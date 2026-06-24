// MilkSense SLAVE (cow collar) — GPS + LoRa + buzzer. No Wi-Fi.
// Listens for the master's beacon, buzzes if its bit is set, then replies
// with GPS in its own TDMA slot (NODE_ID * SLOT_MS after the beacon).
//
// Libraries: LoRa (Sandeep Mistry), TinyGPSPlus (Mikal Hart), SparkFun MAX3010x,
//            OneWire, DallasTemperature, RTClib, SparkFun Simultaneous RFID Tag Reader
// Sensors: MAX30102 heart rate, MPU6050 accel+gyro (pedometer), DS18B20 temperature,
//          INMP441 I2S mic (acoustic level + cough/call events), DS3231 RTC,
//          M6E-Nano UHF RFID reader, buzzer.
// Board: "ESP32 Dev Module" (ESP32 classic)

#include "src/lora.h"
#include "src/gps.h"
#include "src/sensors.h"
#include "src/rfid.h"

// ===== PER-COLLAR CONFIG =====
#define NODE_ID  1            // UNIQUE per collar, 1..HIGHEST_ID (HIGHEST_ID is set on the master)

// ===== BUZZER (cheap active buzzer module, active-high) =====
#define BUZZER_PIN  25
// ponytail: active buzzer => digitalWrite. Passive piezo? use tone(BUZZER_PIN,2000)/noTone.
inline void buzzerSet(bool on) { digitalWrite(BUZZER_PIN, on ? HIGH : LOW); }

// ===== BATTERY (optional) — LiPo via resistor divider on an ADC pin =====
#define BATT_PIN  34
#define BATT_DIV  2.0         // divider ratio; set to match your resistors. Calibrate.
inline uint8_t batteryPct() {
  float v = analogRead(BATT_PIN) / 4095.0f * 3.3f * BATT_DIV;     // measured battery volts
  long pct = map((long)(v * 100), 330, 420, 0, 100);             // 3.3V..4.2V LiPo. Calibrate to your cell.
  return (uint8_t)constrain(pct, 0, 100);
}

#define BEACON_TIMEOUT_MS  60000   // no beacon this long => silence buzzer (don't drain battery if master dies)
unsigned long lastBeacon = 0;

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  buzzerSet(false);
  gpsBegin();
  sensorsBegin();
  rfidBegin();
  if (!loraBegin()) { Serial.println("LoRa init failed"); while (true) delay(1000); }
  Serial.printf("Slave %d up\n", NODE_ID);
}

void loop() {
  gpsFeed();
  sensorsUpdate();
  rfidUpdate();

  uint8_t buf[48];
  int len = loraReceive(buf, sizeof(buf));

  if (len == (int)sizeof(Beacon) && buf[0] == PKT_BEACON) {
    Beacon b; memcpy(&b, buf, sizeof(b));
    lastBeacon = millis();

    bool buzz = b.buzz[NODE_ID >> 3] & (1 << (NODE_ID & 7));
    buzzerSet(buzz);

    // Wait for our slot, keeping GPS and sensors sampling so the data stays fresh.
    unsigned long start = millis(), wait = (unsigned long)NODE_ID * SLOT_MS;
    while (millis() - start < wait) { gpsFeed(); sensorsUpdate(); rfidUpdate(); }

    Report r;
    r.type  = PKT_REPORT;
    r.id    = NODE_ID;
    r.ts    = sensEpoch();
    r.lat   = gps.location.isValid() ? (int32_t)(gps.location.lat() * 1e6) : 0;
    r.lng   = gps.location.isValid() ? (int32_t)(gps.location.lng() * 1e6) : 0;
    r.sats  = gps.satellites.isValid() ? (uint8_t)gps.satellites.value() : 0;
    r.batt  = batteryPct();
    r.hr    = sensHr();
    r.steps = sensStepsTake();
    r.temp  = sensTempC100();
    r.sound = sensSoundLevel();
    r.acev  = sensAcEventsTake();
    memcpy(r.epc, rfidEpc(), sizeof(r.epc));
    loraSendReport(r);                 // reports even without a fix => acts as a heartbeat
  }

  if (millis() - lastBeacon > BEACON_TIMEOUT_MS) buzzerSet(false);
}
