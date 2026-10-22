/**
 * Rendering for the on-campus cohort: the students who live in the dorms, wear
 * scarlet, and can be clicked and interrogated.
 *
 * They use the same instanced figure renderer as the off-campus crowd
 * (`people.tsx`) — a blocky 1.75 m person with a walk cycle — so the difference
 * between the two populations is the palette and the fact that these figures
 * carry a fat invisible click proxy wired to the inspector.
 *
 * Also here: barrier bars over closed walk edges, the ring that tracks the
 * inspected student, and the food-truck meshes a `place_add` lever can spawn.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PANTS, SKIN, pickColour, useCrowd, type FigurePose } from './people'
import type { Mind } from '../engine/mind/engine.ts'
import type { MindStudent } from '../engine/mind/types.ts'

const M = 50
const m = (metres: number) => metres / M

/** which student states are visible outdoors */
export const visibleState = (s: MindStudent) => s.state === 'travel' || s.state === 'queue'

export function MindPeople({
  mind,
  clock,
  onSelect,
  selected,
  limit,
}: {
  mind: Mind
  clock: { t: number }
  onSelect: (id: number) => void
  selected: number | null
  /** max figures to draw, taken from the whole cohort in id order */
  limit: number
}) {
  const { camera, size } = useThree()
  const crowd = useCrowd({ max: mind.students.length, onPick: onSelect, pickMetres: 4 })
  const headings = useRef<number[]>([])
  const list = useRef<FigurePose[]>([])
  const pool = useMemo(
    () =>
      mind.students.map((s, i) => ({
        index: s.id,
        x: 0,
        z: 0,
        heading: 0,
        moving: false,
        phase: 0,
        scale: 1,
        // the cohort's own colour is their shirt: scarlet reads as "on campus"
        shirt: new THREE.Color(s.color),
        pants: new THREE.Color(pickColour(PANTS, i, 7)),
        skin: new THREE.Color(pickColour(SKIN, i, 3)),
      })),
    [mind],
  )

  useFrame(() => {
    const f = clock.t - Math.floor(clock.t)
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1
    const detail = size.height / zoom < 40
    const figures = list.current
    figures.length = 0
    let drawn = 0
    for (const s of mind.students) {
      if (!visibleState(s)) continue
      if (drawn >= limit) break // render cap — the engine still simulates everyone
      const p = pool[s.id]
      const dx = s.pos[0] - s.prev[0]
      const dz = s.pos[1] - s.prev[1]
      if (dx || dz) headings.current[s.id] = Math.atan2(-dz, dx)
      p.x = s.prev[0] + dx * f
      p.z = s.prev[1] + dz * f
      p.heading = headings.current[s.id] ?? 0
      p.moving = s.state === 'travel'
      // a brisk, individual cadence — the cohort walks with purpose
      p.phase = (clock.t * (0.95 + (s.id % 7) * 0.03) + s.id * 0.29) % 1
      p.scale = s.id === selected ? 1.12 : 1
      figures.push(p)
      drawn++
    }
    crowd.pose(figures, detail)
  })

  return crowd.element
}

/** scarlet bars over every closed walk edge — rebuilt only when the set changes */
export function Barriers({ mind }: { mind: Mind }) {
  const ref = useRef<THREE.LineSegments>(null)
  const lastCount = useRef(-1)
  const geom = useMemo(() => new THREE.BufferGeometry(), [])
  useFrame(() => {
    const segs = mind.closedSegments()
    if (segs.length === lastCount.current) return
    lastCount.current = segs.length
    const pts = new Float32Array(segs.length * 6)
    segs.forEach((s, i) => {
      pts.set([s[0], m(6), s[1], s[2], m(6), s[3]], i * 6)
    })
    geom.setAttribute('position', new THREE.BufferAttribute(pts, 3))
    if (ref.current) ref.current.geometry = geom
  })
  return (
    <lineSegments ref={ref} geometry={geom} frustumCulled={false} renderOrder={9}>
      <lineBasicMaterial color="#cc0015" transparent opacity={0.95} />
    </lineSegments>
  )
}

/** a scarlet ring and a short beacon on the inspected student */
export function SelectionMarker({
  mind,
  selected,
  clock,
}: {
  mind: Mind
  selected: number | null
  clock: { t: number }
}) {
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    if (selected === null) {
      g.visible = false
      return
    }
    const s = mind.students[selected]
    if (!s || !visibleState(s)) {
      g.visible = false
      return
    }
    const f = clock.t - Math.floor(clock.t)
    const x = s.prev[0] + (s.pos[0] - s.prev[0]) * f
    const z = s.prev[1] + (s.pos[1] - s.prev[1]) * f
    g.visible = true
    g.position.set(x, 0, z)
    const pulse = 1 + 0.12 * Math.sin(clock.t * 4)
    g.scale.setScalar(pulse)
  })
  return (
    <group ref={ref} renderOrder={10}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.09, 0]}>
        <ringGeometry args={[m(3.6), m(4.6), 28]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.95} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.095, 0]}>
        <ringGeometry args={[m(5), m(5.7), 28]} />
        <meshBasicMaterial color="#cc0015" transparent opacity={0.85} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* a beacon: a 1.75 m figure is hard to find again once you pan away */}
      <mesh position={[0, m(5), 0]}>
        <cylinderGeometry args={[m(0.14), m(0.14), m(10), 5]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.3} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** dynamically added food trucks: a box, an awning and a pad, on the walk graph.
 *  Self-polls the engine (never re-renders its parents on the panel clock —
 *  re-rendering the Canvas subtree tears down overlay roots). */
export function Trucks({ mind }: { mind: Mind }) {
  const [trucks, setTrucks] = useState<{ id: string; pos: [number, number] }[]>([])
  useEffect(() => {
    const refresh = () =>
      setTrucks(mind.activeTrucks().map((t) => ({ id: t.id, pos: t.pos as [number, number] })))
    refresh()
    const id = setInterval(refresh, 500)
    return () => clearInterval(id)
  }, [mind])
  return (
    <group>
      {trucks.map((t) => (
        <group key={t.id} position={[t.pos[0], 0, t.pos[1]]}>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 0]} renderOrder={4}>
            <circleGeometry args={[m(7), 20]} />
            <meshBasicMaterial color="#efe9d8" transparent opacity={0.6} toneMapped={false} />
          </mesh>
          <mesh position={[0, m(1.5), 0]}>
            <boxGeometry args={[m(5), m(2.4), m(2.2)]} />
            <meshLambertMaterial color="#e2492f" />
          </mesh>
          <mesh position={[0, m(2.85), 0]}>
            <boxGeometry args={[m(5.5), m(0.25), m(2.6)]} />
            <meshLambertMaterial color="#f7f3e8" />
          </mesh>
          <mesh position={[0, m(0.3), 0]}>
            <boxGeometry args={[m(5.2), m(0.6), m(2.4)]} />
            <meshLambertMaterial color="#3d4654" />
          </mesh>
        </group>
      ))}
    </group>
  )
}
