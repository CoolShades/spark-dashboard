import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import {
  batteryColor,
  formatClock,
  formatRuntime,
  formatRuntimeShort,
  formatWattsValue,
  LOAD_THRESHOLDS,
  onBattery,
  runtimeColor,
  UPS_STATUS_LABEL,
  upsStatusColor,
} from '@/lib/power'
import { NVIDIA_THEME, thresholdColor } from '@/lib/theme'

/** A UPS reading older than this is the monitoring link down, not a live state. */
const STALE_S = 90

function formatAge(s: number): string {
  return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`
}
import type { PowerNow, PowerUps } from '@/types/power'
import { usePanelDevice } from '../../panelDevice'
import { PanelNotice } from '../PanelNotice'
import { FactLine, Headline, PowerNotice, PowerStat, Sparkline, StaleBadge, StripFooter } from './PowerParts'

/**
 * The second row of figures, each shown only when the source reports it: what
 * the UPS hands out (amps, and VA against its VA rating), the battery string's
 * voltage with the last self-test, and when the host is shut down on battery.
 */
function SecondRow({ ups, dim }: { ups: PowerUps; dim: boolean }) {
  const pct = ups.shutdown_battery_percent ?? null
  const left = ups.shutdown_runtime_seconds ?? null
  const failed = ups.self_test?.startsWith('failed') ?? false
  const stats = [
    ups.output_amps != null && (
      <PowerStat key="out" label="Output" value={ups.output_amps.toFixed(2)} unit="A"
        sub={ups.output_va != null ? `≈${formatWattsValue(ups.output_va)} VA${ups.capacity_va ? ` of ${formatWattsValue(ups.capacity_va)}` : ''}` : undefined} />
    ),
    ups.battery_volts != null && (
      <PowerStat key="batt" label="Battery V" value={ups.battery_volts.toFixed(1)} unit="V"
        sub={ups.self_test ? <span className={failed ? 'text-red-400' : undefined}>self-test {ups.self_test}</span> : undefined} />
    ),
    (pct !== null || left !== null) && (
      <PowerStat key="off" label="Shuts down at" value={pct !== null ? Math.round(pct) : formatRuntimeShort(left!)}
        unit={pct !== null ? '%' : undefined} sub={pct !== null && left !== null ? `or ${formatRuntime(left)} left` : undefined} />
    ),
  ].filter(Boolean)
  if (stats.length === 0) return null
  return <div className={`grid grid-cols-3 gap-2 min-w-0 ${dim ? 'opacity-40' : ''}`}>{stats}</div>
}

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

  // The UPS reports load in whole percent and runtime in whole minutes, every 5 s: at a steady draw they sit still.
  // The reading's age and the mains voltage (0.1 V steps) are what show it is live.
  const age = ups.updated && now.fetchedAt !== null ? Math.max(0, Math.round((now.fetchedAt - Date.parse(ups.updated)) / 1000)) : null
  // A reading this old is the monitoring link failing (apcupsd hung under load on 2026-10-29), not the UPS: the card
  // says so instead of repeating the last state as if it were live, and dims the last figures.
  const stale = age !== null && age > STALE_S
  const color = stale ? NVIDIA_THEME.warning : upsStatusColor(ups.status)
  const runtime = ups.runtime_seconds
  const battery = !stale && onBattery(ups.status)
  const load = ups.load_percent
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
      className="h-full flex flex-col gap-1 min-w-0 overflow-hidden rounded"
      style={battery ? { boxShadow: `inset 0 0 0 1px ${color}55`, background: `${color}0d` } : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
        {battery && runtime !== null ? (
          <Headline value={formatRuntime(runtime)} unit="left" color={runtimeColor(runtime)} tag={<StaleBadge state={now} />} />
        ) : stale ? (
          <Headline value="Not answering" color={color} tag={<StaleBadge state={now} />} />
        ) : (
          <Headline value={UPS_STATUS_LABEL[ups.status]} color={color} tag={<StaleBadge state={now} />} />
        )}
      </div>
      {stale && (
        <FactLine>
          <span className="text-amber-400/90">no reading for {formatAge(age!)}</span> · last, at{' '}
          {formatClock(Date.parse(ups.updated!))}: {UPS_STATUS_LABEL[ups.status]}
        </FactLine>
      )}
      <div className={`grid grid-cols-3 gap-2 min-w-0 ${stale ? 'opacity-40' : ''}`}>
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
          color={load !== null ? thresholdColor(load, LOAD_THRESHOLDS.warning, LOAD_THRESHOLDS.critical) : undefined}
          unit={ups.capacity_watts ? `% of ${Math.round(ups.capacity_watts).toLocaleString('en-GB')} W` : '%'}
        />
      </div>
      <SecondRow ups={ups} dim={stale} />
      {facts.length > 0 && (
        <FactLine>
          {facts.join(' · ')}
          {age !== null && !stale && <span className={age > 30 ? 'text-amber-400' : 'text-zinc-600'}> · read {age} s ago</span>}
        </FactLine>
      )}
      <StripFooter caption={transfer ?? 'no transfer recorded'} title={transfer ?? undefined}>
        <Sparkline points={volts} color="#38bdf8" label="Mains voltage, last few minutes" />
      </StripFooter>
    </div>
  )
}
