import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatClock, formatKwh, formatMoney, formatWattsValue, GPU_SHADES } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerHistory } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { PowerNotice } from './PowerParts'

const REST_COLOR = '#71717a'

/** Runs of consecutive on-battery steps, as [start, end] pairs for shading. */
function batteryRuns(points: PowerHistory['points'], stepMs: number): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  for (const p of points) {
    if (!p.on_battery) continue
    const last = runs[runs.length - 1]
    if (last && p.t - last[1] <= stepMs) last[1] = p.t + stepMs
    else runs.push([p.t, p.t + stepMs])
  }
  return runs
}

/**
 * The last 24 hours at the wall, stacked as each GPU and everything else, the
 * way Home Assistant shows "untracked" consumption under the metered devices.
 * A source that sends no per-GPU series gets one GPUs band. The dashed line is
 * the idle floor; times on battery are shaded amber.
 */
export function PowerHistoryPanel() {
  const history = usePowerDocument<PowerHistory>('history?hours=24', POWER_POLL_MS.history)
  const data = history.data
  const perGpu = Boolean(data?.gpu_labels?.length && data.points.some((p) => p.gpus_watts?.length))
  const keys = useMemo(
    () => (perGpu ? data!.gpu_labels!.map((label, i) => ({ key: `g${i}`, label, color: GPU_SHADES[i % GPU_SHADES.length] }))
      : [{ key: 'g0', label: 'GPUs', color: NVIDIA_THEME.accent }]),
    [data, perGpu],
  )
  const config = useMemo(
    () => Object.fromEntries([...keys.map((k) => [k.key, { label: k.label, color: k.color }]),
      ['rest', { label: 'Rest of system', color: REST_COLOR }]]),
    [keys],
  )
  const rows = useMemo(
    () =>
      (data?.points ?? []).map((p) => {
        const total = p.total_watts
        const row: Record<string, number | null> = { t: p.t }
        if (total === null) {
          for (const k of keys) row[k.key] = null
          row.rest = null
          return row
        }
        // Each GPU's share, capped so the stack never rises above the wall figure (the two are read apart).
        let left = total
        const parts = perGpu ? (p.gpus_watts ?? []) : [p.gpu_watts]
        keys.forEach((k, i) => {
          const w = Math.min(Math.max(parts[i] ?? 0, 0), left)
          row[k.key] = w
          left -= w
        })
        row.rest = Math.max(left, 0)
        return row
      }),
    [data, keys, perGpu],
  )
  const runs = useMemo(() => (data ? batteryRuns(data.points, data.step_seconds * 1000) : []), [data])
  if (!data) return <PowerNotice state={history} />
  if (rows.length === 0) return <PanelNotice>No power history yet</PanelNotice>

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-x-3 gap-y-0.5 mb-1 flex-wrap text-[10px] 2xl:text-xs font-mono tabular-nums">
        {[...keys, { key: 'rest', label: 'Rest of system', color: REST_COLOR }].map((c) => (
          <span key={c.key} className="flex items-center gap-1.5 text-zinc-500">
            <span className="inline-block w-2.5 h-[2px] rounded-full" style={{ backgroundColor: c.color }} />
            {c.label}
          </span>
        ))}
        {data.floor_watts != null && (
          <span className="flex items-center gap-1.5 text-zinc-500">
            <span className="inline-block w-2.5 border-t border-dashed border-zinc-400" />
            idle floor {formatWattsValue(data.floor_watts)} W
          </span>
        )}
        <span className="ml-auto text-zinc-400">
          {data.kwh !== null && <span className="text-zinc-100">{formatKwh(data.kwh)} kWh</span>}
          {data.cost !== null && <span> · {formatMoney(data.cost, data.currency)}</span>}
          {data.average_watts !== null && <span> · avg {formatWattsValue(data.average_watts)} W</span>}
          {data.peak_watts !== null && <span> · peak {formatWattsValue(data.peak_watts)} W</span>}
        </span>
      </div>
      <ChartContainer config={config} className="w-full flex-1 min-h-0 aspect-auto">
        <AreaChart data={rows}>
          <CartesianGrid stroke={NVIDIA_THEME.chartGrid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            stroke={NVIDIA_THEME.chartAxis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatClock}
            minTickGap={60}
          />
          {/* Watts without a unit suffix: "1,600 W" wraps in the axis column; the tooltip and header carry the unit. */}
          <YAxis
            width={40}
            stroke={NVIDIA_THEME.chartAxis}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatWattsValue(v)}
          />
          <ChartTooltip
            content={<ChartTooltipContent labelFormatter={(_, p) => formatClock(Number(p?.[0]?.payload?.t ?? 0))} />}
          />
          {runs.map(([x1, x2]) => (
            <ReferenceArea key={x1} x1={x1} x2={x2} fill={NVIDIA_THEME.warning} fillOpacity={0.18} ifOverflow="hidden" />
          ))}
          {keys.map((k) => (
            <Area
              key={k.key}
              dataKey={k.key}
              stackId="w"
              type="monotone"
              stroke={k.color}
              fill={k.color}
              fillOpacity={0.32}
              strokeWidth={1.2}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
          <Area
            dataKey="rest"
            stackId="w"
            type="monotone"
            stroke={REST_COLOR}
            fill={REST_COLOR}
            fillOpacity={0.22}
            strokeWidth={1}
            isAnimationActive={false}
            connectNulls={false}
          />
          {data.floor_watts != null && (
            <ReferenceLine y={data.floor_watts} stroke="#a1a1aa" strokeDasharray="4 4" strokeOpacity={0.7} />
          )}
        </AreaChart>
      </ChartContainer>
    </div>
  )
}
