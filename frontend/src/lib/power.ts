/**
 * Formatting and judgements for the Power panels. Pure, so the specs can hold
 * them without a DOM.
 *
 * The colour rules follow the UPS dashboards people already read (Grafana's
 * NUT and APC boards, PeaNUT): green only for a UPS on mains, amber for
 * anything running on or towards the battery, red for what needs a person.
 */

import { NVIDIA_THEME } from '@/lib/theme'
import type { MainsLimits, UpsStatus } from '@/types/power'

/** Whole watts with thousands separators: "1,404". */
export function formatWattsValue(watts: number): string {
  return Math.round(watts).toLocaleString('en-GB')
}

/** kWh to one decimal under 100, whole above: "7.6", "182". */
export function formatKwh(kwh: number): string {
  return kwh >= 100 ? Math.round(kwh).toLocaleString('en-GB') : kwh.toFixed(1)
}

/**
 * Money in the source's currency. Sterling under £1 is written in pence,
 * the way a bill or the Octopus app shows a running cost ("37p").
 */
export function formatMoney(amount: number, currency: string): string {
  if (currency === 'GBP' && Math.abs(amount) < 1) return `${Math.round(amount * 100)}p`
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: Math.abs(amount) >= 100 ? 0 : 2,
      minimumFractionDigits: Math.abs(amount) >= 100 ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

/** A unit price per kWh: "26.32p/kWh" for sterling, "€0.31/kWh" otherwise. */
export function formatUnitPrice(price: number, currency: string): string {
  if (currency === 'GBP') return `${(price * 100).toFixed(2)}p/kWh`
  return `${formatMoney(price, currency)}/kWh`
}

/** UPS runtime as people say it: "45 s", "18 min", "1 h 12 min". */
export function formatRuntime(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export const UPS_STATUS_LABEL: Record<UpsStatus, string> = {
  online: 'Online',
  on_battery: 'On battery',
  low_battery: 'Low battery',
  charging: 'Charging',
  offline: 'Offline',
  unknown: 'Unknown',
}

export function upsStatusColor(status: UpsStatus): string {
  switch (status) {
    case 'online':
      return NVIDIA_THEME.healthy
    case 'on_battery':
    case 'charging':
      return NVIDIA_THEME.warning
    case 'low_battery':
    case 'offline':
      return NVIDIA_THEME.critical
    default:
      return '#71717a'
  }
}

/** True when the UPS is carrying the load itself: runtime is then the figure that matters. */
export function onBattery(status: UpsStatus): boolean {
  return status === 'on_battery' || status === 'low_battery'
}

/** Runtime: red under 5 min, amber under 10 (Grafana's NUT board). */
export function runtimeColor(seconds: number | null): string {
  if (seconds === null) return '#a1a1aa'
  if (seconds < 300) return NVIDIA_THEME.critical
  if (seconds < 600) return NVIDIA_THEME.warning
  return '#f4f4f5'
}

/** Battery charge: red under 15 %, amber under 30 %. */
export function batteryColor(percent: number | null): string {
  if (percent === null) return '#a1a1aa'
  if (percent < 15) return NVIDIA_THEME.critical
  if (percent < 30) return NVIDIA_THEME.warning
  return '#f4f4f5'
}

/** UPS load and supply share: amber from 75 %, red from 90 %. */
export const LOAD_THRESHOLDS = { warning: 75, critical: 90 } as const

/**
 * Splits the wall figure into the GPUs and everything else. The GPUs report
 * their own board power (after the supply), so "rest" also carries the
 * supplies' losses; and the two are read at different moments, so the rest is
 * floored at zero instead of going negative on a GPU spike.
 */
export function splitWall(
  totalWatts: number | null,
  gpuWatts: number | null,
): { gpus: number; rest: number } | null {
  if (totalWatts === null || gpuWatts === null) return null
  const gpus = Math.min(Math.max(gpuWatts, 0), totalWatts)
  return { gpus, rest: Math.max(totalWatts - gpus, 0) }
}

/** The GPUs' summed board power from a snapshot, or null when none reports it. */
export function sumGpuWatts(gpus: ReadonlyArray<{ power_watts: number | null }> | undefined): number | null {
  const reported = (gpus ?? []).map((g) => g.power_watts).filter((w): w is number => w !== null)
  return reported.length ? reported.reduce((a, b) => a + b, 0) : null
}

/**
 * Mains limits when the source names none: 230 V +10 % / −6 % (the UK
 * statutory range, ESQCR 2002 reg. 27, which also sits inside the EU's ±10 %)
 * and 50 Hz ±1 %.
 */
export const DEFAULT_MAINS: MainsLimits = {
  nominal_volts: 230,
  min_volts: 216.2,
  max_volts: 253,
  nominal_hz: 50,
  min_hz: 49.5,
  max_hz: 50.5,
}

export function voltsColor(volts: number | null, limits: MainsLimits): string {
  if (volts === null) return '#a1a1aa'
  return volts < limits.min_volts || volts > limits.max_volts ? NVIDIA_THEME.critical : '#f4f4f5'
}

/** "Mon 27" for a YYYY-MM-DD local date, without a time-zone shift. */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  return `${day.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${d}`
}

/** HH:MM for a chart tick. */
export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}
