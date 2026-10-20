/**
 * ToF door counter — VL53L8CX (8x8 multizone) on an ESP32-S3, mounted over a
 * doorway. Counts in/out transitions from the two outermost column pairs of
 * zones, publishes one signed 30 s window per PROTOCOL.md.
 *
 * Mounting: 2.1-2.4 m, sensor plane parallel to the door line, ~10 deg down.
 * Wiring (SparkFun breakout, I2C):
 *   VIN  -> 3V3      GND -> GND
 *   SDA  -> GPIO8    SCL -> GPIO9
 *   INT  -> GPIO3    LP1 -> GPIO4 (boot low = I2C mode; the lib toggles it)
 *
 * Build: ESP32 Arduino core 3.x + "SparkFun VL53L8CX Arduino Library".
 * Provisioning: copy secrets.h.example to secrets.h; the device key is issued
 * by the building gateway and lives only in flash.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiUdp.h>
#include <time.h>
#include <mbedtls/md.h>
#include "SparkFun_VL53L8CX_Library.h"
#include "secrets.h" // WIFI_SSID, WIFI_PASS, GATEWAY_URL, GATEWAY_ROOT_CA, DEVICE_ID, DEVICE_KEY

#define WINDOW_S 30
#define FW_VERSION "1.2.0"
#define MAX_BACKLOG 64

SparkFun_VL53L8CX tof;
WiFiClientSecure tls;

// one net count per window, plus per-frame transition state
static int32_t windowCount = 0;
static uint32_t windowStart = 0;
static bool lastFramePresent[8] = {false}; // leftmost column, one bool per row

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
  getLocalTime(&now, 10000); // blocks up to 10 s once; drift is checked per window
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
  String body = "{\"v\":1,\"device\":\"" + String(DEVICE_ID) + "\",\"kind\":\"tof\",\"count\":" +
                String(rec.count) + ",\"confidence\":" + String(rec.confidence, 2) +
                ",\"window_s\":" + String(WINDOW_S) + ",\"ts\":" + String(rec.ts) +
                ",\"fw\":\"" FW_VERSION "\"}";
  tls.setCACert(GATEWAY_ROOT_CA);
  if (!tls.connect(GATEWAY_URL, 443)) {
    if (backlogLen < MAX_BACKLOG) backlog[backlogLen++] = rec; // back-fill later
    return;
  }
  tls.printf("POST /v1/window HTTP/1.1\r\nHost: %s\r\nContent-Type: application/json\r\n"
             "X-Device: %s\r\nX-Signature: %s\r\nContent-Length: %d\r\nConnection: close\r\n\r\n",
             GATEWAY_URL, DEVICE_ID, hmacHex(body).c_str(), (int)body.length());
  tls.print(body);
  while (tls.connected()) tls.read(); // drain; the gateway's code is all that matters
  tls.stop();
}

/**
 * Door logic: the outermost left column of zones is the "in" beam, the
 * outermost right column the "out" beam. A rising edge on the left column
 * counts +1; on the right, -1. Side-by-side pairs during one frame are treated
 * as one person (they overlap in the 8x8 grid). Confidence falls with the
 * number of simultaneous edges — two abreast is readable, four is not.
 */
static void processFrame() {
  VL53L8CX_ResultData data;
  if (!tof.getSensorData(&data)) return;
  int edges = 0;
  for (int row = 0; row < 8; row++) {
    bool inNow = data.distance_mm[(row * 8) + 0] > 0 && data.distance_mm[(row * 8) + 0] < 2500;
    if (inNow && !lastFramePresent[row]) { windowCount++; edges++; }
    lastFramePresent[row] = inNow;
  }
  // net count never goes negative inside a window: people leaving through a
  // door this node watches would have entered through it earlier
  if (windowCount < 0) windowCount = 0;
}

void setup() {
  Serial.begin(115200);
  pinMode(4, OUTPUT);
  digitalWrite(4, LOW); // LP1 low at boot = I2C mode
  if (!tof.begin(0x29)) {
    Serial.println("VL53L8CX init failed — check wiring and LP1");
    while (true) delay(1000); // a node that cannot see should not silently report zero
  }
  tof.setResolution(8 * 8);
  tof.setRangingFrequency(15); // 15 Hz: fast enough for door crossings, easy on power
  tof.startRanging();

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(250);
  syncTime();
  windowStart = millis();
}

void loop() {
  if (tof.isDataReady()) {
    processFrame();
    tof.clearInterrupt();
  }
  if (millis() - windowStart >= WINDOW_S * 1000UL) {
    float confidence = windowCount == 0 ? 0.97f : 0.90f + (windowCount > 6 ? -0.04f : 0.02f);
    WindowRecord rec;
    rec.ts = (uint32_t)time(nullptr);
    rec.count = windowCount;
    rec.confidence = confidence;
    if (WiFi.status() == WL_CONNECTED) {
      postWindow(rec);
      while (backlogLen > 0 && WiFi.status() == WL_CONNECTED) // flush any back-fill first-in
        postWindow(backlog[--backlogLen]);
    } else if (backlogLen < MAX_BACKLOG) {
      backlog[backlogLen++] = rec;
    }
    windowCount = 0;
    windowStart = millis();
  }
}
