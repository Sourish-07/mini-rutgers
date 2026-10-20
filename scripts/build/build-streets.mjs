/**
 * Bake named street corridors into src/data/streets.json.
 *
 * Closures are addressed by street NAME in the what-if box ("close Hamilton
 * Street"), but the routable graph (network.json) has no street names — it
 * was compiled from OSM ways before names were kept. So we source named
 * street geometry from Nominatim (free, public, no key, 1 req/s politeness)
 * and store each street as a flattened point cloud in scene units: an edge
 * is "part of the street" when both endpoints sit within ~0.6 units (30 m)
 * of any stored point. Streets in OSM are split into many ways, so we query
 * with a campus viewbox and merge EVERY returned segment with a matching
 * name — a single-way query returns an arbitrary fragment.
 *
 * Run: node scripts/build/build-streets.mjs
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

// New Brunswick campus viewbox (lon/lat): covers CAC downtown streets
const VIEWBOX = '-74.465,40.515,-74.430,40.494'

const STREETS = [
  'Hamilton Street',
  'College Avenue',
  'Somerset Street',
  'George Street',
  'Easton Avenue',
  'Huntington Street',
  'Bishop Place',
  'Seminary Place',
  'Union Street',
  'Mine Street',
]

const out = {}
for (const name of STREETS) {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=40' +
    `&viewbox=${VIEWBOX}&bounded=1&q=${encodeURIComponent(name + ', New Brunswick, NJ')}`
  const r = await (
    await fetch(url, { headers: { 'User-Agent': 'CampusMotion/0.1 (campus simulation project)' } })
  ).json()
  const pts = []
  let segs = 0
  for (const hit of r) {
    if (hit.category !== 'highway' || hit.name !== name) continue
    const c = hit.geojson?.coordinates
    if (!Array.isArray(c)) continue
    for (const [lon, lat] of c) {
      const [x, z] = toUnit(lat, lon)
      if (Math.abs(x) <= 70 && Math.abs(z) <= 110) pts.push([x, z])
    }
    segs++
  }
  if (pts.length >= 2) {
    out[name] = pts
    console.log(`  ok  ${name}: ${segs} segments, ${pts.length} pts`)
  } else {
    console.log(`  ??  ${name}: no geometry in viewbox`)
  }
  await new Promise((res) => setTimeout(res, 1100)) // Nominatim politeness: 1 req/s
}

assert.ok((out['Hamilton Street']?.length ?? 0) >= 10, 'Hamilton Street is required by the demo scenarios')
fs.writeFileSync(new URL('../../src/data/streets.json', import.meta.url), JSON.stringify(out))
console.log(`wrote ${Object.keys(out).length} street corridors`)
