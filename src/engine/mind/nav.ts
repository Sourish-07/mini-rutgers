/**
 * Mind navigation: the walk graph of network.json with *edge identity* and
 * closures. The legacy navigation.ts memoizes by rounded endpoints and has no
 * notion of a blocked edge; the behavior engine needs both, because a road
 * closure must (a) be addressable as a set of edges and (b) force replans for
 * students whose remaining path crosses it.
 *
 * Pure data + functions: no React, no three, runs headless in Node.
 */
import net from '../../data/network.json' with { type: 'json' }

export type P = [number, number]
export type NavEdge = { id: string; a: P; b: P; len: number; drive: boolean }

type RawEdge = { a: P; b: P; drive: boolean; walk: boolean; kind: string }

const k = (p: P) => `${p[0]},${p[1]}`
const edgeId = (a: P, b: P) => {
  const ka = k(a)
  const kb = k(b)
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

/* ---------------- graph ---------------- */
export const EDGES: NavEdge[] = []
export const edgeById = new Map<string, NavEdge>()
const adj = new Map<string, { to: string; cost: number; edge: NavEdge }[]>()
const nodes = new Map<string, P>()

for (const e of (net as unknown as { edges: RawEdge[] }).edges) {
  if (!e.walk) continue
  const a = e.a as P
  const b = e.b as P
  const id = edgeId(a, b)
  if (edgeById.has(id)) continue
  const len = Math.hypot(a[0] - b[0], a[1] - b[1])
  const edge: NavEdge = { id, a, b, len, drive: e.drive }
  EDGES.push(edge)
  edgeById.set(id, edge)
  nodes.set(k(a), a)
  nodes.set(k(b), b)
  if (!adj.has(k(a))) adj.set(k(a), [])
  if (!adj.has(k(b))) adj.set(k(b), [])
  adj.get(k(a))!.push({ to: k(b), cost: len, edge })
  adj.get(k(b))!.push({ to: k(a), cost: len, edge })
}

const nodeKeys = [...nodes.keys()]

/* spatial hash for snap(): cell 0.2 units (10 m) */
const CELL = 0.2
const grid = new Map<string, string[]>()
for (const key of nodeKeys) {
  const [x, z] = nodes.get(key)!
  const c = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`
  if (!grid.has(c)) grid.set(c, [])
  grid.get(c)!.push(key)
}

/** nearest graph node — spatial-hash first, full scan fallback */
export function snap(p: P): P {
  const cx = Math.floor(p[0] / CELL)
  const cz = Math.floor(p[1] / CELL)
  let best: string | null = null
  let bd = Infinity
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      const bucket = grid.get(`${cx + dx},${cz + dz}`)
      if (!bucket) continue
      for (const key of bucket) {
        const q = nodes.get(key)!
        const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
        if (d < bd) {
          bd = d
          best = key
        }
      }
    }
  if (!best) {
    for (const key of nodeKeys) {
      const q = nodes.get(key)!
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
      if (d < bd) {
        bd = d
        best = key
      }
    }
  }
  return nodes.get(best!)!
}

export function pathLength(path: P[]): number {
  let n = 0
  for (let i = 1; i < path.length; i++)
    n += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  return n
}

/* ---------------- routing ---------------- */
export type Route = { path: P[]; edges: string[]; len: number }

/** memo per closure epoch: routes are identical until the blocked set changes */
let epoch = 0
export function bumpEpoch() {
  epoch++
  memo.clear()
}
const memo = new Map<string, Route[]>()

/** A* between two graph nodes. from/to must be snapped coordinates. */
export function route(from: P, to: P, blocked?: ReadonlySet<string>): Route | null {
  if (k(from) === k(to)) return { path: [from], edges: [], len: 0 }
  const mk = `${k(from)}|${k(to)}|${blocked ? epoch : 0}`
  const hit = memo.get(mk)
  if (hit) return hit[0]
  const open: { key: string; f: number }[] = [{ key: k(from), f: 0 }]
  const gScore = new Map<string, number>([[k(from), 0]])
  const came = new Map<string, { key: string; edge: NavEdge }>()
  const closedSet = new Set<string>()
  while (open.length) {
    let bi = 0
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i
    const cur = open.splice(bi, 1)[0]
    if (cur.key === k(to)) break
    if (closedSet.has(cur.key)) continue
    closedSet.add(cur.key)
    for (const link of adj.get(cur.key) ?? []) {
      if (blocked?.has(link.edge.id)) continue
      const ng = (gScore.get(cur.key) ?? Infinity) + link.cost
      if (ng < (gScore.get(link.to) ?? Infinity)) {
        gScore.set(link.to, ng)
        came.set(link.to, { key: cur.key, edge: link.edge })
        const tp = nodes.get(link.to)!
        open.push({ key: link.to, f: ng + Math.hypot(tp[0] - to[0], tp[1] - to[1]) })
      }
    }
  }
  if (!came.has(k(to))) return null
  const path: P[] = [to]
  const edges: string[] = []
  let cur = k(to)
  while (cur !== k(from)) {
    const step = came.get(cur)
    if (!step) return null
    edges.push(step.edge.id)
    path.unshift(nodes.get(step.key)!)
    cur = step.key
  }
  const r: Route = { path, edges, len: gScore.get(k(to)) ?? 0 }
  memo.set(mk, [r])
  return r
}

/** walk route between arbitrary points (snapped internally) */
export function walkRoute(from: P, to: P, blocked?: ReadonlySet<string>): Route | null {
  return route(snap(from), snap(to), blocked)
}

/** every edge whose both endpoints sit within tol of any of the points */
export function edgesNear(points: P[], tol: number): string[] {
  const t2 = tol * tol
  const near = (p: P) => {
    for (const q of points) {
      const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
      if (d <= t2) return true
    }
    return false
  }
  const out: string[] = []
  for (const e of EDGES) if (near(e.a) && near(e.b)) out.push(e.id)
  return out
}

/** distance from a point to the nearest of the given points */
export function distToPoints(p: P, points: P[]): number {
  let bd = Infinity
  for (const q of points) {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (d < bd) bd = d
  }
  return bd
}

/** position at fraction f along a polyline */
export function samplePath(path: P[], f: number): P {
  if (path.length === 0) return [0, 0]
  if (path.length === 1) return path[0]
  const total = pathLength(path)
  let want = Math.max(0, Math.min(1, f)) * total
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
    if (seg <= 1e-6) continue
    if (want <= seg) {
      const r = want / seg
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * r,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * r,
      ]
    }
    want -= seg
  }
  return path[path.length - 1]
}
