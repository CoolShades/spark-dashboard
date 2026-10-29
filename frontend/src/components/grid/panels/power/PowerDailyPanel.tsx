import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatDay, formatKwh, formatMoney } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerDaily } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { PowerNotice } from './PowerParts'

const REST_COLOR = '#71717a'
const CONFIG = {
  gpus: { label: 'GPUs kWh', color: NVIDIA_THEME.accent },
  rest: { label: 'Rest kWh', color: REST_COLOR },
}

/** A day with fewer readings than this is drawn faded and its cost marked partial. */
const FULL_DAY = 0.95

/**
 * The last seven days' energy, one bar a day split like the 24-hour chart,
 * with what each day cost above it. Today is drawn lighter: it is not over.
 */
export function PowerDailyPanel() {
  const daily = usePowerDocument<PowerDaily>('daily?days=7', POWER_POLL_MS.daily)
  const data = daily.data
  const rows = useMemo(() => {
    const days = data?.days ?? []
    return days.map((d, i) => {
      const gpus = Math.min(Math.max(d.gpu_kwh ?? 0, 0), d.kwh)
      const today = i === days.length - 1
      return {
        day: formatDay(d.date),
        gpus: d.coverage > 0 ? gpus : null,
        rest: d.coverage > 0 ? Math.max(d.kwh - gpus, 0) : null,
        label: d.coverage > 0 ? formatMoney(d.cost, data!.currency) + (!today && d.coverage < FULL_DAY ? '*' : '') : '',
        faded: today || d.coverage < FULL_DAY,
      }
    })
  }, [data])
  if (!data) return <PowerNotice state={daily} />
  if (rows.every((r) => r.gpus === null)) return <PanelNotice>No daily energy yet</PanelNotice>
  const total = data.days.reduce((sum, d) => sum + d.kwh, 0)
  const cost = data.days.reduce((sum, d) => sum + d.cost, 0)
  const partial = data.days.slice(0, -1).some((d) => d.coverage > 0 && d.coverage < FULL_DAY)

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 mb-1 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400">
        <span>
          <span className="text-zinc-100">{formatKwh(total)} kWh</span> · {formatMoney(cost, data.currency)}
        </span>
        {partial && <span className="ml-auto text-zinc-500">* part of the day not recorded</span>}
      </div>
      <ChartContainer config={CONFIG} className="w-full flex-1 min-h-0 aspect-auto">
        <BarChart data={rows} margin={{ top: 14 }}>
          <CartesianGrid stroke={NVIDIA_THEME.chartGrid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" stroke={NVIDIA_THEME.chartAxis} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis width={32} stroke={NVIDIA_THEME.chartAxis} fontSize={11} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="gpus" stackId="kwh" fill={NVIDIA_THEME.accent} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.day} fillOpacity={r.faded ? 0.4 : 0.85} />
            ))}
          </Bar>
          <Bar dataKey="rest" stackId="kwh" fill={REST_COLOR} radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.day} fillOpacity={r.faded ? 0.35 : 0.7} />
            ))}
            <LabelList dataKey="label" position="top" fill="#a1a1aa" fontSize={10} />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}
