#pragma once
#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>   // Library: "LoRa" by Sandeep Mistry

// ===== WIRING (generic ESP32 + SX127x / RA-02 / RFM95) =====
// SPI uses the default ESP32 VSPI pins: SCK=18, MISO=19, MOSI=23.
#define LORA_SS    5
#define LORA_RST   14
#define LORA_DIO0  2

// ===== RADIO CONFIG — must match the master =====
#define LORA_FREQ      868E6     // EU868. Use 915E6 (US) or 433E6 per your region/module.
#define LORA_SYNCWORD  0x34      // private network id; both ends must match
#define LORA_SF        7         // SF7 = fastest (~50ms airtime for a report). Raise for range; then raise SLOT_MS too.
#define LORA_BW        125E3
#define LORA_TXPOWER   20        // dBm, PA_BOOST

// ===== TDMA =====
// Slave waits (NODE_ID * SLOT_MS) after each beacon, then transmits in its slot.
// SLOT_MS must exceed report airtime (~80ms for the 35-byte report @ SF7/BW125) + guard. Calibrate if you change SF/BW.
#define SLOT_MS    150
#define MAX_NODES  128           // sizes the buzz bitmap; valid NODE_IDs are 1..MAX_NODES-1

// ===== WIRE PROTOCOL — keep byte-identical with master/src/lora.h =====
#define PKT_BEACON 'B'
#define PKT_REPORT 'R'

#pragma pack(push, 1)
struct Beacon {                          // master -> all (broadcast), one per frame
  uint8_t  type;                         // 'B'
  uint16_t frame;
  uint8_t  buzz[(MAX_NODES + 7) / 8];    // 1 bit per NODE_ID; set => buzzer on
};
struct Report {                          // slave -> master, in its slot
  uint8_t  type;                         // 'R'
  uint16_t id;
  uint32_t ts;                           // capture time, unix epoch from RTC (0 = unset)
  int32_t  lat;                          // degrees * 1e6
  int32_t  lng;                          // degrees * 1e6
  uint8_t  sats;
  uint8_t  batt;                         // %
  uint8_t  hr;                           // heart rate, bpm (0 = no reading)
  uint16_t steps;                        // steps since last report
  int16_t  temp;                         // degrees C * 100
  uint8_t  sound;                        // relative acoustic level, dB-ish 0..~90 (INMP441 RMS)
  uint8_t  acev;                         // acoustic events (cough/vocalization proxy) since last report
  uint8_t  epc[12];                      // last-read UHF RFID tag EPC (96-bit); all-zero = none
};
#pragma pack(pop)

// Compile-time guard: catches struct padding that would corrupt the wire format.
static_assert(sizeof(Report) == 36, "Report packing changed");
static_assert(sizeof(Beacon) == 3 + (MAX_NODES + 7) / 8, "Beacon packing changed");

inline bool loraBegin() {
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) return false;
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setSyncWord(LORA_SYNCWORD);
  LoRa.setTxPower(LORA_TXPOWER);
  LoRa.enableCrc();                      // drop corrupt packets (matters at 100 nodes)
  return true;
}

// Returns packet length, or 0 if nothing received.
inline int loraReceive(uint8_t* buf, int maxlen) {
  int len = LoRa.parsePacket();
  if (len <= 0) return 0;
  int i = 0;
  while (LoRa.available() && i < maxlen) buf[i++] = LoRa.read();
  return i;
}

inline void loraSendReport(const Report& r) {
  LoRa.beginPacket();
  LoRa.write((const uint8_t*)&r, sizeof(r));
  LoRa.endPacket();                      // blocking until sent
}
