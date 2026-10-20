import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Scene } from './scene'
import { Panels } from './ui'
import { createSim, scenarioFocusStop, type Scenario } from './sim'
import { fetchLiveVehicles, type LiveVehicle } from './live'

export default function App() {
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(10)
  const [, setFrame] = useState(0)
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [live, setLive] = useState<{ on: boolean; vehicles: LiveVehicle[]; error: string | null }>({
    on: false,
    vehicles: [],
    error: null,
  })

  // one simulation for the session; the scene advances it on the frame clock
  const simRef = useRef<ReturnType<typeof createSim> | null>(null)
  if (!simRef.current) {
    simRef.current = createSim({ population: 6000, seed: 7 })
    simRef.current.runTo(9 * 60) // open at 09:00 with the day already under way
  }
  const sim = simRef.current
  ;(window as unknown as { __sim: unknown }).__sim = sim

  // open where the simulation is actually busiest, not on a hardcoded building
  const [focus] = useState(() => {
    let best = 'bsc'
    let n = -1
    for (const [k, q] of Object.entries(sim.queue)) {
      if (q.length > n) {
        n = q.length
        best = k
      }
    }
    return best
  })
  const clock = useRef({ t: sim.minute }).current

  // panels sample the sim a few times a second; the 3D scene runs at frame rate
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), 400)
    return () => clearInterval(id)
  }, [])

  // live Rutgers tracker polling — fails visibly, never invents vehicles
  useEffect(() => {
    if (!live.on) return
    let dead = false
    const tick = async () => {
      try {
        const vehicles = await fetchLiveVehicles()
        if (!dead) setLive((s) => ({ ...s, vehicles, error: null }))
      } catch (e) {
        if (!dead) setLive((s) => ({ ...s, error: e instanceof Error ? e.message : 'unreachable' }))
      }
    }
    void tick()
    const id = setInterval(tick, 5000)
    return () => {
      dead = true
      clearInterval(id)
    }
  }, [live.on])

  const applyScenario = (sc: Scenario): string | null => {
    const r = sim.applyScenario(sc)
    if (!r.ok) return r.error ?? 'rejected'
    setScenario(sc)
    setFrame((f) => f + 1)
    return null
  }

  const jumpTo = (min: number) => {
    clock.t = Math.max(clock.t, min)
    setFrame((f) => f + 1)
  }

  /** the alert lever, finally real: extra vehicles drop onto the busiest corridor */
  const reserveFleet = () => {
    // only stops a modeled route actually serves can be helped by more buses
    const served = new Set<string>()
    for (const b of sim.buses) for (const s of b.route.stops) served.add(s)
    let bestStop = ''
    let bestN = -1
    for (const [k, q] of Object.entries(sim.queue)) {
      if (!served.has(k)) continue
      if (q.length > bestN) {
        bestN = q.length
        bestStop = k
      }
    }
    let bestRoute = ''
    let bestLoad = -1
    for (const b of sim.buses) {
      if (!b.route.stops.includes(bestStop)) continue
      if (b.riders.length > bestLoad) {
        bestLoad = b.riders.length
        bestRoute = b.route.ref
      }
    }
    if (!bestRoute) return
    applyScenario({
      id: `reserve-${Math.ceil(clock.t)}`,
      label: `Reserve fleet — +3 buses on Route ${bestRoute}`,
      events: [
        { kind: 'fleet_add', id: 'reserve-now', route: bestRoute, buses: 3, atMin: Math.ceil(clock.t) },
      ],
    })
  }

  const eventStop = scenario ? scenarioFocusStop(scenario) : null

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#cfe8f7] text-slate-900">
      <Canvas
        orthographic
        dpr={1}
        camera={{ position: [0.001, 300, 0], zoom: 90, near: -2000, far: 4000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        className="absolute inset-0"
      >
        <Scene
          sim={sim}
          clock={clock}
          speed={running ? speed : 0}
          focus={focus}
          eventStop={eventStop}
          vehicles={live.on ? live.vehicles : []}
        />
      </Canvas>

      <Panels
        sim={sim}
        clock={clock}
        speed={speed}
        setSpeed={setSpeed}
        running={running}
        setRunning={setRunning}
        scenario={scenario}
        applyScenario={applyScenario}
        jumpTo={jumpTo}
        reserveFleet={reserveFleet}
        live={live}
        toggleLive={() => setLive((s) => ({ ...s, on: !s.on }))}
      />
    </div>
  )
}
