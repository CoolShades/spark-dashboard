import { useRef, useState } from 'react'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { BUSY_PERCENT, GPU_LINE_COLORS, utilHeat } from '@/lib/gpus'
import { formatClock, formatKwh, formatWattsValue } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { GpuHistory, GpuStep } from '@/types/gpus'
import { PanelNotice } from '../PanelNotice'
import { Floating, PowerNotice, type Anchor } from '../power/PowerParts'

type CellHover = { gpu: number; t: number; step: GpuStep | null; at: Anchor }
const SLOWED = 0.005

/**
 * Each GPU's last 24 hours as a row of 10-minute cells coloured by its mean
 * load (quiet under 2 %, full accent at 100 %, square-rooted so a light job
 * still shows), with a red mark on any step its clocks were slowed by a
 * thermal or hardware limit, and at the end of the row its busy hours, kWh and
 * the hottest it got. Hovering a cell gives that step's load, power, peak
 * temperature and fan, and how long the clocks were held. The cards above are
 * now; this is the day.
 */
export function GpuDayPanel() {
  const history = usePowerDocument<GpuHistory>('gpu-history?hours=24', POWER_POLL_MS.gpuHistory)
  const gridRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<CellHover | null>(null)
  const h = history.data
  if (!h) return <PowerNotice state={history} />
  if (!h.points?.length) return <PanelNotice>No GPU history yet</PanelNotice>

  const step = h.step_seconds * 1000
  const end = h.points[h.points.length - 1].t + step
  const bins = Math.round((h.hours * 3_600_000) / step)
  const start = end - bins * step
  const cols = Array.from({ length: bins }, (_, k) => start + k * step)
  const byT = new Map(h.points.map((p) => [p.t, p]))
  // Tick at each local 6-hour mark inside the window.
  const ticks = cols.filter((t) => {
    const d = new Date(t)
    return d.getMinutes() === 0 && d.getHours() % 6 === 0
  })
  const busy = h.summary.reduce((s, x) => s + (x.busy_hours ?? 0), 0)
  const kwh = h.summary.reduce((s, x) => s + (x.kwh ?? 0), 0)
  const hottest = h.summary.reduce<(typeof h.summary)[number] | null>((a, b) => ((b.temp_max ?? -1) > (a?.temp_max ?? -1) ? b : a), null)

  return (
    <div className="h-full min-h-0 flex flex-col gap-1.5">
      <div className="shrink-0 flex items-baseline gap-3 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400 min-w-0">
        <span><span className="text-zinc-100">{busy.toFixed(1)}</span> GPU-hours busy</span>
        <span><span className="text-zinc-100">{formatKwh(kwh)}</span> kWh</span>
        {hottest?.temp_max != null && hottest.temp_max_at && (
          <span>hottest <span className="text-zinc-100">{Math.round(hottest.temp_max)} °C</span> · GPU {hottest.index} at {formatClock(Date.parse(hottest.temp_max_at))}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-zinc-500">
          <span>idle</span>
          <span className="inline-block h-1.5 w-16 rounded-full" style={{ background: `linear-gradient(90deg, #2a2d24, #3b4d12, ${NVIDIA_THEME.accent})` }} />
          <span>100 %</span>
          <span className="ml-2 inline-block h-1.5 w-2.5 rounded-sm" style={{ backgroundColor: NVIDIA_THEME.critical }} />
          <span>slowed</span>
        </span>
      </div>

      <div ref={gridRef} className="relative flex-1 min-h-0 grid gap-x-2 gap-y-1"
        style={{ gridTemplateColumns: 'auto 1fr auto', gridTemplateRows: `repeat(${h.labels.length}, minmax(0, 1fr)) auto` }}
        onMouseLeave={() => setHover(null)}>
        {h.labels.map((label, gi) => {
          const s = h.summary[gi]
          return (
            <div key={label} className="contents">
              <span className="self-center flex items-center gap-1.5 text-[10px] 2xl:text-xs font-mono text-zinc-300 whitespace-nowrap">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: GPU_LINE_COLORS[gi % GPU_LINE_COLORS.length] }} />
                {label}
              </span>
              <div className="flex gap-px min-w-0 h-full" aria-label={`${label}, last ${h.hours} h`}>
                {cols.map((t) => {
                  const cell = byT.get(t)?.gpus[gi] ?? null
                  const on = hover?.gpu === gi && hover.t === t
                  return (
                    <div key={t} className="relative flex-1 min-w-0 rounded-[1px]"
                      style={{
                        ...(cell?.util == null ? { border: '1px dashed #27272a' } : { backgroundColor: utilHeat(cell.util) }),
                        outline: on ? '1px solid #e4e4e7' : '1px solid transparent',
                      }}
                      aria-label={`${label} ${formatClock(t)} · ${cell?.util == null ? 'no reading' : `${Math.round(cell.util)} % load`}`}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setHover({ gpu: gi, t, step: cell, at: { top: r.top, bottom: r.bottom, x: r.left + r.width / 2, align: 'center' } })
                      }}>
                      {(cell?.slowdown ?? 0) > SLOWED && (
                        <span className="absolute inset-x-0 top-0 h-[3px] rounded-t-[1px]" style={{ backgroundColor: NVIDIA_THEME.critical }} />
                      )}
                    </div>
                  )
                })}
              </div>
              <span className="self-center text-right text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400 whitespace-nowrap">
                {s ? (
                  <>busy <span className="text-zinc-100">{(s.busy_hours ?? 0).toFixed(1)} h</span> · {formatKwh(s.kwh ?? 0)} kWh
                    {s.temp_max != null && <> · max <span className="text-zinc-100">{Math.round(s.temp_max)} °C</span></>}</>
                ) : null}
              </span>
            </div>
          )
        })}
        <span />
        <div className="relative h-3 text-[9px] font-mono text-zinc-600">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${((t - start) / (end - start)) * 100}%` }}>{formatClock(t)}</span>
          ))}
        </div>
        <span />
        {hover && <CellTip hover={hover} label={h.labels[hover.gpu]} step={step} />}
      </div>
    </div>
  )
}

/**
 * One GPU over one step, in the hour card's style: its load, power, peak
 * temperature and fan, then how long its clocks were held. The power cap is
 * only named on a working step; an idle card reports one for nothing.
 */
function CellTip({ hover, label, step }: { hover: CellHover; label: string; step: number }) {
  const s = hover.step
  const row = (color: string, name: string, value: string) => (
    <div className="flex w-full items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground">{name}</span>
      <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">{value}</span>
    </div>
  )
  const working = (s?.util ?? 0) >= BUSY_PERCENT
  return (
    <Floating at={hover.at} className="grid items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl min-w-44">
      <div className="font-medium text-foreground">{label} · {formatClock(hover.t)}–{formatClock(hover.t + step)}</div>
      {s?.util == null ? (
        <div className="text-muted-foreground">no reading</div>
      ) : (
        <>
          <div className="grid gap-1.5">
            {row(utilHeat(s.util), 'Load', `${Math.round(s.util)} %`)}
            {s.watts != null && row('#a1a1aa', 'Power', `${formatWattsValue(s.watts)} W`)}
            {s.temp != null && row('#f59e0b', 'Temp (peak)', `${Math.round(s.temp)} °C`)}
            {s.fan != null && row('#38bdf8', 'Fan', `${Math.round(s.fan)} %`)}
          </div>
          {working && (s.power_cap ?? 0) > SLOWED && (
            <div className="text-muted-foreground">power-capped {Math.round((s.power_cap ?? 0) * 100)} % of the time</div>
          )}
          {(s.slowdown ?? 0) > SLOWED && (
            <div style={{ color: NVIDIA_THEME.critical }}>slowed {Math.round((s.slowdown ?? 0) * 100)} % of the time</div>
          )}
        </>
      )}
    </Floating>
  )
}
