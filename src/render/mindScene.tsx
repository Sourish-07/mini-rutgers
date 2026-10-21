/**
 * Rendering for the minded cohort: instanced figures (single pose, per-instance
 * colour), an invisible fat hit-proxy so 1.75 m students are actually
 * clickable at campus zoom, barrier bars over closed edges, food-truck meshes
 * for place_add, and a marker ring on the inspected student.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { figureTextures, FIGURE_ASPECT } from './atlas'
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
  limit,
}: {
  mind: Mind
  clock: { t: number }
  onSelect: (id: number) => void
  /** max figures to draw, drawn from the whole cohort in id order */
  limit: number
}) {
  const { camera, size } = useThree()
  const tex = useMemo(() => figureTextures(), [])
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const hitRef = useRef<THREE.InstancedMesh>(null)
  const visibleIds = useRef<number[]>([])
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame(() => {
    const mesh = meshRef.current
    const hit = hitRef.current
    if (!mesh || !hit) return
    const f = clock.t - Math.floor(clock.t)
    const stride = Math.floor(clock.t * 8) % 2
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1
    const unitsAcross = size.height / zoom
    const H = Math.max(m(1.75), unitsAcross * 0.017)
    const W = H * FIGURE_ASPECT

    const ids: number[] = []
    let k = 0
    for (const s of mind.students) {
      if (!visibleState(s)) continue
      if (k >= limit) break // render cap — the engine still simulates everyone
      ids.push(s.id)
      const x = s.prev[0] + (s.pos[0] - s.prev[0]) * f
      const z = s.prev[1] + (s.pos[1] - s.prev[1]) * f
      dummy.position.set(x, H / 2, z)
      dummy.quaternion.copy(camera.quaternion)
      dummy.scale.set(W, H * (s.state === 'travel' && stride ? 1.03 : 1), 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(k, dummy.matrix)
      const c = new THREE.Color(s.color)
      mesh.setColorAt(k, c)
      // invisible fat proxy for raycast
      dummy.position.set(x, 0, z)
      dummy.quaternion.identity()
      dummy.scale.set(m(6), 1, m(6))
      dummy.updateMatrix()
      hit.setMatrixAt(k, dummy.matrix)
      k++
    }
    visibleIds.current = ids
    mesh.count = k
    hit.count = k
    mesh.instanceMatrix.needsUpdate = true
    hit.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  const pick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const id = visibleIds.current[e.instanceId ?? -1]
    if (id !== undefined) onSelect(id)
  }

  const n = mind.students.length
  return (
    <group>
      <instancedMesh ref={hitRef} args={[undefined, undefined, n]} frustumCulled={false} onClick={pick}>
        <cylinderGeometry args={[1, 1, 1, 4]} />
        <meshBasicMaterial visible={false} />
      </instancedMesh>
      <instancedMesh ref={meshRef} args={[undefined, undefined, n]} frustumCulled={false} renderOrder={5}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={tex[1][1]}
          transparent
          alphaTest={0.25}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  )
}

/** red bars over every closed walk edge — rebuilt only when the set changes */
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
      <lineBasicMaterial color="#dc2626" transparent opacity={0.95} />
    </lineSegments>
  )
}

/** a white ring that tracks the inspected student */
export function SelectionMarker({
  mind,
  selected,
  clock,
}: {
  mind: Mind
  selected: number | null
  clock: { t: number }
}) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const ring = ref.current
    if (!ring) return
    if (selected === null) {
      ring.visible = false
      return
    }
    const s = mind.students[selected]
    if (!s || !visibleState(s)) {
      ring.visible = false
      return
    }
    const f = clock.t - Math.floor(clock.t)
    const x = s.prev[0] + (s.pos[0] - s.prev[0]) * f
    const z = s.prev[1] + (s.pos[1] - s.prev[1]) * f
    ring.visible = true
    ring.position.set(x, m(2), z)
    const pulse = 1 + 0.15 * Math.sin(clock.t * 4)
    ring.scale.setScalar(pulse)
  })
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} renderOrder={10} frustumCulled={false}>
      <ringGeometry args={[m(4), m(5), 24]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthWrite={false} />
    </mesh>
  )
}

/** dynamically added food trucks: a little box + awning on a white pad.
 *  Self-polls the engine (never re-renders its parents on the panel clock —
 *  re-rendering the Canvas subtree tears down drei Html roots). */
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
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 0]}>
            <circleGeometry args={[m(7), 20]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.75} />
          </mesh>
          <mesh position={[0, m(1.2), 0]}>
            <boxGeometry args={[m(5), m(2.4), m(2.2)]} />
            <meshBasicMaterial color="#e2492f" />
          </mesh>
          <mesh position={[0, m(2.8), 0]}>
            <boxGeometry args={[m(5.5), m(0.3), m(2.6)]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      ))}
    </group>
  )
}
