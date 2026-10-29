import { useLatestSnapshot, useMetricSeries } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { gpuTempColor, heldBy, utilColor } from '@/lib/gpus'
import { gpuIndexOf, snapshotGpus } from '@/lib/identity'
import { gpuSeries } from '@/lib/metricsHistoryStore'
import { formatWattsValue, LOAD_THRESHOLDS } from '@/lib/power'
import { NVIDIA_THEME, thresholdColor } from '@/lib/theme'
import type { GpuDoc, GpuExtra } from '@/types/gpus'
import type { GpuMetrics } from '@/types/metrics'
import { PanelNotice } from '../PanelNotice'

const GIB = 2 ** 30
const PILL = 'text-[8px] 2xl:text-[9px] uppercase tracking-wider border rounded px-1 leading-tight'

/**
 * One GPU as a tile: its name and P-state (or what holds its clocks while it
 * works), its load as the big figure, its temperature, power against its limit
 * as a bar, VRAM, and a strip of its load over the last few minutes.
 */
function GpuTile({ g, x, multi }: { g: GpuMetrics; x: GpuExtra | undefined; multi: boolean }) {
  const i = gpuIndexOf(g)
  const series = useMetricSeries(gpuSeries('gpuUtil', i, multi), '5m')
  const load = g.utilization_percent
  const held = x ? heldBy(x.clock_reasons, load) : null
  const share = g.power_watts !== null && g.power_limit_watts ? (g.power_watts / g.power_limit_watts) * 100 : null
  const W = 100
  const H = 20
  const t0 = series[0]?.timestamp ?? 0
  const t1 = series[series.length - 1]?.timestamp ?? 1
  const path = series.length > 2
    ? series.map((p, k) => `${k ? 'L' : 'M'}${(((p.timestamp - t0) / Math.max(t1 - t0, 1)) * W).toFixed(1)},${(H - 1 - (Math.min(p.value, 100) / 100) * (H - 2)).toFixed(1)}`).join(' ')
    : null
  return (
    <div className="flex flex-col gap-1 min-w-0 min-h-0 rounded border border-zinc-800 px-2 py-1.5" aria-label={`GPU ${i}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[10px] 2xl:text-xs uppercase tracking-wider text-zinc-300 truncate">{x?.label ?? `GPU ${i}`}</span>
        {x?.pstate && <span className={`${PILL} ml-auto text-zinc-400 border-zinc-700`}>{x.pstate}</span>}
        {held && held.label !== 'idle' && <span className={PILL} style={{ color: held.color, borderColor: `${held.color}66` }}>{held.label}</span>}
      </div>
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-xl 2xl:text-2xl font-bold font-mono tabular-nums leading-none" style={{ color: utilColor(load) }}>
          {load !== null ? Math.round(load) : '—'}
        </span>
        <span className="text-[10px] 2xl:text-xs text-zinc-500">% load</span>
        <span className="ml-auto text-sm 2xl:text-base font-mono font-bold tabular-nums leading-none" style={{ color: gpuTempColor(g.temperature_celsius) }}>
          {g.temperature_celsius !== null ? `${Math.round(g.temperature_celsius)}°` : '—'}
        </span>
      </div>
      {share !== null && (
        <div className="h-1.5 rounded-full overflow-hidden bg-zinc-700/40" aria-label={`GPU ${i} power ${Math.round(share)} % of its limit`}>
          <div className="h-full transition-all duration-500" style={{ width: `${Math.min(100, share)}%`, backgroundColor: thresholdColor(share, LOAD_THRESHOLDS.warning, LOAD_THRESHOLDS.critical) }} />
        </div>
      )}
      <div className="flex items-baseline gap-2 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400 min-w-0">
        <span><span className="text-zinc-200">{g.power_watts !== null ? formatWattsValue(g.power_watts) : '—'}</span> W</span>
        <span className="truncate">{g.memory_used_bytes != null && g.memory_total_bytes ? `${(g.memory_used_bytes / GIB).toFixed(1)} / ${(g.memory_total_bytes / GIB).toFixed(0)} GB` : ''}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full flex-1 min-h-3" aria-label={`GPU ${i} load, last few minutes`}>
        {path && <path d={path} fill="none" stroke={NVIDIA_THEME.accent} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  )
}

/**
 * Every GPU in one card, for the overview: a tile each (load, temperature,
 * power against its limit, VRAM, and a strip of its load over the last few
 * minutes, all the snapshot's, every second; its P-state from the power
 * source), under the totals (board power, VRAM) and the last day's verdict from
 * the GPUs page's health (faults are rollovers, uncorrectable errors, Xids and
 * hardware slowdowns). The GPUs page has the rest.
 */
export function GpuSummaryPanel() {
  const snapshot = useLatestSnapshot()
  const doc = usePowerDocument<GpuDoc>('gpus', POWER_POLL_MS.gpus)
  const gpus = snapshot ? snapshotGpus(snapshot) : []
  if (gpus.length === 0) return <PanelNotice>Waiting for metrics</PanelNotice>
  const extra = new Map((doc.data?.gpus ?? []).map((g) => [g.index, g]))
  const watts = gpus.reduce((s, g) => s + (g.power_watts ?? 0), 0)
  const used = gpus.reduce((s, g) => s + (g.memory_used_bytes ?? 0), 0)
  const total = gpus.reduce((s, g) => s + (g.memory_total_bytes ?? 0), 0)
  const faults = (doc.data?.gpus ?? []).reduce((s, g) => {
    const h = g.health
    return s + (h ? (h.rollovers ?? 0) + (h.uncorrectable ?? 0) + (h.xid ?? 0) + ((h.slowdown_s ?? 0) > 0 ? 1 : 0) : 0)
  }, 0)
  const known = (doc.data?.gpus ?? []).some((g) => g.health)
  const cols = gpus.length > 1 ? 2 : 1

  return (
    <div className="h-full flex flex-col gap-1.5 min-w-0 overflow-hidden">
      <div className="flex items-baseline gap-3 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400 min-w-0">
        <span><span className="text-zinc-100">{formatWattsValue(watts)} W</span> board power</span>
        {total > 0 && <span><span className="text-zinc-100">{(used / GIB).toFixed(0)}</span> / {(total / GIB).toFixed(0)} GB VRAM</span>}
        {known && (
          <span className="ml-auto" style={{ color: faults ? NVIDIA_THEME.critical : NVIDIA_THEME.accent }}>
            {faults ? `⚠ ${faults} fault${faults > 1 ? 's' : ''}, 24 h` : '✓ no faults, 24 h'}
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 grid gap-1.5 min-w-0" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: 'minmax(0, 1fr)' }}>
        {gpus.map((g) => <GpuTile key={gpuIndexOf(g)} g={g} x={extra.get(gpuIndexOf(g))} multi={gpus.length > 1} />)}
      </div>
    </div>
  )
}
