import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatKwh, formatMoney, formatUnitPrice, formatWattsValue } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerNow } from '@/types/power'
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

/**
 * Energy and money in one ledger: a row per period (today, this month, per
 * day and per 30 days at the last seven days' rate) with its kWh and its cost
 * side by side, the today and 30-day rows split at the idle floor into the
 * price of being on and of the work, and what the idle hours alone cost. Each
 * figure appears once; when in the day the money goes is the 7-day heatmap's.
 */
export function PowerSummaryPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
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
    <div className="h-full flex flex-col justify-between gap-2 min-w-0 overflow-hidden">
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


    </div>
  )
}
