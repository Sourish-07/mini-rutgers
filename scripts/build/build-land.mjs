/**
 * Builds the landcover layer the stylized ground draws beneath the crisp vector
 * roads: water, greenery and paved ground (parking / plazas) as polygons in
 * scene units.
 *
 * Source: OpenStreetMap via the Overpass API (build-time only — the app itself
 * stays fully offline). Same projection as every other dataset.
 *
 *   node scripts/build/build-land.mjs
 */
import { writeFileSync } from 'node:fs'

const CENTER = [40.5028, -74.447]
const M_PER_UNIT = 50
const KX = 111320 * Math.cos((CENTER[0] * Math.PI) / 180)
const KY = 110574

// the ground frame, padded slightly so polygons crossing the border still close
const PAD = 6 // scene units
const FRAME = { x0: -70 - PAD, x1: 70 + PAD, z0: -110 - PAD, z1: 110 + PAD }
const BBOX = {
  south: CENTER[0] + (FRAME.z0 * M_PER_UNIT) / KY,
  north: CENTER[0] + (FRAME.z1 * M_PER_UNIT) / KY,
  west: CENTER[1] + (FRAME.x0 * M_PER_UNIT) / KX,
  east: CENTER[1] + (FRAME.x1 * M_PER_UNIT) / KX,
}

const toUnit = (lat, lon) => [((lon - CENTER[1]) * KX) / M_PER_UNIT, (-(lat - CENTER[0]) * KY) / M_PER_UNIT]

/** tag groups, in draw order (later layers sit above earlier ones) */
const LAYERS = {
  green: [
    'way["leisure"="park"]',
    'way["leisure"="garden"]',
    'way["leisure"="nature_reserve"]',
    'way["leisure"="recreation_ground"]',
    'way["leisure"="golf_course"]',
    'way["leisure"="common"]',
    'way["landuse"="grass"]',
    'way["landuse"="meadow"]',
    'way["landuse"="forest"]',
    'way["landuse"="recreation_ground"]',
    'way["landuse"="cemetery"]',
    'way["landuse"="farmland"]',
    'way["landuse"="orchard"]',
    'way["landuse"="vineyard"]',
    'way["natural"="wood"]',
    'way["natural"="scrub"]',
    'way["natural"="grassland"]',
    'way["natural"="heath"]',
    'way["natural"="wetland"]',
  ],
  pitch: ['way["leisure"="pitch"]', 'way["leisure"="track"]', 'way["leisure"="sports_centre"]'],
  paved: [
    // parking lots and railway yards only: whole-campus landuse polygons would
    // paint the university into one flat grey slab and bury the footway network
    'way["amenity"="parking"]',
    'way["landuse"="railway"]',
  ],
  water: [
    'way["natural"="water"]',
    'way["waterway"="riverbank"]',
    'way["waterway"="dock"]',
    'way["landuse"="reservoir"]',
    'way["landuse"="basin"]',
    // no relations: a riverbank multipolygon's outer members arrive as open
    // traces, and closing one by hand produces a polygon covering the county
  ],
}

const bboxStr = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`
const queryFor = (selectors) =>
  `[out:json][timeout:180];(${selectors.map((s) => `\n  ${s}(${bboxStr});`).join('')}\n);out geom;`

async function overpass(query) {
  const body = 'data=' + encodeURIComponent(query)
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'campus-motion-build/1.0 (data build)',
        },
        body,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      console.warn(`  overpass attempt ${attempt} failed: ${err.message}`)
      await new Promise((r) => setTimeout(r, attempt * 3000))
    }
  }
  throw new Error('overpass unreachable')
}

/** drop points closer than `min` units — OSM rings are denser than a 0.5 m map needs */
function simplify(ring, min) {
  if (ring.length < 4) return null
  const out = [ring[0]]
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i]
    const q = out[out.length - 1]
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= min) out.push(p)
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 0.001) out.push(first)
  return out.length >= 4 ? out : null
}

function area(ring) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return Math.abs(a) / 2
}

const MIN_AREA = (80 * 80) / (M_PER_UNIT * M_PER_UNIT) // ignore anything under 80 m × 80 m
const FRAME_UNPADDED = { x0: -70, x1: 70, z0: -110, z1: 110 }
const inFrame = (ring) =>
  ring.some(
    ([x, z]) =>
      x > FRAME_UNPADDED.x0 && x < FRAME_UNPADDED.x1 && z > FRAME_UNPADDED.z0 && z < FRAME_UNPADDED.z1,
  )

/** geometry of a way or relation member, in scene units, or null */
function ringOf(geometry, maxArea = Infinity) {
  if (!geometry || geometry.length < 3) return null
  const simple = simplify(
    geometry.map((g) => toUnit(g.lat, g.lon)),
    0.12,
  ) // ~6 m
  if (!simple) return null
  const a = area(simple)
  if (a < MIN_AREA || a > maxArea || !inFrame(simple)) return null
  return simple.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100])
}

/** per-layer area caps, in scene units² (1 unit² = 2,500 m²) — sized so a part
 *  of campus reads at map scale while whole-campus landuse slabs are dropped */
const MAX_AREA = { paved: 160, pitch: 20, green: 4000, water: 600 }

/**
 * Sutherland–Hodgman clip against the frame.
 *
 * Overpass returns *whole* ways even when only a corner sits in the bbox, so the
 * Raritan arrives as one polygon covering ten times the frame. Unclipped, water
 * would flood the entire map.
 */
function clipToFrame(ring) {
  const inside = [
    ([x]) => x >= FRAME_UNPADDED.x0,
    ([x]) => x <= FRAME_UNPADDED.x1,
    ([, z]) => z >= FRAME_UNPADDED.z0,
    ([, z]) => z <= FRAME_UNPADDED.z1,
  ]
  const cut = [
    (a, b) => [FRAME_UNPADDED.x0, a[1] + ((FRAME_UNPADDED.x0 - a[0]) / (b[0] - a[0])) * (b[1] - a[1])],
    (a, b) => [FRAME_UNPADDED.x1, a[1] + ((FRAME_UNPADDED.x1 - a[0]) / (b[0] - a[0])) * (b[1] - a[1])],
    (a, b) => [a[0] + ((FRAME_UNPADDED.z0 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), FRAME_UNPADDED.z0],
    (a, b) => [a[0] + ((FRAME_UNPADDED.z1 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), FRAME_UNPADDED.z1],
  ]
  let out = ring
  for (let e = 0; e < 4; e++) {
    const input = out
    out = []
    for (let i = 0; i < input.length - 1; i++) {
      const a = input[i]
      const b = input[i + 1]
      const ia = inside[e](a)
      const ib = inside[e](b)
      if (ia) out.push(a)
      if (ia !== ib) out.push(cut[e](a, b))
    }
    if (out.length < 4) return null
    out.push(out[0])
  }
  return out
}

async function main() {
  const out = { water: [], green: [], pitch: [], paved: [] }

  for (const [layer, selectors] of Object.entries(LAYERS)) {
    process.stdout.write(`${layer}: querying ${selectors.length} selectors… `)
    const json = await overpass(queryFor(selectors))
    const cap = MAX_AREA[layer] ?? Infinity
    let n = 0
    for (const el of json.elements ?? []) {
      if (el.type === 'way') {
        const ring = ringOf(el.geometry, cap)
        if (ring) {
          out[layer].push(ring)
          n++
        }
      } else if (el.type === 'relation') {
        // multipolygons: each outer member becomes its own ring — inner holes are
        // rare here, and an island is a smaller error than a missing river
        for (const m of el.members ?? []) {
          if (m.role === 'inner') continue
          const ring = ringOf(m.geometry, cap)
          if (ring) {
            out[layer].push(ring)
            n++
          }
        }
      }
    }
    console.log(`${n} polygons`)
  }

  const text = JSON.stringify(out)
  writeFileSync(new URL('../../src/data/land.json', import.meta.url), text)
  console.log(
    `land.json written — water ${out.water.length}, green ${out.green.length}, pitch ${out.pitch.length}, paved ${out.paved.length} (${(text.length / 1024).toFixed(0)} kB)`,
  )
}

main().catch((err) => {
  console.error('build-land failed:', err.message)
  process.exit(1)
})
