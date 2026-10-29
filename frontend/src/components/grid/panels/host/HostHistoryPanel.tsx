import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatRate } from '@/lib/host'
import { formatClock } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { HostHistory } from '@/types/host'
import { PanelNotice } from '../PanelNotice'
import { PowerNotice } from '../power/PowerParts'

const SERIES = [
  { key: 'user', label: 'User', color: NVIDIA_THEME.accent },
  { key: 'system', label: 'System', color: '#38bdf8' },
  { key: 'iowait', label: 'I/O wait', color: NVIDIA_THEME.warning },
] as const
const MEMORY = '#a78bfa'

/**
 * The host over the last 24 hours in 5-minute steps: CPU time stacked as user,
 * system and waiting on I/O (left axis, scaled to the day), and memory used as a
 * line on the right (0-100 %). The tooltip adds the step's 5-minute load, the
 * CPU's peak Tctl, and network and disk throughput.
 */
export function HostHistoryPanel() {
  const history = usePowerDocument<HostHistory>('host-history?hours=24', POWER_POLL_MS.hostHistory)
  const h = history.data
  if (!h) return <PowerNotice state={history} />
  const rows = h.points ?? []
  if (rows.length === 0) return <PanelNotice>No host history yet</PanelNotice>
  const busy = rows.map((p) => (p.user ?? 0) + (p.system ?? 0) + (p.iowait ?? 0))
  const peak = Math.max(...busy)
  const peakAt = rows[busy.indexOf(peak)]?.t
  const avg = busy.reduce((a, b) => a + b, 0) / busy.length
  const hot = rows.reduce<number | null>((a, p) => (p.tctl != null && (a === null || p.tctl > a) ? p.tctl : a), null)
  const config = Object.fromEntries([...SERIES.map((s) => [s.key, { label: s.label, color: s.color }]), ['mem_percent', { label: 'Memory', color: MEMORY }]])

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-x-3 gap-y-0.5 mb-1 flex-wrap text-[10px] 2xl:text-xs font-mono tabular-nums">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-zinc-500">
            <span className="inline-block w-2.5 h-[2px] rounded-full" style={{ backgroundColor: s.color }} />{s.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-zinc-500">
          <span className="inline-block w-2.5 h-[2px] rounded-full" style={{ backgroundColor: MEMORY }} />memory % (right)
        </span>
        <span className="ml-auto text-zinc-400">
          CPU avg <span className="text-zinc-100">{avg.toFixed(1)} %</span> · peak <span className="text-zinc-100">{peak.toFixed(1)} %</span>
          {peakAt ? ` at ${formatClock(peakAt)}` : ''}{hot !== null ? <> · Tctl up to <span className="text-zinc-100">{Math.round(hot)} °C</span></> : null}
        </span>
      </div>
      <ChartContainer config={config} className="w-full flex-1 min-h-0 aspect-auto">
        <ComposedChart data={rows} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid stroke={NVIDIA_THEME.chartGrid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} stroke={NVIDIA_THEME.chartAxis}
            fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatClock} minTickGap={60} />
          <YAxis yAxisId="cpu" width={36} stroke={NVIDIA_THEME.chartAxis} fontSize={11} tickLine={false} axisLine={false}
            domain={[0, (max: number) => Math.max(5, Math.ceil(max / 5) * 5)]} tickFormatter={(v: number) => `${v}%`} />
          <YAxis yAxisId="mem" orientation="right" width={36} stroke={MEMORY} strokeOpacity={0.6} fontSize={11} tickLine={false}
            axisLine={false} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, p) => formatClock(Number(p?.[0]?.payload?.t ?? 0))}
                formatter={(value, name, item, index) => {
                  const line = (color: string, label: string, text: string) => (
                    <div className="flex w-full items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
                      <span className="text-muted-foreground">{label}</span>
                      <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">{text}</span>
                    </div>
                  )
                  const s = SERIES.find((x) => x.key === name)
                  const main = line(s?.color ?? MEMORY, s?.label ?? 'Memory', `${Number(value).toFixed(1)} %`)
                  if (index !== SERIES.length) return main
                  const p = item?.payload as (typeof rows)[number]
                  return (
                    <div className="grid w-full gap-1.5">
                      {main}
                      <div className="grid gap-1 border-t border-border/50 pt-1.5">
                        {p.load5 != null && line('transparent', 'Load (5 m)', p.load5.toFixed(2))}
                        {p.tctl != null && line('transparent', 'Tctl peak', `${Math.round(p.tctl)} °C`)}
                        {line('transparent', 'Network in / out', `${formatRate(p.net_rx)} / ${formatRate(p.net_tx)}`)}
                        {line('transparent', 'Disk read / write', `${formatRate(p.disk_read)} / ${formatRate(p.disk_write)}`)}
                      </div>
                    </div>
                  )
                }}
              />
            }
          />
          {SERIES.map((s) => (
            <Area key={s.key} yAxisId="cpu" dataKey={s.key} stackId="cpu" type="monotone" stroke={s.color} fill={s.color}
              fillOpacity={0.3} strokeWidth={1.1} isAnimationActive={false} connectNulls={false} />
          ))}
          <Line yAxisId="mem" dataKey="mem_percent" type="monotone" stroke={MEMORY} strokeWidth={1.2} dot={false}
            isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ChartContainer>
    </div>
  )
}
