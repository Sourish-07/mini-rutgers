/**
 * Bake the full building registry into src/data/places-v2.json.
 *
 * v2 of places.json: keeps every attribute the ArcGIS layer exposes
 * (BldgNum, name, category, campus, district, address, website) plus the
 * building FOOTPRINT polygon in scene units — the v1 places.json only kept
 * a centroid, which is not enough for per-building heatmaps, queue placement
 * or "is this point inside the building" checks.
 *
 * Source (free, public, no key):
 *   https://services1.arcgis.com/ze0XBzU1FXj94DJq/arcgis/rest/services/
 *     Rutgers_University_Buildings/FeatureServer/0
 *
 * Run: node scripts/build/build-places-v2.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const CENTER = [40.5028, -74.447]
const KX = 111320 * Math.cos((CENTER[0] * Math.PI) / 180)
const KY = 110574
const M = 50
const toUnit = (lat, lon) => [
  Number((((lon - CENTER[1]) * KX) / M).toFixed(2)),
  Number(((-(lat - CENTER[0]) * KY) / M).toFixed(2)),
]

const BASE =
  'https://services1.arcgis.com/ze0XBzU1FXj94DJq/arcgis/rest/services/Rutgers_University_Buildings/FeatureServer/0/query'

const stops = JSON.parse(fs.readFileSync(new URL('../../src/data/stops.json', import.meta.url)))
const stopKeys = Object.keys(stops)
const nearestStop = (x, z) =>
  stopKeys.reduce((best, k) => {
    const [sx, sz] = stops[k].at
    const db = stops[best].at
    return Math.hypot(sx - x, sz - z) < Math.hypot(db[0] - x, db[1] - z) ? k : best
  }, stopKeys[0])

/* ---------------- paginated pull ---------------- */
const fields = 'BldgNum,BldgName,Category,Campus,District,BldgAddr,Website'
const features = []
for (let offset = 0; ; offset += 2000) {
  const url =
    `${BASE}?where=1%3D1&outFields=${fields}&outSR=4326&f=geojson` +
    `&geometryPrecision=6&resultRecordCount=2000&resultOffset=${offset}`
  const geo = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json()
  const batch = geo.features ?? []
  features.push(...batch)
  console.log(`  arcgis: +${batch.length} (total ${features.length})`)
  if (batch.length < 2000) break
}

/* ---------------- project + registry ---------------- */
const usedIds = new Set()
const places = []
for (const f of features) {
  const ring = f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry?.coordinates?.[0]?.[0]
  if (!ring || ring.length < 4) continue
  const foot = ring.map(([lon, lat]) => toUnit(lat, lon))
  // centroid of the ring (closed ring: skip the repeated last point)
  let x = 0
  let z = 0
  const pts = ring.length > 1 && ring[0] === ring.at(-1) ? ring.slice(0, -1) : ring
  for (const [lon, lat] of pts) {
    const [ux, uz] = toUnit(lat, lon)
    x += ux
    z += uz
  }
  x = Number((x / pts.length).toFixed(2))
  z = Number((z / pts.length).toFixed(2))
  if (!Number.isFinite(x) || Math.abs(x) > 70 || Math.abs(z) > 110) continue

  const p = f.properties ?? {}
  const num = p.BldgNum != null && p.BldgNum !== '' ? String(p.BldgNum) : null
  let id = num ? `b${num}` : `p${places.length}`
  if (usedIds.has(id)) id = `${id}_${places.length}`
  usedIds.add(id)

  // shoelace area in scene units² (1 unit = 50 m → 2500 m²)
  let a2 = 0
  for (let i = 0; i < foot.length - 1; i++) a2 += foot[i][0] * foot[i + 1][1] - foot[i + 1][0] * foot[i][1]
  places.push({
    id,
    n: String(p.BldgName ?? '').slice(0, 64),
    num,
    cat: String(p.Category ?? ''),
    district: String(p.District ?? ''),
    addr: String(p.BldgAddr ?? ''),
    x,
    z,
    s: nearestStop(x, z),
    foot,
    a: Math.round(Math.abs(a2 / 2) * 2500), // m²
  })
}

assert.ok(places.length > 400, `expected several hundred buildings, got ${places.length}`)
const cac = places.filter((p) => p.district === 'CAC')
assert.ok(cac.length > 100, `expected >100 CAC buildings, got ${cac.length}`)

fs.writeFileSync(new URL('../../src/data/places-v2.json', import.meta.url), JSON.stringify(places))
console.log(`wrote ${places.length} buildings (${cac.length} on the College Avenue campus)`)
const homes = cac.filter((p) => p.cat === 'Housing')
console.log(`CAC housing: ${homes.map((h) => h.n).join(', ')}`)
