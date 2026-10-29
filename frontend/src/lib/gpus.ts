/**
 * Judgements and formatting for the GPUs page's panels. Pure, so the specs can
 * hold them without a DOM.
 */

import { NVIDIA_THEME } from '@/lib/theme'

/** One colour per GPU wherever the page draws them side by side (the thermals chart, the heatmap's labels). */
export const GPU_LINE_COLORS = ['#76B900', '#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#2dd4bf'] as const

/** A load this low is the card idling: NVML's "power cap" flag on an idle card means nothing, so it is not shown. */
export const BUSY_PERCENT = 10

/** The held-clocks reasons the page names, most serious first, with how each is drawn. */
const HELD: Array<{ reason: string; tone: 'critical' | 'warning' | 'info' }> = [
  { reason: 'HW slowdown', tone: 'critical' },
  { reason: 'HW thermal', tone: 'critical' },
  { reason: 'power brake', tone: 'critical' },
  { reason: 'thermal', tone: 'warning' },
  { reason: 'power cap', tone: 'info' },
]

/**
 * What is holding the clocks back, for the card's tag: the most serious reason
 * NVML gives while the card is working, or "idle". An idle card reporting a
 * power cap is just idle.
 */
export function heldBy(reasons: readonly string[], utilPercent: number | null): { label: string; color: string } | null {
  if ((utilPercent ?? 0) < BUSY_PERCENT) return { label: 'idle', color: '#a1a1aa' }
  const top = HELD.find((h) => reasons.includes(h.reason))
  if (!top) return null
  const color = top.tone === 'critical' ? NVIDIA_THEME.critical : top.tone === 'warning' ? NVIDIA_THEME.warning : '#e4e4e7'
  return { label: top.reason, color }
}

/** A byte rate split for a tile: { value: "488.0", unit: "KB/s" } (decimal units, like the disk and network panels). */
export function rateParts(bytesPerSec: number | null): { value: string; unit: string } {
  if (bytesPerSec === null) return { value: '—', unit: '' }
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let v = bytesPerSec
  let u = 0
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000
    u += 1
  }
  return { value: v >= 100 || u === 0 ? Math.round(v).toString() : v.toFixed(1), unit: units[u] }
}

/** A counter for a sentence: "36", "3.5k", "10.4k", "1.2M". */
export function formatCount(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1000) return Math.round(n).toLocaleString('en-GB')
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** A load's colour on the 24 h heatmap: the quiet base under 2 %, then up to full accent, square-rooted. */
export function utilHeat(percent: number): string {
  const t = Math.max(0, Math.min(1, percent / 100))
  if (t < 0.02) return '#2a2d24'
  const mix = (a: string, b: string, k: number) => {
    const p = (c: string, i: number) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16)
    const ch = (i: number) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * k).toString(16).padStart(2, '0')
    return `#${ch(0)}${ch(1)}${ch(2)}`
  }
  return mix('#3b4d12', NVIDIA_THEME.accent, Math.sqrt(t))
}

/** The card's headline colour: accent while it works, dim when barely, grey when idle. */
export function utilColor(percent: number | null): string {
  if (percent === null) return '#a1a1aa'
  if (percent >= 50) return NVIDIA_THEME.accent
  if (percent >= BUSY_PERCENT) return '#a3d64f'
  return '#d4d4d8'
}

/** "RTX 3090" from "NVIDIA GeForce RTX 3090". */
export function shortGpuName(name: string | null): string | null {
  return name ? name.replace(/^NVIDIA\s+(GeForce\s+)?/i, '') : null
}
