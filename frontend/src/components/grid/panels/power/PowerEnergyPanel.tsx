import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatKwh, formatMoney } from '@/lib/power'
import type { PowerNow } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { Headline, PowerNotice, PowerStat, StaleBadge } from './PowerParts'

/**
 * Energy used today, against yesterday at the same time of day: a like-for-
 * like comparison at any hour, where "yesterday's total" would make every
 * morning look frugal.
 */
export function PowerEnergyPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  if (!now.data) return <PowerNotice state={now} />
  const energy = now.data.energy
  if (!energy || energy.today_kwh === null) return <PanelNotice>Energy not reported</PanelNotice>

  const today = energy.today_kwh
  const yesterday = energy.yesterday_same_time_kwh
  const delta = yesterday !== null ? today - yesterday : null
  const deltaText =
    delta === null ? null : `${delta >= 0 ? '▲' : '▼'} ${formatKwh(Math.abs(delta))} vs yesterday by now`

  return (
    <div className="h-full flex flex-col justify-center gap-2 min-w-0 overflow-hidden">
      <div className="flex flex-col gap-0.5 min-w-0">
        <Headline value={formatKwh(today)} unit="kWh today" tag={<StaleBadge state={now} />} />
        {deltaText && (
          <span
            className={`text-[10px] 2xl:text-xs font-mono tabular-nums truncate ${delta !== null && delta > 0 ? 'text-amber-400/80' : 'text-[#76B900]'}`}
          >
            {deltaText}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 min-w-0">
        <PowerStat
          label="This month"
          value={energy.month_kwh !== null ? formatKwh(energy.month_kwh) : '—'}
          unit="kWh"
          sub={energy.month_cost !== null ? formatMoney(energy.month_cost, energy.currency) : undefined}
        />
        <PowerStat
          label="Per day"
          value={energy.run_rate_kwh_per_day !== null ? formatKwh(energy.run_rate_kwh_per_day) : '—'}
          unit="kWh"
          sub="last 7 days"
        />
      </div>
    </div>
  )
}
