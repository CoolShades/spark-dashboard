import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { useLatestSnapshot } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatWattsValue, splitWall, sumGpuWatts } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { GpuMetrics } from '@/types/metrics'
import type { PowerHistory, PowerNow } from '@/types/power'
import { usePanelDevice } from '../../panelDevice'
import { PanelNotice } from '../PanelNotice'
import { FactLine, Headline, PowerNotice, PowerStat, StaleBadge } from './PowerParts'

const SYSTEM_COLOR = '#71717a'
const OTHER_COLORS = ['#38bdf8', '#a78bfa', '#f472b6']
const METER_COLOR = '#e4e4e7'

/**
 * The hovered point on the supplies' line: a dot, and the metered figure in a small dark label just above it (below it
 * when the point is near the chart's top), in place of a tooltip box.
 */
export function MeteredDot(props: { cx?: number; cy?: number; value?: number | null }) {
  const { cx, cy, value } = props
  if (cx == null || cy == null || value == null) return <g />
  const text = `${formatWattsValue(value)} W`
  const w = 8 + text.length * 5.6
  const above = cy > 20
  const y = above ? cy - 18 : cy + 6
  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={2.5} fill={METER_COLOR} />
      <rect x={cx - w / 2} y={y} width={w} height={13} rx={3} fill="#09090b" fillOpacity={0.85} />
      <text x={cx} y={y + 9.5} textAnchor="middle" fontSize={9.5} fill={METER_COLOR}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontVariantNumeric: 'tabular-nums' }}>{text}</text>
    </g>
  )
}

/**
 * The last few minutes at the wall, one point a poll, filling what the card has left: the wall figure as an area and
 * the supplies' own meters summed as a line (input where they have one, else output), on an axis scaled to what the
 * window holds (the UPS reads in coarse steps, the supplies every second, and both sit far above zero, so a
 * zero-based axis left them flat along the bottom). Hovering marks the supplies' line with its metered figure.
 */
function LiveChart({ recent }: { recent: ReadonlyArray<{ at: number; data: PowerNow }> }) {
  const rows = recent
    .filter((r) => r.data.total_watts !== null)
    .map((r) => {
      const meters = r.data.supplies.map((sp) => sp.input_watts ?? sp.output_watts)
      const read = meters.filter((w): w is number => w !== null)
      return { t: r.at, wall: r.data.total_watts, metered: read.length ? read.reduce((a, b) => a + b, 0) : null, supplies: r.data.supplies }
    })
  if (rows.length < 3) return <div className="flex-1 min-h-0" />
  const t0 = rows[0].t
  const t1 = rows[rows.length - 1].t
  const values = rows.flatMap((r) => [r.wall, r.metered]).filter((v): v is number => v !== null)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = Math.max(10, (hi - lo) * 0.2)
  const names = rows[rows.length - 1].supplies.filter((sp) => (sp.input_watts ?? sp.output_watts) !== null).map((sp) => sp.name)
  return (
    <div className="flex-1 min-h-[56px] flex flex-col min-w-0" aria-label="Last few minutes">
      <ChartContainer config={{ wall: { label: 'Wall', color: NVIDIA_THEME.accent }, metered: { label: 'Supplies', color: METER_COLOR } }}
        className="w-full flex-1 min-h-0 aspect-auto">
        <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={NVIDIA_THEME.chartGrid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide />
          <YAxis width={34} stroke={NVIDIA_THEME.chartAxis} fontSize={10} tickLine={false} axisLine={false} tickCount={3}
            domain={[Math.max(0, Math.floor((lo - pad) / 10) * 10), Math.ceil((hi + pad) / 10) * 10]}
            tickFormatter={(v: number) => formatWattsValue(v)} allowDecimals={false} />
          {/* No tooltip box: a faint cursor, and the supplies' metered figure as a small label above the line (MeteredDot). */}
          <ChartTooltip content={() => null} cursor={{ stroke: '#52525b', strokeDasharray: '2 2' }} isAnimationActive={false} />
          <Area dataKey="wall" type="stepAfter" stroke={NVIDIA_THEME.accent} fill={NVIDIA_THEME.accent} fillOpacity={0.15}
            strokeWidth={1.5} isAnimationActive={false} connectNulls activeDot={false} />
          <Line dataKey="metered" type="monotone" stroke={METER_COLOR} strokeOpacity={0.7} strokeWidth={1.1} dot={false}
            isAnimationActive={false} connectNulls activeDot={MeteredDot} />
        </ComposedChart>
      </ChartContainer>
      <p className="shrink-0 text-[10px] 2xl:text-xs text-zinc-500 font-mono tabular-nums truncate">
        last {Math.max(1, Math.round((t1 - t0) / 60_000))} min · <span style={{ color: NVIDIA_THEME.accent }}>wall</span>
        {names.length > 0 && <> · <span className="text-zinc-300">{names.join(' + ')} (metered)</span></>}
      </p>
    </div>
  )
}

/**
 * The GPU slice, card by card: each one's board power (this dashboard's NVML
 * reading, so it moves every second) against its power limit, with the slot
 * the source names it by in the 24 h chart ("GPU 0 · slot 2") when it does.
 */
function GpuRow({ gpus, labels }: { gpus: ReadonlyArray<GpuMetrics>; labels: ReadonlyArray<string> }) {
  if (gpus.length === 0) return null
  return (
    <div className="grid gap-2 min-w-0" style={{ gridTemplateColumns: `repeat(${Math.min(gpus.length, 4)}, minmax(0, 1fr))` }}>
      {gpus.map((g) => {
        const name = `GPU ${g.index}`
        const where = labels.find((l) => l.startsWith(`${name} · `))?.slice(name.length + 3)
        const share = g.power_watts !== null && g.power_limit_watts ? (g.power_watts / g.power_limit_watts) * 100 : null
        return (
          <div key={g.index} className="flex flex-col gap-1 min-w-0"
            title={g.power_limit_watts ? `${name}: power limit ${formatWattsValue(g.power_limit_watts)} W` : name}>
            <PowerStat label={name} value={g.power_watts !== null ? formatWattsValue(g.power_watts) : '—'} unit="W" sub={where} />
            {share !== null && (
              <div className="h-1 w-full rounded-full overflow-hidden bg-zinc-700/40" aria-label={`${name}, ${Math.round(share)} % of its power limit`}>
                <div className="h-full transition-all duration-500" style={{ width: `${Math.min(100, share)}%`, backgroundColor: NVIDIA_THEME.accent }} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The whole rack at the wall, and where it goes: the GPUs (this dashboard's own
 * NVML reading, so that slice moves every second), the other loads on the same
 * meter (a router on the UPS, estimated by the source), and the system: CPU,
 * memory, disks, fans and the supplies' losses. Then the GPU slice card by
 * card, and a live chart of the last few minutes, polled every 2 s, scaled to
 * what it holds, the supplies' metered figure on hover.
 */
export function PowerWallPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  const snapshot = useLatestSnapshot()
  const history = usePowerDocument<PowerHistory>('history?hours=24', POWER_POLL_MS.history)
  usePanelDevice(now.data?.total_source ?? null)
  if (!now.data) return <PowerNotice state={now} />

  const { total_watts: total, total_estimated: estimated, supplies } = now.data
  if (total === null) return <PanelNotice>Wall power not reported</PanelNotice>
  const split = splitWall(total, sumGpuWatts(snapshot?.gpus), now.data.other_loads ?? [])
  const slices = split
    ? [
        { name: 'GPUs', watts: split.gpus, color: NVIDIA_THEME.accent, est: false, tip: 'NVML board power, all cards' },
        { name: 'System', watts: split.system, color: SYSTEM_COLOR, est: false,
          tip: 'CPU, memory, disks, fans and the power supplies’ losses' },
        ...split.others.map((o, i) => ({ name: o.name, watts: o.watts, color: OTHER_COLORS[i % OTHER_COLORS.length],
          est: o.estimated, tip: o.estimated ? 'An estimate: nothing meters it on its own' : '' })),
      ]
    : []
  const readings = supplies
    .map((s) =>
      s.input_watts !== null
        ? `${s.name} in ${formatWattsValue(s.input_watts)} W`
        : s.output_watts !== null
          ? `${s.name} out ${formatWattsValue(s.output_watts)} W`
          : null,
    )
    .filter(Boolean)

  return (
    <div className="h-full flex flex-col gap-1.5 min-w-0 overflow-hidden">
      <Headline
        value={formatWattsValue(total)}
        unit="W"
        tag={
          <>
            {estimated && (
              <span
                className="text-[9px] uppercase tracking-wider text-zinc-500 border border-zinc-700 rounded px-1"
                title="Derived from the UPS's load reading, not metered"
              >
                est.
              </span>
            )}
            <StaleBadge state={now} />
          </>
        }
      />
      {slices.length > 0 && total > 0 && (
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex h-2 w-full rounded-full overflow-hidden bg-zinc-700/40" aria-label="Where the wall power goes">
            {slices.map((s) => (
              <div key={s.name} className="h-full transition-all duration-500"
                style={{ width: `${(s.watts / total) * 100}%`, backgroundColor: s.color }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0">
            {slices.map((s) => (
              <span key={s.name} className="flex items-center gap-1" title={s.tip}>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-zinc-400">{s.name}</span>
                <span className="text-zinc-200">{s.est ? '~' : ''}{formatWattsValue(s.watts)} W</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {readings.length > 0 && <FactLine>{readings.join(' · ')}</FactLine>}
      <div className="mt-1.5">
        <GpuRow gpus={snapshot?.gpus ?? []} labels={history.data?.gpu_labels ?? []} />
      </div>
      <LiveChart recent={now.recent as ReadonlyArray<{ at: number; data: PowerNow }>} />
    </div>
  )
}
