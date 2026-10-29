import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import {
  batteryColor,
  formatRuntime,
  formatRuntimeShort,
  LOAD_THRESHOLDS,
  onBattery,
  runtimeColor,
  UPS_STATUS_LABEL,
  upsStatusColor,
} from '@/lib/power'
import { thresholdColor } from '@/lib/theme'
import type { PowerNow } from '@/types/power'
import { usePanelDevice } from '../../panelDevice'
import { PanelNotice } from '../PanelNotice'
import { FactLine, Headline, PowerNotice, PowerStat, Sparkline, StaleBadge, StripFooter } from './PowerParts'

/**
 * The UPS at a glance. On mains the headline is its state; on battery it is
 * the runtime left, counting down, because that is the only number that
 * matters then (PeaNUT and Grafana's NUT board both do this).
 */
export function PowerUpsPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  usePanelDevice(now.data?.ups?.name ?? null)
  if (!now.data) return <PowerNotice state={now} />
  const ups = now.data.ups
  if (!ups) return <PanelNotice>No UPS reported</PanelNotice>

  const color = upsStatusColor(ups.status)
  const runtime = ups.runtime_seconds
  const battery = onBattery(ups.status)
  const load = ups.load_percent
  // The UPS reports load in whole percent and runtime in whole minutes, every 5 s: at a steady draw they sit still.
  // The reading's age and the mains voltage (0.1 V steps) are what show it is live.
  const age = ups.updated && now.fetchedAt !== null ? Math.max(0, Math.round((now.fetchedAt - Date.parse(ups.updated)) / 1000)) : null
  const volts = (now.recent as ReadonlyArray<{ at: number; data: PowerNow }>)
    .map((r) => ({ at: r.at, v: r.data.ups?.input_volts ?? null }))
    .filter((p): p is { at: number; v: number } => p.v !== null)
  const facts = [
    ups.input_volts !== null ? `in ${ups.input_volts.toFixed(1)} V` : null,
    ups.input_hz !== null ? `${ups.input_hz.toFixed(1)} Hz` : null,
    ups.temperature_c !== null ? `${ups.temperature_c.toFixed(1)} °C` : null,
  ].filter(Boolean)
  const transfer =
    ups.last_transfer &&
    `last transfer: ${ups.last_transfer}${ups.transfers != null ? ` (${ups.transfers} since start)` : ''}`

  return (
    <div
      className="h-full flex flex-col gap-2 min-w-0 overflow-hidden rounded"
      style={battery ? { boxShadow: `inset 0 0 0 1px ${color}55`, background: `${color}0d` } : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
        {battery && runtime !== null ? (
          <Headline value={formatRuntime(runtime)} unit="left" color={runtimeColor(runtime)} tag={<StaleBadge state={now} />} />
        ) : (
          <Headline value={UPS_STATUS_LABEL[ups.status]} color={color} tag={<StaleBadge state={now} />} />
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <PowerStat
          label="Battery"
          value={ups.battery_percent !== null ? Math.round(ups.battery_percent) : '—'}
          unit="%"
          color={batteryColor(ups.battery_percent)}
        />
        <PowerStat
          label={battery ? 'Status' : 'Runtime'}
          value={battery ? UPS_STATUS_LABEL[ups.status] : runtime !== null ? formatRuntimeShort(runtime) : '—'}
          color={battery ? color : runtimeColor(runtime)}
        />
        <PowerStat
          label="Load"
          value={load !== null ? Math.round(load) : '—'}
          unit="%"
          color={load !== null ? thresholdColor(load, LOAD_THRESHOLDS.warning, LOAD_THRESHOLDS.critical) : undefined}
          sub={ups.capacity_watts ? `of ${Math.round(ups.capacity_watts).toLocaleString('en-GB')} W` : undefined}
        />
      </div>
      {facts.length > 0 && (
        <FactLine>
          {facts.join(' · ')}
          {age !== null && <span className={age > 30 ? 'text-amber-400' : 'text-zinc-600'}> · read {age} s ago</span>}
        </FactLine>
      )}
      <StripFooter caption={transfer ?? 'no transfer recorded'} title={transfer ?? undefined}>
        <Sparkline points={volts} color="#38bdf8" label="Mains voltage, last few minutes" />
      </StripFooter>
    </div>
  )
}
