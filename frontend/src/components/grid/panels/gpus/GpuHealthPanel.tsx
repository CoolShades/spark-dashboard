import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatCount } from '@/lib/gpus'
import { formatClock, formatRuntime } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { GpuDoc, GpuExtra } from '@/types/gpus'
import { PanelNotice } from '../PanelNotice'
import { PowerNotice, StripFooter } from '../power/PowerParts'

/** A fault count: green at zero, red otherwise; "—" when the source does not report it. */
function Fault({ name, value, unit = '' }: { name: string; value: number | null | undefined; unit?: string }) {
  const bad = (value ?? 0) > 0
  return (
    <span className="whitespace-nowrap">
      {name} <span style={{ color: value == null ? '#a1a1aa' : bad ? NVIDIA_THEME.critical : NVIDIA_THEME.accent }}>
        {value == null ? '—' : unit === 's' ? (value > 0 ? formatRuntime(value) : '0') : formatCount(value)}
      </span>
    </span>
  )
}

/**
 * One GPU's last 24 h of trouble. Its verdict first: faults are what to act on
 * (replay rollovers, uncorrectable errors, Xids, a hardware slowdown); then the
 * link it trained to at best today and now; then the correctable errors, in
 * grey because the link retried each one and lost nothing (they matter only
 * as a trend); and any time the driver capped the clocks for heat.
 */
function GpuBlock({ g }: { g: GpuExtra }) {
  const h = g.health
  if (!h) {
    return (
      <div className="flex flex-col gap-1 min-w-0 rounded border border-zinc-800 p-2">
        <span className="text-[10px] 2xl:text-xs uppercase tracking-wider text-zinc-400">{g.label}</span>
        <span className="text-[10px] 2xl:text-xs font-mono text-zinc-500">health not computed yet</span>
      </div>
    )
  }
  const faults = (h.rollovers ?? 0) + (h.uncorrectable ?? 0) + (h.xid ?? 0) + ((h.slowdown_s ?? 0) > 0 ? 1 : 0)
  const best = h.link_gen_max != null ? `Gen${h.link_gen_max} x${h.link_width_max ?? '?'}` : null
  const now = g.pcie_gen != null ? `Gen${g.pcie_gen} x${g.pcie_width ?? '?'}` : null
  const narrower = h.link_width_max != null && g.pcie_width != null && g.pcie_width < h.link_width_max
  const boot = h.since_boot
  const title = [
    'Correctable errors are retried by the link and cost no data; faults are the ones to act on.',
    boot ? `Since the driver loaded: ${formatCount(boot.replays)} replays, ${formatCount(boot.retrains)} retrains, ${formatCount(boot.rollovers)} rollovers` : null,
    h.xid_last ? `Last Xid ${h.xid_last.code ?? '?'} at ${formatClock(Date.parse(h.xid_last.at))}` : null,
  ].filter(Boolean).join('\n')
  return (
    <div className="flex flex-col gap-1 min-w-0 rounded border p-2" style={{ borderColor: faults ? `${NVIDIA_THEME.critical}55` : '#27272a' }}
      aria-label={`${g.label} health`} title={title}>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-[10px] 2xl:text-xs uppercase tracking-wider text-zinc-300 truncate">{g.label}</span>
        <span className="ml-auto shrink-0 text-[10px] 2xl:text-xs font-mono font-medium"
          style={{ color: faults ? NVIDIA_THEME.critical : NVIDIA_THEME.accent }}>
          {faults ? `⚠ ${faults} fault${faults > 1 ? 's' : ''}` : '✓ no faults'}
        </span>
      </div>
      <div className="text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-300 truncate">
        {best ? <>link <span className="text-zinc-100">{best}</span> at best</> : 'link —'}
        {now && <span className={narrower ? 'text-amber-400' : 'text-zinc-500'}> · now {now}</span>}
      </div>
      <div className="flex flex-wrap gap-x-2 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400">
        <Fault name="rollovers" value={h.rollovers} />
        <Fault name="uncorrectable" value={h.uncorrectable} />
        <Fault name="Xid" value={h.xid} />
        <Fault name="HW slowdown" value={h.slowdown_s} unit="s" />
      </div>
      <div className="text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-500 truncate">
        correctable: {formatCount(h.replays)} replays · {formatCount(h.naks)} NAKs · {formatCount(h.retrains)} retrains · {formatCount(h.aer_corrected)} AER
      </div>
      {(h.thermal_s ?? 0) > 0 && (
        <div className="text-[10px] 2xl:text-xs font-mono tabular-nums text-amber-400/90 truncate">
          clocks capped for heat {formatRuntime(h.thermal_s!)}
        </div>
      )}
    </div>
  )
}

/**
 * The GPUs' PCIe links and faults over the last 24 hours, a block per card,
 * from the power source's /gpus document: what an operator checks after a
 * crash or before trusting a link at its current speed. Correctable errors are
 * shown, not alarmed on; faults turn the block red.
 */
export function GpuHealthPanel() {
  const doc = usePowerDocument<GpuDoc>('gpus', POWER_POLL_MS.gpus)
  if (!doc.data) return <PowerNotice state={doc} />
  const gpus = doc.data.gpus ?? []
  if (gpus.length === 0) return <PanelNotice>No GPUs reported</PanelNotice>
  const cols = Math.min(gpus.length, 2)
  return (
    <div className="h-full min-h-0 flex flex-col gap-1.5 min-w-0 overflow-hidden">
      <div className="grid gap-2 min-w-0 content-start" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {gpus.map((g) => <GpuBlock key={g.label} g={g} />)}
      </div>
      <StripFooter caption={<>last 24 h{doc.data.health_at ? ` · checked ${formatClock(Date.parse(doc.data.health_at))}` : ''}
        {doc.data.driver ? ` · driver ${doc.data.driver}` : ''} · correctable errors are retried by the link and cost no data</>}>
        <span />
      </StripFooter>
    </div>
  )
}
