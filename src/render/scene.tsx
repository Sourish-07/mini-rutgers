/**
 * The scene.
 *
 * Everything here is a projection of engine state: the ground is vector
 * geometry drawn from OSM, the buildings are the real Rutgers footprints baked
 * into `places-v2.json` (no runtime fetch — the app works offline), the buses
 * are driven along their own route loops, and the crowds are blocky instanced
 * figures that walk.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { FRAME, GROUND, grassTexture, landcoverGeometry, roadGeometry, routeGeometry } from './ground'
import PLACES_DATA from '../data/places-v2.json'
import { STOPS, type Agent, type Bus, type Sim } from '../engine/sim'
import { SKIN, PANTS, pickColour, useCrowd, type FigurePose } from './people'
import { MindPeople, Barriers, SelectionMarker, Trucks } from './mindScene'
import type { Mind } from '../engine/mind/engine.ts'

const M = 50

/** metres -> scene units */
export const m = (metres: number) => metres / M

/** what the map is drawn on: the designed vector ground, or the baked imagery */
export type Imagery = 'designed' | 'satellite'

/* ------------------------------------------------------------------ campus */

type Place = {
  id: string
  n: string
  num?: string
  cat: string
  district: string
  x: number
  z: number
  foot: [number, number][]
}

const PLACES = PLACES_DATA as unknown as Place[]

/** storeys per category — real campus silhouettes, not one uniform slab */
const STOREYS: Record<string, number> = {
  Housing: 4,
  Academic: 3,
  Research: 4,
  'Health Care': 3,
  Administrative: 3,
  'Information Center': 3,
  'Student Life': 2,
  Athletic: 2,
  Agricultural: 2,
  Storage: 1,
  Utilities: 1,
  Parking: 1,
}

/** muted clay and brick — the buildings sit on the map, they do not shout on it */
const ROOF: Record<string, string> = {
  Academic: '#a8735f',
  Housing: '#b98a63',
  Administrative: '#9c7261',
  'Student Life': '#b5793f',
  Athletic: '#7f9a6b',
  Research: '#9a6a52',
  'Health Care': '#a97676',
  'Information Center': '#9aa4ad',
  Parking: '#9aa0a4',
  Utilities: '#8f939a',
  Storage: '#a09a8c',
  Agricultural: '#8aa063',
}
const ROOF_FALLBACK = '#b0a898'

const STOREY_M = 3.6

/* -------------------------------------------------------------- buildings */

/** a soft blob so every building sits in its own light instead of hovering */
let blobTex: THREE.Texture | null = null
function shadowBlob(): THREE.Texture {
  if (blobTex) return blobTex
  const s = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = s
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.18, s / 2, s / 2, s * 0.5)
  g.addColorStop(0, 'rgba(24,32,20,0.42)')
  g.addColorStop(0.65, 'rgba(24,32,20,0.20)')
  g.addColorStop(1, 'rgba(24,32,20,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  blobTex = t
  return t
}

type Block = { x: number; z: number; w: number; d: number }

/**
 * Real footprints, extruded: roof triangulated from the ring, walls raised along
 * every edge, plus a thin roof outline. A bounding box would cover the street the
 * building sits beside, which is why the polygon is carried all the way here.
 */
function Buildings() {
  const { solid, outline, blocks } = useMemo(() => {
    const pos: number[] = []
    const col: number[] = []
    const edge: number[] = []
    const blocks: Block[] = []
    const c = new THREE.Color()

    for (const p of PLACES) {
      const ring = p.foot
      if (!ring || ring.length < 4) continue
      let area = 0
      for (let i = 0; i < ring.length; i++) {
        const [x, z] = ring[i]
        const [nx, nz] = ring[(i + 1) % ring.length]
        area += x * nz - nx * z
      }
      const contour = (area < 0 ? ring.slice().reverse() : ring).map(([x, z]) => new THREE.Vector2(x, z))
      if (contour.length < 3) continue

      const storeys = (STOREYS[p.cat] ?? 2) + (hash(p.id) % 2)
      const h = m(STOREY_M) * storeys
      c.set(ROOF[p.cat] ?? ROOF_FALLBACK)
      const roof = [c.r * 1.02, c.g * 1.01, c.b * 0.98]
      const wall = [c.r * 0.84, c.g * 0.83, c.b * 0.88]

      let faces: number[][]
      try {
        faces = THREE.ShapeUtils.triangulateShape(contour, [])
      } catch {
        continue
      }
      for (const f of faces) {
        for (const i of f) {
          const v = contour[i]
          pos.push(v.x, h, v.y)
          col.push(roof[0], roof[1], roof[2])
        }
      }
      for (let i = 0; i < contour.length; i++) {
        const a = contour[i]
        const b = contour[(i + 1) % contour.length]
        pos.push(a.x, 0, a.y, b.x, 0, b.y, b.x, h, b.y)
        pos.push(a.x, 0, a.y, b.x, h, b.y, a.x, h, a.y)
        for (let k = 0; k < 6; k++) col.push(wall[0], wall[1], wall[2])
        edge.push(a.x, h + 0.004, a.y, b.x, h + 0.004, b.y)
      }

      // bounding box of the ring, for the ground shadow
      let x0 = Infinity
      let x1 = -Infinity
      let z0 = Infinity
      let z1 = -Infinity
      for (const [x, z] of contour) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        z0 = Math.min(z0, z)
        z1 = Math.max(z1, z)
      }
      blocks.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 })
    }

    const solid = new THREE.BufferGeometry()
    solid.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    solid.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    solid.computeVertexNormals()

    const outline = new THREE.BufferGeometry()
    outline.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3))

    return { solid, outline, blocks }
  }, [])

  const shadows = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = shadows.current
    if (!mesh) return
    const dummy = new THREE.Object3D()
    blocks.forEach((b, i) => {
      dummy.position.set(b.x + 0.35, 0.02, b.z + 0.45)
      dummy.rotation.set(-Math.PI / 2, 0, 0)
      dummy.scale.set(b.w * 1.5, b.d * 1.5, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [blocks])

  return (
    <group>
      {blocks.length > 0 && (
        <instancedMesh ref={shadows} args={[undefined, undefined, blocks.length]} renderOrder={2}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={shadowBlob()} transparent depthWrite={false} toneMapped={false} />
        </instancedMesh>
      )}
      <mesh geometry={solid}>
        <meshLambertMaterial vertexColors />
      </mesh>
      <lineSegments geometry={outline} renderOrder={3}>
        <lineBasicMaterial color="#f4efe2" transparent opacity={0.5} />
      </lineSegments>
    </group>
  )
}

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0
  return h
}

/* ---------------------------------------------------------------- the map */

/** the four landcover sheets, bottom to top, then the roads over them */
function Ground({ imagery }: { imagery: Imagery }) {
  const designed = imagery === 'designed'
  const grass = useMemo(() => grassTexture(), [])
  const land = useMemo(
    () => ({
      green: landcoverGeometry('green'),
      pitch: landcoverGeometry('pitch'),
      paved: landcoverGeometry('paved'),
      water: landcoverGeometry('water'),
    }),
    [],
  )
  const roads = useMemo(() => roadGeometry(), [])
  const routes = useMemo(() => routeGeometry(), [])

  // The aerial layer is a 5 MB photograph and most sessions never switch to it,
  // so it is fetched on first use instead of riding in the initial load.
  const [aerial, setAerial] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (imagery !== 'satellite' || aerial) return
    let dead = false
    let tex: THREE.Texture | null = null
    import('../data/satellite.jpg').then(({ default: url }) => {
      if (dead) return
      tex = new THREE.TextureLoader().load(url)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 8
      setAerial(tex)
    })
    return () => {
      dead = true
      tex?.dispose()
    }
  }, [imagery, aerial])

  const w = FRAME.x1 - FRAME.x0
  const h = FRAME.z1 - FRAME.z0
  const cx = (FRAME.x0 + FRAME.x1) / 2
  const cz = (FRAME.z0 + FRAME.z1) / 2

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[cx, 0, cz]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={designed ? grass : (aerial ?? grass)} toneMapped={false} />
      </mesh>
      {designed && (
        <>
          {(['green', 'pitch', 'paved', 'water'] as const).map((k) => (
            <mesh key={k} geometry={land[k]} renderOrder={1}>
              <meshBasicMaterial vertexColors toneMapped={false} />
            </mesh>
          ))}
          <mesh geometry={roads} renderOrder={2}>
            <meshBasicMaterial vertexColors toneMapped={false} />
          </mesh>
        </>
      )}
      <mesh geometry={routes} renderOrder={3}>
        <meshBasicMaterial vertexColors toneMapped={false} />
      </mesh>
      <FrameBorder />
    </group>
  )
}

/** a hairline around the mapped frame — it reads as a drawn board, not a crop */
function FrameBorder() {
  const geom = useMemo(() => {
    const { x0, x1, z0, z1 } = FRAME
    const y = 0.012
    const pts = [x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0]
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  return (
    <lineSegments geometry={geom} renderOrder={9}>
      <lineBasicMaterial color={GROUND.frame} transparent opacity={0.5} />
    </lineSegments>
  )
}

const MAJOR = new Set(['arc', 'bsc', 'livSc', 'cas', 'yard', 'redoak', 'hill', 'quads'])

/** stops as small pieces of street furniture: a pad, a pole, a scarlet sign */
function Stops() {
  return (
    <>
      {Object.entries(STOPS).map(([k, s]) => (
        <group key={k} position={[s.at[0], 0, s.at[1]]}>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.045, 0]} renderOrder={4}>
            <circleGeometry args={[m(4.2), 20]} />
            <meshBasicMaterial color="#efe9d8" transparent opacity={0.5} toneMapped={false} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 0]} renderOrder={4}>
            <ringGeometry args={[m(4.2), m(4.9), 24]} />
            <meshBasicMaterial
              color={MAJOR.has(k) ? '#12161c' : '#6b7280'}
              transparent
              opacity={0.45}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[m(3.4), m(1.6), 0]}>
            <cylinderGeometry args={[m(0.14), m(0.14), m(3.2), 5]} />
            <meshLambertMaterial color="#4a5260" />
          </mesh>
          <mesh position={[m(3.4), m(2.9), 0]}>
            <boxGeometry args={[m(1.5), m(0.85), m(0.1)]} />
            <meshLambertMaterial color="#cc0015" />
          </mesh>
          <mesh position={[m(3.4), m(1.95), 0]}>
            <boxGeometry args={[m(0.16), m(0.55), m(0.16)]} />
            <meshLambertMaterial color="#4a5260" />
          </mesh>
        </group>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ buses */

/** position at an arc-length distance along the loop */
function atDistance(bus: Bus, distance: number): [number, number] {
  const len = bus.route.len
  const d = ((distance % len) + len) % len
  const path = bus.route.path
  let acc = 0
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
    if (acc + seg >= d) {
      const t = (d - acc) / (seg || 1)
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      ]
    }
    acc += seg
  }
  return path[path.length - 1]
}

function BusMesh({ bus, clock }: { bus: Bus; clock: { t: number } }) {
  const g = useRef<THREE.Group>(null)
  const yaw = useRef(0)
  useFrame((_, dt) => {
    const node = g.current
    if (!node) return
    const f = clock.t - Math.floor(clock.t)
    // interpolate along the loop, modulo its length: interpolating xz directly
    // makes a wrapping bus fly straight across the campus and back
    const len = bus.route.len
    const step = (((bus.d - bus.pd) % len) + len) % len
    const dNow = (bus.pd + step * f) % len
    const p0 = atDistance(bus, dNow)
    node.position.set(p0[0], 0, p0[1])
    const p1 = atDistance(bus, dNow + 1.5)
    const dx = p1[0] - p0[0]
    const dz = p1[1] - p0[1]
    if (dx || dz) {
      // turn toward the path, never snap: a terminus U-turn should read as a bus
      // swinging round, not as one that teleports into reverse
      const target = Math.atan2(-dz, dx)
      let delta = target - yaw.current
      delta = Math.atan2(Math.sin(delta), Math.cos(delta))
      yaw.current += delta * Math.min(1, dt * 4)
      node.rotation.y = yaw.current
    }
  })

  const load = bus.riders.length / bus.capacity
  return (
    <group ref={g}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.035, 0]} renderOrder={3}>
        <planeGeometry args={[m(15), m(5.6)]} />
        <meshBasicMaterial
          map={shadowBlob()}
          transparent
          opacity={0.6}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <group scale={m(12) / 2.1}>
        {/* scarlet body reads from the air; the white roof band is what you see top-down */}
        <mesh position={[0, 0.42, 0]}>
          <boxGeometry args={[2.1, 0.44, 0.86]} />
          <meshLambertMaterial color="#b3002d" />
        </mesh>
        <mesh position={[0, 0.66, 0]}>
          <boxGeometry args={[2.02, 0.06, 0.78]} />
          <meshLambertMaterial color="#c81f3c" />
        </mesh>
        <mesh position={[0, 0.7, 0]}>
          <boxGeometry args={[1.98, 0.02, 0.18]} />
          <meshLambertMaterial color="#f8f8f6" />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[2.12, 0.16, 0.88]} />
          <meshLambertMaterial color="#7f0021" />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0, 0.5, s * 0.435]}>
            <boxGeometry args={[1.82, 0.2, 0.02]} />
            <meshLambertMaterial color="#22303c" />
          </mesh>
        ))}
        {[-1, 1].map((e) => (
          <mesh key={e} position={[e * 1.045, 0.5, 0]}>
            <boxGeometry args={[0.02, 0.2, 0.74]} />
            <meshLambertMaterial color="#22303c" />
          </mesh>
        ))}
        {(
          [
            [-0.72, -0.42],
            [-0.72, 0.42],
            [0.72, -0.42],
            [0.72, 0.42],
          ] as const
        ).map(([x, z], i) => (
          <mesh key={i} position={[x, 0.13, z]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.13, 0.13, 0.1, 12]} />
            <meshLambertMaterial color="#141a20" />
          </mesh>
        ))}
      </group>
      {/* a full bus turns its roof band scarlet: load is readable from the air */}
      <mesh position={[0, m(3.5), 0]} rotation-x={-Math.PI / 2} renderOrder={6}>
        <planeGeometry args={[m(9), m(1.1)]} />
        <meshBasicMaterial
          color={load > 0.85 ? '#cc0015' : '#2f7d4f'}
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

/* ----------------------------------------------------------------- people */

/**
 * Off-campus students: the background population the legacy engine drives. They
 * ride the buses in, walk to their destination and walk home again, so only the
 * ones on foot are drawn — riders are inside the bus mesh.
 */
function People({ agents, clock, limit }: { agents: Agent[]; clock: { t: number }; limit: number }) {
  const { camera, size } = useThree()
  const crowd = useCrowd({ max: agents.length })
  const headings = useRef<number[]>([])
  const list = useRef<FigurePose[]>([])
  const pool = useMemo(
    () =>
      agents.map((a, i) => ({
        index: a.id,
        x: 0,
        z: 0,
        heading: 0,
        moving: false,
        phase: 0,
        scale: 1,
        shirt: new THREE.Color(a.col),
        pants: new THREE.Color(pickColour(PANTS, i, 5)),
        skin: new THREE.Color(pickColour(SKIN, i, 3)),
      })),
    [agents],
  )

  useFrame(() => {
    const f = clock.t - Math.floor(clock.t)
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1
    const detail = size.height / zoom < 34
    const figures = list.current
    figures.length = 0
    let drawn = 0
    for (const a of agents) {
      if (drawn >= limit) break // render cap — the engine still simulates everyone
      if (a.state === 'ride') continue
      const p = pool[a.id]
      const dx = a.x - a.px
      const dz = a.z - a.pz
      if (dx || dz) headings.current[a.id] = Math.atan2(-dz, dx)
      p.x = a.px + dx * f
      p.z = a.pz + dz * f
      p.heading = headings.current[a.id] ?? 0
      p.moving = a.state === 'walk-stop' || a.state === 'walk-dest'
      p.phase = (clock.t * 1.15 + a.id * 0.41) % 1
      figures.push(p)
      drawn++
    }
    crowd.pose(figures, detail)
  })

  return crowd.element
}

/* ------------------------------------------------------------------ labels */

export type ScreenLabel = { key: string; label: string; x: number; y: number }

/** where the labeled stops land on screen, for the DOM overlay over the canvas */
function projectLabels(camera: THREE.Camera, w: number, h: number): ScreenLabel[] {
  const v = new THREE.Vector3()
  const out: ScreenLabel[] = []
  for (const [key, s] of Object.entries(STOPS)) {
    if (!MAJOR.has(key)) continue
    v.set(s.at[0], m(9), s.at[1]).project(camera)
    out.push({ key, label: s.label, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h })
  }
  return out
}

/* ------------------------------------------------------------------ scene */

export const Scene = memo(function Scene({
  sim,
  mind,
  clock,
  speed,
  focus,
  selected,
  onSelect,
  mindLimit,
  simLimit,
  imagery,
  onLabels,
}: {
  sim: Sim
  mind: Mind
  clock: { t: number }
  speed: number
  /** stop key the camera opens on */
  focus: string
  selected: number | null
  onSelect: (id: number) => void
  /** max on-campus figures to draw (of the full cohort) */
  mindLimit: number
  /** max off-campus figures to draw (of the full transit population) */
  simLimit: number
  imagery: Imagery
  /** screen positions of the labeled stops, throttled — for the DOM overlay */
  onLabels?: (labels: ScreenLabel[]) => void
}) {
  const { camera, size } = useThree()
  const labelClock = useRef(0)

  // one fixed isometric angle: 45° azimuth, ~45° elevation, north up. OrbitControls
  // keeps pan and zoom but never tilts, so the view stays comparable all day.
  useEffect(() => {
    const t = STOPS[focus].at
    camera.up.set(0, 1, 0)
    camera.position.set(t[0] + 140, 200, t[1] + 140)
    camera.lookAt(t[0], 0, t[1])
    ;(camera as THREE.OrthographicCamera).updateProjectionMatrix()
  }, [camera, focus])

  useFrame((_, dt) => {
    clock.t += (Math.min(0.25, dt) * speed) / 60
    const target = Math.floor(clock.t)
    if (target > sim.minute) sim.runTo(target)
    // the mind engine counts minutes since 07:00 (START), the legacy sim uses
    // absolute minutes — same tick, two conventions
    const rel = target - mind.START
    if (rel > mind.minute) mind.runTo(rel)

    if (onLabels) {
      labelClock.current += dt
      if (labelClock.current > 0.1) {
        labelClock.current = 0
        onLabels(projectLabels(camera, size.width, size.height))
      }
    }
  }, -1)

  return (
    <>
      <color attach="background" args={[GROUND.sky]} />
      <hemisphereLight args={['#fdf7e8', '#8a9a72', 1.1]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[70, 110, 45]} intensity={1.45} color="#fff3dd" />

      <Ground imagery={imagery} />
      <Stops />
      <Buildings />
      {sim.buses.map((b, i) => (
        <BusMesh key={i} bus={b} clock={clock} />
      ))}
      <People agents={sim.agents} clock={clock} limit={simLimit} />
      <MindPeople mind={mind} clock={clock} onSelect={onSelect} selected={selected} limit={mindLimit} />
      <Barriers mind={mind} />
      <SelectionMarker mind={mind} selected={selected} clock={clock} />
      <Trucks mind={mind} />

      <OrbitControls
        makeDefault
        target={[STOPS[focus].at[0], 0, STOPS[focus].at[1]]}
        enableRotate={false}
        enablePan
        screenSpacePanning
        enableDamping
        dampingFactor={0.12}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        minZoom={6}
        maxZoom={2200}
        zoomSpeed={2}
      />
    </>
  )
})
