import { useMemo, useRef, useState } from 'react'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatDay, formatKwh, formatMoney, formatWattsValue } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerDaily, PowerDay, PowerNow } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { PowerNotice } from './PowerParts'

const IDLE_COLOR = '#71717a'
/** A day with fewer readings than this is marked partial. */
const FULL_DAY = 0.95
const HOUR_TICKS = [0, 6, 12, 18]

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
 * split at the idle floor into being on and work.
 */
export function PowerDailyPanel() {
  const daily = usePowerDocument<PowerDaily>('daily?days=7', POWER_POLL_MS.daily)
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  const gridRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ day: PowerDay; hour: number; x: number; y: number; below: boolean } | null>(null)
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

  const dayTip = (d: PowerDay) =>
    [
      `${formatDay(d.date)}: ${formatKwh(d.kwh)} kWh, ${formatMoney(d.cost, c)}`,
      d.idle_kwh != null && d.work_kwh != null ? `being on ${formatKwh(d.idle_kwh)} kWh, work ${formatKwh(d.work_kwh)} kWh` : null,
      d.average_watts !== null ? `average ${formatWattsValue(d.average_watts)} W` : null,
      d.peak_watts !== null ? `peak minute ${formatWattsValue(d.peak_watts)} W` : null,
      d.gpu_kwh != null && d.kwh > 0 ? `GPUs ${Math.round((d.gpu_kwh / d.kwh) * 100)} % of the energy` : null,
      d.coverage < FULL_DAY ? `readings for ${Math.round(d.coverage * 100)} % of the ${d.date === today ? 'day so far' : 'day'}` : null,
    ].filter(Boolean).join('\n')

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
        style={{ gridTemplateColumns: 'auto 1fr minmax(3rem, 14%) auto auto', gridTemplateRows: `repeat(${days.length}, minmax(0, 1fr)) auto` }}
        onMouseLeave={() => setHover(null)}>
        {rowsNewestFirst.map((d) => {
          const none = d.coverage === 0
          const partial = !none && d.coverage < FULL_DAY && d.date !== today
          const hours = d.hourly_watts ?? Array.from({ length: 24 }, () => null)
          const idle = d.idle_kwh ?? null
          const work = d.work_kwh ?? null
          return (
            <div key={d.date} className="contents">
              <span className={`self-center text-[10px] 2xl:text-xs font-mono ${d.date === today ? 'text-zinc-100' : 'text-zinc-400'}`} title={dayTip(d)}>
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
                        const grid = gridRef.current?.getBoundingClientRect()
                        const cell = e.currentTarget.getBoundingClientRect()
                        if (!grid) return
                        const y = cell.top - grid.top
                        setHover({ day: d, hour: h, x: cell.left - grid.left + cell.width / 2, y: y < 90 ? cell.bottom - grid.top : y, below: y < 90 })
                      }} />
                  )
                })}
              </div>
              {/* The bar has its column to itself, so its length is the day's share of the week's biggest day; the
                  figure sits in the next column, right-aligned, rather than squeezing the longest bar. */}
              <div className="self-center flex min-w-0" title={dayTip(d)}>
                <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-800" style={{ width: `${none ? 0 : Math.max(6, (d.kwh / scale.maxKwh) * 100)}%` }}>
                  {idle !== null && work !== null && d.kwh > 0 ? (
                    <>
                      <div className="h-full" style={{ width: `${(idle / (idle + work || 1)) * 100}%`, backgroundColor: IDLE_COLOR }} />
                      <div className="h-full" style={{ width: `${(work / (idle + work || 1)) * 100}%`, backgroundColor: NVIDIA_THEME.accent }} />
                    </>
                  ) : (
                    <div className="h-full w-full" style={{ backgroundColor: IDLE_COLOR }} />
                  )}
                </div>
              </div>
              <span className="self-center text-right text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-300 whitespace-nowrap" title={dayTip(d)}>
                {none ? '—' : formatKwh(d.kwh)}
              </span>
              <span className="self-center text-right text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-200 whitespace-nowrap" title={dayTip(d)}>
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
        <div className="col-span-3 self-start flex gap-2 text-[9px] font-mono text-zinc-600 whitespace-nowrap">
          <span>kWh · <span style={{ color: IDLE_COLOR }}>on</span>/<span style={{ color: NVIDIA_THEME.accent }}>work</span></span>
          <span className="ml-auto">{partial(days, today) ? '* part day' : ''}</span>
        </div>
        {hover && <HourTip hover={hover} floor={floor} unit={unit} currency={c} />}
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
  hover: { day: PowerDay; hour: number; x: number; y: number; below: boolean }
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
    <div className="pointer-events-none absolute z-20 grid min-w-40 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl"
      style={{ left: hover.x, top: hover.y, transform: `translate(-50%, ${hover.below ? '6px' : 'calc(-100% - 6px)'})` }}>
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
    </div>
  )
}

function partial(days: PowerDay[], today: string | undefined): boolean {
  return days.some((d) => d.coverage > 0 && d.coverage < FULL_DAY && d.date !== today)
}
