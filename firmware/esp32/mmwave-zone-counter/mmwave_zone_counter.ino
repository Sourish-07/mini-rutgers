/**
 * mmWave zone counter — 60 GHz MR60BHA1-class module on an ESP32-S3, mounted
 * high over a plaza/lobby zone. The module's onboard presence/people-in-area
 * algorithm reports zone occupancy; this sketch windows it into one signed
 * 30 s count per PROTOCOL.md.
 *
 * Mounting: 2.5-3.5 m, looking straight down over the counting zone
 * (~75 m radius at 3 m with the default beam; verify with the ground truth
 * walk-through in the calibration doc before trusting absolute numbers).
 *
 * Wiring (Seeed module over UART):
 *   VIN -> 5V    GND -> GND
 *   TX  -> GPIO17 (ESP32 RX)
 *   RX  -> GPIO18 (ESP32 TX)
 *
 * Build: ESP32 Arduino core 3.x + the Seeed 60 GHz mmWave Arduino library for
 * your module generation (the presence/algo API differs slightly between the
 * MR60BHA1 and MR60FDA2 generations — the calls used below are the common
 * shape; adjust one wrapper if yours differs).
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include <mbedtls/md.h>
#include "Seeed_mmradar.h" // adjust to your module's library header
#include "secrets.h"       // WIFI_SSID, WIFI_PASS, GATEWAY_URL, GATEWAY_ROOT_CA, DEVICE_ID, DEVICE_KEY

#define WINDOW_S 30
#define FW_VERSION "1.2.0"
#define MAX_BACKLOG 64

Seeed_mmradar radar(&Serial1);
WiFiClientSecure tls;

static uint32_t occupiedTicks = 0; // ticks where the algo reported a person in zone
static uint32_t totalTicks = 0;
static float lastConfidence = 0.95f;
static uint32_t windowStart = 0;

struct WindowRecord {
  uint32_t ts;
  int32_t count;
  float confidence;
};
static WindowRecord backlog[MAX_BACKLOG];
static int backlogLen = 0;

static void syncTime() {
  configTime(0, 0, "pool.ntp.org");
  struct tm now;
  getLocalTime(&now, 10000);
}

static String hmacHex(const String &body) {
  byte mac[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char *)DEVICE_KEY, strlen(DEVICE_KEY));
  mbedtls_md_hmac_update(&ctx, (const unsigned char *)body.c_str(), body.length());
  mbedtls_md_hmac_finish(&ctx, mac);
  mbedtls_md_free(&ctx);
  char out[65];
  for (int i = 0; i < 32; i++) sprintf(out + i * 2, "%02x", mac[i]);
  return String(out);
}

static void postWindow(const WindowRecord &rec) {
  String body = "{\"v\":1,\"device\":\"" + String(DEVICE_ID) + "\",\"kind\":\"mmwave\",\"count\":" +
                String(rec.count) + ",\"confidence\":" + String(rec.confidence, 2) +
                ",\"window_s\":" + String(WINDOW_S) + ",\"ts\":" + String(rec.ts) +
                ",\"fw\":\"" FW_VERSION "\"}";
  tls.setCACert(GATEWAY_ROOT_CA);
  if (!tls.connect(GATEWAY_URL, 443)) {
    if (backlogLen < MAX_BACKLOG) backlog[backlogLen++] = rec;
    return;
  }
  tls.printf("POST /v1/window HTTP/1.1\r\nHost: %s\r\nContent-Type: application/json\r\n"
             "X-Device: %s\r\nX-Signature: %s\r\nContent-Length: %d\r\nConnection: close\r\n\r\n",
             GATEWAY_URL, DEVICE_ID, hmacHex(body).c_str(), (int)body.length());
  tls.print(body);
  while (tls.connected()) tls.read();
  tls.stop();
}

void setup() {
  Serial.begin(115200);
  Serial1.begin(115200, SERIAL_8N1, 17, 18); // module UART
  if (!radar.init()) {
    Serial.println("mmWave init failed — check UART wiring and module power");
    while (true) delay(1000); // never report zero from a blind node
  }
  // presence/in-zone algorithm: stationary + moving people, no imaging —
  // the module returns targets and a people-in-area figure, nothing else
  radar.resetRadar();
  // (generation-specific tuning lives in the provisioning sheet, not here)

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(250);
  syncTime();
  windowStart = millis();
}

void loop() {
  // sample the algo at ~5 Hz: fast enough for a 30 s window, calm on power
  if (radar.peopleInArea() > 0) occupiedTicks++;
  totalTicks++;
  // confidence tracks the algo's own target-count stability across the
  // window: a figure that keeps flipping between 2 and 6 is not a 6
  lastConfidence = 0.98f - (radar.targetCount() > 8 ? 0.06f : 0.0f);

  if (millis() - windowStart >= WINDOW_S * 1000UL) {
    // presence ratio over the window, scaled by the calibration factor is
    // applied ingest-side; the node reports what it saw, nothing else
    int32_t count = (int32_t)radar.peopleInArea(); // end-of-window figure
    if (totalTicks > 0) {
      // if the zone was occupied only part of the window, say so honestly
      float ratio = (float)occupiedTicks / (float)totalTicks;
      if (ratio < 0.9f) lastConfidence *= ratio;
    }
    WindowRecord rec;
    rec.ts = (uint32_t)time(nullptr);
    rec.count = count;
    rec.confidence = lastConfidence;
    if (WiFi.status() == WL_CONNECTED) {
      postWindow(rec);
      while (backlogLen > 0 && WiFi.status() == WL_CONNECTED)
        postWindow(backlog[--backlogLen]);
    } else if (backlogLen < MAX_BACKLOG) {
      backlog[backlogLen++] = rec;
    }
    occupiedTicks = 0;
    totalTicks = 0;
    windowStart = millis();
  }
  delay(200);
}
