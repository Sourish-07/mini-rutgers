/**
 * Live vehicle positions from the Rutgers bus tracker (demo.rubus.live) — the same
 * feed scripts/check-live.mjs validates our route geometry against. The browser
 * may refuse it cross-origin (CORS); the toggle fails visibly and never invents
 * vehicles, mirroring the "never fall back silently" rule the twin is built on.
 */
export type LiveVehicle = {
  id: string
  route: string
  lat: number
  lng: number
  riders?: number
  capacity?: number
}

export const LIVE_URL = 'https://demo.rubus.live/buses'

/** tracker route ids -> our route refs */
export const ROUTE_OF: Record<string, string> = { wknd1: 'W1', wknd2: 'W2' }

const CENTER = [40.5028, -74.447]
const KX = (111320 * Math.cos((CENTER[0] * Math.PI) / 180)) / 50
const KY = 110574 / 50

export function liveToScene(lat: number, lng: number): [number, number] {
  return [(lng - CENTER[1]) * KX, -(lat - CENTER[0]) * KY]
}

export async function fetchLiveVehicles(): Promise<LiveVehicle[]> {
  const res = await fetch(LIVE_URL)
  if (!res.ok) throw new Error(`tracker responded ${res.status}`)
  const body = (await res.json()) as Record<string, Omit<LiveVehicle, 'id'>>
  return Object.entries(body).map(([id, v]) => ({ id, ...v }))
}
