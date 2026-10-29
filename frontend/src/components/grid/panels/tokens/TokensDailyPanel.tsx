import { useRef, useState } from 'react'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatDay } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import { formatTokens, share } from '@/lib/tokens'
import type { TokenDaily, TokenDay } from '@/types/tokens'
import { PanelNotice } from '../PanelNotice'
import { Floating, PowerNotice, type Anchor } from '../power/PowerParts'

const HOUR_TICKS = [0, 6, 12, 18]
type Hover = { day: TokenDay; hour: number | null; at: Anchor }

/** An hour's colour: the quiet base when nothing was written, full accent at the week's busiest hour, square-rooted. */
function heat(tokens: number, peak: number): string {
  if (tokens <= 0) return '#2a2d24'
  const t = Math.sqrt(Math.min(1, tokens / Math.max(peak, 1)))
  const p = (c: string, i: number) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16)
  const ch = (i: number) => Math.round(p('#3b4d12', i) + (p(NVIDIA_THEME.accent, i) - p('#3b4d12', i)) * t).toString(16).padStart(2, '0')
  return `#${ch(0)}${ch(1)}${ch(2)}`
}

/**
 * The last seven days as a day x hour grid, newest on top, like the Power
 * page's energy heatmap: each cell an hour coloured by the output tokens
 * written in it (up to the week's busiest hour), then the day's output as a bar
 * with its count inside, and its requests. Hovering an hour or a day opens its
 * card: tokens out and in, the cached share and requests.
 */
export function TokensDailyPanel() {
  const daily = usePowerDocument<TokenDaily>('token-daily?days=7', POWER_POLL_MS.tokenDaily)
  const gridRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const data = daily.data
  if (!data) return <PowerNotice state={daily} />
  const days = data.days ?? []
  if (days.every((d) => d.coverage === 0)) return <PanelNotice>No token history yet</PanelNotice>

  const peakHour = Math.max(...days.flatMap((d) => d.hourly_output.filter((v): v is number => v !== null)), 1)
  const peakDay = Math.max(...days.map((d) => d.output), 1)
  const out = days.reduce((s, d) => s + d.output, 0)
  const inp = days.reduce((s, d) => s + d.prompt, 0)
  const req = days.reduce((s, d) => s + d.requests, 0)
  const today = days[days.length - 1]?.date
  const open = (day: TokenDay, hour: number | null, el: HTMLElement, align: Anchor['align']) => {
    const r = el.getBoundingClientRect()
    const g = gridRef.current?.getBoundingClientRect()
    setHover({ day, hour, at: { top: r.top, bottom: r.bottom, x: align === 'center' ? r.left + r.width / 2 : align === 'right' ? (g?.right ?? r.right) : (g?.left ?? r.left), align } })
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-1.5">
      <div className="shrink-0 flex items-baseline gap-3 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400 min-w-0">
        <span><span className="text-zinc-100">{formatTokens(out)}</span> out · {formatTokens(inp)} in</span>
        <span>{req.toLocaleString('en-GB')} requests</span>
        <span className="ml-auto flex items-center gap-1.5 text-zinc-500">
          <span>0</span>
          <span className="inline-block h-1.5 w-16 rounded-full" style={{ background: `linear-gradient(90deg, #2a2d24, #3b4d12, ${NVIDIA_THEME.accent})` }} />
          <span>{formatTokens(peakHour)}/h</span>
        </span>
      </div>
      <div ref={gridRef} className="relative flex-1 min-h-0 grid gap-x-2 gap-y-1"
        style={{ gridTemplateColumns: 'auto 1fr minmax(4rem, 18%) auto', gridTemplateRows: `repeat(${days.length}, minmax(0, 1fr)) auto` }}
        onMouseLeave={() => setHover(null)}>
        {[...days].reverse().map((d) => {
          const w = d.output > 0 ? Math.max(6, (d.output / peakDay) * 100) : 0
          const inside = w >= 22
          return (
            <div key={d.date} className="contents">
              <span className={`self-center text-[10px] 2xl:text-xs font-mono cursor-default ${d.date === today ? 'text-zinc-100' : 'text-zinc-400'}`}
                onMouseEnter={(e) => open(d, null, e.currentTarget, 'left')}>{formatDay(d.date)}</span>
              <div className="flex gap-px min-w-0 h-full" aria-label={`${formatDay(d.date)} by hour`}>
                {d.hourly_output.map((v, h) => (
                  <div key={h} className="flex-1 min-w-0 rounded-[2px]"
                    style={{
                      ...(v === null ? { border: '1px dashed #27272a' } : { backgroundColor: heat(v, peakHour) }),
                      outline: hover?.day.date === d.date && hover.hour === h ? '1px solid #e4e4e7' : '1px solid transparent',
                    }}
                    aria-label={`${formatDay(d.date)} ${String(h).padStart(2, '0')}:00 · ${v === null ? 'no reading' : `${formatTokens(v)} tokens out`}`}
                    onMouseEnter={(e) => open(d, h, e.currentTarget, 'center')} />
                ))}
              </div>
              <div className="self-center relative h-4 min-w-0 cursor-default" aria-label={`${formatDay(d.date)} tokens`}
                onMouseEnter={(e) => open(d, null, e.currentTarget, 'right')}>
                {w > 0 && <div className="absolute inset-y-0 left-0 rounded-[3px]" style={{ width: `${w}%`, backgroundColor: NVIDIA_THEME.accent, opacity: 0.85 }} />}
                <span className="absolute inset-y-0 flex items-center text-[10px] 2xl:text-xs font-mono font-medium tabular-nums whitespace-nowrap leading-none"
                  style={d.output === 0 ? { left: 0, color: '#71717a' } : inside ? { left: 0, paddingLeft: 5, color: '#0a0a0a' } : { left: `calc(${w}% + 4px)`, color: '#d4d4d8' }}>
                  {d.output === 0 ? '—' : formatTokens(d.output)}
                </span>
              </div>
              <span className="self-center text-right text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-300 whitespace-nowrap cursor-default"
                onMouseEnter={(e) => open(d, null, e.currentTarget, 'right')}>{d.requests ? `${d.requests.toLocaleString('en-GB')} req` : ''}</span>
            </div>
          )
        })}
        <span />
        <div className="relative h-3 text-[9px] font-mono text-zinc-600">
          {HOUR_TICKS.map((h) => <span key={h} className="absolute" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}</span>)}
          <span className="absolute right-0">24</span>
        </div>
        <span className="col-span-2 text-[9px] font-mono text-zinc-600">tokens out · requests</span>
        {hover && <Tip hover={hover} today={today} />}
      </div>
    </div>
  )
}

/** An hour's or a day's figures, in the hour card's style. */
function Tip({ hover, today }: { hover: Hover; today: string | undefined }) {
  const d = hover.day
  const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`
  const row = (color: string, label: string, value: string) => (
    <div className="flex w-full items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">{value}</span>
    </div>
  )
  const out = hover.hour === null ? d.output : d.hourly_output[hover.hour]
  const inp = hover.hour === null ? d.prompt : d.hourly_prompt[hover.hour]
  const cached = share(d.cached, d.prompt)
  return (
    <Floating at={hover.at} className="grid items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl min-w-44">
      <div className="font-medium text-foreground">
        {formatDay(d.date)}{hover.hour !== null ? ` · ${hh(hover.hour)}–${hh(hover.hour + 1)}` : d.date === today ? ' · so far' : ''}
      </div>
      {out == null ? (
        <div className="text-muted-foreground">no reading</div>
      ) : (
        <div className="grid gap-1.5">
          {row(NVIDIA_THEME.accent, 'Output', `${formatTokens(out)} tok`)}
          {inp != null && row('#38bdf8', 'Prompt', `${formatTokens(inp)} tok`)}
          {hover.hour === null && cached !== null && row('transparent', 'From cache', `${cached} %`)}
          {hover.hour === null && row('transparent', 'Requests', d.requests.toLocaleString('en-GB'))}
          {hover.hour === null && d.requests > 0 && row('transparent', 'Out per request', `${formatTokens(d.output / d.requests)} tok`)}
        </div>
      )}
    </Floating>
  )
}
