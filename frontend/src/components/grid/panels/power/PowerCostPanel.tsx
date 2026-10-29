import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatMoney, formatUnitPrice, formatWattsValue } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerNow } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { FactLine, Headline, PowerNotice, StaleBadge } from './PowerParts'

const IDLE_COLOR = '#71717a'

/** A two-part bar with its legend: what the money buys, being on against work. */
function SplitBar({ idle, work, currency }: { idle: number; work: number; currency: string }) {
  const total = idle + work
  if (total <= 0) return null
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex h-2 w-full rounded-full overflow-hidden bg-zinc-700/40" aria-label="Being on and work">
        <div className="h-full" style={{ width: `${(idle / total) * 100}%`, backgroundColor: IDLE_COLOR }} />
        <div className="h-full" style={{ width: `${(work / total) * 100}%`, backgroundColor: NVIDIA_THEME.accent }} />
      </div>
      <div className="flex justify-between gap-2 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0">
        <span className="text-zinc-400 truncate">being on <span className="text-zinc-200">{formatMoney(idle, currency)}</span></span>
        <span className="text-zinc-400 truncate">work <span style={{ color: NVIDIA_THEME.accent }}>{formatMoney(work, currency)}</span></span>
      </div>
    </div>
  )
}

/**
 * What the machine costs to run, and what that money buys. The rate right now
 * says whether it is idling or working; the month (at the last seven days'
 * run rate, not today x 30) and today split at the idle floor into the price of
 * being on and the price of the work; and the hours spent idle get a price of
 * their own, the most a sleep-when-idle policy could save. kWh stay on the
 * Energy panel. The standing charge is paid with or without the machine, so
 * unless the source counts it, it is named, not added.
 */
export function PowerCostPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  if (!now.data) return <PowerNotice state={now} />
  const { energy: e, cost_per_hour: perHour, total_watts: watts } = now.data
  if (!e) return <PanelNotice>No tariff reported</PanelNotice>
  const c = e.currency
  const money = (v: number | null | undefined) => (v != null ? formatMoney(v, c) : '—')

  const floor = e.floor_watts ?? null
  const workNowW = watts !== null && floor !== null ? Math.max(0, watts - floor) : null
  const workNow = perHour !== null && watts && workNowW !== null ? (perHour * workNowW) / watts : null
  const state =
    workNowW === null ? null : workNowW < floor! * 0.1 ? 'idle' : `${money(workNow)} of it work`
  const monthSplit = e.run_rate_idle_per_month != null && e.run_rate_work_per_month != null
  const todaySplit = e.today_idle_cost != null && e.today_work_cost != null

  return (
    <div className="h-full flex flex-col justify-center gap-1.5 min-w-0 overflow-hidden">
      <div className="flex flex-col min-w-0">
        <Headline value={perHour !== null ? money(perHour) : '—'} unit="/ hour" tag={<StaleBadge state={now} />} />
        {state && (
          <span className="text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400 truncate">
            now: <span style={{ color: state === 'idle' ? '#a1a1aa' : NVIDIA_THEME.accent }}>{state}</span>
            {floor !== null && <span className="text-zinc-500"> · floor {formatWattsValue(floor)} W</span>}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-lg 2xl:text-xl font-bold font-mono tabular-nums text-zinc-100">
            {e.run_rate_per_month != null ? `~${money(e.run_rate_per_month)}` : '—'}
          </span>
          <span className="text-[10px] 2xl:text-xs text-zinc-500 truncate">/ month at the last 7 days' rate</span>
        </div>
        {monthSplit && <SplitBar idle={e.run_rate_idle_per_month!} work={e.run_rate_work_per_month!} currency={c} />}
      </div>
      {todaySplit ? (
        <FactLine>
          today <span className="text-zinc-200">{money(e.today_cost)}</span> = idle {money(e.today_idle_cost)} + work{' '}
          <span style={{ color: NVIDIA_THEME.accent }}>{money(e.today_work_cost)}</span>
        </FactLine>
      ) : (
        <FactLine>today <span className="text-zinc-200">{money(e.today_cost)}</span></FactLine>
      )}
      {e.idle_hours_per_day != null && e.idle_time_cost_per_month != null && (
        <p className="text-[10px] 2xl:text-xs text-zinc-300 font-mono tabular-nums break-words line-clamp-2"
          title="Hours a day within 10 % of the idle floor (last 7 days) at the floor's draw: the most sleeping when idle could save">
          idle ~{e.idle_hours_per_day.toFixed(0)} h/day → <span className="text-amber-400/90">{money(e.idle_time_cost_per_month)}/mo</span> pays
          for sitting idle
        </p>
      )}
      <FactLine>
        {formatUnitPrice(e.unit_price, c)}
        {e.tariff_label ? ` · ${e.tariff_label}` : ''}
        {e.standing_charge_per_day !== null &&
          (e.include_standing_charge
            ? ` · incl. ${formatMoney(e.standing_charge_per_day, c)}/day standing`
            : ` · standing ${formatMoney(e.standing_charge_per_day, c)}/day not included`)}
        {e.tariff_error ? ' · tariff not refreshed' : ''}
      </FactLine>
    </div>
  )
}
