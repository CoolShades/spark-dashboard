import { useLatestSnapshot } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatWattsValue, splitWall, sumGpuWatts } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerNow } from '@/types/power'
import { usePanelDevice } from '../../panelDevice'
import { PanelNotice } from '../PanelNotice'
import { FactLine, Headline, PowerNotice, StaleBadge } from './PowerParts'

const SYSTEM_COLOR = '#71717a'
const OTHER_COLORS = ['#38bdf8', '#a78bfa', '#f472b6']
const METER_COLOR = '#e4e4e7'

/** The live strip: the wall figure and the supplies' own input meters over the last few minutes, one point a poll. */
function LiveStrip({ recent }: { recent: ReadonlyArray<{ at: number; data: PowerNow }> }) {
  const pts = recent.filter((r) => r.data.total_watts !== null)
  if (pts.length < 3) return null
  const metered = (d: PowerNow) => {
    const ins = d.supplies.map((s) => s.input_watts).filter((w): w is number => w !== null)
    return ins.length ? ins.reduce((a, b) => a + b, 0) : null
  }
  const t0 = pts[0].at
  const t1 = pts[pts.length - 1].at
  const all = pts.flatMap((p) => [p.data.total_watts!, metered(p.data) ?? p.data.total_watts!])
  const lo = Math.min(...all) * 0.97
  const hi = Math.max(...all) * 1.03 || 1
  const W = 300
  const H = 40
  const x = (t: number) => ((t - t0) / Math.max(t1 - t0, 1)) * W
  const y = (w: number) => H - ((w - lo) / Math.max(hi - lo, 1)) * H
  const path = (f: (d: PowerNow) => number | null) =>
    pts
      .map((p) => [p.at, f(p.data)] as const)
      .filter(([, w]) => w !== null)
      .map(([t, w], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(w!).toFixed(1)}`)
      .join(' ')
  const meterNames = pts[pts.length - 1].data.supplies.filter((s) => s.input_watts !== null).map((s) => s.name)
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-8" aria-label="Last few minutes">
        <path d={path((d) => d.total_watts)} fill="none" stroke={NVIDIA_THEME.accent} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {meterNames.length > 0 && (
          <path d={path(metered)} fill="none" stroke={METER_COLOR} strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <span className="text-[9px] 2xl:text-[10px] text-zinc-500 font-mono truncate">
        last {Math.max(1, Math.round((t1 - t0) / 60_000))} min · <span style={{ color: NVIDIA_THEME.accent }}>wall</span>
        {meterNames.length > 0 && <> · <span className="text-zinc-300">{meterNames.join(' + ')} in (metered)</span></>}
      </span>
    </div>
  )
}

/**
 * The whole rack at the wall, and where it goes: the GPUs (this dashboard's own
 * NVML reading, so that slice moves every second), the other loads on the same
 * meter (a router on the UPS, estimated by the source), and the system: CPU,
 * memory, disks, fans and the supplies' losses. Below it, a live strip of the
 * last few minutes, polled every 2 s.
 */
export function PowerWallPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  const snapshot = useLatestSnapshot()
  usePanelDevice(now.data?.total_source ?? null)
  if (!now.data) return <PowerNotice state={now} />

  const { total_watts: total, total_estimated: estimated, supplies } = now.data
  if (total === null) return <PanelNotice>Wall power not reported</PanelNotice>
  const split = splitWall(total, sumGpuWatts(snapshot?.gpus), now.data.other_loads ?? [])
  const slices = split
    ? [
        { name: 'GPUs', watts: split.gpus, color: NVIDIA_THEME.accent, est: false, tip: 'NVML board power, all cards' },
        { name: 'System', watts: split.system, color: SYSTEM_COLOR, est: false,
          tip: 'CPU, memory, disks, fans and the power supplies’ losses' },
        ...split.others.map((o, i) => ({ name: o.name, watts: o.watts, color: OTHER_COLORS[i % OTHER_COLORS.length],
          est: o.estimated, tip: o.estimated ? 'An estimate: nothing meters it on its own' : '' })),
      ]
    : []
  const readings = supplies
    .map((s) =>
      s.input_watts !== null
        ? `${s.name} in ${formatWattsValue(s.input_watts)} W`
        : s.output_watts !== null
          ? `${s.name} out ${formatWattsValue(s.output_watts)} W`
          : null,
    )
    .filter(Boolean)

  return (
    <div className="h-full flex flex-col justify-center gap-1.5 min-w-0 overflow-hidden">
      <Headline
        value={formatWattsValue(total)}
        unit="W"
        tag={
          <>
            {estimated && (
              <span
                className="text-[9px] uppercase tracking-wider text-zinc-500 border border-zinc-700 rounded px-1"
                title="Derived from the UPS's load reading, not metered"
              >
                est.
              </span>
            )}
            <StaleBadge state={now} />
          </>
        }
      />
      {slices.length > 0 && total > 0 && (
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex h-2 w-full rounded-full overflow-hidden bg-zinc-700/40" aria-label="Where the wall power goes">
            {slices.map((s) => (
              <div key={s.name} className="h-full transition-all duration-500"
                style={{ width: `${(s.watts / total) * 100}%`, backgroundColor: s.color }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0">
            {slices.map((s) => (
              <span key={s.name} className="flex items-center gap-1" title={s.tip}>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-zinc-400">{s.name}</span>
                <span className="text-zinc-200">{s.est ? '~' : ''}{formatWattsValue(s.watts)} W</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <LiveStrip recent={now.recent as ReadonlyArray<{ at: number; data: PowerNow }>} />
      {readings.length > 0 && <FactLine>{readings.join(' · ')}</FactLine>}
    </div>
  )
}
