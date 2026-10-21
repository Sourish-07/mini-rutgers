import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Scene } from '../render/scene'
import { Panels, Sensors, Prediction, AgentMenu } from '../ui/Panels'
import { WhatIf, Inspector, Results } from '../ui/MindPanels'
import { createSim } from '../engine/sim'
import { createMind } from '../engine/mind/engine.ts'

export default function App() {
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(10)
  const [, setFrame] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)

  // one simulation for the session; the scene advances it on the frame clock
  const simRef = useRef<ReturnType<typeof createSim> | null>(null)
  const mindRef = useRef<ReturnType<typeof createMind> | null>(null)
  if (!simRef.current) {
    simRef.current = createSim({ population: 6000, seed: 7 })
    simRef.current.runTo(9 * 60) // open at 09:00 with the day already under way
  }
  if (!mindRef.current) {
    // the behavior cohort: 420 minded students with real Rutgers schedules
    mindRef.current = createMind({ seed: 21, cohort: 420 })
    mindRef.current.runTo(2 * 60)
  }
  const sim = simRef.current
  const mind = mindRef.current
  // render caps only — the engines always simulate the full populations; these
  // start at "draw everything" and the header menu lets the user drag them down
  const [mindLimit, setMindLimit] = useState(mind.students.length)
  const [simLimit, setSimLimit] = useState(sim.agents.length)
  // honest live counts — exactly how many are standing outdoors / on foot now
  let mindOutdoors = 0
  for (const s of mind.students) if (s.state === 'travel' || s.state === 'queue') mindOutdoors++
  let simOnFoot = 0
  for (const a of sim.agents) if (a.state !== 'ride') simOnFoot++
  const w = window as unknown as { __sim: unknown; __mind: unknown }
  w.__sim = sim
  w.__mind = mind

  // the demo opens on the College Avenue quarter — the minded campus
  const focus = 'cas'
  const clock = useRef({ t: sim.minute }).current

  // panels sample both sims a few times a second; the 3D scene runs at frame rate
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), 400)
    return () => clearInterval(id)
  }, [])

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
          mind={mind}
          clock={clock}
          speed={running ? speed : 0}
          focus={focus}
          selected={selected}
          onSelect={setSelected}
          mindLimit={mindLimit}
          simLimit={simLimit}
        />
      </Canvas>

      <Panels
        sim={sim}
        speed={speed}
        setSpeed={setSpeed}
        running={running}
        setRunning={setRunning}
      >
        <AgentMenu
          mind={mind}
          sim={sim}
          mindLimit={mindLimit}
          setMindLimit={setMindLimit}
          simLimit={simLimit}
          setSimLimit={setSimLimit}
          mindOutdoors={mindOutdoors}
          simOnFoot={simOnFoot}
        />
      </Panels>

      {/* left column — stacked and scrollable so panels never overlap */}
      <div className="pointer-events-auto absolute bottom-4 left-4 top-28 z-20 flex w-[16.5rem] flex-col gap-2 overflow-y-auto pb-1 pr-0.5">
        <Sensors sim={sim} />
        <WhatIf mind={mind} clock={clock} />
      </div>

      {/* right column — stacked and scrollable so panels never overlap */}
      <div className="pointer-events-auto absolute bottom-4 right-4 top-24 z-20 flex w-[17rem] flex-col gap-2 overflow-y-auto pb-1 pr-0.5">
        <Prediction sim={sim} clock={clock} />
        <Inspector mind={mind} selected={selected} setSelected={setSelected} />
        <Results mind={mind} clock={clock} />
      </div>
    </div>
  )
}
