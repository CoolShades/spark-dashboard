import type { ReactNode } from 'react'
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
 * A small muted line of facts under a headline. It wraps to a second line
 * rather than cutting off: a tariff name or a UPS's transfer reason is only
 * useful whole, and a narrower window should cost height, not words.
 */
export function FactLine({ children }: { children: ReactNode }) {
  return <p className="text-[10px] 2xl:text-xs text-zinc-500 font-mono tabular-nums break-words line-clamp-2">{children}</p>
}
