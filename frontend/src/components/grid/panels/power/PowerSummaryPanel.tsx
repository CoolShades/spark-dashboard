import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatKwh, formatMoney, formatUnitPrice, formatWattsValue } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerHistory, PowerNow } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { Headline, PowerNotice, StaleBadge } from './PowerParts'

const IDLE_COLOR = '#71717a'

function Split({ idle, work }: { idle: number; work: number }) {
  const total = idle + work
  if (total <= 0) return <span />
  return (
    <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-zinc-700/40 self-center" aria-label="Being on and work">
      <div className="h-full" style={{ width: `${(idle / total) * 100}%`, backgroundColor: IDLE_COLOR }} />
      <div className="h-full" style={{ width: `${(work / total) * 100}%`, backgroundColor: NVIDIA_THEME.accent }} />
    </div>
  )
}

/** The last 24 hours' cost, one bar an hour, split at the idle floor: when the money goes, which watts alone don't say. */
function CostByHour({ history, unit, floor, currency }: { history: PowerHistory; unit: number; floor: number | null; currency: string }) {
  const hours = useMemo(() => {
    const byHour = new Map<number, { t: number; idle: number; work: number }>()
    const kwh = history.step_seconds / 3600 / 1000
    for (const p of history.points) {
      if (p.total_watts === null) continue
      const start = new Date(p.t)
      start.setMinutes(0, 0, 0)
      const key = start.getTime()
      const h = byHour.get(key) ?? { t: key, idle: 0, work: 0 }
      const f = floor ?? p.total_watts
      h.idle += Math.min(p.total_watts, f) * kwh * unit
      h.work += Math.max(0, p.total_watts - f) * kwh * unit
      byHour.set(key, h)
    }
    return [...byHour.values()].sort((x, y) => x.t - y.t).slice(-24).map((h) => ({ ...h, total: h.idle + h.work }))
  }, [history, unit, floor])
  if (hours.length < 2) return null
  const full = hours.slice(0, -1)                      // the current hour is still filling: it would drag the average down
  const avg = full.reduce((s, h) => s + h.total, 0) / Math.max(full.length, 1)
  const peak = Math.max(...hours.map((h) => h.total))
  const lastT = hours[hours.length - 1].t
  const hh = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  const config = {
    idle: { label: 'Being on', color: IDLE_COLOR },
    work: { label: 'Work', color: NVIDIA_THEME.accent },
  }
  return (
    // At most ~40 % of the card: on a tall panel the ledger is the point, the hours are the texture under it.
    <div className="flex flex-col gap-0.5 min-w-0 flex-1 min-h-[3rem] max-h-[40%]">
      <div className="flex items-baseline justify-between text-[9px] 2xl:text-[10px] uppercase tracking-wider text-zinc-500">
        <span>cost by hour · last 24 h</span>
        <span className="normal-case tracking-normal font-mono">avg {formatMoney(avg, currency)}/h · peak {formatMoney(peak, currency)}/h</span>
      </div>
      <ChartContainer config={config} className="w-full flex-1 min-h-0 aspect-auto">
        <BarChart data={hours} barCategoryGap="22%" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="cost-work" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a3e635" stopOpacity={0.95} />
              <stop offset="100%" stopColor={NVIDIA_THEME.accent} stopOpacity={0.55} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={NVIDIA_THEME.chartGrid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            stroke={NVIDIA_THEME.chartAxis}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(t: number) => hh(t)}
            interval="preserveStartEnd"
            minTickGap={36}
          />
          <YAxis hide domain={[0, (max: number) => max * 1.08]} />
          <ChartTooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, p) => {
                  const t = Number(p?.[0]?.payload?.t ?? 0)
                  return `${hh(t)}–${hh(t + 3_600_000)}${t === lastT ? ' (so far)' : ''}`
                }}
                formatter={(value, name, item) => (
                  <div className="flex w-full items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: name === 'work' ? NVIDIA_THEME.accent : IDLE_COLOR }} />
                    <span className="text-muted-foreground">{name === 'work' ? 'Work' : 'Being on'}</span>
                    <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">
                      {formatMoney(Number(value), currency)}
                      {name === 'work' && item?.payload ? ` · ${formatMoney(Number(item.payload.total), currency)} total` : ''}
                    </span>
                  </div>
                )}
              />
            }
          />
          <ReferenceLine y={avg} stroke="#a1a1aa" strokeOpacity={0.5} strokeDasharray="3 3" />
          <Bar dataKey="idle" stackId="c" fill={IDLE_COLOR} fillOpacity={0.45} isAnimationActive={false}>
            {hours.map((h) => <Cell key={h.t} fillOpacity={h.t === lastT ? 0.25 : 0.45} />)}
          </Bar>
          <Bar dataKey="work" stackId="c" fill="url(#cost-work)" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {hours.map((h) => <Cell key={h.t} fillOpacity={h.t === lastT ? 0.5 : 1} />)}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}

/**
 * Energy and money in one ledger: a row per period (today, this month, per
 * day and per 30 days at the last seven days' rate) with its kWh and its cost
 * side by side, the today and 30-day rows split at the idle floor into the
 * price of being on and of the work, what the idle hours alone cost, and the
 * last day's cost hour by hour. Each figure appears once.
 */
export function PowerSummaryPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  const history = usePowerDocument<PowerHistory>('history?hours=24', POWER_POLL_MS.history)
  if (!now.data) return <PowerNotice state={now} />
  const { energy: e, cost_per_hour: perHour, total_watts: watts } = now.data
  if (!e) return <PanelNotice>Energy not reported</PanelNotice>
  const c = e.currency
  const money = (v: number | null | undefined) => (v != null ? formatMoney(v, c) : '—')
  const kwh = (v: number | null | undefined) => (v != null ? formatKwh(v) : '—')

  const floor = e.floor_watts ?? null
  const workW = watts !== null && floor !== null ? Math.max(0, watts - floor) : null
  const workNow = perHour !== null && watts && workW !== null ? (perHour * workW) / watts : null
  const state = workW === null ? null : workW < floor! * 0.1 ? 'idle' : `${money(workNow)} of it work`
  const delta = e.today_kwh != null && e.yesterday_same_time_kwh != null ? e.today_kwh - e.yesterday_same_time_kwh : null
  const perMonthKwh = e.run_rate_kwh_per_day != null ? e.run_rate_kwh_per_day * 30 : null
  // The tariff's name only (up to its first comma: "Octopus Flexible"); the region and the standing charge, which is
  // shown but not counted unless the source says so, go in the tooltip.
  const tariffName = e.tariff_label ? e.tariff_label.split(',')[0] : null
  const tariffTip = [
    e.tariff_label,
    e.standing_charge_per_day !== null
      ? `standing ${formatMoney(e.standing_charge_per_day, c)}/day ${e.include_standing_charge ? 'included' : 'not included'}`
      : null,
    e.tariff_error ? 'tariff not refreshed' : null,
  ].filter(Boolean).join(' · ')

  const label = 'text-[10px] 2xl:text-xs uppercase tracking-wider text-zinc-400'
  const num = 'text-sm 2xl:text-base min-[1920px]:text-lg font-bold font-mono tabular-nums text-zinc-100 text-right'

  return (
    <div className="h-full flex flex-col gap-2 min-w-0 overflow-hidden">
      <div className="flex flex-col min-w-0">
        <Headline value={perHour !== null ? money(perHour) : '—'} unit="/ hour" tag={<StaleBadge state={now} />} />
        {state && (
          <span className="text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400 truncate">
            now: <span style={{ color: state === 'idle' ? '#a1a1aa' : NVIDIA_THEME.accent }}>{state}</span>
            {floor !== null && <span className="text-zinc-500"> · idle floor {formatWattsValue(floor)} W</span>}
            <span className="text-zinc-500" title={tariffTip}> · {formatUnitPrice(e.unit_price, c)}{tariffName ? ` · ${tariffName}` : ''}</span>
          </span>
        )}
      </div>

      <div className="grid items-baseline gap-x-3 gap-y-1.5 min-[1920px]:gap-y-2.5 min-w-0" style={{ gridTemplateColumns: 'auto auto auto 1fr' }}>
        <span />
        <span className="text-[9px] text-zinc-500 text-right">kWh</span>
        <span className="text-[9px] text-zinc-500 text-right">{c === 'GBP' ? '£' : c}</span>
        <span className="flex justify-between text-[9px] text-zinc-500 min-w-0">
          <span>being on</span><span style={{ color: NVIDIA_THEME.accent }}>work</span>
        </span>

        <span className={label}>today</span>
        <span className={num}>{kwh(e.today_kwh)}</span>
        <span className={num}>{money(e.today_cost)}</span>
        {e.today_idle_cost != null && e.today_work_cost != null
          ? <Split idle={e.today_idle_cost} work={e.today_work_cost} /> : <span />}

        <span />
        <span className="col-span-3 -mt-1 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-500 truncate">
          {e.today_idle_cost != null && e.today_work_cost != null && <>idle {money(e.today_idle_cost)} + work <span style={{ color: NVIDIA_THEME.accent }}>{money(e.today_work_cost)}</span></>}
          {delta !== null && (
            <span className={delta > 0 ? 'text-amber-400/80' : 'text-[#76B900]'}> · {delta >= 0 ? '▲' : '▼'} {formatKwh(Math.abs(delta))} kWh vs yesterday by now</span>
          )}
        </span>

        <span className={label}>month</span>
        <span className={num}>{kwh(e.month_kwh)}</span>
        <span className={num}>{money(e.month_cost)}</span>
        <span className="text-[10px] text-zinc-500">so far</span>

        <span className={label}>per day</span>
        <span className={num}>{kwh(e.run_rate_kwh_per_day)}</span>
        <span className={num}>{money(e.run_rate_per_day)}</span>
        <span className="text-[10px] text-zinc-500">last 7 days</span>

        <span className={label}>per 30 d</span>
        <span className={num}>{perMonthKwh !== null ? Math.round(perMonthKwh) : '—'}</span>
        <span className={num}>{e.run_rate_per_month != null ? `~${money(e.run_rate_per_month)}` : '—'}</span>
        {e.run_rate_idle_per_month != null && e.run_rate_work_per_month != null
          ? <Split idle={e.run_rate_idle_per_month} work={e.run_rate_work_per_month} /> : <span />}

        {e.run_rate_idle_per_month != null && e.run_rate_work_per_month != null && (
          <>
            <span />
            <span className="col-span-3 -mt-1 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-500 truncate">
              being on {money(e.run_rate_idle_per_month)} + work <span style={{ color: NVIDIA_THEME.accent }}>{money(e.run_rate_work_per_month)}</span>
            </span>
          </>
        )}
      </div>

      {e.idle_hours_per_day != null && e.idle_time_cost_per_month != null && (
        <p className="text-[10px] 2xl:text-xs text-zinc-300 font-mono tabular-nums break-words line-clamp-2"
          title="Hours a day within 10 % of the idle floor (last 7 days) at the floor's draw: the most sleeping when idle could save">
          idle ~{e.idle_hours_per_day.toFixed(0)} h/day → <span className="text-amber-400/90">{money(e.idle_time_cost_per_month)}/mo</span> pays for sitting idle
        </p>
      )}

      {history.data && <CostByHour history={history.data} unit={e.unit_price} floor={floor} currency={c} />}

    </div>
  )
}
