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
