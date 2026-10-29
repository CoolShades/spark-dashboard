import { useLatestSnapshot } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatWattsValue, splitWall, sumGpuWatts } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { PowerNow } from '@/types/power'
import { usePanelDevice } from '../../panelDevice'
import { PanelNotice } from '../PanelNotice'
import { FactLine, Headline, PowerNotice, StaleBadge } from './PowerParts'

const REST_COLOR = '#71717a'

/**
 * The whole machine at the wall, and how much of it is the GPUs. The wall
 * figure is the power source's; the GPU figure is this dashboard's own NVML
 * reading, so the split needs no extra plumbing — "rest" is what the cards do
 * not account for: CPU, memory, disks, fans and the supplies' own losses.
 */
export function PowerWallPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  const snapshot = useLatestSnapshot()
  usePanelDevice(now.data?.total_source ?? null)
  if (!now.data) return <PowerNotice state={now} />

  const { total_watts: total, total_estimated: estimated, supplies } = now.data
  if (total === null) return <PanelNotice>Wall power not reported</PanelNotice>
  const split = splitWall(total, sumGpuWatts(snapshot?.gpus))
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
    <div className="h-full flex flex-col justify-center gap-2 min-w-0 overflow-hidden">
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
      {split && total > 0 && (
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex h-2 w-full rounded-full overflow-hidden bg-zinc-700/40" aria-label="GPUs and the rest of the system">
            <div className="h-full transition-all duration-500" style={{ width: `${(split.gpus / total) * 100}%`, backgroundColor: NVIDIA_THEME.accent }} />
            <div className="h-full transition-all duration-500" style={{ width: `${(split.rest / total) * 100}%`, backgroundColor: REST_COLOR }} />
          </div>
          <div className="flex gap-3 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0">
            <span className="flex items-center gap-1 truncate">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: NVIDIA_THEME.accent }} />
              <span className="text-zinc-400">GPUs</span>
              <span className="text-zinc-200">{formatWattsValue(split.gpus)} W</span>
            </span>
            <span className="flex items-center gap-1 truncate" title="CPU, memory, disks, fans and the power supplies' losses">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: REST_COLOR }} />
              <span className="text-zinc-400">Rest</span>
              <span className="text-zinc-200">{formatWattsValue(split.rest)} W</span>
            </span>
          </div>
        </div>
      )}
      {readings.length > 0 && <FactLine>{readings.join(' · ')}</FactLine>}
    </div>
  )
}
