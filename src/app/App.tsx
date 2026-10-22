/**
 * The composition root.
 *
 * One simulation pair for the session — the 6,000-student transit population and
 * the 420 on-campus students with real schedules — advanced by the scene's frame
 * clock. The overlay samples both a few times a second; the map labels are DOM,
 * positioned by the camera, so text never goes through the 3D pass.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Scene, type Imagery, type ScreenLabel } from '../render/scene'
import { Legend, Populations, Prediction, StatusStrip, StopLabels, Telemetry, TopBar } from '../ui/Panels'
import { Inspector, Results, WhatIf } from '../ui/MindPanels'
import { createSim } from '../engine/sim'
import { createMind } from '../engine/mind/engine.ts'

export default function App() {
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(10)
  const [, setFrame] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [imagery, setImagery] = useState<Imagery>('designed')
  const [labels, setLabels] = useState<ScreenLabel[]>([])

  // one simulation for the session; the scene advances it on the frame clock
  const simRef = useRef<ReturnType<typeof createSim> | null>(null)
  const mindRef = useRef<ReturnType<typeof createMind> | null>(null)
  if (!simRef.current) {
    simRef.current = createSim({ population: 6000, seed: 7 })
    simRef.current.runTo(9 * 60) // open at 09:00 with the day already under way
  }
  if (!mindRef.current) {
    // the on-campus cohort: 420 students with real Rutgers schedules
    mindRef.current = createMind({ seed: 21, cohort: 420 })
    mindRef.current.runTo(2 * 60)
  }
  const sim = simRef.current
  const mind = mindRef.current

  // render caps only — both engines always simulate the full populations; these
  // start at "draw everything" and the Populations panel lets the user drag them
  const [mindLimit, setMindLimit] = useState(mind.students.length)
  const [simLimit, setSimLimit] = useState(sim.agents.length)

  // honest live counts — exactly how many are outdoors / on foot right now
  let mindOutdoors = 0
  for (const s of mind.students) if (s.state === 'travel' || s.state === 'queue') mindOutdoors++
  let simOnFoot = 0
  for (const a of sim.agents) if (a.state !== 'ride') simOnFoot++

  const w = window as unknown as { __sim: unknown; __mind: unknown }
  w.__sim = sim
  w.__mind = mind

  // the demo opens on the College Avenue quarter — the on-campus quarter
  const focus = 'cas'
  const clock = useRef({ t: sim.minute }).current

  // panels sample both sims a few times a second; the 3D scene runs at frame rate
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), 400)
    return () => clearInterval(id)
  }, [])

  const onLabels = useCallback((next: ScreenLabel[]) => setLabels(next), [])

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-ink-950">
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ position: [0.001, 300, 0], zoom: 150, near: -2000, far: 4000 }}
        gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
        className="absolute inset-0"
      >
        <Scene
          sim={sim}
          mind={mind}
          clock={clock}
          speed={running ? speed : 0}
          focus={focus}
          selected={selected}
          onSelect={setSelected}
          mindLimit={mindLimit}
          simLimit={simLimit}
          imagery={imagery}
          onLabels={onLabels}
        />
      </Canvas>

      {/* stop names, projected by the camera and drawn as DOM */}
      <StopLabels labels={labels} />

      <TopBar
        minute={Math.floor(clock.t)}
        speed={speed}
        setSpeed={setSpeed}
        running={running}
        setRunning={setRunning}
        imagery={imagery}
        setImagery={setImagery}
      />

      {/* left dock — stacked and scrollable so panels never overlap */}
      <div className="dock pointer-events-auto absolute bottom-14 left-3 top-[76px] z-20 flex w-[17rem] flex-col gap-2 overflow-y-auto pb-2 pr-0.5">
        <Populations
          mind={mind}
          sim={sim}
          mindLimit={mindLimit}
          setMindLimit={setMindLimit}
          simLimit={simLimit}
          setSimLimit={setSimLimit}
          mindOutdoors={mindOutdoors}
          simOnFoot={simOnFoot}
        />
        <WhatIf mind={mind} clock={clock} />
        <Legend />
      </div>

      {/* right dock — stacked and scrollable so panels never overlap */}
      <div className="dock pointer-events-auto absolute bottom-14 right-3 top-[76px] z-20 flex w-[18.5rem] flex-col gap-2 overflow-y-auto pb-2 pr-0.5">
        <Telemetry sim={sim} />
        <Prediction sim={sim} clock={clock} />
        <Inspector mind={mind} selected={selected} setSelected={setSelected} />
        <Results mind={mind} clock={clock} />
      </div>

      <StatusStrip minute={Math.floor(clock.t)} speed={speed} running={running} />
    </div>
  )
}
