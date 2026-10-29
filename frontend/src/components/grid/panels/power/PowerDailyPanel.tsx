import { useMemo } from 'react'
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
 * and work, and what it cost. The 24 h chart says how the last day went; this
 * says which hours of which days the machine works, and what each day cost.
 */
export function PowerDailyPanel() {
  const daily = usePowerDocument<PowerDaily>('daily?days=7', POWER_POLL_MS.daily)
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  const data = daily.data
  const floor = now.data?.energy?.floor_watts ?? null
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

      <div className="flex-1 min-h-0 grid gap-x-2 gap-y-1" style={{ gridTemplateColumns: 'auto 1fr minmax(4rem, 18%) auto', gridTemplateRows: `repeat(${days.length}, minmax(0, 1fr)) auto` }}>
        {days.map((d) => {
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
                {hours.map((w, h) => (
                  <div key={h}
                    className="flex-1 min-w-0 rounded-[2px]"
                    style={w === null ? { border: '1px dashed #27272a' } : { backgroundColor: heat(w, scale.base, scale.peak) }}
                    title={`${formatDay(d.date)} ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00 · ${w === null ? 'no reading' : `${formatWattsValue(w)} W average`}`} />
                ))}
              </div>
              <div className="self-center flex items-center gap-1.5 min-w-0" title={dayTip(d)}>
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
                <span className="text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-300 whitespace-nowrap">{none ? '—' : formatKwh(d.kwh)}</span>
              </div>
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
        <span className="text-[9px] font-mono text-zinc-600 self-start">kWh · being on / work</span>
        <span className="text-[9px] font-mono text-zinc-600 self-start text-right">{partial(days, today) ? '* part day' : ''}</span>
      </div>
    </div>
  )
}

function partial(days: PowerDay[], today: string | undefined): boolean {
  return days.some((d) => d.coverage > 0 && d.coverage < FULL_DAY && d.date !== today)
}
