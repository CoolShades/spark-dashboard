import type { ReactNode } from 'react'
import type { DataPoint } from '@/lib/metricsHistoryStore'
import { StripFooter } from '../power/PowerParts'

/** A card's strip, like the Power page's: one live line over the panel's window, from 0, and its caption. */
export function SeriesStrip({ points, color, caption, label }: { points: DataPoint[]; color: string; caption: ReactNode; label: string }) {
  if (points.length < 3) return <StripFooter caption={caption}><span className="block h-6" /></StripFooter>
  const t0 = points[0].timestamp
  const t1 = points[points.length - 1].timestamp
  const top = Math.max(...points.map((p) => p.value), 1e-9)
  const W = 300
  const H = 40
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${(((p.timestamp - t0) / Math.max(t1 - t0, 1)) * W).toFixed(1)},${(H - 1 - (p.value / top) * (H - 2)).toFixed(1)}`)
    .join(' ')
  return (
    <StripFooter caption={caption}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-6" aria-label={label}>
        <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </StripFooter>
  )
}
