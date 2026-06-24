// MilkSense MASTER (receiver/gateway) — LoRa + Wi-Fi. No GPS, no buzzer.
// Beacons all collars once per frame, collects their GPS replies, and streams
// each reading to the backend over a WebSocket as JSON. Buzzer commands arrive
// from the backend and ride out in the next beacon's bitmap.
//
// Up   (master -> backend): {"id":N,"ts":epoch,"lat":..,"lng":..,"sats":N,"batt":N,"hr":N,"steps":N,"temp":N,"sound":N,"acev":N,"epc":"hex","rssi":N,"snr":N}
// Down (backend -> master): "buzz <id> <0|1>"   (plain text, parsed with sscanf)
//
// Libraries: LoRa (Sandeep Mistry), ArduinoWebsockets (gilmaimon)
// Board: "ESP32 Dev Module" (ESP32 classic)

#include <WiFi.h>
#include <ArduinoWebsockets.h>
#include "src/lora.h"

using namespace websockets;

// ===== CONFIG =====
#define WIFI_SSID  "your-ssid"
#define WIFI_PASS  "your-pass"
#define WS_URL     "ws://192.168.1.100:8001/api/ws?role=master"   // backend WebSocket

#define HIGHEST_ID 100                              // highest NODE_ID you deploy
#define FRAME_MS   ((HIGHEST_ID + 2) * SLOT_MS)     // time for one full sweep (~12s @ 100 nodes, SLOT_MS=120)

WebsocketsClient ws;
uint8_t  buzzBitmap[(MAX_NODES + 7) / 8] = {0};     // set by backend commands, sent every beacon
uint16_t frame = 0;
unsigned long lastBeacon = 0, lastWsTry = 0;

// Backend -> master: "buzz <id> <0|1>". Single-threaded (runs inside ws.poll()), no locking needed.
void onMessage(WebsocketsMessage m) {
  int id, on;
  if (sscanf(m.data().c_str(), "buzz %d %d", &id, &on) == 2 && id > 0 && id < MAX_NODES) {
    if (on) buzzBitmap[id >> 3] |=  (1 << (id & 7));
    else    buzzBitmap[id >> 3] &= ~(1 << (id & 7));
  }
}

void wifiConnect() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.printf("\nWiFi %s\n", WiFi.localIP().toString().c_str());
}

void setup() {
  Serial.begin(115200);
  if (!loraBegin()) { Serial.println("LoRa init failed"); while (true) delay(1000); }
  wifiConnect();
  ws.onMessage(onMessage);
  ws.connect(WS_URL);
  Serial.println("Master up");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) wifiConnect();
  ws.poll();

  // Reconnect the WebSocket if it dropped (non-blocking, every 3s).
  if (!ws.available() && millis() - lastWsTry > 3000) {
    ws.connect(WS_URL);
    lastWsTry = millis();
  }

  // Start of frame: broadcast the beacon (carries the buzz bitmap for every collar).
  if (millis() - lastBeacon >= FRAME_MS) {
    Beacon b; b.type = PKT_BEACON; b.frame = frame++;
    memcpy(b.buzz, buzzBitmap, sizeof(b.buzz));
    loraSendBeacon(b);
    lastBeacon = millis();
  }

  // Collect collar replies and forward each immediately.
  uint8_t buf[48];
  int len = loraReceive(buf, sizeof(buf));
  if (len == (int)sizeof(Report) && buf[0] == PKT_REPORT) {
    Report r; memcpy(&r, buf, sizeof(r));
    char epc[25];
    for (int i = 0; i < 12; i++) snprintf(epc + i * 2, 3, "%02X", r.epc[i]);  // 24-hex; all-zero = no tag
    char json[288];
    snprintf(json, sizeof(json),
      "{\"id\":%u,\"ts\":%lu,\"lat\":%.6f,\"lng\":%.6f,\"sats\":%u,\"batt\":%u,"
      "\"hr\":%u,\"steps\":%u,\"temp\":%.2f,\"sound\":%u,\"acev\":%u,\"epc\":\"%s\",\"rssi\":%d,\"snr\":%.1f}",
      r.id, (unsigned long)r.ts, r.lat / 1e6, r.lng / 1e6, r.sats, r.batt,
      r.hr, r.steps, r.temp / 100.0, r.sound, r.acev, epc, LoRa.packetRssi(), LoRa.packetSnr());
    if (ws.available()) ws.send(json);
    Serial.println(json);
  }
}
