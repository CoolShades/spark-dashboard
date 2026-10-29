import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatMoney, formatUnitPrice } from '@/lib/power'
import type { PowerNow } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { FactLine, Headline, PowerNotice, PowerStat, StaleBadge } from './PowerParts'

/**
 * What the machine costs to run, at the source's tariff. The headline is the
 * rate right now; the month figure is the recent run rate (the last seven
 * days), not today times thirty. The standing charge is paid with or without
 * the server, so unless the source counts it, it is named, not added.
 */
export function PowerCostPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  if (!now.data) return <PowerNotice state={now} />
  const { energy, cost_per_hour: perHour } = now.data
  if (!energy) return <PanelNotice>No tariff reported</PanelNotice>
  const c = energy.currency
  const money = (v: number | null) => (v !== null ? formatMoney(v, c) : '—')

  return (
    <div className="h-full flex flex-col justify-center gap-2 min-w-0 overflow-hidden">
      <Headline value={perHour !== null ? money(perHour) : '—'} unit="/ hour" tag={<StaleBadge state={now} />} />
      <div className="grid grid-cols-2 gap-2 min-w-0">
        <PowerStat label="Today" value={money(energy.today_cost)} />
        <PowerStat
          label="Per month"
          value={energy.run_rate_per_month !== null ? `~${money(energy.run_rate_per_month)}` : '—'}
          sub={energy.run_rate_per_day !== null ? `${money(energy.run_rate_per_day)}/day (7 d)` : undefined}
        />
      </div>
      <FactLine>
        {formatUnitPrice(energy.unit_price, c)}
        {energy.tariff_label ? ` · ${energy.tariff_label}` : ''}
        {energy.standing_charge_per_day !== null &&
          (energy.include_standing_charge
            ? ` · incl. ${formatMoney(energy.standing_charge_per_day, c)}/day standing`
            : ` · standing ${formatMoney(energy.standing_charge_per_day, c)}/day not included`)}
      </FactLine>
    </div>
  )
}
