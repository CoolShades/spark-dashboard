import type { ReactNode } from 'react'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import {
  batteryAgeColor,
  batteryColor,
  DEFAULT_MAINS,
  formatBatteryAge,
  formatClock,
  formatDate,
  formatRuntime,
  formatRuntimeShort,
  formatWhen,
  LOAD_THRESHOLDS,
  onBattery,
  runtimeColor,
  UPS_STATUS_LABEL,
  upsStatusColor,
  upsTempColor,
  voltsColor,
} from '@/lib/power'
import { NVIDIA_THEME, thresholdColor } from '@/lib/theme'
import type { MainsLimits, PowerNow, PowerUps } from '@/types/power'
import { usePanelDevice } from '../../panelDevice'
import { PanelNotice } from '../PanelNotice'
import { FactLine, Headline, PowerNotice, PowerStat, Sparkline, StaleBadge, StripFooter } from './PowerParts'

/** A UPS reading older than this is the monitoring link down, not a live state. */
const STALE_S = 90
const DAY_MS = 86_400_000

function formatAge(s: number): string {
  return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`
}

/** What the UPS does to the mains on its way to the load: passes it through, or its AVR boosts or trims it. */
function regulation(ups: PowerUps): string | undefined {
  if (onBattery(ups.status)) return 'from the battery'
  if (ups.avr === 'boost') return 'AVR boosting low mains'
  if (ups.avr === 'trim') return 'AVR trimming high mains'
  if (ups.input_volts === null || ups.output_volts == null) return undefined
  const d = ups.output_volts - ups.input_volts
  return Math.abs(d) <= 1 ? 'mains passed through' : `${d > 0 ? '+' : ''}${d.toFixed(1)} V vs mains`
}

/**
 * The spells on battery, counted as power cuts apart from self-tests: how many
 * in the window (or since monitoring began, if that is shorter, as of `at`),
 * and the last one under the count; the full list on hover.
 */
function powerCuts(ups: PowerUps, at: number): ReactNode {
  const ev = ups.battery_events
  if (!ev) return null
  const cuts = ev.events.filter((e) => !e.self_test)
  const tests = ev.events.filter((e) => e.self_test)
  const short = ev.since !== null && at - Date.parse(ev.since) < (ev.days - 1) * DAY_MS
  const last = cuts[cuts.length - 1]
  const test = tests[tests.length - 1]
  const sub = last ? `last ${formatWhen(last.start)}, ~${formatRuntime(last.seconds)}` : test ? `self-test ${formatWhen(test.start)}` : 'none recorded'
  const title = ev.events.length
    ? ev.events.map((e) => `${formatWhen(e.start)}: ~${formatRuntime(e.seconds)} on battery (${e.reason ?? 'no reason given'})`).join('\n')
    : `No time on battery ${short ? `since ${formatDate(ev.since!)}` : `in ${ev.days} days`}`
  return (
    <div key="cuts" title={title} className="min-w-0">
      <PowerStat label="Power cuts" value={cuts.length} unit={short ? `since ${formatDate(ev.since!).replace(/ \d{4}$/, '')}` : `in ${ev.days} d`} sub={sub} />
    </div>
  )
}

/** A row of three figures; one the source does not report is left out. */
function Row({ stats, dim }: { stats: ReactNode[]; dim: boolean }) {
  const shown = stats.filter(Boolean)
  if (shown.length === 0) return null
  return <div className={`grid grid-cols-3 gap-2 min-w-0 ${dim ? 'opacity-40' : ''}`}>{shown}</div>
}

/**
 * The supply and the battery, two rows under the headline figures: the mains
 * in, what the UPS hands the PSUs and whether its AVR is correcting it, and the
 * power cuts it has ridden through; then its temperature, the battery string's
 * voltage with the last self-test, and the battery's age.
 */
function MoreRows({ ups, limits, dim, at }: { ups: PowerUps; limits: MainsLimits; dim: boolean; at: number }) {
  const failed = ups.self_test?.startsWith('failed') ?? false
  const ageDays = ups.battery_date ? (at - Date.parse(`${ups.battery_date.slice(0, 10)}T00:00:00Z`)) / DAY_MS : null
  const age = ageDays !== null && Number.isFinite(ageDays) ? formatBatteryAge(ageDays) : null
  return (
    <>
      <Row dim={dim} stats={[
        ups.input_volts !== null && (
          <PowerStat key="in" label="Mains in" value={ups.input_volts.toFixed(1)} unit="V" color={voltsColor(ups.input_volts, limits)}
            sub={ups.input_hz !== null ? `${ups.input_hz.toFixed(1)} Hz` : undefined} />
        ),
        ups.output_volts != null && (
          <PowerStat key="out" label="To PSUs" value={ups.output_volts.toFixed(1)} unit="V" color={voltsColor(ups.output_volts, limits)}
            sub={regulation(ups)} />
        ),
        powerCuts(ups, at),
      ]} />
      <Row dim={dim} stats={[
        ups.temperature_c !== null && (
          <PowerStat key="temp" label="Temperature" value={ups.temperature_c.toFixed(1)} unit="°C" color={upsTempColor(ups.temperature_c)}
            sub="inside the UPS" />
        ),
        ups.battery_volts != null && (
          <PowerStat key="bv" label="Battery V" value={ups.battery_volts.toFixed(1)} unit="V"
            sub={ups.self_test ? <span className={failed ? 'text-red-400' : undefined}>self-test {ups.self_test}</span> : undefined} />
        ),
        age !== null && (
          <PowerStat key="age" label="Battery age" value={age.value} unit={age.unit} color={batteryAgeColor(ageDays!)}
            sub={`dated ${formatDate(ups.battery_date!)}`} />
        ),
      ]} />
    </>
  )
}

/**
 * The UPS at a glance. On mains the headline is its state; on battery it is
 * the runtime left, counting down, because that is the only number that
 * matters then (PeaNUT and Grafana's NUT board both do this). Under it three
 * rows of three: the battery, runtime and load; the supply; the battery's
 * health. Then when the host is shut down on battery, the reading's age, and a
 * strip of the mains voltage over the last few minutes.
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
  const pct = ups.shutdown_battery_percent ?? null
  const left = ups.shutdown_runtime_seconds ?? null
  const shutdown = pct !== null && left !== null ? `shuts down at ${Math.round(pct)} % or ${formatRuntime(left)} left`
    : pct !== null ? `shuts down at ${Math.round(pct)} %` : left !== null ? `shuts down with ${formatRuntime(left)} left` : null
  const transfer =
    ups.last_transfer &&
    `last transfer: ${ups.last_transfer}${ups.transfers != null ? ` (${ups.transfers} since start)` : ''}`
  const minutes = volts.length > 1 ? Math.max(1, Math.round((volts[volts.length - 1].at - volts[0].at) / 60_000)) : null

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
      {/* "Now" for the battery's age and the cut window is when this reading was fetched: a render stays pure. */}
      <MoreRows ups={ups} limits={now.data.mains ?? DEFAULT_MAINS} dim={stale} at={now.fetchedAt ?? Date.parse(now.data.at)} />
      {(shutdown || (age !== null && !stale)) && (
        <FactLine>
          {shutdown}
          {age !== null && !stale && <span className={age > 30 ? 'text-amber-400' : 'text-zinc-600'}>{shutdown ? ' · ' : ''}read {age} s ago</span>}
        </FactLine>
      )}
      <StripFooter caption={minutes !== null ? `mains in, last ${minutes} min` : 'mains in'} title={transfer ?? undefined}>
        <Sparkline points={volts} color="#38bdf8" label="Mains voltage, last few minutes" />
      </StripFooter>
    </div>
  )
}
