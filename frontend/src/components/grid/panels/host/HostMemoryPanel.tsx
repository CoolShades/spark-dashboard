import { useLatestSnapshot, useMetricSeries } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { bytesParts, maxOf, TEMP_LIMITS, tempTone } from '@/lib/host'
import { NVIDIA_THEME } from '@/lib/theme'
import type { HostDoc } from '@/types/host'
import type { PanelContentProps } from '../../panelRegistry'
import { Headline, PowerStat } from '../power/PowerParts'
import { SeriesStrip } from '../tokens/TokenParts'

const CACHE = '#38bdf8'
const FREE = '#3f3f46'
const PILL = 'text-[9px] uppercase tracking-wider border rounded px-1'

/**
 * Memory, laid out like the wall card: what is used as the headline, a bar of
 * used, page cache and free (the cache gives way to programs, so "available" is
 * used's real headroom), then what is available, the cache, swap, the memory
 * committed against the kernel's limit, the hottest DIMM, and the BMC's memory
 * training check. Used and the strip are the snapshot's; the rest is /host.
 */
export function HostMemoryPanel({ panel }: PanelContentProps) {
  const snapshot = useLatestSnapshot()
  const doc = usePowerDocument<HostDoc>('host', POWER_POLL_MS.host)
  const series = useMetricSeries('memoryUsedPercent', panel.window)
  const m = snapshot?.memory ?? null
  const d = doc.data
  const total = m?.total_bytes ?? d?.memory.total ?? null
  const used = m?.used_bytes ?? d?.memory.used ?? null
  const cache = (d?.memory.cached ?? m?.cached_bytes ?? 0) + (d?.memory.buffered ?? 0)
  const free = total !== null && used !== null ? Math.max(0, total - used - cache) : null
  const u = bytesParts(used)
  const t = bytesParts(total)
  const dimm = maxOf(d?.temps.dimm.map((x) => x.c) ?? [])
  const swapUsed = d?.memory.swap_used ?? null
  const training = d?.bmc_flags.memory_train_err ?? null
  const slices = total ? [
    { name: 'used', v: used ?? 0, color: NVIDIA_THEME.accent },
    { name: 'cache', v: cache, color: CACHE },
    { name: 'free', v: free ?? 0, color: FREE },
  ] : []

  return (
    <div className="h-full flex flex-col gap-1 min-w-0 overflow-hidden">
      <Headline value={u.value} unit={`${u.unit} used of ${t.value} ${t.unit}`}
        tag={total && used !== null ? <span className={`${PILL} text-zinc-400 border-zinc-700`}>{Math.round((used / total) * 100)} %</span> : undefined} />
      {slices.length > 0 && (
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex h-2 w-full rounded-full overflow-hidden bg-zinc-700/40" aria-label="Used, cache and free memory">
            {slices.map((s) => <div key={s.name} className="h-full transition-all duration-500" style={{ width: `${(s.v / total!) * 100}%`, backgroundColor: s.color }} />)}
          </div>
          <div className="flex flex-wrap gap-x-3 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0">
            {slices.map((s) => {
              const p = bytesParts(s.v)
              return (
                <span key={s.name} className="flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color === FREE ? '#71717a' : s.color }} />
                  <span className="text-zinc-400">{s.name}</span><span className="text-zinc-200">{p.value} {p.unit}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}
      <div className="mt-1 grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Available" value={bytesParts(d?.memory.available ?? m?.available_bytes).value} unit={bytesParts(d?.memory.available ?? m?.available_bytes).unit}
          sub="used + free-able" />
        <PowerStat label="Committed" value={bytesParts(d?.memory.committed_as).value} unit={bytesParts(d?.memory.committed_as).unit}
          sub={d?.memory.commit_limit ? `of ${bytesParts(d.memory.commit_limit).value} ${bytesParts(d.memory.commit_limit).unit} limit` : undefined} />
        <PowerStat label="Swap" value={bytesParts(swapUsed).value} unit={bytesParts(swapUsed).unit}
          sub={d?.memory.swap_total ? `of ${bytesParts(d.memory.swap_total).value} ${bytesParts(d.memory.swap_total).unit}` : undefined} />
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="DIMMs" value={dimm !== null ? Math.round(dimm) : '—'} unit="°C" color={tempTone(dimm, ...TEMP_LIMITS.dimm)}
          sub={d?.temps.dimm.length ? `hottest of ${d.temps.dimm.length}` : undefined} />
        <PowerStat label="Dirty" value={bytesParts(d?.memory.dirty).value} unit={bytesParts(d?.memory.dirty).unit} sub="waiting to write" />
        <PowerStat label="Training" value={training ?? '—'} color={training === 'ok' ? NVIDIA_THEME.accent : training ? NVIDIA_THEME.critical : undefined}
          sub="BMC memory check" />
      </div>
      <SeriesStrip points={series} color={NVIDIA_THEME.accent} label="Memory used, last few minutes"
        caption={<><span style={{ color: NVIDIA_THEME.accent }}>used</span> %, last {panel.window}</>} />
    </div>
  )
}
