// Herd model: a barn area state-machine that emits report/nfc/milk messages, ported from the
// Python emulator. Realistic-ish dairy behaviour with a handful of demo anomalies.
import { BASE_LAT, BASE_LNG, M_LAT, M_LNG } from "./geofence.js";

export const TIME_ACCEL = 120;
export const NUM_COWS = 12;
export const REPORT_S = 300;
export const MILK_HOURS = [5, 17];
export const ANOMALY = { 2: "heat", 5: "feeding", 7: "health", 10: "productivity" };
export const STRAY = new Set([3, 8, 11]);
export const NAMES = ["Bella", "Daisy", "Luna", "Maggie", "Rosie", "Stella",
  "Buttercup", "Clover", "Hazel", "Ivy", "Willow", "Penny"];
export const NO_EPC = "0".repeat(24);  // wire sentinel: no RFID tag read this report
// what a cow in each zone is doing — the same activity vocabulary the scikit behaviour model uses
export const AREA_BEHAVIOR = {
  bedding: "resting", feeding: "eating", watering: "drinking", paddock: "grazing",
  barn: "standing", waiting: "waiting", parlor_path: "walking", parlor: "milking",
};

// [dwell_lo, dwell_hi (min), hr_lo, hr_hi]
const PROFILE = {
  bedding: [70, 140, 48, 56], feeding: [35, 70, 56, 64], watering: [3, 8, 58, 66],
  paddock: [30, 90, 64, 78], barn: [30, 90, 54, 62], waiting: [10, 30, 60, 70],
  parlor_path: [1, 3, 66, 80], parlor: [5, 10, 60, 72],
};
const WEIGHTS = {
  feeding: { watering: 0.5, bedding: 0.3, barn: 0.2 },
  watering: { feeding: 0.3, paddock: 0.3, bedding: 0.2, barn: 0.2 },
  bedding: { feeding: 0.4, watering: 0.2, paddock: 0.2, barn: 0.2 },
  paddock: { watering: 0.35, feeding: 0.3, bedding: 0.25, barn: 0.1 },
  barn: { feeding: 0.35, bedding: 0.3, watering: 0.2, paddock: 0.15 },
  waiting: { parlor_path: 1 }, parlor_path: { feeding: 1 }, parlor: { parlor_path: 1 },
};
const AREA_STEP = { bedding: 0.75, feeding: 0.9, watering: 1.05, paddock: 1.2,
  barn: 0.9, waiting: 1.0, parlor_path: 1.25, parlor: 0.75 };
const RFID_GATES = new Set(["feeding", "watering", "parlor"]);  // zones with a UHF gate reader



export const DAY0 = Math.floor(Date.now() / 1000 / 86400) * 86400;
export const LIVE_START = DAY0 + 8 * 3600;
export const INIT_T = LIVE_START - 28 * 3600;
export const START_DAY = Math.floor(DAY0 / 86400);

const rndU = (a, b) => a + Math.random() * (b - a);
const rndI = (a, b) => Math.floor(rndU(a, b + 1));
const gauss = (m, s) => { const u = Math.random() || 1e-9, v = Math.random(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function choice(weights) {
  const keys = Object.keys(weights), tot = keys.reduce((s, k) => s + weights[k], 0);
  let r = Math.random() * tot;
  for (const k of keys) { r -= weights[k]; if (r <= 0) return k; }
  return keys[keys.length - 1];
}

export class Cow {
  constructor(id) {
    this.id = id;
    this.name = NAMES[(id - 1) % NAMES.length];
    this.anomaly = ANOMALY[id] || null;
    this.area = "bedding";
    this.areaEnter = INIT_T;
    this.dwell = this._dwell("bedding");
    this.lastReport = INIT_T;
    this.batt = rndU(88, 100);
    this.milkDaily = rndU(28, 38);
    this.activity = this.anomaly === "heat" ? 2.2 : this.anomaly === "health" ? 0.7 : rndU(0.85, 1.15);
    const ang = rndU(0, 2 * Math.PI);
    const dist = STRAY.has(id) ? rndU(350, 430) : rndU(0, 130);
    this.home = [dist * Math.cos(ang), dist * Math.sin(ang)];
    this.pos = [...this.home];
    this.milked = new Set();
    this.pending = [];
    this.buzzer = false;
    // Unique 96-bit UHF EPC per animal (ear tag). Read whenever the cow passes a gate reader.
    this.epc = ("E2801170" + id.toString(16).padStart(16, "0")).toUpperCase();
  }
  _dwell(area) {
    let d = rndU(PROFILE[area][0], PROFILE[area][1]);
    if (this.anomaly === "heat" && area === "bedding") d *= 0.5;
    if (this.anomaly === "health" && area === "bedding") d *= 0.4;
    if ((this.anomaly === "health" || this.anomaly === "feeding") && area === "feeding") d *= this.anomaly === "health" ? 0.5 : 0.3;
    return Math.max(1, d) * 60;
  }
  _dueMilking(t) {
    const day = Math.floor(t / 86400), hour = Math.floor((t % 86400) / 3600);
    for (const mh of MILK_HOURS) if (mh <= hour && hour < mh + 2 && !this.milked.has(day + ":" + mh)) return day + ":" + mh;
    return null;
  }
  _forcedMilkTime(after, until) {
    if (this.pending.length || ["waiting", "parlor_path", "parlor"].includes(this.area)) return null;
    const cands = [];
    for (const day of [Math.floor(after / 86400), Math.floor(after / 86400) + 1])
      for (const mh of MILK_HOURS) {
        if (this.milked.has(day + ":" + mh)) continue;
        const ws = day * 86400 + mh * 3600, cand = Math.max(ws, after);
        if (cand < ws + 2 * 3600 && cand <= until) cands.push(cand);
      }
    return cands.length ? Math.min(...cands) : null;
  }
  _nextArea(t) {
    if (this.pending.length) return this.pending.shift();
    const due = this._dueMilking(t);
    if (due) { this.milked.add(due); this.pending = ["waiting", "parlor_path", "parlor", "parlor_path", "feeding"]; return this.pending.shift(); }
    const w = { ...WEIGHTS[this.area] };
    if (this.anomaly === "heat") w.paddock = (w.paddock || 0) + 0.4;
    if (this.anomaly === "feeding") { if (w.feeding) w.feeding *= 0.3; if (w.paddock) w.paddock *= 0.4; }
    if (this.anomaly === "health" && w.bedding) w.bedding *= 0.3;
    return choice(w);
  }
  sessionLiters(t) {
    let daily = this.milkDaily;
    if (this.anomaly === "productivity") daily *= Math.min(1.4, Math.max(0.5, Math.pow(0.9, Math.floor(t / 86400) - START_DAY)));
    const share = (t % 86400) / 3600 < 12 ? 0.55 : 0.45;
    return +(daily * share * rndU(0.92, 1.08)).toFixed(1);
  }
  report(t) {
    const hour = (t % 86400) / 3600;
    const diurnal = hour < 5 || hour >= 21 ? 0.55 : 1 + 0.15 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
    let steps = this.activity * 10 * AREA_STEP[this.area] * diurnal * rndU(0.85, 1.15);
    if (this.buzzer) steps *= 1.2;
    let hr = rndI(PROFILE[this.area][2], PROFILE[this.area][3]) + Math.round((this.activity - 1) * 6);
    if (this.anomaly === "heat" || this.buzzer) hr += rndI(5, 10);
    let temp = 38.6 + 0.32 * Math.sin(((hour - 8) / 24) * 2 * Math.PI) + gauss(0, 0.07);
    if (["paddock", "parlor_path", "waiting"].includes(this.area)) temp += 0.1;
    if (this.anomaly === "health") { temp += rndU(1.2, 1.8); hr += rndI(8, 15); }
    this.pos[0] += rndU(-22, 22) + (this.home[0] - this.pos[0]) * 0.15;
    this.pos[1] += rndU(-22, 22) + (this.home[1] - this.pos[1]) * 0.15;
    const dist = Math.hypot(this.pos[0], this.pos[1]);
    const rssi = Math.round(Math.max(-120, -55 - dist * 0.13 + rndU(-4, 4)));
    const snr = +Math.max(-6, Math.min(12, 11 - dist * 0.025 + rndU(-1.5, 1.5))).toFixed(1);
    // Acoustic (INMP441 proxy): relative level dB-ish + cough/vocalization events since last report.
    const AREA_NOISE = { feeding: 9, watering: 4, paddock: 2, barn: 3, bedding: 0, waiting: 7, parlor_path: 8, parlor: 15 };
    const night = hour < 5 || hour >= 21 ? -9 : 0;          // barn quiets down overnight
    const sound = Math.max(32, Math.min(95, Math.round(44 + (AREA_NOISE[this.area] || 0) + night + (this.activity - 1) * 5 + gauss(0, 3))));
    let acev = Math.random() < 0.04 ? 1 : 0;                            // baseline occasional moo (~11/day)
    if (this.anomaly === "health") acev += rndI(1, 3);                  // coughing / respiratory distress (strong)
    if (this.anomaly === "heat" || this.buzzer) acev += Math.random() < 0.3 ? 1 : 0;  // bellowing / distress (mild)
    this.batt = Math.max(0, this.batt - 0.02);
    return {
      type: "report", id: this.id, ts: Math.round(t),
      lat: +(BASE_LAT + this.pos[0] / M_LAT).toFixed(6), lng: +(BASE_LNG + this.pos[1] / M_LNG).toFixed(6),
      sats: rndI(7, 11), batt: Math.round(this.batt), hr: Math.max(0, hr), steps: Math.max(0, Math.round(steps)),
      temp: +temp.toFixed(2),
      epc: RFID_GATES.has(this.area) ? this.epc : NO_EPC,  // unique tag, only when at a gate reader
      sound, acev, rssi, snr,
    };
  }
}

export function generate(cows, simTo) {
  const msgs = [];
  for (const c of cows) {
    while (true) {
      let end = c.areaEnter + c.dwell;
      const forced = c._forcedMilkTime(c.areaEnter, simTo);
      if (forced != null && forced < end) end = forced;
      if (end > simTo) break;
      if (c.area === "parlor") msgs.push({ type: "milk", id: c.id, liters: c.sessionLiters(end), ts: Math.round(end) });
      const nxt = c._nextArea(end);
      c.area = nxt; c.areaEnter = end; c.dwell = c._dwell(nxt);
      msgs.push({ type: "nfc", id: c.id, area: nxt, ts: Math.round(end) });
    }
    while (c.lastReport + REPORT_S <= simTo) { c.lastReport += REPORT_S; msgs.push(c.report(c.lastReport)); }
  }
  msgs.sort((a, b) => a.ts - b.ts);
  return msgs;
}

export function seedPreviousMilk(cows, days = 4) {
  const out = [];
  for (const c of cows)
    for (let d = days; d > 0; d--)
      for (const mh of MILK_HOURS) {
        const t = DAY0 - d * 86400 + mh * 3600;
        out.push({ type: "milk", id: c.id, liters: c.sessionLiters(t), ts: t });
      }
  return out;
}
