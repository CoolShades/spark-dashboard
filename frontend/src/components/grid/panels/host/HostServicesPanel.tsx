import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatUptime } from '@/lib/host'
import { NVIDIA_THEME } from '@/lib/theme'
import type { HostDoc } from '@/types/host'
import { PowerNotice } from '../power/PowerParts'

const label = 'text-[9px] 2xl:text-[10px] uppercase tracking-wider text-zinc-500'

/** A status pill: a dot in the state's colour, then the name. */
function Pill({ name, ok, title }: { name: string; ok: boolean; title: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] 2xl:text-xs font-mono text-zinc-300 whitespace-nowrap" title={title}>
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ok ? NVIDIA_THEME.accent : NVIDIA_THEME.critical }} />
      {name}
    </span>
  )
}

/**
 * What runs on the host and how it is connected: how long it has been up and
 * whether the inference server answers its health check; the watched systemd
 * units and the Docker containers, a dot each (green running, red otherwise,
 * restarts noted); and the network links with their speed and the last day's
 * errors (red) and drops (counted, not alarmed: a NIC drops frames it was never
 * meant to take).
 */
export function HostServicesPanel() {
  const doc = usePowerDocument<HostDoc>('host', POWER_POLL_MS.host)
  const d = doc.data
  if (!d) return <PowerNotice state={doc} />
  const health = d.checks.find((c) => c.url?.includes('/health'))
  const units = d.units.map((u) => ({ ...u, ok: u.active === 'active' && u.sub === 'running' }))
  const containers = d.containers.map((c) => ({ ...c, ok: c.status === 'running' }))
  const down = units.filter((u) => !u.ok).length + containers.filter((c) => !c.ok).length

  return (
    <div className="h-full flex flex-col gap-1.5 min-w-0 overflow-hidden">
      <div className="flex items-baseline gap-3 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400 min-w-0">
        <span>up <span className="text-zinc-100">{formatUptime(d.uptime_s)}</span></span>
        {health && (
          <span>inference health <span style={{ color: health.code === 200 ? NVIDIA_THEME.accent : NVIDIA_THEME.critical }}>{health.code ?? '—'}</span></span>
        )}
        <span className="ml-auto" style={{ color: down ? NVIDIA_THEME.critical : NVIDIA_THEME.accent }}>
          {down ? `⚠ ${down} not running` : `✓ all ${units.length + containers.length} running`}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className={label}>Services</span>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {units.map((u) => <Pill key={u.name} name={u.name.replace(/\.service$/, '')} ok={u.ok} title={`${u.name}: ${u.active} (${u.sub})`} />)}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className={label}>Containers</span>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {containers.map((c) => (
            <Pill key={c.name} name={`${c.name}${c.restart_count ? ` ↻${c.restart_count}` : ''}`} ok={c.ok}
              title={`${c.name}: ${c.status}${c.uptime_ns ? `, up ${formatUptime(c.uptime_ns / 1e9)}` : ''}${c.restart_count ? `, ${c.restart_count} restarts` : ''}`} />
          ))}
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-0.5 min-w-0">
        <span className={label}>Network</span>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] 2xl:text-xs font-mono tabular-nums">
          {d.net.map((n) => {
            const up = n.up ?? (n.speed_mbps ?? -1) > 0
            return (
              <span key={n.interface} className="flex items-center gap-1.5 text-zinc-400 whitespace-nowrap">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: up ? NVIDIA_THEME.accent : '#52525b' }} />
                <span className="text-zinc-200">{n.interface}</span>
                {n.speed_mbps != null && n.speed_mbps > 0 && <span>{n.speed_mbps >= 1000 ? `${n.speed_mbps / 1000} GbE` : `${n.speed_mbps} Mb`}</span>}
                {(n.errors_24h ?? 0) > 0 && <span style={{ color: NVIDIA_THEME.critical }}>{n.errors_24h} errors</span>}
                {(n.drops_24h ?? 0) > 0 && <span className="text-zinc-500" title="Frames the NIC dropped in the last 24 h (often multicast or frames for no one here)">{n.drops_24h!.toLocaleString('en-GB')} drops</span>}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
