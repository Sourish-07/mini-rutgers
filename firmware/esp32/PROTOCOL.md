# Ingest protocol v1

One HTTPS POST per node per 30-second window. MQTT-over-TLS is an accepted
alternative transport (`campus/v1/node/<id>/count`) with the same payload and
signature rules. The dashboard's simulated fleet (`src/sensors.ts`) emits this
exact shape.

## Request

```
POST /v1/window
Host: <ingest endpoint>
Content-Type: application/json
X-Device: esp32-01
X-Signature: <lowercase hex HMAC-SHA256 of the raw body bytes, keyed with the device key>
```

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

## Field rules

| Field        | Rule                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `v`          | protocol version, always `1`                                                                                         |
| `device`     | stable node id (`esp32-01`…`esp32-12`), issued at provisioning                                                       |
| `kind`       | `mmwave` or `tof` — consumers must not treat their confidence the same way (ToF undercounts at crush load)           |
| `count`      | zone presence (mmWave) or net in/out integral (ToF) for the window; non-negative                                     |
| `confidence` | the node's own quality estimate for the window, `0..1`; honest defaults: ToF doors 0.86–0.98, mmWave zones 0.90–0.98 |
| `window_s`   | window length in seconds, always `30` in v1                                                                          |
| `ts`         | unix seconds at window close, NTP-synced; drift >2 s is a fault                                                      |
| `fw`         | firmware semver, for the calibration table                                                                           |

## Behavioural contract

- **Heartbeat always**: a window with `count: 0` is still sent. Silence means
  the node is down; the ingest must alarm on it.
- **Idempotency**: the ingest keys on `(device, ts)`; replays after a
  reconnect are safe and deduplicated.
- **Ordering**: windows may arrive out of order after back-fill; consumers
  sort by `ts`, they do not trust arrival.
- **Rejection**: bad signature, unknown device, or `ts` too far from server
  time ⇒ `401`/`403`/`409`; the node backs off exponentially and retries its
  ring buffer.
- **No raw data**: the protocol has no field for frames, tracks, images or
  identities — by design. Anything that needs more than a count needs a new
  protocol version and a new privacy review.

## Verification vectors

When you add an ingest implementation, these must round-trip through
`src/sensors.ts`'s payload unchanged; the v1 acceptance test is that swapping
`readFleet()` for the ingest subscription changes **nothing** in the dashboard
except the telemetry badge flipping from _simulated_ to _live_.
