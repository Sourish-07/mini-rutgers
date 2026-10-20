# ESP32 sensor firmware

Real firmware for the twelve-building deployment described in
[docs/SENSOR_INGEST.md](../../docs/SENSOR_INGEST.md). Two node types ship here:

- `tof-door-counter/` — VL53L8CX 8×8-zone ToF sensor on an ESP32-S3, mounted
  over a doorway, counting in/out transitions
- `mmwave-zone-counter/` — 60 GHz mmWave module (MR60BHA1-class) on an
  ESP32-S3, reporting zone occupancy / people-in-area

Both publish the **same signed payload** (see [PROTOCOL.md](PROTOCOL.md)) that
`src/sensors.ts` simulates in the dashboard — counts and confidence only, no
images, no identities, no raw frames leaving the building.

> Status: these sketches are written to compile against the ESP32 Arduino core
> 3.x with the SparkFun VL53L8CX library / Seeed mmWave library respectively.
> They have not yet been flashed to hardware (roadmap M6). Pin mappings and the
> gateway endpoint are called out at the top of each sketch.

## Why the network looks like this

ESP32s have no 5G modem, and that is the right shape: several cheap nodes per
building talk to a building gateway over the LAN, and **the gateway is the one
device that rides Verizon 5G UW / MEC to the ingest**. That single hop keeps
per-doorway streams off the internet, gives the ingest a path that does not
depend on campus WiFi (stadium egress is exactly when WiFi dies), and makes the
security story reviewable: one signing domain, one egress point per building.

```
[ToF / mmWave nodes]--LAN-->[building gateway]--5G UW/MEC-->[ingest service]
```

## Bill of materials (one node)

| Part     | ToF door node                                        | mmWave zone node                            |
| -------- | ---------------------------------------------------- | ------------------------------------------- |
| MCU      | ESP32-S3 DevKitC-1                                   | ESP32-S3 DevKitC-1                          |
| Sensor   | SparkFun VL53L8CX breakout (~$15)                    | Seeed MR60BHA1 60 GHz module (~$40)         |
| Mount    | Doorway header, 2.1–2.4 m height, angled 10–15° down | Ceiling/plaza pole, 2.5–3.5 m, looking down |
| Power    | 5V USB (PoE splitter optional)                       | 5V 1A USB                                   |
| BOM/node | ~$25                                                 | ~$50                                        |

## Build & flash

Arduino IDE (or PlatformIO):

1. Board: "ESP32S3 Dev Module", USB CDC on boot enabled
2. Install `SparkFun VL53L8CX Arduino Library` (ToF node) or the Seeed mmWave
   library for your module (zone node)
3. Copy `secrets.h.example` → `secrets.h`, fill in WiFi, gateway URL, CA
   certificate and the device key issued by provisioning
4. Flash, mount, aim, and confirm the first signed heartbeat in the gateway log

## Provisioning & OTA

- Device keys are issued per node by the gateway and only ever stored in
  flash (never in the repo; `secrets.h` is gitignored).
- OTA: each release tag has a signed `.bin`; the gateway can push updates over
  the LAN and the sketch verifies the image signature before rebooting.
- Every window is signed with the device key (HMAC-SHA256); a node that cannot
  reach the gateway keeps a local ring buffer and back-fills on reconnect —
  counts are timestamped, silence is a fault, never "empty building".

## Deployment checklist (from the calibration doc)

- [ ] Two weeks of baseline counts against known room schedules
- [ ] One event egress reconciled against scanned attendance
- [ ] Per-node scale factors written into the ingest, not patched in firmware
- [ ] Sign-off records the privacy stance: counts and confidence only
