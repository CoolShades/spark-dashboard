import { useLatestSnapshot } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { navigateTo } from '@/hooks/useRoute'
import { maxOf } from '@/lib/host'
import { formatMoney, formatRuntimeShort, formatWattsValue, onBattery, UPS_STATUS_LABEL } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import { formatTokens } from '@/lib/tokens'
import type { GpuDoc } from '@/types/gpus'
import type { HostDoc } from '@/types/host'
import type { PowerNow } from '@/types/power'
import type { TokenDoc } from '@/types/tokens'

type Tone = 'ok' | 'warn' | 'bad' | 'idle'
const TONE: Record<Tone, string> = { ok: NVIDIA_THEME.accent, warn: NVIDIA_THEME.warning, bad: NVIDIA_THEME.critical, idle: '#a1a1aa' }

interface Tile {
  key: string
  label: string
  verdict: string
  tone: Tone
  detail: string
  /** The page that has the rest: the tile opens it. */
  page: string
}

/** One area's tile: its verdict in its colour and a line of detail; a button that opens the area's page. */
function HealthTile({ t }: { t: Tile }) {
  return (
    <button type="button" onClick={() => navigateTo(`/pages/${t.page}`)} aria-label={`${t.label}: ${t.verdict}`}
      className="group flex flex-col gap-1 min-w-0 rounded border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/40 px-2.5 py-2 text-left transition-colors"
      style={t.tone === 'bad' ? { borderColor: `${NVIDIA_THEME.critical}66` } : undefined}>
      <span className="flex items-center gap-1.5 text-[10px] 2xl:text-xs uppercase tracking-wider text-zinc-400">
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: TONE[t.tone], boxShadow: `0 0 6px ${TONE[t.tone]}` }} />
        {t.label}
        <span className="ml-auto text-zinc-600 group-hover:text-zinc-400">›</span>
      </span>
      <span className="text-sm 2xl:text-base font-bold font-mono tabular-nums leading-tight truncate" style={{ color: TONE[t.tone] }}>{t.verdict}</span>
      <span className="text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-500 truncate">{t.detail}</span>
    </button>
  )
}

/**
 * The whole machine's health in one row, for the overview: a tile per area
 * (the engine, the GPUs, the power at the wall and the UPS, the host, its
 * storage, the BMC and its services), each with its verdict in colour and a
 * line of detail, and a click through to the page that has the rest. Built
 * from the same documents the pages read, so it agrees with them.
 */
export function OverviewHealthPanel() {
  const snapshot = useLatestSnapshot()
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  const gpus = usePowerDocument<GpuDoc>('gpus', POWER_POLL_MS.gpus)
  const host = usePowerDocument<HostDoc>('host', POWER_POLL_MS.host)
  const tokens = usePowerDocument<TokenDoc>('tokens', POWER_POLL_MS.tokens)
  const tiles: Tile[] = []

  const engine = snapshot?.engines?.[0] ?? null
  const running = engine?.metrics?.active_requests ?? 0
  const state = engine?.status.type ?? null
  tiles.push({
    key: 'engine', label: 'Engine', page: 'tokens',
    verdict: !engine ? 'Not serving' : state !== 'Running' ? (state ?? '—') : running > 0 ? `${running} running` : 'Idle',
    tone: !engine ? 'bad' : state !== 'Running' ? 'warn' : running > 0 ? 'ok' : 'idle',
    detail: [engine?.model?.name, tokens.data ? `${formatTokens(tokens.data.today.output)} out today` : null].filter(Boolean).join(' · ') || '—',
  })

  const g = gpus.data?.gpus ?? []
  const faults = g.reduce((s, x) => s + (x.health ? (x.health.rollovers ?? 0) + (x.health.uncorrectable ?? 0) + (x.health.xid ?? 0) + ((x.health.slowdown_s ?? 0) > 0 ? 1 : 0) : 0), 0)
  const hot = maxOf((snapshot?.gpus ?? []).map((x) => x.temperature_celsius))
  const full = g.filter((x) => (x.health?.link_gen_max ?? 0) >= 4).length
  tiles.push({
    key: 'gpus', label: 'GPUs', page: 'gpus',
    verdict: g.length ? (faults ? `${faults} fault${faults > 1 ? 's' : ''}` : 'No faults') : `${snapshot?.gpus?.length ?? 0} GPUs`,
    tone: faults ? 'bad' : g.length ? 'ok' : 'idle',
    detail: [g.length ? `${full}/${g.length} at Gen4` : null, hot !== null ? `hottest ${Math.round(hot)} °C` : null].filter(Boolean).join(' · ') || '—',
  })

  const n = now.data
  tiles.push({
    key: 'power', label: 'Power', page: 'power',
    verdict: n?.total_watts != null ? `${formatWattsValue(n.total_watts)} W` : '—',
    tone: n?.total_watts != null ? 'ok' : 'idle',
    detail: n?.energy?.today_cost != null ? `${formatMoney(n.energy.today_cost, n.energy.currency)} today · ${n.cost_per_hour != null ? formatMoney(n.cost_per_hour, n.energy.currency) : '—'}/h` : '—',
  })
  const ups = n?.ups ?? null
  const batt = ups ? onBattery(ups.status) : false
  tiles.push({
    key: 'ups', label: 'UPS', page: 'power',
    verdict: ups ? UPS_STATUS_LABEL[ups.status] : '—',
    tone: !ups ? 'idle' : batt ? 'warn' : ups.status === 'online' ? 'ok' : 'bad',
    detail: ups ? `${ups.battery_percent != null ? `${Math.round(ups.battery_percent)} %` : '—'} · ${ups.runtime_seconds != null ? formatRuntimeShort(ups.runtime_seconds) : '—'} runtime` : '—',
  })

  const h = host.data
  const cpu = snapshot?.cpu?.aggregate_percent ?? null
  const mem = snapshot?.memory ? (snapshot.memory.used_bytes / snapshot.memory.total_bytes) * 100 : null
  tiles.push({
    key: 'host', label: 'Host', page: 'host',
    verdict: cpu !== null ? `CPU ${Math.round(cpu)} %` : '—',
    tone: cpu === null ? 'idle' : cpu >= 90 ? 'warn' : 'ok',
    detail: [h?.load['5'] != null ? `load ${h.load['5'].toFixed(2)}` : null, mem !== null ? `mem ${Math.round(mem)} %` : null].filter(Boolean).join(' · ') || '—',
  })
  const degraded = (h?.arrays ?? []).filter((a) => (a.map ?? '').includes('_') || (a.DisksFailed ?? 0) > 0).length
  const failing = (h?.drives ?? []).filter((d) => d.healthy === false).length
  tiles.push({
    key: 'storage', label: 'Storage', page: 'host',
    verdict: !h ? '—' : degraded ? 'Degraded' : failing ? 'Failing' : 'Healthy',
    tone: !h ? 'idle' : degraded || failing ? 'bad' : 'ok',
    detail: h ? `${h.drives.length} drives · ${h.arrays.map((a) => a.level ?? a.name).join(' + ')}` : '—',
  })
  const railsOff = (h?.rails ?? []).filter((r) => r.ok === false).length
  const checksBad = Object.entries(h?.bmc_flags ?? {}).filter(([k, v]) => ['watchdog2', 'memory_train_err'].includes(k) && v !== 'ok').length
  tiles.push({
    key: 'bmc', label: 'BMC', page: 'host',
    verdict: !h ? '—' : railsOff + checksBad ? `${railsOff + checksBad} out of range` : 'Nominal',
    tone: !h ? 'idle' : railsOff + checksBad ? 'bad' : 'ok',
    detail: h ? `${h.rails.length} rails · ${h.fans.length} fans` : '—',
  })
  const units = h?.units ?? []
  const containers = h?.containers ?? []
  const down = units.filter((u) => !(u.active === 'active' && u.sub === 'running')).length + containers.filter((c) => c.status !== 'running').length
  tiles.push({
    key: 'services', label: 'Services', page: 'host',
    verdict: !h ? '—' : down ? `${down} down` : 'All running',
    tone: !h ? 'idle' : down ? 'bad' : 'ok',
    detail: h ? `${units.length} units · ${containers.length} containers` : '—',
  })

  return (
    <div className="h-full grid grid-cols-4 xl:grid-cols-8 gap-2 content-center min-w-0 overflow-hidden" aria-label="Health by area">
      {tiles.map((t) => <HealthTile key={t.key} t={t} />)}
    </div>
  )
}
