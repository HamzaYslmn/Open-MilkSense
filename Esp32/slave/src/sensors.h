#pragma once
#include <Arduino.h>
#include <Wire.h>
#include <MAX30105.h>           // Library: "SparkFun MAX3010x Pulse and Proximity Sensor"
#include "heartRate.h"          //   (ships with the MAX3010x library)
#include <OneWire.h>            // Library: "OneWire"
#include <DallasTemperature.h>  // Library: "DallasTemperature"
#include <RTClib.h>             // Library: "RTClib" by Adafruit (DS3231)
#include <ESP_I2S.h>            // built into the ESP32 core (arduino-esp32 3.x) — no extra install

// MPU6050 (3-axis accel + gyro) is read over raw I2C — we only need accel for steps,
// so no driver library. Gyro registers (0x43..) are there if you ever want orientation.

// ===== PINS =====
#define I2C_SDA      21         // shared I2C bus: MAX30102 (0x57), DS3231 RTC (0x68), MPU6050 (0x69)
#define I2C_SCL      22
#define DS18B20_PIN  4          // 1-Wire data; needs a 4.7k pull-up to 3.3V
// INMP441 I2S MEMS mic — tie its L/R pin to GND (left channel). din = data in; bclk/ws are ESP32 outputs.
#define MIC_BCK  32
#define MIC_WS   33
#define MIC_SD   35             // data-in; input-only pin is fine
// DS3231 RTC is at 0x68 — the same default as the MPU6050. Tie the MPU6050's AD0 pin HIGH
// to move it to 0x69 so both share the bus.
#define MPU_ADDR     0x69

// ===== STEP DETECTOR — CALIBRATE for cow gait =====
#define STEP_THRESHOLD_G     0.25f   // dynamic accel (g) above the gravity baseline that counts as a step
#define STEP_REFRACTORY_MS   250     // ignore steps closer together than this

// ===== TEMPERATURE cadence =====
#define TEMP_INTERVAL_MS 5000
#define DS18B20_CONV_MS  800         // 12-bit conversion time

// ===== ACOUSTIC (INMP441) — CALIBRATE to your mic/placement =====
#define MIC_RATE             16000   // Hz
#define EVENT_MARGIN_DB      12      // a block this far above rolling ambient = an acoustic event (cough/call)
#define EVENT_REFRACTORY_MS  300

inline MAX30105 hrSensor;
inline OneWire oneWire(DS18B20_PIN);
inline DallasTemperature ds(&oneWire);
inline RTC_DS3231 rtc;
inline bool _rtcOk = false;
inline I2SClass mic;

// readings (0 = no data yet)
inline uint8_t  _bpm = 0;
inline uint16_t _steps = 0;
inline int16_t  _tempC100 = 0;       // deg C * 100
inline uint8_t  _soundDb = 0;        // smoothed relative acoustic level (dB-ish)
inline uint8_t  _acEvents = 0;       // loud acoustic events since last report

// ----- MPU6050 raw accel magnitude in g -----
inline void _mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR); Wire.write(reg); Wire.write(val); Wire.endTransmission();
}
inline float _mpuAccelMag() {
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x3B); Wire.endTransmission(false);  // ACCEL_XOUT_H
  if (Wire.requestFrom(MPU_ADDR, 6) != 6) return 0;
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();
  float x = ax / 16384.0f, y = ay / 16384.0f, z = az / 16384.0f;  // 16384 LSB/g at +-2g
  return sqrtf(x * x + y * y + z * z);
}

inline bool sensorsBegin() {
  Wire.begin(I2C_SDA, I2C_SCL);
  if (hrSensor.begin(Wire, I2C_SPEED_FAST)) {       // MAX30102 absent => stays 0, no crash
    hrSensor.setup();
    hrSensor.setPulseAmplitudeRed(0x0A);
    hrSensor.setPulseAmplitudeIR(0x20);
  }
  _mpuWrite(0x6B, 0x00);                             // PWR_MGMT_1: wake MPU6050
  _mpuWrite(0x1C, 0x00);                             // ACCEL_CONFIG: +-2g
  ds.begin();
  ds.setWaitForConversion(false);                    // non-blocking temperature reads
  _rtcOk = rtc.begin();
  if (_rtcOk && rtc.lostPower())                     // first power-up: seed from build time; sync properly later
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  mic.setPins(MIC_BCK, MIC_WS, -1, MIC_SD);          // dout unused
  mic.begin(I2S_MODE_STD, MIC_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO);
  return true;
}

// Call as often as possible (also during the TDMA slot wait) so HR/step sampling keeps up.
inline void sensorsUpdate() {
  unsigned long now = millis();

  // Heart rate (motion-sensitive on a moving animal — treat as a coarse estimate).
  static long lastBeat = 0; static float bpmAvg = 0;
  long ir = hrSensor.getIR();
  if (ir < 50000) { _bpm = 0; }                      // no skin contact
  else if (checkForBeat(ir)) {
    float bpm = 60000.0f / (now - lastBeat);
    lastBeat = now;
    if (bpm > 20 && bpm < 255) { bpmAvg = bpmAvg ? bpmAvg * 0.75f + bpm * 0.25f : bpm; _bpm = (uint8_t)bpmAvg; }
  }

  // Step counter: peak detection on accel-above-gravity with hysteresis + refractory.
  static float baseline = 1.0f; static unsigned long lastStep = 0; static bool above = false;
  float mag = _mpuAccelMag();
  baseline = baseline * 0.98f + mag * 0.02f;         // slow-tracking gravity baseline
  float dyn = fabsf(mag - baseline);
  if (!above && dyn > STEP_THRESHOLD_G && now - lastStep > STEP_REFRACTORY_MS) {
    _steps++; lastStep = now; above = true;
  } else if (dyn < STEP_THRESHOLD_G * 0.5f) {
    above = false;
  }

  // Acoustic (INMP441): when a DMA block is ready, compute its RMS level and flag loud events
  // (cough / vocalization proxy) against a slow-tracking ambient floor.
  static int16_t mbuf[256];
  static float ambientDb = 30.0f; static unsigned long lastEvent = 0;
  if (mic.available() >= (int)sizeof(mbuf)) {
    int n = mic.readBytes((char*)mbuf, sizeof(mbuf)) / 2;        // int16 samples (left slot)
    uint64_t sumsq = 0;
    for (int i = 0; i < n; i++) sumsq += (int32_t)mbuf[i] * mbuf[i];
    float rms = n ? sqrtf((float)sumsq / n) : 0;
    float db = 20.0f * log10f(rms + 1.0f);                       // ~0..90 relative (not absolute SPL — calibrate)
    ambientDb = ambientDb * 0.98f + db * 0.02f;
    if (db > ambientDb + EVENT_MARGIN_DB && now - lastEvent > EVENT_REFRACTORY_MS) {
      if (_acEvents < 255) _acEvents++;
      lastEvent = now;
    }
    _soundDb = (uint8_t)constrain((int)db, 0, 255);
  }

  // Temperature: request, then read once the conversion has had time to finish.
  static unsigned long reqAt = 0; static bool pending = false;
  if (!pending && now - reqAt > TEMP_INTERVAL_MS) { ds.requestTemperatures(); reqAt = now; pending = true; }
  if (pending && now - reqAt > DS18B20_CONV_MS) {
    float c = ds.getTempCByIndex(0);
    if (c > -50) _tempC100 = (int16_t)(c * 100);
    pending = false;
  }
}

inline uint8_t  sensHr()        { return _bpm; }
inline int16_t  sensTempC100()  { return _tempC100; }
inline uint16_t sensStepsTake() { uint16_t s = _steps; _steps = 0; return s; }  // steps since last report
inline uint32_t sensEpoch()        { return _rtcOk ? rtc.now().unixtime() : 0; }
inline uint8_t  sensSoundLevel()   { return _soundDb; }                          // relative acoustic level (dB-ish)
inline uint8_t  sensAcEventsTake() { uint8_t e = _acEvents; _acEvents = 0; return e; }  // cough/call proxy since last report
