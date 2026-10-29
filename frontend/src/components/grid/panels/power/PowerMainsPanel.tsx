import { useMemo } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { DEFAULT_MAINS, formatClock, voltsColor } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerHistory, PowerNow } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { PowerNotice, PowerStat } from './PowerParts'

const CONFIG = {
  volts: { label: 'Mains in (min–max)', color: '#38bdf8' },
  out: { label: 'UPS out, to the PSUs', color: NVIDIA_THEME.accent },
}

/**
 * The supply the UPS sees, and what it passes on: input voltage over the last
 * 24 hours as each step's min–max band, the UPS's output (what the power
 * supplies get) as a green line over it, against the nominal 230 V and the
 * statutory limits, with the frequency beside it. A UPS that keeps switching to battery usually shows why
 * here first.
 */
export function PowerMainsPanel() {
  const history = usePowerDocument<PowerHistory>('history?hours=24', POWER_POLL_MS.history)
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  const limits = now.data?.mains ?? DEFAULT_MAINS
  const rows = useMemo(
    () =>
      (history.data?.points ?? [])
        .filter((p) => p.input_volts_min !== null && p.input_volts_max !== null)
        .map((p) => ({ t: p.t, volts: [p.input_volts_min, p.input_volts_max] as [number, number], out: p.output_volts ?? null })),
    [history.data],
  )
  if (!history.data) return <PowerNotice state={history} />
  if (rows.length === 0) return <PanelNotice>Mains voltage not reported</PanelNotice>

  const h = history.data
  const outs = rows.map((r) => r.out).filter((v): v is number => v !== null)
  const hasOut = outs.length > 0
  const lo = Math.min(h.input_volts_min ?? limits.nominal_volts, limits.nominal_volts, ...outs)
  const hi = Math.max(h.input_volts_max ?? limits.nominal_volts, limits.nominal_volts, ...outs)
  const domain: [number, number] = [Math.floor(lo - 4), Math.ceil(hi + 4)]
  const ups = now.data?.ups ?? null
  const range = (a: number | null, b: number | null, digits: number) =>
    a !== null && b !== null ? `${a.toFixed(digits)}–${b.toFixed(digits)}` : '—'

  return (
    <div className="h-full min-h-0 flex flex-col gap-1">
      {/* Two figures with their 24 h range underneath: four side by side cut off below ~1600 px. */}
      <div className="shrink-0 grid grid-cols-2 gap-2 min-w-0">
        <PowerStat
          label="Voltage"
          value={ups?.input_volts != null ? ups.input_volts.toFixed(1) : '—'}
          unit="V"
          color={voltsColor(ups?.input_volts ?? null, limits)}
          sub={
            <span
              style={{
                color:
                  (h.input_volts_min ?? limits.nominal_volts) < limits.min_volts ||
                  (h.input_volts_max ?? limits.nominal_volts) > limits.max_volts
                    ? NVIDIA_THEME.critical
                    : undefined,
              }}
            >
              24 h {range(h.input_volts_min, h.input_volts_max, 1)} V
            </span>
          }
        />
        <PowerStat
          label="Frequency"
          value={ups?.input_hz != null ? ups.input_hz.toFixed(1) : '—'}
          unit="Hz"
          sub={`24 h ${range(h.input_hz_min, h.input_hz_max, 2)} Hz`}
        />
      </div>
      <div className="shrink-0 flex items-center gap-3 text-[10px] 2xl:text-xs font-mono text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-[2px] rounded-full" style={{ backgroundColor: CONFIG.volts.color }} />
          mains in
        </span>
        {hasOut && (
          <span className="flex items-center gap-1.5" title="The UPS's output voltage: what the power supplies get. A line-interactive UPS passes mains through, so it sits on the input until it boosts, trims or runs on battery.">
            <span className="inline-block w-2.5 h-[2px] rounded-full" style={{ backgroundColor: CONFIG.out.color }} />
            UPS out → PSUs
          </span>
        )}
      </div>
      <ChartContainer config={CONFIG} className="w-full flex-1 min-h-0 aspect-auto">
        <ComposedChart data={rows}>
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
          <YAxis width={36} domain={domain} stroke={NVIDIA_THEME.chartAxis} fontSize={11} tickLine={false} axisLine={false} allowDataOverflow />
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => formatClock(Number(p?.[0]?.payload?.t ?? 0))} />} />
          <ReferenceLine y={limits.nominal_volts} stroke="#52525b" strokeDasharray="4 4" />
          {limits.min_volts >= domain[0] && <ReferenceLine y={limits.min_volts} stroke={NVIDIA_THEME.critical} strokeOpacity={0.5} />}
          {limits.max_volts <= domain[1] && <ReferenceLine y={limits.max_volts} stroke={NVIDIA_THEME.critical} strokeOpacity={0.5} />}
          <Area dataKey="volts" type="monotone" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.25} strokeWidth={1} isAnimationActive={false} />
          {hasOut && (
            <Line dataKey="out" type="monotone" stroke={NVIDIA_THEME.accent} strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls={false} />
          )}
        </ComposedChart>
      </ChartContainer>
    </div>
  )
}
