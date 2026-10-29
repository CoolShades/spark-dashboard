/**
 * Formatting and judgements for the Tokens page's panels. Pure, so the specs
 * can hold them without a DOM.
 */

import { NVIDIA_THEME } from '@/lib/theme'

/** A token count split for a tile: { value: "1.4", unit: "M" }; under a thousand, the count itself. */
export function tokenParts(n: number | null | undefined): { value: string; unit: string } {
  if (n == null || !Number.isFinite(n)) return { value: '—', unit: '' }
  if (n < 1000) return { value: Math.round(n).toString(), unit: '' }
  for (const [div, unit] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (n >= div) {
      const v = n / div
      return { value: v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, ''), unit }
    }
  }
  return { value: String(n), unit: '' }
}

/** A count for a sentence: "1.4M", "512". */
export function formatTokens(n: number | null | undefined): string {
  const p = tokenParts(n)
  return `${p.value}${p.unit}`
}

/** Milliseconds split for a tile: { "420", "ms" } under a second, { "2.31", "s" } above. */
export function msParts(ms: number | null | undefined): { value: string; unit: string } {
  if (ms == null || !Number.isFinite(ms)) return { value: '—', unit: '' }
  if (ms < 1000) return { value: ms < 10 ? ms.toFixed(1) : Math.round(ms).toString(), unit: 'ms' }
  return { value: (ms / 1000).toFixed(ms < 10_000 ? 2 : 1), unit: 's' }
}

/** A latency against its SLO threshold: green within it, amber up to twice it, red beyond; plain without data. */
export function sloColor(ms: number | null | undefined, threshold: number): string {
  if (ms == null) return '#f4f4f5'
  if (ms <= threshold) return NVIDIA_THEME.accent
  if (ms <= threshold * 2) return NVIDIA_THEME.warning
  return NVIDIA_THEME.critical
}

/** A rate for a headline: one decimal under 10, whole above. */
export function formatRate(tps: number | null | undefined): string {
  if (tps == null || !Number.isFinite(tps)) return '—'
  return tps < 10 ? tps.toFixed(1) : Math.round(tps).toLocaleString('en-GB')
}

/** A share as a whole percent, or null when the whole is zero. */
export function share(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part == null || !whole) return null
  return Math.round((part / whole) * 100)
}
