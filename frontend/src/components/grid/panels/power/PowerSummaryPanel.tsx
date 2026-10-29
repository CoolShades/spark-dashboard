import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { cumulativeCost, formatKwh, formatMoney, formatUnitPrice, formatWattsValue } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerDaily, PowerNow } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { FactLine, Headline, PowerNotice, PowerStat, StaleBadge, StripFooter } from './PowerParts'

const IDLE_COLOR = '#71717a'
const YESTERDAY_COLOR = '#a1a1aa'

/** The value of a cumulative series at `hour`, by straight lines between its points. */
function at(points: Array<[number, number]>, hour: number): number | null {
  if (points.length < 2) return null
  for (let i = 1; i < points.length; i++) {
    const [h0, v0] = points[i - 1]
    const [h1, v1] = points[i]
    if (hour <= h1) return v0 + ((v1 - v0) * (hour - h0)) / Math.max(h1 - h0, 1e-9)
  }
  return points[points.length - 1][1]
}

/**
 * The card's strip, in the same place as the wall and UPS cards' strips: today's
 * spend through the day so far against yesterday's whole day, both from the
 * 7-day document's hourly draw at the current unit price.
 */
function TodayVsYesterday({ daily, price, currency, now }: { daily: PowerDaily | null; price: number; currency: string; now: number }) {
  const days = daily?.days ?? []
  const clock = new Date(now)
  const hourNow = clock.getHours() + clock.getMinutes() / 60
  const today = cumulativeCost(days[days.length - 1], price, hourNow)
  const yesterday = cumulativeCost(days[days.length - 2], price)
  if (today.length < 2 && yesterday.length < 2) return null
  const top = Math.max(...today.map((p) => p[1]), ...yesterday.map((p) => p[1]), 0.01)
  const W = 300
  const H = 40
  const path = (pts: Array<[number, number]>) =>
    pts.map(([h, v], i) => `${i ? 'L' : 'M'}${((h / 24) * W).toFixed(1)},${(H - 1 - (v / top) * (H - 3)).toFixed(1)}`).join(' ')
  const end = today[today.length - 1]
  const byNow = at(yesterday, hourNow)
  const allDay = yesterday.length ? yesterday[yesterday.length - 1][1] : null
  return (
    <StripFooter
      title="What each day had cost by each hour, from its hourly draw at the current unit price"
      caption={
        <>
          <span style={{ color: NVIDIA_THEME.accent }}>today</span> vs <span style={{ color: YESTERDAY_COLOR }}>yesterday</span>
          {byNow !== null && allDay !== null && <> · {formatMoney(byNow, currency)} by now, {formatMoney(allDay, currency)} all day</>}
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-6" aria-label="Today vs yesterday, cost through the day">
        {yesterday.length > 1 && (
          <path d={path(yesterday)} fill="none" stroke={YESTERDAY_COLOR} strokeOpacity={0.6} strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        )}
        {today.length > 1 && (
          <path d={path(today)} fill="none" stroke={NVIDIA_THEME.accent} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        )}
        {today.length > 1 && <circle cx={(end[0] / 24) * W} cy={H - 1 - (end[1] / top) * (H - 3)} r={2} fill={NVIDIA_THEME.accent} />}
      </svg>
    </StripFooter>
  )
}

/**
 * Energy and money, laid out like the wall card beside it: the running cost now
 * as the headline, the 30-day cost split at the idle floor into the price of
 * being on and of the work (as a bar, like the wall's split), the tariff, then
 * two rows of three (today, this month, per 30 days at the last seven days'
 * rate; against yesterday by now, per day, and what the idle hours alone cost),
 * and a strip of today's spend against yesterday's. When in the day the money
 * goes, hour by hour, is the 7-day heatmap's.
 */
export function PowerSummaryPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  const daily = usePowerDocument<PowerDaily>('daily?days=7', POWER_POLL_MS.daily)
  if (!now.data) return <PowerNotice state={now} />
  const { energy: e, cost_per_hour: perHour, total_watts: watts } = now.data
  if (!e) return <PanelNotice>Energy not reported</PanelNotice>
  const c = e.currency
  const money = (v: number | null | undefined) => (v != null ? formatMoney(v, c) : '—')

  const floor = e.floor_watts ?? null
  const workW = watts !== null && floor !== null ? Math.max(0, watts - floor) : null
  const workNow = perHour !== null && watts && workW !== null ? (perHour * workW) / watts : null
  const idleNow = workW !== null && workW < floor! * 0.1
  const delta = e.today_kwh != null && e.yesterday_same_time_kwh != null ? e.today_kwh - e.yesterday_same_time_kwh : null
  const perMonthKwh = e.run_rate_kwh_per_day != null ? e.run_rate_kwh_per_day * 30 : null
  const idle30 = e.run_rate_idle_per_month ?? null
  const work30 = e.run_rate_work_per_month ?? null
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
  const facts = [
    formatUnitPrice(e.unit_price, c) + (tariffName ? ` · ${tariffName}` : ''),
    floor !== null ? `idle floor ${formatWattsValue(floor)} W` : null,
  ].filter(Boolean)

  return (
    <div className="h-full flex flex-col gap-1.5 min-w-0 overflow-hidden">
      <Headline
        value={perHour !== null ? money(perHour) : '—'}
        unit="/ hour"
        tag={
          <>
            {workW !== null && (
              <span className="text-[9px] uppercase tracking-wider border rounded px-1"
                style={idleNow ? { color: '#a1a1aa', borderColor: '#3f3f46' } : { color: NVIDIA_THEME.accent, borderColor: `${NVIDIA_THEME.accent}66` }}
                title={idleNow ? 'Within 10 % of the idle floor' : 'The part of the running cost above the idle floor'}>
                {idleNow ? 'idle' : `${money(workNow)} work`}
              </span>
            )}
            <StaleBadge state={now} />
          </>
        }
      />
      {idle30 !== null && work30 !== null && idle30 + work30 > 0 && (
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex h-2 w-full rounded-full overflow-hidden bg-zinc-700/40" aria-label="Per 30 days: being on and work">
            <div className="h-full" style={{ width: `${(idle30 / (idle30 + work30)) * 100}%`, backgroundColor: IDLE_COLOR }} />
            <div className="h-full" style={{ width: `${(work30 / (idle30 + work30)) * 100}%`, backgroundColor: NVIDIA_THEME.accent }} />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0">
            <span className="text-zinc-500">per 30 d</span>
            {[{ name: 'being on', v: idle30, color: IDLE_COLOR }, { name: 'work', v: work30, color: NVIDIA_THEME.accent }].map((s) => (
              <span key={s.name} className="flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-zinc-400">{s.name}</span>
                <span className="text-zinc-200">{money(s.v)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div title={tariffTip} className="min-w-0"><FactLine>{facts.join(' · ')}</FactLine></div>

      <div className="mt-1.5 grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Today" value={money(e.today_cost)}
          sub={e.today_kwh != null ? `${formatKwh(e.today_kwh)} kWh${e.today_work_cost != null ? ` · work ${money(e.today_work_cost)}` : ''}` : undefined} />
        <PowerStat label="Month" value={money(e.month_cost)} sub={e.month_kwh != null ? `${formatKwh(e.month_kwh)} kWh so far` : undefined} />
        <PowerStat label="Per 30 d" value={e.run_rate_per_month != null ? `~${money(e.run_rate_per_month)}` : '—'}
          sub={perMonthKwh !== null ? `${Math.round(perMonthKwh)} kWh at 7-d rate` : undefined} />
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        {delta !== null ? (
          <PowerStat label="Vs yesterday" value={`${delta >= 0 ? '▲' : '▼'} ${formatKwh(Math.abs(delta))}`} unit="kWh"
            color={delta > 0 ? NVIDIA_THEME.warning : NVIDIA_THEME.accent}
            sub={`${delta >= 0 ? '+' : '−'}${money(Math.abs(delta) * e.unit_price)} by now`} />
        ) : <span />}
        <PowerStat label="Per day" value={money(e.run_rate_per_day)}
          sub={e.run_rate_kwh_per_day != null ? `${formatKwh(e.run_rate_kwh_per_day)} kWh · last 7 d` : undefined} />
        {e.idle_time_cost_per_month != null ? (
          <div title="Hours a day within 10 % of the idle floor (last 7 days) at the floor's draw: the most sleeping when idle could save" className="min-w-0">
            <PowerStat label="Sitting idle" value={money(e.idle_time_cost_per_month)} unit="/mo" color={NVIDIA_THEME.warning}
              sub={e.idle_hours_per_day != null ? `~${e.idle_hours_per_day.toFixed(0)} h a day` : undefined} />
          </div>
        ) : <span />}
      </div>

      <TodayVsYesterday daily={daily.data} price={e.unit_price} currency={c} now={now.fetchedAt ?? Date.parse(now.data.at)} />
    </div>
  )
}
