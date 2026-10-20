/**
 * Bake a real day of CAC classes into src/data/schedule.json.
 *
 * Source: the public, key-free Schedule of Classes API
 *   https://sis.rutgers.edu/soc/api/courses.json?year=&term=&campus=NB
 * We keep every section that meets on the target weekday on the College
 * Avenue campus (campusAbbrev === 'CAC'), resolve its SOC building code
 * through src/data/bldg-codes.json, and convert times to sim minutes
 * since 07:00 (START). Sections in unmapped buildings are dropped with a
 * warning — the code table grows as scope widens.
 *
 * The raw API response is cached at %TEMP%/soc_nb.json so repeated runs
 * don't re-download 21 MB.
 *
 * Run: node scripts/build/build-schedule.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const YEAR = 2026
const TERM = 9 // fall
const DAY = 'T' // Tuesday — the simulated weekday
const START = 7 * 60 // sim minute 0 = 07:00
const API = `https://sis.rutgers.edu/soc/api/courses.json?year=${YEAR}&term=${TERM}&campus=NB`
const CACHE = `${process.env.TEMP}/soc_nb.json`

const codes = JSON.parse(fs.readFileSync(new URL('../../src/data/bldg-codes.json', import.meta.url)))
const map = codes.codes

let raw
if (fs.existsSync(CACHE) && fs.statSync(CACHE).size > 1_000_000) {
  raw = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  console.log(`cached catalog: ${raw.length} courses`)
} else {
  console.log('downloading catalog (~21 MB)…')
  const res = await fetch(API, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  raw = await res.json()
  fs.writeFileSync(CACHE, JSON.stringify(raw))
  console.log(`downloaded ${raw.length} courses`)
}

const toMin = (m) => {
  // startTimeMilitary like "1550" → 15*60+50 - START (may go negative: before 07:00)
  const h = Math.floor(m.startTimeMilitary / 100)
  const min = m.startTimeMilitary % 100
  return h * 60 + min - START
}

const sections = []
const dropped = {}
let seen = new Set()
for (const c of raw) {
  for (const s of c.sections ?? []) {
    for (const m of s.meetingTimes ?? []) {
      if (m.campusAbbrev !== 'CAC' || m.meetingDay !== DAY) continue
      if (!m.buildingCode || !m.startTimeMilitary || !m.endTimeMilitary) continue
      const b = map[m.buildingCode]
      if (!b) {
        dropped[m.buildingCode] = (dropped[m.buildingCode] ?? 0) + 1
        continue
      }
      const id = `${c.subject}:${c.courseNumber}:${s.number}`
      if (seen.has(id)) continue
      seen.add(id)
      const start = toMin(m)
      const end = toMin({ startTimeMilitary: m.endTimeMilitary })
      if (end <= start) continue
      sections.push({
        id,
        subj: c.subjectDescription ?? c.subject ?? '',
        course: `${c.subject ?? ''}:${c.courseNumber ?? ''}`,
        title: String(c.title ?? '').slice(0, 60),
        sec: s.number,
        placeId: b.placeId,
        bldg: b.name,
        room: String(m.roomNumber ?? ''),
        start,
        end,
        mode: m.meetingModeDesc ?? 'LEC',
      })
    }
  }
}

sections.sort((a, b) => a.start - b.start || a.placeId.localeCompare(b.placeId))
assert.ok(sections.length > 150, `expected hundreds of CAC sections, got ${sections.length}`)
const droppedTotal = Object.values(dropped).reduce((a, b) => a + b, 0)
assert.ok(droppedTotal < sections.length * 0.05, `too many sections dropped: ${JSON.stringify(dropped)}`)

fs.writeFileSync(new URL('../../src/data/schedule.json', import.meta.url), JSON.stringify(sections))
console.log(
  `wrote ${sections.length} Tuesday sections across ${new Set(sections.map((s) => s.placeId)).size} buildings`,
)
if (Object.keys(dropped).length) console.log(`dropped (unmapped codes): ${JSON.stringify(dropped)}`)
const byB = {}
for (const s of sections) byB[s.bldg] = (byB[s.bldg] ?? 0) + 1
console.log(
  Object.entries(byB)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10),
)
