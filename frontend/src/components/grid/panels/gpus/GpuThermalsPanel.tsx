import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { useLatestSnapshot } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { GPU_LINE_COLORS } from '@/lib/gpus'
import { gpuIndexOf, snapshotGpus } from '@/lib/identity'
import { formatClock } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { GpuHistory } from '@/types/gpus'
import { PanelNotice } from '../PanelNotice'
import { PowerNotice } from '../power/PowerParts'

/**
 * Each GPU's temperature over the last 24 hours (the peak of each step), one
 * line and one colour per card, with the cards' own limits as dashed lines when
 * the source gives them: the temperature target the boost algorithm holds to,
 * and the maximum operating temperature above which the driver slows the
 * clocks. The legend is each card now, from this dashboard's NVML reading; the
 * tooltip gives every card's temperature and fan at the hovered step.
 */
export function GpuThermalsPanel() {
  const history = usePowerDocument<GpuHistory>('gpu-history?hours=24', POWER_POLL_MS.gpuHistory)
  const snapshot = useLatestSnapshot()
  const h = history.data
  const keys = useMemo(
    () => (h?.labels ?? []).map((label, i) => ({ key: `g${i}`, label, color: GPU_LINE_COLORS[i % GPU_LINE_COLORS.length] })),
    [h],
  )
  const config = useMemo(() => Object.fromEntries(keys.map((k) => [k.key, { label: k.label, color: k.color }])), [keys])
  const rows = useMemo(
    () =>
      (h?.points ?? []).map((p) => {
        const row: Record<string, number | null> = { t: p.t }
        p.gpus.forEach((g, i) => {
          row[`g${i}`] = g.temp
          row[`f${i}`] = g.fan
        })
        return row
      }),
    [h],
  )
  if (!h) return <PowerNotice state={history} />
  if (rows.length === 0) return <PanelNotice>No GPU history yet</PanelNotice>

  const live = new Map((snapshot ? snapshotGpus(snapshot) : []).map((g) => [gpuIndexOf(g), g]))
  const target = h.limits?.target_c ?? null
  const maxOp = h.limits?.max_operating_c ?? null
  const peaks = rows.flatMap((r) => keys.map((k) => r[k.key])).filter((v): v is number => v !== null)
  const top = Math.max(...peaks, (maxOp ?? target ?? 85) + 2)
  const hottest = h.summary.reduce<(typeof h.summary)[number] | null>((a, b) => ((b.temp_max ?? -1) > (a?.temp_max ?? -1) ? b : a), null)

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-x-3 gap-y-0.5 mb-1 flex-wrap text-[10px] 2xl:text-xs font-mono tabular-nums">
        {keys.map((k, i) => {
          const now = live.get(h.summary[i]?.index ?? i)?.temperature_celsius ?? null
          return (
            <span key={k.key} className="flex items-center gap-1.5 text-zinc-500">
              <span className="inline-block w-2.5 h-[2px] rounded-full" style={{ backgroundColor: k.color }} />
              {k.label.replace(/ · slot \d+$/, '')}
              {now !== null && <span className="text-zinc-200">{Math.round(now)} °C</span>}
            </span>
          )
        })}
        {hottest?.temp_max != null && hottest.temp_max_at && (
          <span className="ml-auto text-zinc-400">
            hottest <span className="text-zinc-100">{Math.round(hottest.temp_max)} °C</span> · GPU {hottest.index} at {formatClock(Date.parse(hottest.temp_max_at))}
          </span>
        )}
      </div>
      <ChartContainer config={config} className="w-full flex-1 min-h-0 aspect-auto">
        <LineChart data={rows} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid stroke={NVIDIA_THEME.chartGrid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} stroke={NVIDIA_THEME.chartAxis}
            fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatClock} minTickGap={60} />
          <YAxis width={34} stroke={NVIDIA_THEME.chartAxis} fontSize={11} tickLine={false} axisLine={false}
            domain={[(min: number) => Math.max(0, Math.floor((min - 5) / 10) * 10), Math.ceil(top / 5) * 5]}
            tickFormatter={(v: number) => `${v}°`} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, p) => formatClock(Number(p?.[0]?.payload?.t ?? 0))}
                formatter={(value, name, item) => {
                  const i = Number(String(name).slice(1))
                  const fan = (item?.payload as Record<string, number | null> | undefined)?.[`f${i}`]
                  return (
                    <div className="flex w-full items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: keys[i]?.color }} />
                      <span className="text-muted-foreground">{keys[i]?.label}</span>
                      <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">
                        {Math.round(Number(value))} °C{fan != null ? ` · fan ${Math.round(fan)} %` : ''}
                      </span>
                    </div>
                  )
                }}
              />
            }
          />
          {target !== null && (
            <ReferenceLine y={target} stroke={NVIDIA_THEME.warning} strokeDasharray="4 4" strokeOpacity={0.6}
              label={{ value: `${target}° target`, position: 'insideTopLeft', fill: NVIDIA_THEME.warning, fontSize: 10, opacity: 0.8 }} />
          )}
          {maxOp !== null && (
            <ReferenceLine y={maxOp} stroke={NVIDIA_THEME.critical} strokeDasharray="4 4" strokeOpacity={0.6}
              label={{ value: `${maxOp}° max operating`, position: 'insideTopLeft', fill: NVIDIA_THEME.critical, fontSize: 10, opacity: 0.8 }} />
          )}
          {keys.map((k) => (
            <Line key={k.key} dataKey={k.key} type="monotone" stroke={k.color} strokeWidth={1.4} dot={false}
              isAnimationActive={false} connectNulls={false} />
          ))}
        </LineChart>
      </ChartContainer>
    </div>
  )
}
