import { useLatestSnapshot, useMetricSeries } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { utilHeat, utilColor } from '@/lib/gpus'
import { formatUptime, TEMP_LIMITS, tempTone } from '@/lib/host'
import { NVIDIA_THEME } from '@/lib/theme'
import type { HostDoc } from '@/types/host'
import type { PanelContentProps } from '../../panelRegistry'
import { Headline, PowerStat } from '../power/PowerParts'
import { SeriesStrip } from '../tokens/TokenParts'

const PILL = 'text-[9px] uppercase tracking-wider border rounded px-1'

/**
 * The CPU at a glance, laid out like the Power page's UPS card: its load now as
 * the headline (tagged with the 5-minute load average and the uptime), the
 * processor's name and thread count, every core as a cell
 * coloured by its own load, then the die temperature (Tctl) with the hottest
 * CCD, the clocks, the load averages, and where the time goes (user, system,
 * waiting on I/O). Load and cores are the snapshot's, every second; the rest is
 * the power source's /host.
 */
export function HostCpuPanel({ panel }: PanelContentProps) {
  const snapshot = useLatestSnapshot()
  const doc = usePowerDocument<HostDoc>('host', POWER_POLL_MS.host)
  const series = useMetricSeries('cpuAggregate', panel.window)
  const cpu = snapshot?.cpu ?? null
  const d = doc.data
  const load = cpu?.aggregate_percent ?? null
  const cores = cpu?.per_core ?? []
  const ccdMax = d?.temps.ccd.length ? Math.max(...d.temps.ccd) : null
  const pct = (v: number | null | undefined) => (v != null ? v.toFixed(1) : '—')
  const name = [cpu?.name, d?.cpus ? `${d.cpus} threads` : null].filter(Boolean).join(' · ')

  return (
    <div className="h-full flex flex-col gap-1 min-w-0 overflow-hidden">
      <Headline value={load !== null ? Math.round(load) : '—'} unit="% CPU" color={utilColor(load)}
        tag={
          <>
            {d?.load['5'] != null && <span className={`${PILL} text-zinc-400 border-zinc-700`} title="5-minute load average">load {d.load['5'].toFixed(2)}</span>}
            {d?.uptime_s != null && <span className={`${PILL} text-zinc-400 border-zinc-700`} title="Time since the host booted">up {formatUptime(d.uptime_s)}</span>}
          </>
        } />
      {/* The processor's name between the headline and its cores: what the grid below is made of. */}
      {name && <span className="text-[10px] 2xl:text-xs font-mono text-zinc-400 truncate -mt-0.5">{name}</span>}
      {cores.length > 0 && (
        <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${Math.min(32, cores.length)}, minmax(0, 1fr))` }} aria-label="Load per core">
          {cores.map((c) => (
            <div key={c.id} className="h-2.5 rounded-[1px]" style={{ backgroundColor: utilHeat(c.usage_percent) }}
              aria-label={`core ${c.id} · ${Math.round(c.usage_percent)} %`} />
          ))}
        </div>
      )}
      <div className="mt-1 grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Tctl" value={d?.temps.tctl != null ? Math.round(d.temps.tctl) : '—'} unit="°C"
          color={tempTone(d?.temps.tctl, ...TEMP_LIMITS.tctl)} sub={ccdMax !== null ? `hottest CCD ${Math.round(ccdMax)}` : undefined} />
        <PowerStat label="Clock" value={d?.clock_mhz.avg != null ? (d.clock_mhz.avg / 1000).toFixed(2) : '—'} unit="GHz"
          sub={d?.clock_mhz.max != null ? `max ${(d.clock_mhz.max / 1000).toFixed(2)}` : undefined} />
        <PowerStat label="Load 1 m" value={d?.load['1'] != null ? d.load['1'].toFixed(2) : '—'}
          sub={d ? `5 m ${d.load['5']?.toFixed(2) ?? '—'} · 15 m ${d.load['15']?.toFixed(2) ?? '—'}` : undefined} />
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="User" value={pct(d?.cpu.user)} unit="%" />
        <PowerStat label="System" value={pct(d?.cpu.system)} unit="%" />
        <PowerStat label="I/O wait" value={pct(d?.cpu.iowait)} unit="%" color={(d?.cpu.iowait ?? 0) >= 10 ? NVIDIA_THEME.warning : undefined} />
      </div>
      <SeriesStrip points={series} color={NVIDIA_THEME.accent} label="CPU load, last few minutes"
        caption={<><span style={{ color: NVIDIA_THEME.accent }}>CPU</span>, last {panel.window}</>} />
    </div>
  )
}
