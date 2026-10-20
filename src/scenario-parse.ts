/**
 * Plain-English scenario drafts. "1000 person event at BSC tonight at 7pm" becomes
 * a reviewable Scenario the operator confirms before anything is scheduled — the
 * same draft → confirm → apply discipline the operator product used. The parser is
 * deliberately conservative: anything it does not understand is surfaced as
 * `unsupported`, never guessed at.
 */
import { ROUTES, STOPS } from './engine/sim.ts'
import type { Scenario, ScenarioEvent } from './engine/scenario.ts'

export type ParseDraft = { scenario: Scenario | null; assumptions: string[]; unsupported: string[] }

/** venue aliases, most specific first — "bsc" beats "student center" */
const VENUES: [RegExp, string][] = [
  [/busch student center|\bbsc\b/, 'bsc'],
  [/college ave\w* student center|\bcasc\b/, 'cas'],
  [/livingston student center|\blsc\b|\blivsc\b/, 'livSc'],
  [/livingston plaza/, 'livPlaza'],
  [/allison road|\barc\b/, 'arc'],
  [/hill center|\bhill\b/, 'hill'],
  [/the yard|\byard\b/, 'yard'],
  [/werblin|\brec(ration)? center\b/, 'werblin'],
  [/\bquads?\b/, 'quads'],
  [/science buildings|\bscience\b/, 'science'],
  [/\bstadium\b|\bshi\b/, 'stadium'],
  [/red oak/, 'redoak'],
  [/lipman/, 'lipman'],
  [/\bbiel\b/, 'biel'],
  [/henderson/, 'henderson'],
  [/gibbons/, 'gibbons'],
  [/college hall/, 'collegeHall'],
  [/south campus|rockoff|\bsocam\b/, 'socam'],
  [/student activities|\bsac\b/, 'sac'],
]

function findVenue(text: string): string | null {
  for (const [re, stop] of VENUES) if (re.test(text)) return stop
  return null
}

function findRoute(text: string): string | null {
  for (const r of ROUTES) {
    if (new RegExp(`\\broute\\s+${r.ref.replace('/', '\\/')}\\b`, 'i').test(text)) return r.ref
  }
  return null
}

function parseTimes(text: string): number[] {
  const out: number[] = []
  const re = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/gi
  for (const m of text.matchAll(re)) {
    let h = Number(m[1]) % 12
    if (/p\.?m\.?/i.test(m[3])) h += 12
    out.push(h * 60 + (m[2] ? Number(m[2]) : 0))
  }
  const re24 = /(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?=\s|$)/g
  for (const m of text.matchAll(re24)) out.push(Number(m[1]) * 60 + Number(m[2]))
  return [...new Set(out)].sort((a, b) => a - b)
}

function parseCount(text: string, re: RegExp, fallback: number): number {
  const m = text.match(re)
  if (!m) return fallback
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function parseScenarioText(text: string, nowMin: number): ParseDraft {
  const t = text.toLowerCase()
  const assumptions: string[] = []
  const unsupported: string[] = []
  const times = parseTimes(t)
  const venue = findVenue(t)
  const closing = /\b(close|closes|closed|closure|shut down|shut|block|skip)\b/.test(t)
  const reserving = /\b(add|reserve|extra|deploy|another|more)\b/.test(t) && /\bbus|\bfleet\b/.test(t)
  const eventWord = /\b(event|party|concert|rsvp|festival|rally|game|show|fair|meetup|exam|study)\b/.test(t)

  if (/\btomorrow\b/.test(t))
    unsupported.push('"tomorrow" — this twin simulates one weekday; use a clock time')
  if (/\b(rain|snow|storm|weather)\b/.test(t)) unsupported.push('weather is not modelled yet (roadmap M4)')
  if (/\b(weekend|saturday|sunday)\b/.test(t)) unsupported.push('weekend timetables are not modelled yet')

  let events: ScenarioEvent[] = []

  if (closing && venue) {
    const from = times[0] ?? nowMin
    const to = times[1] ?? from + 120
    if (to <= from) unsupported.push('the closure end time is not after its start')
    events = [
      {
        kind: 'stop_closure',
        id: 'closure-draft',
        stop: venue,
        fromMin: from,
        toMin: Math.max(to, from + 15),
      },
    ]
    assumptions.push(`${STOPS[venue].label} is skipped by every bus; riders reroute to the nearest open stop`)
  } else if (closing && !venue) {
    unsupported.push('a closure needs a stop I can find (e.g. "close the BSC stop")')
  } else if (reserving) {
    const route = findRoute(t)
    if (!route) {
      unsupported.push('say which route, e.g. "add 3 buses to Route B"')
    } else {
      const buses = parseCount(t, /(\d+)\s*(?:more\s+)?(?:buses|bus|vehicles)/, 3)
      events = [{ kind: 'fleet_add', id: 'fleet-draft', route, buses, atMin: Math.ceil(nowMin) }]
      assumptions.push(
        `${buses} extra vehicle(s) drop onto Route ${route} at the next tick, evenly spaced around the loop`,
      )
    }
  } else if (venue && (eventWord || /\d/.test(t))) {
    const attendees = parseCount(
      t,
      /(\d[\d,]*)\s*(?:-|\s)?\s*(?:person|people|attendee|guest|student|rsvp)/,
      500,
    )
    const start = times[0] ?? (/\btonight\b/.test(t) ? 1140 : nowMin + 30)
    const hours = t.match(/for\s+(\d+(?:\.\d+)?)\s*hours?/)
    const end = times[1] ?? (hours ? start + Math.round(Number(hours[1]) * 60) : start + 180)
    events = [
      {
        kind: 'event_surge',
        id: 'event-draft',
        stop: venue,
        attendees,
        startMin: start,
        endMin: Math.max(end, start + 30),
      },
    ]
    assumptions.push('72% of RSVPs show up (showRate — edit the JSON preset to change)')
    assumptions.push('arrivals spread over 45 min before doors; egress over 30 min after the end')
  } else if (eventWord && !venue) {
    unsupported.push('I found an event but no venue I can match — try a stop or building name')
  } else {
    unsupported.push('nothing actionable found — try an event, a closure, or a reserve-fleet request')
  }

  const scenario: Scenario | null = events.length
    ? {
        id: `draft-${Math.abs(events.length)}-${nowMin}`,
        label: `Draft: ${text.trim().slice(0, 64)}`,
        description: 'Parsed from free text — review each event before applying.',
        events,
      }
    : null

  return { scenario, assumptions, unsupported }
}
