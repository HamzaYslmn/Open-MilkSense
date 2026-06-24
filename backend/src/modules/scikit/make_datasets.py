"""Generate two MilkSense ESP32-collar datasets, all cows combined into each:

    Cow_Behavior_Dataset.csv  -> label = what the cow is DOING
                                 (resting, eating, drinking, grazing, standing,
                                  walking, milking, mounting/mating)
    Cow_Health_Dataset.csv    -> label = its HEALTH condition
                                 (healthy, fever, respiratory, lameness, heat_stress)

Both files share the exact same sensor columns -- every one is something the ESP32
collar actually produces (the LoRa `Report` packet + the master's link metrics),
nothing beyond that:

    DS3231 RTC      -> timestamp
    node id         -> cow_id
    UHF RFID (EPC)  -> rfid_epc, rfid_zone (gate reader the tag was seen at)
    GPS             -> gps_lat, gps_lng, gps_sats
    battery ADC     -> battery_pct
    MAX30102        -> heart_rate_bpm
    MPU6050         -> steps (per 5-min report)
    DS18B20         -> body_temp_c
    INMP441 mic     -> sound_level_db, acoustic_events
    LoRa (master)   -> lora_rssi_dbm, lora_snr_db

Behaviour is derived from the cow's current zone (+ estrus -> mounting); health from
its assigned condition (estrus is reproductive, so estrus cows read health=healthy).
Each cow starts healthy and an onset partway through flips it to its condition, so the
health file contains realistic healthy->condition rows.

Run: `uv run python make_datasets.py`  (stdlib only, no deps needed)
"""
import csv, math, random
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).parent / "datasets"
REPORT_S = 300          # collar reports every 5 min
DAYS = 5                # ~1440 rows per cow
BASE_LAT, BASE_LNG = 40.98760, 29.12340
M_LAT, M_LNG = 111_320.0, 84_000.0   # metres per degree at this latitude
GATES = {"feeding", "watering", "parlor"}
AREA_NOISE = {"feeding": 9, "watering": 4, "paddock": 2, "barn": 3,
              "bedding": 0, "waiting": 7, "parlor_path": 8, "parlor": 15}
# per-zone motion level, so behaviours actually separate on the step counter
AREA_STEP = {"bedding": 0.3, "feeding": 0.7, "watering": 0.9, "paddock": 1.4,
             "barn": 0.8, "waiting": 1.1, "parlor_path": 1.3, "parlor": 0.5}
# zone -> the activity the cow is doing there
BEHAVIOR = {"bedding": "resting", "feeding": "eating", "watering": "drinking",
            "paddock": "grazing", "barn": "standing", "waiting": "walking",
            "parlor_path": "walking", "parlor": "milking"}

# cow_id -> (name, condition). Healthy cows included so the models see normal too.
COWS = [
    (1, "Bella", "healthy"), (2, "Daisy", "estrus"), (3, "Luna", "fever"),
    (4, "Maggie", "respiratory"), (5, "Rosie", "lameness"), (6, "Stella", "heat_stress"),
    (7, "Buttercup", "estrus"), (8, "Clover", "fever"), (9, "Hazel", "healthy"),
    (10, "Ivy", "healthy"),
]

SENSOR_COLS = ["timestamp", "cow_id", "rfid_epc", "rfid_zone", "gps_lat", "gps_lng",
               "gps_sats", "battery_pct", "heart_rate_bpm", "steps", "body_temp_c",
               "sound_level_db", "acoustic_events", "lora_rssi_dbm", "lora_snr_db"]


def area_for(hour, rng):
    """Coarse daily routine -> current zone (drives RFID gate reads + behaviour + noise)."""
    if hour < 5 or hour >= 21:
        return "bedding"
    if 5 <= hour < 6 or 16 <= hour < 17:
        return rng.choice(["waiting", "parlor_path", "parlor"])
    if 6 <= hour < 9 or 17 <= hour < 19:
        return rng.choice(["feeding", "feeding", "watering"])
    return rng.choice(["paddock", "paddock", "watering", "barn"])


def gen_cow(cow_id, condition, start_ts):
    """Return list of (sensor_row, behavior_label, health_label) for one cow."""
    rng = random.Random(cow_id * 7919)            # reproducible per cow
    epc = ("E2801170" + format(cow_id, "016x")).upper()
    onset = start_ts + int((1.0 + rng.random()) * 86400)   # day 2-ish
    activity = 1.0 + rng.uniform(-0.12, 0.12)
    batt = rng.uniform(96, 100)
    ang, dist = rng.uniform(0, 2 * math.pi), rng.uniform(10, 120)
    hx, hy = dist * math.cos(ang), dist * math.sin(ang)
    px, py = hx, hy
    area, dwell_left = "bedding", 0
    out = []
    n = DAYS * 86400 // REPORT_S
    for i in range(n):
        ts = start_ts + i * REPORT_S
        hour = (ts % 86400) / 3600
        sick = ts >= onset
        cond = condition if sick else "healthy"
        diurnal = 0.5 if (hour < 5 or hour >= 21) else 1 + 0.18 * math.sin((hour - 9) / 24 * 2 * math.pi)
        # behaviour persists: a cow stays in an activity for a while, it doesn't re-roll every
        # 5 min. This dwell is what makes a window of reports meaningful to classify.
        forced = "bedding" if (hour < 5 or hour >= 21) else None
        if dwell_left <= 0 or (forced and area != forced):
            area = area_for(hour, rng)
            dwell_left = rng.randint(3, 10)       # 15–50 min in one activity
        dwell_left -= 1

        # --- baseline sensor model (healthy cow) ---
        steps = activity * 11 * diurnal * AREA_STEP[area] * rng.uniform(0.8, 1.2)
        hr = 56 + diurnal * 9 + (activity - 1) * 6 + rng.gauss(0, 2)
        temp = 38.6 + 0.34 * math.sin((hour - 8) / 24 * 2 * math.pi) + rng.gauss(0, 0.07)
        night = -9 if (hour < 5 or hour >= 21) else 0
        sound = 44 + AREA_NOISE[area] + night + (activity - 1) * 5 + rng.gauss(0, 3)
        acev = 1 if rng.random() < 0.05 else 0

        behavior = BEHAVIOR[area]
        mid = max(0.0, math.sin((hour - 13) / 12 * math.pi))   # midday heat factor, peaks ~13:00

        # --- condition signatures (after onset) ---
        if cond == "estrus":                       # restless, mounting, bellowing
            steps *= 2.3; hr += 9; temp += 0.25
            if hour < 5 or hour >= 21: steps *= 2.0
            acev += rng.randint(0, 2)
            if area not in ("feeding", "watering", "parlor"):   # the cow is mounting, not grazing
                behavior = "mounting"
        elif cond == "fever":                      # systemic illness: hot, tachycardic, lethargic
            steps *= 0.55; hr += 13; temp += rng.uniform(1.3, 1.9)
            sound -= 4; acev += 1 if rng.random() < 0.2 else 0
        elif cond == "respiratory":                # pneumonia: coughing, mild fever
            steps *= 0.8; hr += 8; temp += rng.uniform(0.5, 0.9)
            sound += 5; acev += rng.randint(2, 4)
        elif cond == "lameness":                   # sore: stands/lies, very few steps
            steps *= 0.4; hr += 5; sound -= 5
        elif cond == "heat_stress":                # midday ambient heat: panting
            steps *= (1 - 0.5 * mid); hr += 16 * mid
            temp += 1.1 * mid; sound += 8 * mid
            acev += 1 if rng.random() < 0.15 * (mid + 0.2) else 0

        # health label: estrus is reproductive (not illness); heat_stress only shows midday
        if cond in ("fever", "respiratory", "lameness"):
            health = cond
        elif cond == "heat_stress":
            health = "heat_stress" if mid > 0.25 else "healthy"
        else:
            health = "healthy"

        # GPS random walk back toward home
        px += rng.uniform(-18, 18) + (hx - px) * 0.15
        py += rng.uniform(-18, 18) + (hy - py) * 0.15
        gdist = math.hypot(px, py)
        rssi = max(-120, -55 - gdist * 0.13 + rng.uniform(-4, 4))
        snr = max(-6, min(12, 11 - gdist * 0.025 + rng.uniform(-1.5, 1.5)))
        batt = max(0, batt - 0.011)

        sensor_row = [
            datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            cow_id,
            epc if area in GATES else "",
            area if area in GATES else "",
            round(BASE_LAT + px / M_LAT, 6), round(BASE_LNG + py / M_LNG, 6),
            rng.randint(7, 11), round(batt, 1),
            max(0, round(hr)), max(0, round(steps)), round(temp, 2),
            max(30, min(95, round(sound))), int(acev),
            round(rssi), round(snr, 1),
        ]
        out.append((sensor_row, behavior, health))
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    start = int(datetime(2026, 6, 21, tzinfo=timezone.utc).timestamp())
    all_rows = []
    for cow_id, _name, condition in COWS:
        all_rows += gen_cow(cow_id, condition, start)
    all_rows.sort(key=lambda r: (r[0][0], r[0][1]))    # by timestamp, then cow_id

    for fname, label_name, idx in [("Cow_Behavior_Dataset.csv", "behavior", 1),
                                   ("Cow_Health_Dataset.csv", "health_status", 2)]:
        path = OUT / fname
        with open(path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(SENSOR_COLS + [label_name])
            w.writerows(r[0] + [r[idx]] for r in all_rows)
        labels = sorted({r[idx] for r in all_rows})
        print(f"{fname}: {len(all_rows)} rows from {len(COWS)} cows, {label_name} classes={labels}")


if __name__ == "__main__":
    main()
