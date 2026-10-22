/**
 * The crowd, as geometry.
 *
 * The people used to be 44 × 66 px canvases: fine at arm's length, mush when you
 * zoom in to read a single student. They are now small blocky figures built from
 * real primitives and drawn as seven InstancedMeshes (legs, torso, arms, head,
 * contact shadow), so six thousand people cost seven draw calls and stay sharp at
 * any zoom because they are never scaled up from a bitmap.
 *
 * They walk: a sine wave per figure swings the legs and counter-swings the arms,
 * the body bobs on the same wave, and the heading yaw follows the direction of
 * travel. Everyone is 1.75 m tall (the scale check in scripts/check/check-layout
 * asserts it), cast in a shirt colour of their own, and given a soft contact
 * shadow so they sit on the ground instead of floating over it.
 */
import { useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'

const M = 50
const m = (metres: number) => metres / M

/* --------------------------------------------------------------- proportions */

/** metres → scene units (1 unit = 50 m): a person is 1.75 m, i.e. 0.035 units */
const U = (metres: number) => metres / 50

const LEG_LEN = 0.78
const LEG_W = 0.13
const ARM_LEN = 0.54
const ARM_W = 0.11
const TORSO_W = 0.42
const TORSO_D = 0.24
const TORSO_H = 0.56
const HEAD = 0.25

const HIP_Y = U(LEG_LEN)
const TORSO_Y = U(LEG_LEN + TORSO_H / 2)
const SHOULDER_Y = U(LEG_LEN + TORSO_H - 0.06)
const HEAD_Y = U(LEG_LEN + TORSO_H + HEAD / 2 - 0.02)
/** the hips and shoulders are a few centimetres apart, in units */
const HIP_SPREAD = U(0.085)
const ARM_SPREAD = U(0.175)
const BOB = U(0.02)

/* -------------------------------------------------------------------- colour */

/** skin tones, drawn from the same seeded stream as the personas */
export const SKIN = ['#e2b48c', '#c68f62', '#9c6742', '#6f4426', '#f0cfae', '#b07c50', '#845234', '#d9a878']
/** trousers: quiet, so the shirts carry the identity */
export const PANTS = ['#2f3540', '#46413a', '#26282c', '#5c564a', '#343c48', '#544b41', '#3b3833', '#282e3a']

/** deterministic colour pick: a person's shirt, trousers and skin never change */
export const pickColour = <T,>(table: T[], i: number, stride = 3): T => table[(i * stride) % table.length]

/* ------------------------------------------------------------------ geometry */

type Parts = {
  leg: THREE.BufferGeometry
  arm: THREE.BufferGeometry
  torso: THREE.BufferGeometry
  head: THREE.BufferGeometry
  shadow: THREE.BufferGeometry
}

let cached: Parts | null = null

/**
 * Flat shading, baked into the geometry: each box face gets a fixed brightness
 * (top brightest, sides dimmer) as a vertex colour. Combined with the per-instance
 * shirt colour this is how a 3-pixel figure still reads as a solid little person —
 * a lit material would wash these out to grey slivers at map zoom.
 */
function shadeBox(geom: THREE.BoxGeometry, top = 1, x = 0.84, z = 0.74, bottom = 0.55): THREE.BoxGeometry {
  // BoxGeometry vertex order is +X, -X, +Y, -Y, +Z, -Z — four vertices each
  const shades = [x, x, top, bottom, z, z]
  const n = geom.getAttribute('position').count
  const color = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) {
    const s = shades[Math.floor(v / 4)] ?? top
    color[v * 3] = s
    color[v * 3 + 1] = s
    color[v * 3 + 2] = s
  }
  geom.setAttribute('color', new THREE.BufferAttribute(color, 3))
  return geom
}

/** geometries hang from their pivot (hip / shoulder) so a rotation swings the limb */
export function figureParts(): Parts {
  if (cached) return cached
  const leg = shadeBox(new THREE.BoxGeometry(U(LEG_W), U(LEG_LEN), U(LEG_W)), 0.95, 0.8, 0.7, 0.5).translate(
    0,
    -U(LEG_LEN) / 2,
    0,
  )
  const arm = shadeBox(new THREE.BoxGeometry(U(ARM_W), U(ARM_LEN), U(ARM_W)), 0.95, 0.8, 0.7, 0.5).translate(
    0,
    -U(ARM_LEN) / 2,
    0,
  )
  const torso = shadeBox(new THREE.BoxGeometry(U(TORSO_W), U(TORSO_H), U(TORSO_D)), 1, 0.86, 0.72, 0.5)
  const head = shadeBox(new THREE.BoxGeometry(U(HEAD), U(HEAD), U(HEAD)), 1, 0.88, 0.78, 0.6)
  const shadow = new THREE.CircleGeometry(U(0.36), 16).rotateX(-Math.PI / 2)
  cached = { leg, arm, torso, head, shadow }
  return cached
}

/** one figure, in scene units — the caller owns all simulation truth */
export type FigurePose = {
  /** stable instance slot (a person's id): colours are painted once per slot */
  index: number
  x: number
  z: number
  /** radians, 0 = facing +x */
  heading: number
  moving: boolean
  /** 0..1 walk-cycle phase */
  phase: number
  /** per-instance tint */
  shirt: THREE.Color
  pants: THREE.Color
  skin: THREE.Color
  /** 1 = a normal 1.75 m person */
  scale?: number
}

/* -------------------------------------------------------------------- crowd */

/**
 * The crowd is indexed by a *stable* instance slot (a person's id), never by
 * "position in the visible list". That is what lets instance colours be written
 * once at boot instead of every frame: a person keeps their coat all day.
 */
export function useCrowd({
  max,
  onPick,
  pickMetres = 3,
}: {
  /** instance capacity — the whole simulated population, drawn or not */
  max: number
  /** called with the instance slot (person id) under the pointer */
  onPick?: (slot: number) => void
  pickMetres?: number
}) {
  const parts = useMemo(() => figureParts(), [])
  const { camera, size } = useThree()
  const legL = useRef<THREE.InstancedMesh>(null)
  const legR = useRef<THREE.InstancedMesh>(null)
  const torso = useRef<THREE.InstancedMesh>(null)
  const armL = useRef<THREE.InstancedMesh>(null)
  const armR = useRef<THREE.InstancedMesh>(null)
  const head = useRef<THREE.InstancedMesh>(null)
  const shadow = useRef<THREE.InstancedMesh>(null)
  const hit = useRef<THREE.InstancedMesh>(null)
  const painted = useRef(new Set<number>())
  const shown = useRef(new Set<number>())
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tint = useMemo(() => new THREE.Color(), [])
  const black = useMemo(() => new THREE.Color('#000000'), [])
  const vRight = useMemo(() => new THREE.Vector3(), [])
  const vUp = useMemo(() => new THREE.Vector3(), [])

  const meshes = () => [legL, legR, torso, armL, armR, head, shadow].map((r) => r.current)

  /** paint a slot once: shirt, trousers, skin */
  const paint = (slot: number, fig: FigurePose) => {
    const all = meshes()
    if (all.some((x) => !x)) return
    const [L1, L2, T, A1, A2, H, S] = all as THREE.InstancedMesh[]
    T.setColorAt(slot, tint.copy(fig.shirt))
    A1.setColorAt(slot, tint.copy(fig.shirt))
    A2.setColorAt(slot, tint.copy(fig.shirt))
    L1.setColorAt(slot, tint.copy(fig.pants))
    L2.setColorAt(slot, tint.copy(fig.pants))
    H.setColorAt(slot, tint.copy(fig.skin))
    S.setColorAt(slot, black)
    for (const mesh of all as THREE.InstancedMesh[]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  /** hide every slot drawn last frame that is not in this one */
  const retire = (keep: Set<number>) => {
    if (!shown.current.size) return
    const dead: number[] = []
    for (const slot of shown.current) if (!keep.has(slot)) dead.push(slot)
    if (!dead.length) return
    dummy.position.set(0, -50, 0)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.setScalar(1)
    dummy.updateMatrix()
    for (const mesh of [...meshes(), hit.current] as (THREE.InstancedMesh | null)[]) {
      if (!mesh) continue
      for (const slot of dead) mesh.setMatrixAt(slot, dummy.matrix)
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  /**
   * Write one frame. `detail` gates the parts that are sub-pixel when zoomed out
   * (arms and contact shadows) by hiding their meshes — cheaper than rewriting
   * thirty thousand matrices just to make them vanish.
   */
  const pose = (figures: FigurePose[], detail = true) => {
    const all = meshes()
    const proxy = hit.current
    if (!proxy || all.some((x) => !x)) return
    const [L1, L2, T, A1, A2, H, S] = all as THREE.InstancedMesh[]
    A1.visible = A2.visible = S.visible = detail

    // A true 1.75 m figure is a quarter of a pixel at map zoom, and an invisible
    // crowd explains nothing. Figures are grown until they hold ~1% of the
    // viewport height, capped at 2.5× so a whole-campus view does not turn into
    // a field of giants. Zoom in and the true scale takes over.
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1
    const across = size.height / zoom
    const bump = Math.min(3, Math.max(1, (across * 0.015) / U(1.75)))

    // Only the figures actually inside the view are posed. At the demo's framing
    // the camera sees ~300 m of a 7 × 11 km campus, so this is the difference
    // between assembling eight thousand matrices every frame and a few hundred.
    // An orthographic camera makes the test two dot products against its own axes.
    const cam = camera as THREE.OrthographicCamera
    vRight.setFromMatrixColumn(cam.matrixWorld, 0)
    vUp.setFromMatrixColumn(cam.matrixWorld, 1)
    const eye = cam.position
    const halfH = across / 2
    const halfW = halfH * (size.width / Math.max(1, size.height))
    const margin = across * 0.03

    const keep = new Set<number>()
    for (const f of figures) {
      const dx = f.x - eye.x
      const dy = -eye.y
      const dz = f.z - eye.z
      const rx = dx * vRight.x + dy * vRight.y + dz * vRight.z
      const ry = dx * vUp.x + dy * vUp.y + dz * vUp.z
      if (Math.abs(rx) > halfW + margin || Math.abs(ry) > halfH + margin) continue

      const s = (f.scale ?? 1) * bump
      if (!painted.current.has(f.index)) {
        painted.current.add(f.index)
        paint(f.index, f)
      }
      keep.add(f.index)

      const wave = f.moving ? Math.sin(f.phase * Math.PI * 2) : 0
      const swing = wave * 0.5
      const bob = f.moving ? Math.abs(wave) * BOB * s : 0
      const sin = Math.sin(f.heading) * s
      const cos = Math.cos(f.heading) * s
      const i = f.index

      // legs: hinged at the hip, opposite phase
      dummy.rotation.set(swing, f.heading, 0, 'YXZ')
      dummy.scale.setScalar(s)
      dummy.position.set(f.x - sin * HIP_SPREAD, HIP_Y * s, f.z - cos * HIP_SPREAD)
      dummy.updateMatrix()
      L1.setMatrixAt(i, dummy.matrix)
      dummy.rotation.set(-swing, f.heading, 0, 'YXZ')
      dummy.position.set(f.x + sin * HIP_SPREAD, HIP_Y * s, f.z + cos * HIP_SPREAD)
      dummy.updateMatrix()
      L2.setMatrixAt(i, dummy.matrix)

      // trunk and head: a slight forward lean while walking, a small bob
      dummy.rotation.set(f.moving ? 0.05 : 0, f.heading, 0, 'YXZ')
      dummy.position.set(f.x, TORSO_Y * s + bob, f.z)
      dummy.updateMatrix()
      T.setMatrixAt(i, dummy.matrix)
      dummy.rotation.set(0, f.heading, 0, 'YXZ')
      dummy.position.set(f.x, HEAD_Y * s + bob, f.z)
      dummy.updateMatrix()
      H.setMatrixAt(i, dummy.matrix)

      // the parts that are sub-pixel when zoomed out cost nothing when they are
      // not written at all — their meshes are hidden for the same reason
      if (detail) {
        // arms: counter-swing, flared a little when idle
        dummy.rotation.set(-swing * 0.8, f.heading, -0.07, 'YXZ')
        dummy.position.set(f.x - sin * ARM_SPREAD, SHOULDER_Y * s + bob, f.z - cos * ARM_SPREAD)
        dummy.updateMatrix()
        A1.setMatrixAt(i, dummy.matrix)
        dummy.rotation.set(swing * 0.8, f.heading, 0.07, 'YXZ')
        dummy.position.set(f.x + sin * ARM_SPREAD, SHOULDER_Y * s + bob, f.z + cos * ARM_SPREAD)
        dummy.updateMatrix()
        A2.setMatrixAt(i, dummy.matrix)

        // contact shadow
        dummy.rotation.set(0, 0, 0)
        dummy.scale.setScalar(s * 1.06)
        dummy.position.set(f.x, 0.09, f.z)
        dummy.updateMatrix()
        S.setMatrixAt(i, dummy.matrix)
      }

      // the fat invisible proxy that makes a 1.75 m person clickable
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(m(pickMetres) * 2, 1, m(pickMetres) * 2)
      dummy.position.set(f.x, 0, f.z)
      dummy.updateMatrix()
      proxy.setMatrixAt(i, dummy.matrix)
    }

    retire(keep)
    shown.current = keep
    for (const mesh of [...all, proxy] as THREE.InstancedMesh[]) mesh.instanceMatrix.needsUpdate = true
  }

  const pick = (e: ThreeEvent<MouseEvent>) => {
    if (!onPick || e.instanceId === undefined) return
    e.stopPropagation()
    onPick(e.instanceId)
  }

  /**
   * The parts. The fat invisible proxy is first in the list because it is the
   * one a click actually lands on: a 1.75 m student is two pixels wide at map
   * zoom, so the hit volume is a 3 m cylinder around them instead.
   */
  const element = (
    <>
      <instancedMesh
        ref={hit}
        args={[undefined, undefined, max]}
        frustumCulled={false}
        onClick={pick}
        renderOrder={1}
      >
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshBasicMaterial visible={false} />
      </instancedMesh>
      {(
        [
          [legL, parts.leg, 5],
          [legR, parts.leg, 5],
          [torso, parts.torso, 6],
          [armL, parts.arm, 6],
          [armR, parts.arm, 6],
          [head, parts.head, 6],
          [shadow, parts.shadow, 4],
        ] as const
      ).map((entry, i) => (
        <instancedMesh
          key={i}
          ref={entry[0]}
          args={[entry[1], undefined, max]}
          frustumCulled={false}
          renderOrder={entry[2]}
        >
          {/* flat and unlit: the baked face shading does the work, so a figure
              reads as its own colour instead of whatever the light did to it */}
          <meshBasicMaterial
            vertexColors={i !== 6}
            transparent={i === 6}
            opacity={i === 6 ? 0.2 : 1}
            depthWrite={i !== 6}
            toneMapped={false}
          />
        </instancedMesh>
      ))}
    </>
  )

  return { element, pose, parts }
}
