/**
 * The ground: a designed vector surface.
 *
 * The old layer was a single 3200 px stitched aerial photograph stretched over a
 * 7 × 11 km frame. At the demo's campus framing that is a ~9× upscale, which is
 * exactly why the map looked pixelated — no texture stays sharp across a 50×
 * zoom range.
 *
 * So the ground is drawn as geometry instead: landcover polygons (water, green,
 * pitches, paved lots) and every road and footway as a real ribbon with a dark
 * casing. Geometry is resolution-free — sharp at 5 m or 5 km — and it lets the
 * map carry one deliberate palette instead of borrowed photography.
 *
 * Layers, bottom to top (y offsets keep them from fighting):
 *   grass base 0.00 · landcover 0.011–0.016 · footways 0.030
 *   road casing 0.040 · road fill 0.050 · bus routes 0.070
 */
import * as THREE from 'three'
import NET from '../data/network.json'
import LAND_DATA from '../data/land.json'
import { ROUTES } from '../engine/sim'

export const FRAME = { x0: -70, x1: 70, z0: -110, z1: 110 }

/** metres → scene units */
const M = 50
const u = (metres: number) => metres / M

type P = [number, number]
type Edge = { a: P; b: P; drive: boolean; walk: boolean; kind: string }

const EDGES = (NET as unknown as { edges: Edge[] }).edges
const LANDCOVER = LAND_DATA as unknown as Record<'water' | 'green' | 'pitch' | 'paved', P[][]>

/* ---------------------------------------------------------------- palette */

export const GROUND = {
  paper: '#0a0d11',
  /** the board the map is drawn on — reads as a mounted sheet, not a crop */
  sky: '#ded9cc',
  frame: '#8b8474',
  grass: '#8aa766',
  green: '#7c9a58',
  water: '#7ab0c8',
  pitch: '#93ab68',
  paved: '#b3ada0',
} as const

/** carriageways: real widths in metres, plus the casing that makes them read */
const ROADS: Record<string, { w: number; fill: string }> = {
  motorway: { w: 16, fill: '#6c717a' },
  trunk: { w: 16, fill: '#6c717a' },
  primary: { w: 13.5, fill: '#767b84' },
  secondary: { w: 11, fill: '#7e838c' },
  tertiary: { w: 9.5, fill: '#858a93' },
  residential: { w: 7.5, fill: '#8c929a' },
  unclassified: { w: 7, fill: '#8c929a' },
  living_street: { w: 6, fill: '#9399a1' },
  service: { w: 5, fill: '#9ba1a8' },
}

/** footways and paths: cream ribbons laid on the grass */
const WAYS: Record<string, { w: number; fill: string }> = {
  footway: { w: 2, fill: '#ded7c3' },
  path: { w: 1.8, fill: '#d8d0bb' },
  pedestrian: { w: 4.5, fill: '#e2dbc8' },
  steps: { w: 1.8, fill: '#cfc7b1' },
  cycleway: { w: 2.2, fill: '#c4cdb0' },
}
const WAY_FALLBACK = { w: 2, fill: '#ded7c3' }

const fillOf = (e: Edge): { w: number; fill: string } | null => {
  if (e.drive) return ROADS[e.kind] ?? { w: 6, fill: '#8c929a' }
  if (e.walk) return WAYS[e.kind] ?? WAY_FALLBACK
  return null
}

const darker = (hex: string, k: number) => {
  const c = new THREE.Color(hex)
  return `#${c.multiplyScalar(k).getHexString()}`
}

/* --------------------------------------------------------------- geometry */

const scratch = new THREE.Color()

/**
 * One segment as two triangles, extended by half a width at both ends so that
 * consecutive segments overlap and corners close — the cheap equivalent of a
 * round line join, which is the difference between "roads" and "confetti".
 */
function pushSegment(pos: number[], col: number[], a: P, b: P, half: number, c: THREE.Color, y: number) {
  let dx = b[0] - a[0]
  let dz = b[1] - a[1]
  const len = Math.hypot(dx, dz) || 1e-6
  dx /= len
  dz /= len
  const nx = -dz * half
  const nz = dx * half
  const ax = a[0] - dx * half
  const az = a[1] - dz * half
  const bx = b[0] + dx * half
  const bz = b[1] + dz * half
  const x0 = ax + nx
  const z0 = az + nz
  const x1 = bx + nx
  const z1 = bz + nz
  const x2 = bx - nx
  const z2 = bz - nz
  const x3 = ax - nx
  const z3 = az - nz
  pos.push(x0, y, z0, x1, y, z1, x2, y, z2, x0, y, z0, x2, y, z2, x3, y, z3)
  for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b)
}

function geometryFrom(pos: number[], col: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeBoundingSphere()
  return g
}

/** footways first, then carriageways with a casing — one geometry, one draw call */
export function roadGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const yCasing = 0.04
  const yFill = 0.05

  for (const e of EDGES) {
    if (e.drive) continue
    const spec = fillOf(e)
    if (!spec) continue
    scratch.set(spec.fill)
    pushSegment(pos, col, e.a, e.b, u(spec.w) / 2, scratch, 0.03)
  }
  for (const e of EDGES) {
    if (!e.drive) continue
    const spec = fillOf(e)!
    scratch.set(darker(spec.fill, 0.66))
    pushSegment(pos, col, e.a, e.b, u(spec.w) / 2 + u(1.6), scratch, yCasing)
    scratch.set(spec.fill)
    pushSegment(pos, col, e.a, e.b, u(spec.w) / 2, scratch, yFill)
  }
  return geometryFrom(pos, col)
}

const LAYER_Y: Record<string, number> = { green: 0.011, pitch: 0.013, paved: 0.014, water: 0.016 }
const LAYER_COLOUR: Record<string, string> = {
  green: GROUND.green,
  pitch: GROUND.pitch,
  paved: GROUND.paved,
  water: GROUND.water,
}

/** landcover: water, parks and pitches, paved lots — flat filled polygons */
export function landcoverGeometry(layer: 'water' | 'green' | 'pitch' | 'paved'): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const y = LAYER_Y[layer]
  scratch.set(LAYER_COLOUR[layer])
  for (const ring of LANDCOVER[layer] ?? []) {
    if (ring.length < 4) continue
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z))
    let faces: number[][]
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, [])
    } catch {
      continue // a self-intersecting ring is not worth a crash over
    }
    for (const f of faces) {
      for (const i of f) {
        const v = contour[i]
        pos.push(v.x, y, v.y)
        col.push(scratch.r, scratch.g, scratch.b)
      }
    }
  }
  return geometryFrom(pos, col)
}

/** bus routes as ribbons riding on top of the carriageway they follow */
export function routeGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const y = 0.07
  for (const r of ROUTES) {
    scratch.set(darker(r.colour, 0.5))
    for (let i = 1; i < r.path.length; i++) {
      pushSegment(pos, col, r.path[i - 1], r.path[i], u(4.6) / 2, scratch, y - 0.006)
    }
    scratch.set(r.colour)
    for (let i = 1; i < r.path.length; i++) {
      pushSegment(pos, col, r.path[i - 1], r.path[i], u(3.2) / 2, scratch, y)
    }
  }
  return geometryFrom(pos, col)
}

/** a mottled grass texture — 7 × 11 km of one flat colour reads as paper */
let grassTex: THREE.Texture | null = null
export function grassTexture(): THREE.Texture {
  if (grassTex) return grassTex
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = GROUND.grass
  ctx.fillRect(0, 0, size, size)
  // deterministic speckle — the same field every run, no per-frame randomness
  let seed = 7
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const r = 1 + rnd() * 7
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(120,150,88,0.26)' : 'rgba(168,186,124,0.2)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(26, 40)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  grassTex = tex
  return tex
}
