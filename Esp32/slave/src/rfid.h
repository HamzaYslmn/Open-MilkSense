#pragma once
#include <Arduino.h>
#include <SparkFun_UHF_RFID_Reader.h>   // Library: "SparkFun Simultaneous RFID Tag Reader" (M6E Nano)

// UHF reader on UART1 (UART0=USB, UART2=GPS). Pick free pins.
#define RFID_RX    27       // ESP32 RX  <- reader TX
#define RFID_TX    26       // ESP32 TX  -> reader RX
#define RFID_BAUD  38400    // M6E Nano default
#define RFID_REGION   REGION_EUROPE   // set to your region! (REGION_NORTHAMERICA, REGION_AUSTRALIA, ...)
#define RFID_READPOWER 1000           // 10.00 dBm. Raise toward 2700 (27dBm) for range — watch current draw.
#define RFID_STALE_MS  30000          // forget the last tag if not re-read within this window

inline RFID nano;
inline HardwareSerial RFIDSerial(1);
inline uint8_t  _epc[12] = {0};
inline uint32_t _epcSeen = 0;

inline bool rfidBegin() {
  RFIDSerial.begin(RFID_BAUD, SERIAL_8N1, RFID_RX, RFID_TX);
  nano.begin(RFIDSerial);
  nano.setRegion(RFID_REGION);
  nano.setReadPower(RFID_READPOWER);
  nano.startReading();                 // continuous read; tags stream in asynchronously
  return true;
}

// Call often. Captures the most recently seen tag's EPC.
inline void rfidUpdate() {
  if (!nano.check()) return;
  if (nano.parseResponse() != RESPONSE_IS_TAGFOUND) return;
  uint8_t n = nano.getTagEPCBytes();
  if (n > 12) n = 12;
  memset(_epc, 0, sizeof(_epc));
  for (uint8_t i = 0; i < n; i++) _epc[i] = nano.msg[31 + i];   // EPC offset per SparkFun continuous-read example
  _epcSeen = millis();
}

// 12 bytes; all-zero if no tag seen within RFID_STALE_MS.
inline const uint8_t* rfidEpc() {
  static uint8_t out[12];
  if (_epcSeen == 0 || millis() - _epcSeen > RFID_STALE_MS) { memset(out, 0, 12); return out; }
  memcpy(out, _epc, 12);
  return out;
}
