import { useMemo, useRef, useState } from 'react'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatDay, formatKwh, formatMoney, formatWattsValue } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerDaily, PowerDay, PowerNow } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { Floating, PowerNotice, type Anchor } from './PowerParts'

const IDLE_COLOR = '#71717a'
/** A day with fewer readings than this is marked partial. */
const FULL_DAY = 0.95
const HOUR_TICKS = [0, 6, 12, 18]
/** A bar shorter than this share of its column has no room for its kWh inside, so the figure sits just past its end. */
const LABEL_INSIDE = 22

type HourHover = { day: PowerDay; hour: number; at: Anchor }
type DayHover = { day: PowerDay; at: Anchor }

/** Mix two #rrggbb colours: t = 0 gives a, t = 1 gives b. */
function mix(a: string, b: string, t: number): string {
  const p = (c: string, i: number) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16)
  const ch = (i: number) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0')
  return `#${ch(0)}${ch(1)}${ch(2)}`
}

/**
 * An hour's colour: the idle floor and below is the quiet base, the busiest
 * hour of the week is full accent, and the scale between is square-rooted so a
 * moderate hour still reads as "something ran" rather than vanishing.
 */
function heat(watts: number, floor: number, peak: number): string {
  const t = Math.max(0, Math.min(1, (watts - floor) / Math.max(peak - floor, 1)))
  return t < 0.02 ? '#2a2d24' : mix('#3b4d12', NVIDIA_THEME.accent, Math.sqrt(t))
}

/**
 * The last seven days as a day x hour grid: each row a day, each cell an hour
 * coloured by its mean wall draw (from the idle floor up to the week's busiest
 * hour), then the day's energy as a bar split at the idle floor into being on
 * and work (the key: "on/work"), its kWh, and what it cost. The 24 h chart says how the last day went; this
 * says which hours of which days the machine works, and what each day cost.
 * Newest day on top. Hovering an hour gives its average draw and what it cost,
 * split at the idle floor into being on and work; hovering a day's name, bar or
 * cost gives the day's card.
 */
export function PowerDailyPanel() {
  const daily = usePowerDocument<PowerDaily>('daily?days=7', POWER_POLL_MS.daily)
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  const gridRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HourHover | null>(null)
  const [dayHover, setDayHover] = useState<DayHover | null>(null)
  const data = daily.data
  const floor = now.data?.energy?.floor_watts ?? null
  const unit = now.data?.energy?.unit_price ?? null
  const scale = useMemo(() => {
    const all = (data?.days ?? []).flatMap((d) => (d.hourly_watts ?? []).filter((w): w is number => w !== null))
    const peak = all.length ? Math.max(...all) : 1
    const base = floor ?? (all.length ? Math.min(...all) : 0)
    const maxKwh = Math.max(...(data?.days ?? []).map((d) => d.kwh), 0.001)
    return { peak, base, maxKwh }
  }, [data, floor])
  if (!data) return <PowerNotice state={daily} />
  const days = data.days
  if (days.every((d) => d.coverage === 0)) return <PanelNotice>No daily energy yet</PanelNotice>

  const c = data.currency
  const rowsNewestFirst = [...days].reverse()
  const covered = days.filter((d) => d.coverage > 0)
  const total = days.reduce((s, d) => s + d.kwh, 0)
  const cost = days.reduce((s, d) => s + d.cost, 0)
  const fullDays = covered.filter((d, i) => d.coverage >= FULL_DAY && i < covered.length - 1)
  const avg = fullDays.length ? fullDays.reduce((s, d) => s + d.kwh, 0) / fullDays.length : null
  const today = days[days.length - 1]?.date

  const openDay = (d: PowerDay, el: HTMLElement, side: 'left' | 'right') => {
    const grid = gridRef.current?.getBoundingClientRect()
    if (!grid) return
    const r = el.getBoundingClientRect()
    setHover(null)
    setDayHover({ day: d, at: { top: r.top, bottom: r.bottom, x: side === 'right' ? grid.right : grid.left, align: side } })
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-1.5">
      <div className="shrink-0 flex items-baseline gap-3 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400 min-w-0">
        <span><span className="text-zinc-100">{formatKwh(total)} kWh</span> · {formatMoney(cost, c)}</span>
        {avg !== null && <span>avg {formatKwh(avg)} kWh/day</span>}
        <span className="ml-auto flex items-center gap-1.5 text-zinc-500">
          <span>{floor !== null ? 'idle' : 'low'}</span>
          <span className="inline-block h-1.5 w-16 rounded-full"
            style={{ background: `linear-gradient(90deg, #2a2d24, #3b4d12, ${NVIDIA_THEME.accent})` }} />
          <span>{formatWattsValue(scale.peak)} W</span>
        </span>
      </div>

      <div ref={gridRef} className="relative flex-1 min-h-0 grid gap-x-2 gap-y-1"
        style={{ gridTemplateColumns: 'auto 1fr minmax(4rem, 18%) auto', gridTemplateRows: `repeat(${days.length}, minmax(0, 1fr)) auto` }}
        onMouseLeave={() => { setHover(null); setDayHover(null) }}>
        {rowsNewestFirst.map((d) => {
          const none = d.coverage === 0
          const partial = !none && d.coverage < FULL_DAY && d.date !== today
          const hours = d.hourly_watts ?? Array.from({ length: 24 }, () => null)
          const idle = d.idle_kwh ?? null
          const work = d.work_kwh ?? null
          const share = none ? 0 : Math.max(6, (d.kwh / scale.maxKwh) * 100)
          const inside = share >= LABEL_INSIDE
          return (
            <div key={d.date} className="contents">
              <span className={`self-center text-[10px] 2xl:text-xs font-mono cursor-default ${d.date === today ? 'text-zinc-100' : 'text-zinc-400'}`}
                onMouseEnter={(e) => openDay(d, e.currentTarget, 'left')}>
                {formatDay(d.date)}
              </span>
              <div className="flex gap-px min-w-0 h-full" aria-label={`${formatDay(d.date)} by hour`}>
                {hours.map((w, h) => {
                  const on = hover?.day.date === d.date && hover.hour === h
                  return (
                    <div key={h}
                      className="flex-1 min-w-0 rounded-[2px] transition-[outline-color] duration-100"
                      style={{
                        ...(w === null ? { border: '1px dashed #27272a' } : { backgroundColor: heat(w, scale.base, scale.peak) }),
                        outline: on ? '1px solid #e4e4e7' : '1px solid transparent',
                        outlineOffset: 0,
                      }}
                      aria-label={`${formatDay(d.date)} ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00 · ${w === null ? 'no reading' : `${formatWattsValue(w)} W average`}`}
                      onMouseEnter={(e) => {
                        const cell = e.currentTarget.getBoundingClientRect()
                        setDayHover(null)
                        setHover({ day: d, hour: h, at: { top: cell.top, bottom: cell.bottom, x: cell.left + cell.width / 2, align: 'center' } })
                      }} />
                  )
                })}
              </div>
              {/* The bar has its column to itself, so its length is the day's share of the week's biggest day, with the
                  day's kWh written inside it, over the "on" end (or just past the end of a bar too short to hold it). */}
              <div className="self-center relative h-4 min-w-0 cursor-default" aria-label={`${formatDay(d.date)} energy`}
                onMouseEnter={(e) => openDay(d, e.currentTarget, 'right')}>
                {!none && (
                  <div className="absolute inset-y-0 left-0 flex rounded-[3px] overflow-hidden bg-zinc-800" style={{ width: `${share}%` }}>
                    {idle !== null && work !== null && d.kwh > 0 ? (
                      <>
                        <div className="h-full" style={{ width: `${(idle / (idle + work || 1)) * 100}%`, backgroundColor: IDLE_COLOR }} />
                        <div className="h-full" style={{ width: `${(work / (idle + work || 1)) * 100}%`, backgroundColor: NVIDIA_THEME.accent }} />
                      </>
                    ) : (
                      <div className="h-full w-full" style={{ backgroundColor: IDLE_COLOR }} />
                    )}
                  </div>
                )}
                <span className="absolute inset-y-0 flex items-center text-[10px] 2xl:text-xs font-mono font-medium tabular-nums whitespace-nowrap leading-none"
                  style={none ? { left: 0, color: '#71717a' }
                    : inside ? { left: 0, paddingLeft: 5, color: '#fafafa', textShadow: '0 0 3px rgba(0, 0, 0, 0.75)' }
                      : { left: `calc(${share}% + 4px)`, color: '#d4d4d8' }}>
                  {none ? '—' : formatKwh(d.kwh)}
                </span>
              </div>
              <span className="self-center text-right text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-200 whitespace-nowrap cursor-default"
                onMouseEnter={(e) => openDay(d, e.currentTarget, 'right')}>
                {none ? '' : formatMoney(d.cost, c)}{partial ? '*' : ''}
              </span>
            </div>
          )
        })}
        <span />
        <div className="relative h-3 text-[9px] font-mono text-zinc-600">
          {HOUR_TICKS.map((h) => (
            <span key={h} className="absolute -translate-x-0" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}</span>
          ))}
          <span className="absolute right-0">24</span>
        </div>
        {/* The bars' key, one line under the bars, its two words in the bars' colours. */}
        <div className="col-span-2 self-start flex gap-2 text-[9px] font-mono text-zinc-600 whitespace-nowrap">
          <span>kWh · <span style={{ color: IDLE_COLOR }}>on</span>/<span style={{ color: NVIDIA_THEME.accent }}>work</span></span>
          <span className="ml-auto">{partial(days, today) ? '* part day' : ''}</span>
        </div>
        {hover && <HourTip hover={hover} floor={floor} unit={unit} currency={c} />}
        {dayHover && <DayTip hover={dayHover} currency={c} today={today} />}
      </div>
    </div>
  )
}

/**
 * An hour's figures, styled like the charts' tooltips: when, its mean draw,
 * and what it cost split at the idle floor (being on and work), at the
 * current unit price.
 */
function HourTip({ hover, floor, unit, currency }: {
  hover: HourHover
  floor: number | null
  unit: number | null
  currency: string
}) {
  const w = hover.day.hourly_watts?.[hover.hour] ?? null
  const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`
  const idle = w !== null && unit !== null ? (Math.min(w, floor ?? w) / 1000) * unit : null
  const work = w !== null && unit !== null ? (Math.max(0, w - (floor ?? w)) / 1000) * unit : null
  const row = (color: string, label: string, value: string) => (
    <div className="flex w-full items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">{value}</span>
    </div>
  )
  return (
    <Floating at={hover.at} className="grid items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl min-w-40">
      <div className="font-medium text-foreground">{formatDay(hover.day.date)} · {hh(hover.hour)}–{hh(hover.hour + 1)}</div>
      {w === null ? (
        <div className="text-muted-foreground">no reading</div>
      ) : (
        <div className="grid gap-1.5">
          {row('#a1a1aa', 'Average draw', `${formatWattsValue(w)} W`)}
          {idle !== null && row(IDLE_COLOR, 'Being on', formatMoney(idle, currency))}
          {work !== null && row(NVIDIA_THEME.accent, 'Work', formatMoney(work, currency))}
          {idle !== null && work !== null && row('transparent', 'Total', formatMoney(idle + work, currency))}
        </div>
      )}
    </Floating>
  )
}

/**
 * A day's figures, in the hour card's style: its energy and cost split at the
 * idle floor into being on and work (the cost shared out by kWh, which is exact
 * on a flat tariff), the total, then its average and peak, the GPUs' share and,
 * for a day with gaps, how much of it was read.
 */
function DayTip({ hover, currency, today }: { hover: DayHover; currency: string; today: string | undefined }) {
  const d = hover.day
  const idle = d.idle_kwh ?? null
  const work = d.work_kwh ?? null
  const split = idle !== null && work !== null && idle + work > 0
  const part = (kwh: number) => `${formatKwh(kwh)} kWh · ${formatMoney(split ? d.cost * (kwh / (idle! + work!)) : 0, currency)}`
  const facts = [
    d.average_watts !== null ? `average ${formatWattsValue(d.average_watts)} W` : null,
    d.peak_watts !== null ? `peak minute ${formatWattsValue(d.peak_watts)} W` : null,
    d.gpu_kwh != null && d.kwh > 0 ? `GPUs ${Math.round((d.gpu_kwh / d.kwh) * 100)} % of the energy` : null,
    d.coverage > 0 && d.coverage < FULL_DAY ? `readings for ${Math.round(d.coverage * 100)} % of the ${d.date === today ? 'day so far' : 'day'}` : null,
  ].filter(Boolean)
  const row = (color: string, label: string, value: string, strong = false) => (
    <div className="flex w-full items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
      <span className={strong ? 'font-medium text-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">{value}</span>
    </div>
  )
  return (
    <Floating at={hover.at} className="grid items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl min-w-48">
      <div className="font-medium text-foreground">{formatDay(d.date)}{d.date === today ? ' · so far' : ''}</div>
      {d.coverage === 0 ? (
        <div className="text-muted-foreground">no readings</div>
      ) : (
        <>
          <div className="grid gap-1.5">
            {split && row(IDLE_COLOR, 'Being on', part(idle!))}
            {split && row(NVIDIA_THEME.accent, 'Work', part(work!))}
            <div className={split ? 'border-t border-border/50 pt-1.5' : ''}>
              {row('transparent', 'Total', `${formatKwh(d.kwh)} kWh · ${formatMoney(d.cost, currency)}`, true)}
            </div>
          </div>
          {facts.length > 0 && <div className="grid gap-0.5 text-muted-foreground">{facts.map((f) => <span key={f}>{f}</span>)}</div>}
        </>
      )}
    </Floating>
  )
}

function partial(days: PowerDay[], today: string | undefined): boolean {
  return days.some((d) => d.coverage > 0 && d.coverage < FULL_DAY && d.date !== today)
}
