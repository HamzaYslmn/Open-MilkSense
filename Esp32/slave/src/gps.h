#pragma once
#include <Arduino.h>
#include <TinyGPSPlus.h>   // Library: "TinyGPSPlus" by Mikal Hart

// NEO-6M / NEO-8M on UART2. Adjust pins to your wiring.
#define GPS_RX  16   // ESP32 RX  <- GPS TX
#define GPS_TX  17   // ESP32 TX  -> GPS RX
#define GPS_BAUD 9600

inline TinyGPSPlus gps;
inline HardwareSerial GPSSerial(2);

inline void gpsBegin() {
  GPSSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX, GPS_TX);
}

// Call often (also while waiting for the TDMA slot) so the UART buffer never overflows.
inline void gpsFeed() {
  while (GPSSerial.available()) gps.encode(GPSSerial.read());
}
