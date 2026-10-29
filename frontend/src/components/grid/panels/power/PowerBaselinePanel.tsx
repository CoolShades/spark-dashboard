import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatKwh, formatMoney, formatWattsValue } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerNow } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { FactLine, Headline, PowerNotice, PowerStat, StaleBadge } from './PowerParts'

const IDLE_COLOR = '#71717a'

/**
 * What it costs just to be on, against what the work costs. The idle floor is
 * the machine's draw doing nothing; everything above it today is work. For a
 * box that idles most of the day this is the number that decides whether it
 * should sleep, which the running cost alone hides.
 */
export function PowerBaselinePanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  if (!now.data) return <PowerNotice state={now} />
  const e = now.data.energy
  if (!e || e.floor_watts == null) return <PanelNotice>Idle floor not reported</PanelNotice>

  const idle = e.today_idle_kwh ?? null
  const work = e.today_work_kwh ?? null
  const total = idle !== null && work !== null ? idle + work : null
  const workShare = total ? work! / total : null

  return (
    <div className="h-full flex flex-col justify-center gap-2 min-w-0 overflow-hidden">
      <Headline value={formatWattsValue(e.floor_watts)} unit="W idle floor" tag={<StaleBadge state={now} />} />
      {total !== null && total > 0 && (
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex h-2 w-full rounded-full overflow-hidden bg-zinc-700/40" aria-label="Today: idle and work">
            <div className="h-full" style={{ width: `${(idle! / total) * 100}%`, backgroundColor: IDLE_COLOR }} />
            <div className="h-full" style={{ width: `${(work! / total) * 100}%`, backgroundColor: NVIDIA_THEME.accent }} />
          </div>
          <span className="text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400 truncate">
            today: idle {formatKwh(idle!)} · <span className="text-zinc-200">work {formatKwh(work!)} kWh</span>
            {workShare !== null && ` (${Math.round(workShare * 100)} %)`}
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 min-w-0">
        <PowerStat
          label="Being on"
          value={e.floor_cost_per_month != null ? `~${formatMoney(e.floor_cost_per_month, e.currency)}` : '—'}
          sub="per month, idle alone"
        />
        <PowerStat
          label="Work today"
          value={e.today_work_cost != null ? formatMoney(e.today_work_cost, e.currency) : '—'}
          sub="above the floor"
        />
      </div>
      <FactLine>floor = the quietest tenth of the last 7 days</FactLine>
    </div>
  )
}
