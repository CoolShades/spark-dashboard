import type { ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import type { DataPoint } from '@/lib/metricsHistoryStore'
import { NVIDIA_THEME } from '@/lib/theme'
import { HoverLabel, StripFooter, type HoveredPoint } from '../power/PowerParts'

/** The axis's top for a window peaking at `hi`: the next of 1, 1.5, 2, 3, 4, 5, 6, 8, 10 × a power of ten. */
function niceTop(hi: number): number {
  if (!(hi > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(hi))
  return ([1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((n) => n * mag >= hi - 1e-9) ?? 10) * mag
}

/** A card's strip, like the Power page's: one live line over the panel's window, from 0, and its caption. */
export function SeriesStrip({ points, color, caption, label }: { points: DataPoint[]; color: string; caption: ReactNode; label: string }) {
  if (points.length < 3) return <StripFooter caption={caption}><span className="block h-6" /></StripFooter>
  const t0 = points[0].timestamp
  const t1 = points[points.length - 1].timestamp
  const top = Math.max(...points.map((p) => p.value), 1e-9)
  const W = 300
  const H = 40
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${(((p.timestamp - t0) / Math.max(t1 - t0, 1)) * W).toFixed(1)},${(H - 1 - (p.value / top) * (H - 2)).toFixed(1)}`)
    .join(' ')
  return (
    <StripFooter caption={caption}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-6" aria-label={label}>
        <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </StripFooter>
  )
}

/**
 * A live line you can hover, like the wall card's chart: from 0 to the window's peak (rounded up, or `max`), filling
 * its parent's height, with a three-tick axis when `axis` is set. Hovering marks the point and gives its value in a
 * small dark label above it (`format`). In a short strip (no axis) the label always sits above the line and may run
 * over what is above the strip; it never drops under the strip's foot. The focus ring recharts' keyboard layer
 * would draw round the whole chart on hover is hidden.
 */
export function HoverStrip({ points, color, label, format, max, axis = false }: {
  points: DataPoint[]; color: string; label: string; format: (v: number) => string; max?: number; axis?: boolean
}) {
  if (points.length < 3) return <div className="flex-1 min-h-0" aria-label={label} />
  const rows = points.map((p) => ({ t: p.timestamp, v: p.value }))
  const top = max ?? niceTop(Math.max(...rows.map((r) => r.v)))
  return (
    <div className="flex-1 min-h-0 flex min-w-0" aria-label={label}>
      <ChartContainer config={{ v: { label, color } }} className="w-full flex-1 min-h-0 aspect-auto [&_.recharts-surface]:overflow-visible [&_:focus]:outline-none">
        <AreaChart data={rows} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
          {axis && <CartesianGrid stroke={NVIDIA_THEME.chartGrid} strokeDasharray="3 3" vertical={false} />}
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide />
          <YAxis hide={!axis} width={34} stroke={NVIDIA_THEME.chartAxis} fontSize={10} tickLine={false} axisLine={false}
            domain={[0, top]} ticks={[0, top / 2, top]} interval={0} tickFormatter={(v: number) => v.toLocaleString('en-GB')} />
          <ChartTooltip content={() => null} cursor={{ stroke: '#52525b', strokeDasharray: '2 2' }} isAnimationActive={false} />
          <Area dataKey="v" type="monotone" stroke={color} fill={color} fillOpacity={0.15} strokeWidth={1.3} dot={false}
            isAnimationActive={false}
            activeDot={(d: HoveredPoint) => (
              <HoverLabel cx={d.cx} cy={d.cy} color={color} flip={axis} at={(d.index ?? 0) / (rows.length - 1)}
                text={d.index != null && rows[d.index] ? format(rows[d.index].v) : null} />
            )} />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}
