/**
 * Formatting and judgements for the Host page's panels. Pure, so the specs can
 * hold them without a DOM.
 */

import { NVIDIA_THEME } from '@/lib/theme'

/** Bytes split for a tile, decimal like the disk and network panels: { "67.1", "GB" }. */
export function bytesParts(n: number | null | undefined): { value: string; unit: string } {
  if (n == null || !Number.isFinite(n)) return { value: '—', unit: '' }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let u = 0
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000
    u += 1
  }
  return { value: v >= 100 || u === 0 ? Math.round(v).toString() : v.toFixed(1), unit: units[u] }
}

/** "1.2 MB/s" for a byte rate. */
export function formatRate(bytesPerSec: number | null | undefined): string {
  const p = bytesParts(bytesPerSec)
  return p.unit ? `${p.value} ${p.unit}/s` : p.value
}

/** Uptime as people say it: "2 d 2 h", "5 h 12 min", "8 min". */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d) return `${d} d ${h} h`
  if (h) return `${h} h ${m} min`
  return `${m} min`
}

/** A component temperature: white, then amber and red from the given limits. */
export function tempTone(c: number | null | undefined, warn: number, crit: number): string {
  if (c == null) return '#a1a1aa'
  if (c >= crit) return NVIDIA_THEME.critical
  if (c >= warn) return NVIDIA_THEME.warning
  return '#f4f4f5'
}

/** Limits per part (°C): a Threadripper's Tctl throttles at 95, DDR4 DIMMs are rated to 85, NVMe drives warn
 *  around 70, an X550 10 GbE controller runs hot by design (to ~100); amber well before each. */
export const TEMP_LIMITS = {
  tctl: [80, 90],
  dimm: [70, 80],
  nvme: [65, 75],
  lan: [85, 95],
  slot: [60, 75],
  drive: [55, 65],
} as const

/** The biggest of some readings, or null. */
export function maxOf(values: ReadonlyArray<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => x != null)
  return v.length ? Math.max(...v) : null
}

/** The thermal scale's stops (°C, colour): blue when cool, through cyan, green, yellow and orange, to red. */
export const THERMAL_STOPS: ReadonlyArray<readonly [number, string]> = [
  [25, '#2563eb'],
  [40, '#06b6d4'],
  [50, '#22c55e'],
  [60, '#eab308'],
  [70, '#f97316'],
  [80, '#ef4444'],
]

/** A temperature as a colour on the thermal scale, interpolated between its stops (clamped at the ends). */
export function thermalColor(c: number): string {
  const s = THERMAL_STOPS
  if (c <= s[0][0]) return s[0][1]
  if (c >= s[s.length - 1][0]) return s[s.length - 1][1]
  const i = s.findIndex(([t]) => t >= c)
  const [t0, a] = s[i - 1]
  const [t1, b] = s[i]
  const k = (c - t0) / (t1 - t0)
  const p = (h: string, j: number) => parseInt(h.slice(1 + 2 * j, 3 + 2 * j), 16)
  const ch = (j: number) => Math.round(p(a, j) + (p(b, j) - p(a, j)) * k).toString(16).padStart(2, '0')
  return `#${ch(0)}${ch(1)}${ch(2)}`
}
