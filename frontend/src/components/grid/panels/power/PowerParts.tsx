import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Line, LineChart, ReferenceDot, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
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
 * moves too little to see: the strip shows it is being read, and how it moves,
 * on a scale fitted to the window. Hovering gives a reading (`format`).
 */
export function Sparkline({ points, color, label, format }: {
  points: ReadonlyArray<{ at: number; v: number }>; color: string; label: string; format: (v: number) => string
}) {
  if (points.length < 3) return null
  const vs = points.map((p) => p.v)
  const lo = Math.min(...vs)
  const hi = Math.max(...vs)
  const pad = Math.max((hi - lo) * 0.15, 0.05)
  return (
    <HoverLines rows={points.map((p) => ({ t: p.at, v: p.v }))} x="t" lines={[{ key: 'v', color, width: 1.3 }]}
      domain={[lo - pad, hi + pad]} label={label} text={(r) => (r.v != null ? format(r.v) : null)} />
  )
}

/** One line of a hoverable strip: its key in the rows, its colour, and how it is drawn. */
export type StripLine = { key: string; color: string; width?: number; opacity?: number; dashed?: boolean }
type StripRow = Record<string, number | null>

/**
 * A strip of live lines you can hover, in the place and size of the plain strips (`className`, h-6 by default): no
 * axis or grid, on a fixed `domain`. Hovering draws a faint cursor and marks each line's point; the first line with a
 * value there (the lines are listed in that order, and the first is drawn on top) carries the small dark label with
 * `text(row)`, always above the point. `marks` are fixed dots, such as a line's latest point.
 */
export function HoverLines({ rows, x, lines, domain, xDomain, label, text, marks = [], className = 'h-6' }: {
  rows: ReadonlyArray<StripRow>; x: string; lines: ReadonlyArray<StripLine>; domain: [number, number]
  xDomain?: [number, number]; label: string; text: (row: StripRow) => LabelText | null
  marks?: ReadonlyArray<{ x: number; y: number; color: string }>; className?: string
}) {
  const last = Math.max(rows.length - 1, 1)
  const config = Object.fromEntries(lines.map((l) => [l.key, { label: l.key, color: l.color }]))
  const dot = (line: StripLine) => (d: HoveredPoint) => {
    const row = d.index != null ? rows[d.index] : undefined
    if (!row || d.cx == null || d.cy == null) return <g />
    if (lines.find((l) => row[l.key] != null)?.key !== line.key) {
      return <circle cx={d.cx} cy={d.cy} r={2} fill={line.color} pointerEvents="none" />
    }
    return <HoverLabel cx={d.cx} cy={d.cy} color={line.color} flip={false} at={(d.index ?? 0) / last} text={text(row)} />
  }
  return (
    <div className={`w-full min-w-0 ${className}`} aria-label={label}>
      <ChartContainer config={config} className="h-full w-full aspect-auto [&_.recharts-surface]:overflow-visible [&_:focus]:outline-none">
        <LineChart data={[...rows]} margin={{ top: 1, right: 1, bottom: 1, left: 1 }}>
          <XAxis dataKey={x} type="number" domain={xDomain ?? ['dataMin', 'dataMax']} hide />
          <YAxis domain={domain} hide />
          <ChartTooltip content={() => null} cursor={{ stroke: '#52525b', strokeDasharray: '2 2' }} isAnimationActive={false} />
          {[...lines].reverse().map((l) => (
            <Line key={l.key} dataKey={l.key} type="linear" stroke={l.color} strokeWidth={l.width ?? 1.5} strokeOpacity={l.opacity ?? 1}
              strokeDasharray={l.dashed ? '3 2' : undefined} dot={false} isAnimationActive={false} activeDot={dot(l)} />
          ))}
          {marks.map((m) => <ReferenceDot key={`${m.x}:${m.y}`} x={m.x} y={m.y} r={2} fill={m.color} stroke="none" />)}
        </LineChart>
      </ChartContainer>
    </div>
  )
}

/** What recharts hands an activeDot: the hovered point's place, value and index in the data. */
export type HoveredPoint = { cx?: number; cy?: number; value?: unknown; index?: number }

/** A hover label's text: one string in the point's colour, or segments each with its own colour. */
export type LabelText = string | ReadonlyArray<readonly [text: string, color: string]>

export function HoverLabel({ cx, cy, text, color, at = 0.5, flip = true }: {
  cx?: number; cy?: number; text: LabelText | null; color: string; at?: number; flip?: boolean
}) {
  if (cx == null || cy == null || text === null) return <g />
  const parts = typeof text === 'string' ? [[text, color] as const] : text
  const w = 8 + parts.reduce((n, [t]) => n + t.length, 0) * 5.6
  const y = !flip || cy > 20 ? cy - 18 : cy + 6
  const x = at > 0.85 ? cx - w + 6 : at < 0.15 ? cx - 6 : cx - w / 2
  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={2.5} fill={color} />
      <rect x={x} y={y} width={w} height={13} rx={3} fill="#09090b" fillOpacity={0.85} />
      <text x={x + w / 2} y={y + 9.5} textAnchor="middle" fontSize={9.5} fill={color}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontVariantNumeric: 'tabular-nums', whiteSpace: 'pre' }}>
        {parts.map(([t, c], k) => <tspan key={k} fill={c}>{t}</tspan>)}
      </text>
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
