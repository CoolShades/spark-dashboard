import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PowerDocumentState } from '@/hooks/usePowerDocument'
import { formatClock } from '@/lib/power'
import { PanelNotice } from '../PanelNotice'

/**
 * What a Power panel shows before it has a document: the same quiet notice as
 * every other empty panel. "Not configured" names the flag, because the fix is
 * the operator's and nothing on the page can make it.
 */
export function PowerNotice({ state }: { state: PowerDocumentState<unknown> }) {
  switch (state.status) {
    case 'not-configured':
      return <PanelNotice>No power source configured (--power-url)</PanelNotice>
    case 'unavailable':
      return <PanelNotice>Power source unavailable</PanelNotice>
    default:
      return <PanelNotice>Waiting for power data</PanelNotice>
  }
}

/** A figure that has gone stale: the source stopped answering after it had answered. */
export function StaleBadge({ state }: { state: PowerDocumentState<unknown> }) {
  if (state.status !== 'unavailable' || state.fetchedAt === null) return null
  return (
    <span className="text-[9px] uppercase tracking-wider text-amber-400" title="The power source stopped answering">
      stale since {formatClock(state.fetchedAt)}
    </span>
  )
}

interface PowerStatProps {
  label: string
  value: ReactNode
  unit?: string
  color?: string
  sub?: ReactNode
}

/** A labelled figure in the engine tiles' type scale, with a colour of its own. */
export function PowerStat({ label, value, unit, color, sub }: PowerStatProps) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] 2xl:text-xs min-[1920px]:text-sm font-medium uppercase tracking-wider truncate text-zinc-400">
        {label}
      </span>
      <div className="flex items-baseline min-w-0">
        <span
          className="text-base xl:text-lg 2xl:text-xl min-[1920px]:text-2xl font-bold font-mono tabular-nums leading-none truncate"
          style={{ color: color ?? '#f4f4f5' }}
        >
          {value}
        </span>
        {unit && <span className="text-[10px] 2xl:text-xs ml-1 text-zinc-500">{unit}</span>}
      </div>
      {sub && <span className="text-[9px] 2xl:text-[10px] text-zinc-500 font-mono tabular-nums truncate">{sub}</span>}
    </div>
  )
}

/** The panel's one big number: what someone glancing at the page reads first. */
export function Headline({ value, unit, color, tag }: { value: ReactNode; unit?: string; color?: string; tag?: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span
        className="text-2xl xl:text-3xl 2xl:text-4xl min-[2560px]:text-5xl font-bold font-mono tabular-nums leading-none truncate"
        style={{ color: color ?? '#f4f4f5' }}
      >
        {value}
      </span>
      {unit && <span className="text-xs 2xl:text-sm text-zinc-500">{unit}</span>}
      {tag}
    </div>
  )
}

/**
 * A card's footer: a live strip and one caption line, pinned to the bottom so
 * the strips of neighbouring cards in a row line up.
 */
export function StripFooter({ children, caption, title }: { children: ReactNode; caption: ReactNode; title?: string }) {
  return (
    <div className="mt-auto shrink-0 flex flex-col gap-0.5 min-w-0">
      {children}
      <p className="text-[10px] 2xl:text-xs text-zinc-500 font-mono tabular-nums truncate" title={title}>{caption}</p>
    </div>
  )
}

/**
 * A small muted line of facts under a headline. It wraps to a second line
 * rather than cutting off: a tariff name or a UPS's transfer reason is only
 * useful whole, and a narrower window should cost height, not words.
 */
export function FactLine({ children }: { children: ReactNode }) {
  // shrink-0: in a short card a clamped line would otherwise be squeezed and cut through the middle of its text.
  return <p className="shrink-0 text-[10px] 2xl:text-xs text-zinc-500 font-mono tabular-nums break-words line-clamp-2">{children}</p>
}

/**
 * A tiny live line from the poller's recent readings, for a panel whose figure
 * moves too little to see: the strip shows it is being read, and how it moves.
 */
export function Sparkline({ points, color, label }: { points: ReadonlyArray<{ at: number; v: number }>; color: string; label: string }) {
  if (points.length < 3) return null
  const t0 = points[0].at
  const t1 = points[points.length - 1].at
  const vs = points.map((p) => p.v)
  const lo = Math.min(...vs)
  const hi = Math.max(...vs)
  const pad = Math.max((hi - lo) * 0.15, 0.05)
  const W = 300
  const H = 28
  const d = points
    .map((p, i) => {
      const x = ((p.at - t0) / Math.max(t1 - t0, 1)) * W
      const y = H - ((p.v - (lo - pad)) / Math.max(hi - lo + 2 * pad, 1e-9)) * H
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-6" aria-label={label}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * A chart's hovered point, in place of a tooltip box: a dot, and the value in a small dark label just above it. Near
 * the chart's top the label goes below the point (`flip`, for a chart with room under its line); near either end of
 * the window (`at`, the point's place in it, 0 to 1) it leans inward so it is not cut off at the chart's edge.
 */
/** What recharts hands an activeDot: the hovered point's place, value and index in the data. */
export type HoveredPoint = { cx?: number; cy?: number; value?: unknown; index?: number }

export function HoverLabel({ cx, cy, text, color, at = 0.5, flip = true }: {
  cx?: number; cy?: number; text: string | null; color: string; at?: number; flip?: boolean
}) {
  if (cx == null || cy == null || text === null) return <g />
  const w = 8 + text.length * 5.6
  const y = !flip || cy > 20 ? cy - 18 : cy + 6
  const x = at > 0.85 ? cx - w + 6 : at < 0.15 ? cx - 6 : cx - w / 2
  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={2.5} fill={color} />
      <rect x={x} y={y} width={w} height={13} rx={3} fill="#09090b" fillOpacity={0.85} />
      <text x={x + w / 2} y={y + 9.5} textAnchor="middle" fontSize={9.5} fill={color}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontVariantNumeric: 'tabular-nums' }}>{text}</text>
    </g>
  )
}

/**
 * Where a hover card points, in viewport pixels: the hovered element's top and
 * bottom, and the x it hangs from (an hour's centre, or the grid's edge on the
 * side a day was hovered from).
 */
export type Anchor = { top: number; bottom: number; x: number; align: 'center' | 'left' | 'right' }
/** A card opens above its row when the viewport has this much room there, below it otherwise. */
const CARD_ROOM = 200

/**
 * A hover card on a layer of its own (portalled to <body>, fixed to the
 * viewport): a panel clips whatever overflows it, and a hover card is often
 * taller than a two-row panel. It opens above the row when there is room, else below.
 */
export function Floating({ at, className, children }: { at: Anchor; className: string; children: ReactNode }) {
  const above = at.top > CARD_ROOM
  const tx = at.align === 'center' ? '-50%' : at.align === 'right' ? '-100%' : '0'
  return createPortal(
    <div className={`pointer-events-none fixed z-50 ${className}`}
      style={{ left: at.x, top: above ? at.top - 6 : at.bottom + 6, transform: `translate(${tx}, ${above ? '-100%' : '0'})` }}>
      {children}
    </div>,
    document.body,
  )
}
