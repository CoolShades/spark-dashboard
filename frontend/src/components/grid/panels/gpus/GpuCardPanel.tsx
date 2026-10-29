import { useMetricSeries } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { tempColor } from '@/lib/format'
import { heldBy, rateParts, shortGpuName, utilColor } from '@/lib/gpus'
import { gpuIndexOf } from '@/lib/identity'
import type { DataPoint } from '@/lib/metricsHistoryStore'
import { formatWattsValue, LOAD_THRESHOLDS } from '@/lib/power'
import { NVIDIA_THEME, thresholdColor } from '@/lib/theme'
import type { GpuDoc, GpuHistory } from '@/types/gpus'
import { usePanelDevice } from '../../panelDevice'
import type { PanelContentProps } from '../../panelRegistry'
import { GpuPanelNotice } from '../PanelNotice'
import { useGpuPanel } from '../useGpuPanel'
import { FactLine, Headline, PowerStat, StripFooter } from '../power/PowerParts'

const GIB = 2 ** 30
const POWER_LINE = '#a1a1aa'

/** The card's strip: load (0-100 %) and power (0 to the limit) over the panel's window, each on its own scale. */
function Strip({ util, power, limit, window }: { util: DataPoint[]; power: DataPoint[]; limit: number | null; window: string }) {
  const all = [...util, ...power]
  if (util.length < 3) return null
  const t0 = Math.min(...all.map((p) => p.timestamp))
  const t1 = Math.max(...all.map((p) => p.timestamp))
  const W = 300
  const H = 40
  const top = limit ?? Math.max(...power.map((p) => p.value), 1)
  const path = (pts: DataPoint[], max: number) =>
    pts
      .map((p, i) => `${i ? 'L' : 'M'}${(((p.timestamp - t0) / Math.max(t1 - t0, 1)) * W).toFixed(1)},${(H - 1 - (Math.min(p.value, max) / max) * (H - 2)).toFixed(1)}`)
      .join(' ')
  return (
    <StripFooter caption={<><span style={{ color: NVIDIA_THEME.accent }}>load</span> · <span className="text-zinc-400">power</span>, last {window}</>}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-6" aria-label="Load and power, last few minutes">
        {power.length > 1 && <path d={path(power, top)} fill="none" stroke={POWER_LINE} strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        <path d={path(util, 100)} fill="none" stroke={NVIDIA_THEME.accent} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </StripFooter>
  )
}

/**
 * One GPU at a glance, laid out like the Power page's UPS card. The headline is
 * its load, tagged with its P-state and what is holding its clocks (an idle
 * card reads "idle", whatever NVML flags); a bar of its power against its
 * limit; three rows of three (power, temperature with today's peak, fan; SM
 * clock, VRAM, memory-bus load; PCIe link with the best it trained to today,
 * RX, TX); its model, VBIOS and bus; and a strip of load and power over the
 * panel's window. The live figures are this dashboard's own NVML snapshot,
 * every second; the P-state, held reasons, link and memory-bus load come from
 * the power source's /gpus document, every 5 s, and appear when it has one.
 */
export function GpuCardPanel({ panel }: PanelContentProps) {
  const resolution = useGpuPanel(panel)
  const doc = usePowerDocument<GpuDoc>('gpus', POWER_POLL_MS.gpus)
  const history = usePowerDocument<GpuHistory>('gpu-history?hours=24', POWER_POLL_MS.gpuHistory)
  // Called above the early return with a stand-in key, like every hook here: an unresolved binding has no series.
  const seriesFor = resolution.status === 'resolved' ? resolution.seriesFor : null
  const util = useMetricSeries(seriesFor ? seriesFor('gpuUtil') : 'gpuUtil', panel.window)
  const power = useMetricSeries(seriesFor ? seriesFor('gpuPower') : 'gpuPower', panel.window)
  usePanelDevice(resolution.status === 'resolved' ? resolution.gpu.name : null)
  if (resolution.status !== 'resolved') return <GpuPanelNotice resolution={resolution} />

  const g = resolution.gpu
  const index = gpuIndexOf(g)
  const extra = doc.data?.gpus?.find((x) => x.index === index) ?? null
  const summary = history.data?.summary?.find((s) => s.index === index) ?? null
  const load = g.utilization_percent
  const held = extra ? heldBy(extra.clock_reasons, load) : null
  const limit = g.power_limit_watts
  const share = g.power_watts !== null && limit ? (g.power_watts / limit) * 100 : null
  const used = g.memory_used_bytes ?? null
  const total = g.memory_total_bytes ?? null
  const health = extra?.health ?? null
  const linkBest = health?.link_gen_max != null ? `Gen${health.link_gen_max} x${health.link_width_max ?? '?'}` : null
  const linkNow = extra?.pcie_gen != null ? `Gen${extra.pcie_gen}` : null
  const rx = rateParts(g.pcie_rx_bytes_per_sec)
  const tx = rateParts(g.pcie_tx_bytes_per_sec)
  const facts = [shortGpuName(g.name), extra?.vbios ? `VBIOS ${extra.vbios}` : null, extra?.bus ?? null].filter(Boolean)
  const pill = 'text-[9px] uppercase tracking-wider border rounded px-1'

  return (
    <div className="h-full flex flex-col gap-1 min-w-0 overflow-hidden">
      <Headline
        value={load !== null ? Math.round(load) : '—'}
        unit="% load"
        color={utilColor(load)}
        tag={
          <>
            {extra?.pstate && (
              <span className={`${pill} text-zinc-400 border-zinc-700`} title="Performance state: P0 is full speed, P8 idle">
                {extra.pstate}
              </span>
            )}
            {held && (
              <span className={pill} style={{ color: held.color, borderColor: `${held.color}66` }}
                title={extra!.clock_reasons.length ? `Clocks held by: ${extra!.clock_reasons.join(', ')}` : 'Nothing is holding the clocks'}>
                {held.label}
              </span>
            )}
          </>
        }
      />
      {share !== null && (
        <div className="flex h-2 w-full rounded-full overflow-hidden bg-zinc-700/40" aria-label={`Power, ${Math.round(share)} % of the limit`}>
          <div className="h-full transition-all duration-500"
            style={{ width: `${Math.min(100, share)}%`, backgroundColor: thresholdColor(share, LOAD_THRESHOLDS.warning, LOAD_THRESHOLDS.critical) }} />
        </div>
      )}

      <div className="mt-1 grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Power" value={g.power_watts !== null ? formatWattsValue(g.power_watts) : '—'} unit="W"
          sub={limit ? `of ${formatWattsValue(limit)} W` : undefined} />
        <PowerStat label="Temp" value={g.temperature_celsius !== null ? Math.round(g.temperature_celsius) : '—'} unit="°C"
          color={tempColor(g.temperature_celsius)} sub={summary?.temp_max != null ? `max ${Math.round(summary.temp_max)} today` : undefined} />
        <PowerStat label="Fan" value={g.fan_speed_percent !== null ? Math.round(g.fan_speed_percent) : '—'} unit="%"
          sub={g.fan_speed_percent === 0 ? 'stopped' : undefined} />
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="SM clock" value={g.clock_sm_mhz !== null ? formatWattsValue(g.clock_sm_mhz) : '—'} unit="MHz"
          sub={g.clock_memory_mhz !== null ? `mem ${formatWattsValue(g.clock_memory_mhz)}` : undefined} />
        <PowerStat label="VRAM" value={used !== null ? (used / GIB).toFixed(1) : '—'} unit="GB"
          sub={total ? `of ${(total / GIB).toFixed(1)} · ${Math.round(((used ?? 0) / total) * 100)} %` : undefined} />
        <PowerStat label="Mem bus" value={extra?.memory_util_percent != null ? Math.round(extra.memory_util_percent) : '—'} unit="%"
          sub={extra?.memory_util_percent != null ? 'controller load' : undefined} />
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <div className="min-w-0" title="An idle card trains its link down to Gen1; under load it should reach the best shown here">
          <PowerStat label="PCIe" value={linkNow ?? '—'} unit={extra?.pcie_width != null ? `x${extra.pcie_width}` : undefined}
            sub={linkBest ? `${linkBest} today` : undefined} />
        </div>
        <PowerStat label="RX" value={rx.value} unit={rx.unit} />
        <PowerStat label="TX" value={tx.value} unit={tx.unit} />
      </div>
      {facts.length > 0 && <FactLine>{facts.join(' · ')}</FactLine>}
      <Strip util={util} power={power} limit={limit} window={panel.window} />
    </div>
  )
}
