import { useMemo } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { useLatestSnapshot } from '@/hooks/useMetricsStore'
import { useSloSettings } from '@/hooks/useSloSettings'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { engineKey } from '@/lib/identity'
import { formatClock } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import { formatRate, formatTokens, msParts, sloColor } from '@/lib/tokens'
import type { TokenHistory } from '@/types/tokens'
import { PanelNotice } from '../PanelNotice'
import { PowerNotice } from '../power/PowerParts'

const PROMPT = '#38bdf8'
const MARGIN = 5
const AXIS_W = 44

/**
 * The last 24 hours of tokens in 5-minute steps: output tokens a second as an
 * area on the left axis, prompt tokens a second as a line on the right (they
 * run two orders of magnitude apart), and under the time axis a ribbon of each
 * step's TTFT p95 against the SLO: green inside it, amber up to twice it, red
 * beyond, empty where nothing finished. The tooltip gives a step's rates,
 * requests, the most running and its TTFT.
 */
export function TokensHistoryPanel() {
  const history = usePowerDocument<TokenHistory>('token-history?hours=24', POWER_POLL_MS.tokenHistory)
  const snapshot = useLatestSnapshot()
  const engine = snapshot?.engines?.[0] ?? null
  const { thresholds: slo } = useSloSettings(engine ? engineKey(engine) : null, engine?.model?.name ?? null)
  const h = history.data
  const rows = useMemo(
    () => (h?.points ?? []).map((p) => ({ ...p, out: p.output / h!.step_seconds, in: p.prompt / h!.step_seconds })),
    [h],
  )
  if (!h) return <PowerNotice state={history} />
  if (rows.length === 0) return <PanelNotice>No token history yet</PanelNotice>

  const out = rows.reduce((s, p) => s + p.output, 0)
  const inp = rows.reduce((s, p) => s + p.prompt, 0)
  const req = rows.reduce((s, p) => s + p.requests, 0)
  const peak = Math.max(...rows.map((p) => p.out))
  const config = { out: { label: 'Output', color: NVIDIA_THEME.accent }, in: { label: 'Prompt', color: PROMPT } }
  const t0 = rows[0].t
  const t1 = rows[rows.length - 1].t + h.step_seconds * 1000

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-x-3 gap-y-0.5 mb-1 flex-wrap text-[10px] 2xl:text-xs font-mono tabular-nums">
        <span className="flex items-center gap-1.5 text-zinc-500">
          <span className="inline-block w-2.5 h-[2px] rounded-full" style={{ backgroundColor: NVIDIA_THEME.accent }} />output tok/s (left)
        </span>
        <span className="flex items-center gap-1.5 text-zinc-500">
          <span className="inline-block w-2.5 h-[2px] rounded-full" style={{ backgroundColor: PROMPT }} />prompt tok/s (right)
        </span>
        <span className="ml-auto text-zinc-400">
          <span className="text-zinc-100">{formatTokens(out)}</span> out · <span className="text-zinc-100">{formatTokens(inp)}</span> in ·{' '}
          {req.toLocaleString('en-GB')} requests · peak {formatRate(peak)} tok/s
        </span>
      </div>
      <ChartContainer config={config} className="w-full flex-1 min-h-0 aspect-auto">
        <ComposedChart data={rows} margin={{ top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN }}>
          <CartesianGrid stroke={NVIDIA_THEME.chartGrid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} stroke={NVIDIA_THEME.chartAxis}
            fontSize={11} tickLine={false} axisLine={false} tickFormatter={formatClock} minTickGap={60} />
          <YAxis yAxisId="out" width={AXIS_W} stroke={NVIDIA_THEME.chartAxis} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => formatTokens(v)} />
          <YAxis yAxisId="in" orientation="right" width={AXIS_W} stroke={PROMPT} strokeOpacity={0.6} fontSize={11} tickLine={false}
            axisLine={false} tickFormatter={(v: number) => formatTokens(v)} />
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
                  const main = line(name === 'out' ? NVIDIA_THEME.accent : PROMPT, name === 'out' ? 'Output' : 'Prompt', `${formatRate(Number(value))} tok/s`)
                  if (index !== 1) return main
                  const p = item?.payload as (typeof rows)[number]
                  return (
                    <div className="grid w-full gap-1.5">
                      {main}
                      <div className="grid gap-1 border-t border-border/50 pt-1.5">
                        {line('transparent', 'Requests', p.requests.toLocaleString('en-GB'))}
                        {p.running != null && line('transparent', 'Running (most)', String(Math.round(p.running)))}
                        {p.ttft_p50_ms != null && line('transparent', 'TTFT p50 / p95', `${msParts(p.ttft_p50_ms).value}${msParts(p.ttft_p50_ms).unit} / ${msParts(p.ttft_p95_ms).value}${msParts(p.ttft_p95_ms).unit}`)}
                      </div>
                    </div>
                  )
                }}
              />
            }
          />
          <Area yAxisId="out" dataKey="out" type="monotone" stroke={NVIDIA_THEME.accent} fill={NVIDIA_THEME.accent} fillOpacity={0.25}
            strokeWidth={1.2} isAnimationActive={false} connectNulls={false} />
          <Line yAxisId="in" dataKey="in" type="monotone" stroke={PROMPT} strokeOpacity={0.8} strokeWidth={1.1} dot={false}
            isAnimationActive={false} connectNulls={false} />
        </ComposedChart>
      </ChartContainer>
      <div className="shrink-0 flex items-center gap-2 mt-0.5" style={{ paddingLeft: MARGIN + AXIS_W - 18, paddingRight: MARGIN + AXIS_W }}>
        <span className="text-[9px] font-mono text-zinc-500 w-4 shrink-0" title="TTFT p95 per step against the SLO">TTFT</span>
        <div className="relative h-2 flex-1" aria-label="TTFT p95 per step against the SLO">
          {rows.every((p) => p.ttft_p95_ms == null) && (
            <span className="absolute inset-0 flex items-center text-[9px] font-mono text-zinc-600 whitespace-nowrap">
              TTFT p95 per step, against the {slo.ttftMs} ms SLO, as requests finish
            </span>
          )}
          {rows.map((p) =>
            p.ttft_p95_ms == null ? null : (
              <span key={p.t} className="absolute inset-y-0 rounded-[1px]"
                style={{ left: `${((p.t - t0) / (t1 - t0)) * 100}%`, width: `${Math.max(((h.step_seconds * 1000) / (t1 - t0)) * 100, 0.3)}%`,
                  backgroundColor: sloColor(p.ttft_p95_ms, slo.ttftMs), opacity: 0.75 }}
                aria-label={`${formatClock(p.t)} TTFT p95 ${Math.round(p.ttft_p95_ms)} ms`} />
            ),
          )}
        </div>
      </div>
    </div>
  )
}
