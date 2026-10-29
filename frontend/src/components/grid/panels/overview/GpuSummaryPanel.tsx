import { useLatestSnapshot } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { gpuTempColor, heldBy, utilColor } from '@/lib/gpus'
import { gpuIndexOf, snapshotGpus } from '@/lib/identity'
import { formatWattsValue } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { GpuDoc } from '@/types/gpus'
import { PanelNotice } from '../PanelNotice'

const GIB = 2 ** 30

/**
 * Every GPU in one card, for the overview: a row each with its slot, its load
 * as a bar, its power and temperature (the snapshot's, every second) and its
 * P-state or what holds its clocks; above them the totals (power, VRAM) and the
 * last day's verdict from the GPUs page's health (faults are rollovers,
 * uncorrectable errors, Xids and hardware slowdowns). The GPUs page has the rest.
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
      <div className="flex-1 min-h-0 grid gap-x-2.5 gap-y-1 content-around items-center text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0"
        style={{ gridTemplateColumns: 'auto minmax(0, 1fr) 2.5rem 3.25rem 2.75rem auto' }}>
        {gpus.map((g) => {
          const i = gpuIndexOf(g)
          const x = extra.get(i)
          const load = g.utilization_percent
          const held = x ? heldBy(x.clock_reasons, load) : null
          return (
            <div key={i} className="contents" aria-label={`GPU ${i}`}>
              <span className="text-zinc-300 whitespace-nowrap">{x?.label ?? `GPU ${i}`}</span>
              <div className="h-2 rounded-full overflow-hidden bg-zinc-700/40 min-w-0" aria-label={`GPU ${i} load ${Math.round(load ?? 0)} %`}>
                <div className="h-full transition-all duration-500" style={{ width: `${Math.min(100, load ?? 0)}%`, backgroundColor: utilColor(load) }} />
              </div>
              <span className="text-right" style={{ color: utilColor(load) }}>{load !== null ? `${Math.round(load)}%` : '—'}</span>
              <span className="text-right text-zinc-200">{g.power_watts !== null ? `${formatWattsValue(g.power_watts)} W` : '—'}</span>
              <span className="text-right" style={{ color: gpuTempColor(g.temperature_celsius) }}>
                {g.temperature_celsius !== null ? `${Math.round(g.temperature_celsius)}°` : '—'}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-right whitespace-nowrap" style={{ color: held?.label === 'idle' || !held ? '#71717a' : held.color }}>
                {[x?.pstate, held && held.label !== 'idle' ? held.label : null].filter(Boolean).join(' · ') || ''}
              </span>
            </div>
          )
        })}
      </div>
      <p className="shrink-0 text-[10px] 2xl:text-xs text-zinc-500 font-mono truncate">load · power · temperature now · P-state</p>
    </div>
  )
}
