/**
 * The simulated ESP32 sensor fleet — the firmware-sim. Twelve high-traffic
 * buildings (see docs/SENSOR_INGEST.md) plus the stop shelters carry 60 GHz mmWave
 * zone counters and ToF door counters; the real firmware lives in firmware/esp32/
 * and publishes exactly the payload shape readFleet() returns here. Substituting
 * the real ingest for this module is a swap of one function.
 *
 * Privacy by construction: nodes report zone counts and a confidence figure —
 * never positions, images or identities.
 */
import placesData from './data/places.json' with { type: 'json' }
import { STOPS, type Sim } from './engine/sim.ts'
import { lcg } from './engine/rng.ts'

export type SensorKind = 'mmwave' | 'tof'

export type SensorNode = {
  id: string
  kind: SensorKind
  label: string
  stop: string
  at: [number, number]
}

/** the twelve buildings with the highest transit-coupled traffic, matched against places.json */
const WANTED: { match: string; kind: SensorKind; label: string; stop: string }[] = [
  { match: 'busch student center', kind: 'mmwave', label: 'Busch Student Center', stop: 'bsc' },
  {
    match: 'college avenue student center',
    kind: 'mmwave',
    label: 'College Ave Student Center',
    stop: 'cas',
  },
  { match: 'allison road classroom', kind: 'mmwave', label: 'Allison Road Classrooms', stop: 'arc' },
  { match: 'hill center for the mathematical', kind: 'mmwave', label: 'Hill Center', stop: 'hill' },
  { match: 'livingston student center', kind: 'mmwave', label: 'Livingston Student Center', stop: 'livSc' },
  { match: 'werblin', kind: 'mmwave', label: 'Werblin Rec Center', stop: 'werblin' },
  { match: 'life sciences building', kind: 'mmwave', label: 'Life Sciences (Busch)', stop: 'science' },
  { match: 'shi stadium', kind: 'mmwave', label: 'SHI Stadium', stop: 'stadium' },
  { match: 'livingston quad 1', kind: 'tof', label: 'Livingston Quads', stop: 'quads' },
  { match: 'lipman hall', kind: 'tof', label: 'Lipman Hall (Cook)', stop: 'lipman' },
  { match: 'student activities center', kind: 'tof', label: 'Student Activities Ctr', stop: 'sac' },
  { match: 'livingston apartments building c', kind: 'tof', label: 'Livingston Apartments', stop: 'livSc' },
]

const places = placesData as unknown as { n?: string; x: number; z: number; s: string }[]

function resolveAt(match: string, stop: string): [number, number] {
  const hit = places.find((p) => (p.n ?? '').toLowerCase().includes(match))
  if (hit) return [hit.x, hit.z]
  const at = STOPS[stop]?.at
  return at ? [at[0], at[1]] : [0, 0]
}

export const FLEET: SensorNode[] = WANTED.map((w, i) => ({
  id: `esp32-${String(i + 1).padStart(2, '0')}`,
  kind: w.kind,
  label: w.label,
  stop: w.stop,
  at: resolveAt(w.match, w.stop),
}))

export type SensorReading = SensorNode & { count: number; confidence: number; tsMin: number }

/** zone radius: 75 m around the node anchor */
const R = 1.5

/**
 * Read the fleet at a simulated minute. Counts everyone physically inside the zone
 * (people on a bus in motion are the bus's business, not the building's), with a
 * deterministic per-(node, minute) counting noise the way a real sensor jitters.
 */
export function readFleet(sim: Sim, minute: number): SensorReading[] {
  return FLEET.map((node, i) => {
    let count = 0
    for (const a of sim.agents) {
      if (a.state === 'ride') continue
      const dx = a.x - node.at[0]
      const dz = a.z - node.at[1]
      if (dx * dx + dz * dz <= R * R) count++
    }
    const noise = lcg(Math.floor(minute) * 131 + i * 17)()
    const jitter = Math.round(count * 0.08 * (noise - 0.5))
    return { ...node, count: Math.max(0, count + jitter), confidence: 0.86 + noise * 0.12, tsMin: minute }
  })
}
