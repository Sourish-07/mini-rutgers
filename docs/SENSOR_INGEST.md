# Sensor ingest — the twelve-building 5G deployment contract

This is the design the dashboard's simulated fleet (`src/sensors.ts`) and the
real firmware (`firmware/esp32/`) both implement. Swapping the simulation for
live ingest is a one-function change in `src/sensors.ts`.

## The twelve nodes

Chosen for transit-coupled traffic: event venues (the student centers, the
stadium), high-enrollment academic clusters (ARC, Hill, Life Sciences), the
recreation center, and the dense residential blocks (Livingston quads and
apartments, Lipman on Cook). IDs are stable and appear in the dashboard panel.

| Node ID  | Building (from the ArcGIS data)           | Kind        | Anchors stop |
| -------- | ----------------------------------------- | ----------- | ------------ |
| esp32-01 | Busch Student Center BSC                  | mmWave zone | bsc          |
| esp32-02 | College Avenue Student Center CASC        | mmWave zone | cas          |
| esp32-03 | Allison Road Classroom Building ARC       | mmWave zone | arc          |
| esp32-04 | Hill Center for the Mathematical Sciences | mmWave zone | hill         |
| esp32-05 | Livingston Student Center LSC             | mmWave zone | livSc        |
| esp32-06 | Sonny A. Werblin Recreation Center        | mmWave zone | werblin      |
| esp32-07 | Life Sciences Building                    | mmWave zone | science      |
| esp32-08 | SHI Stadium and Hale Center               | mmWave zone | stadium      |
| esp32-09 | Livingston Quad 1                         | ToF door    | quads        |
| esp32-10 | Lipman Hall                               | ToF door    | lipman       |
| esp32-11 | Rutgers Student Activities Center SAC     | ToF door    | sac          |
| esp32-12 | Livingston Apartments Bldg C              | ToF door    | livSc        |

## Hardware decision matrix

|                           | 60 GHz mmWave (MR60BHA1-class)               | ToF (VL53L8CX)                              |
| ------------------------- | -------------------------------------------- | ------------------------------------------- |
| Best at                   | zone presence, crowd density at doors/plazas | precise in/out door counts                  |
| Counting under crush load | good (multi-target)                          | degrades; undercounts >2 abreast            |
| Privacy                   | no images, no identity — radar returns only  | no images, no identity — photon timing only |
| Cost per point            | ~$30–60                                      | ~$10–15                                     |
| Power                     | ~0.4–1 W                                     | ~0.1 W                                      |
| Verdict                   | **the 8 venue/cluster nodes**                | **the 4 residential/hall door nodes**       |

MCU: ESP32-S3 (plenty of RAM for the zone grids, USB-OTG for provisioning).
ESP32 has no 5G modem — see the network architecture below for why that is a
feature, not a gap.

## Network architecture (the Verizon story)

```
[VL53L8CX / MR60BHA1]──I2C/UART──[ESP32-S3 node, per doorway/zone]
        │                    counts only, 30 s windows
        ▼
[building gateway]  2–4 nodes each (ESP-NOW/WiFi LAN, no internet exposure)
        ▼
[Verizon 5G UW / MEC edge]  ← the only hop that leaves the building
        ▼
[ingest service]  verify HMAC, persist, broadcast → dashboard
```

Aggregation happens at the building gateway: the cloud never sees per-doorway
raw streams, only the signed window counts. 5G/MEC gives the ingest a
low-latency path that does not depend on campus WiFi — which is exactly the
kind of thing you want working during a stadium egress.

## Payload contract

One HTTPS POST per node per 30-second window (MQTT-over-TLS is a drop-in
alternative; topic `campus/v1/node/<id>/count`):

```json
{
  "v": 1,
  "device": "esp32-01",
  "kind": "mmwave",
  "count": 42,
  "confidence": 0.93,
  "window_s": 30,
  "ts": 1761000000,
  "fw": "1.2.0"
}
```

`X-Signature: <hex HMAC-SHA256 of the raw body with the device key>`; keys are
provisioned per device and rotated at the gateway. Heartbeat every window even
when the count is zero — silence is a fault, not "empty building".

`confidence` is the node's own quality estimate (ToF doors report lower
confidence during crush loads; mmWave during heavy multipath). The dashboard
and any forecasting layer should consume it rather than pretending all counts
are equally good.

## Calibration

1. **Baseline occupancy**: run nodes for two weeks against known room
   schedules; regress node counts vs enrollment-weighted class hours to get a
   per-node scale factor.
2. **Egress dynamics**: during one event, reconcile door-counter in/out
   integrals with the venue's scanned attendance; that fixes the ToF
   undercount at crush load.
3. **Feeding the twin**: calibrated counts become scenario `showRate` evidence
   and initial conditions for the live tab (today they seed the firmware-sim's
   shape, which is honest because it is labelled simulated).

## Privacy stance (non-negotiable)

Counts and confidence only. No cameras, no identifying MACs, no per-person
tracking, no raw radar frames off-premises. The aggregation point is inside the
building; the signed payload is the only thing that crosses 5G. This should be
written into the deployment sign-off, not just the README.
