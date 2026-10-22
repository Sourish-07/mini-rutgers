/**
 * A hairline sparkline, drawn by hand.
 *
 * It replaced Recharts: a charting library brought a whole dashboard house style
 * with it, and this needs to look like an instrument trace instead — one line, a
 * dashed threshold, no chrome. 300 × 60 user units, stretched to the panel, with
 * a non-scaling stroke so the line stays 1 px at any width.
 */
export function Sparkline({
  data,
  threshold,
  height = 58,
  unit,
}: {
  data: number[]
  /** a level worth marking, e.g. bus capacity */
  threshold?: number
  height?: number
  unit?: string
}) {
  const W = 300
  const H = 60
  const max = Math.max(threshold ?? 0, ...data, 1) * 1.15
  const n = data.length
  const px = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W)
  const py = (v: number) => H - 2 - (v / max) * (H - 6)
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')
  const last = data[n - 1] ?? 0
  const peak = Math.max(...data, 0)

  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        {/* quarter lines: enough structure to read a level off, nothing more */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="#ffffff"
            strokeOpacity={0.06}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {threshold !== undefined && (
          <line
            x1={0}
            x2={W}
            y1={py(threshold)}
            y2={py(threshold)}
            stroke="#e8a33d"
            strokeOpacity={0.85}
            strokeWidth={1}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {n > 1 && (
          <>
            <path d={`${line} L${W},${H} L0,${H} Z`} fill="#cc0015" fillOpacity={0.16} />
            <path
              d={line}
              fill="none"
              stroke="#e9eef3"
              strokeWidth={1.4}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={px(n - 1)} cy={py(last)} r={2.4} fill="#ff5a6e" />
          </>
        )}
      </svg>
      <span className="pointer-events-none absolute left-0 top-0 font-mono text-[9px] text-ink-500">
        peak {peak}
        {unit}
      </span>
      <span className="pointer-events-none absolute bottom-0 right-0 font-mono text-[9px] text-ink-400">
        now {last}
        {unit}
      </span>
    </div>
  )
}
