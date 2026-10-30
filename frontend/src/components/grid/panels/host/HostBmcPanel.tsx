import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import type { DataPoint } from '@/lib/metricsHistoryStore'
import { NVIDIA_THEME } from '@/lib/theme'
import type { HostDoc, HostHistory } from '@/types/host'
import { Headline, PowerNotice } from '../power/PowerParts'
import { SeriesStrip } from '../tokens/TokenParts'

const PILL = 'text-[9px] uppercase tracking-wider border rounded px-1'

/** A rail's deviation colour: green within 3 % of nominal, amber to 5 % (ATX's limit), red beyond. */
function deviationColor(pct: number): string {
  const a = Math.abs(pct)
  if (a > 5) return NVIDIA_THEME.critical
  if (a > 3) return NVIDIA_THEME.warning
  return NVIDIA_THEME.accent
}

/** A rail's name for a tight grid: "+3.3v_alw" -> "+3.3V alw", "+cpu_1.8v_s5" -> "CPU 1.8V S5". */
function railName(n: string): string {
  return n.replace(/^\+/, '+').replace(/v(_|$)/g, 'V$1').replace(/_/g, ' ').replace(/^\+cpu/i, 'CPU').replace(/^\+(?=[a-z])/i, '')
    .replace(/\b(pch|soc|vsoc|vcore|vddio|cldo|alw|s5|vbat)\b/gi, (w) => w.toUpperCase())
}

/** What the BMC's discrete sensors say, in words, the PSU lines as one (an ATX supply is not wired to the BMC). */
function discrete(flags: Record<string, string>): Array<{ name: string; state: string; ok: boolean | null }> {
  const out: Array<{ name: string; state: string; ok: boolean | null }> = []
  const say = (k: string, name: string) => {
    if (!(k in flags)) return
    const v = flags[k]
    out.push({ name, state: v.replace(/_/g, ' '), ok: v === 'ok' ? true : v === 'presence_detected' ? null : false })
  }
  say('watchdog2', 'watchdog')
  say('memory_train_err', 'memory training')
  say('cpu_ecc', 'CPU ECC')
  const psu = Object.entries(flags).filter(([k]) => /^(psu\d|pmbpower)/.test(k))
  if (psu.length) {
    const read = psu.filter(([, v]) => v !== 'no_reading')
    out.push(read.length
      ? { name: 'PSU lines', state: read.map(([k, v]) => `${k} ${v}`).join(', '), ok: read.every(([, v]) => v === 'ok') }
      : { name: 'PSU lines', state: 'not wired to the BMC', ok: null })
  }
  return out
}

/**
 * The BMC (the board's management controller, read over IPMI): its verdict as
 * the headline (every rail within ±5 % of nominal and every discrete sensor
 * ok, or what is not), every voltage rail with its deviation from nominal, the
 * BMC's own checks (watchdog, memory training, ECC, the PSU lines), and a strip
 * of the +12 V rail's low points over the last day. The temperatures and fans
 * it also reads are on the Thermals card.
 */
export function HostBmcPanel() {
  const doc = usePowerDocument<HostDoc>('host', POWER_POLL_MS.host)
  const history = usePowerDocument<HostHistory>('host-history?hours=24', POWER_POLL_MS.hostHistory)
  const d = doc.data
  if (!d) return <PowerNotice state={doc} />
  const checks = discrete(d.bmc_flags)
  const off = d.rails.filter((r) => r.ok === false)
  const bad = checks.filter((c) => c.ok === false)
  const ok = off.length === 0 && bad.length === 0
  const sensors = d.rails.length + d.fans.length + d.temps.dimm.length + d.temps.slots.length + d.temps.board.length + checks.length
  const v12: DataPoint[] = (history.data?.points ?? []).filter((p) => p.v12 != null).map((p) => ({ timestamp: p.t, value: p.v12! }))
  const lo = v12.length ? Math.min(...v12.map((p) => p.value)) : null
  const hi = v12.length ? Math.max(...v12.map((p) => p.value)) : null

  return (
    <div className="h-full flex flex-col gap-1.5 min-w-0 overflow-hidden">
      <Headline value={ok ? 'Nominal' : `${off.length + bad.length} out of range`} color={ok ? NVIDIA_THEME.accent : NVIDIA_THEME.critical}
        tag={<span className={`${PILL} text-zinc-400 border-zinc-700`}>{sensors} sensors</span>} />
      <div className="grid gap-x-4 gap-y-0.5 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {d.rails.map((r) => {
          const pct = r.nominal ? ((r.volts - r.nominal) / r.nominal) * 100 : null
          return (
            <div key={r.name} className="flex items-baseline gap-2 min-w-0" aria-label={`${r.name} ${r.volts.toFixed(2)} V`}>
              <span className="text-zinc-400 truncate">{railName(r.name)}</span>
              <span className="ml-auto text-zinc-100">{r.volts.toFixed(2)}</span>
              <span className="w-12 text-right" style={{ color: pct === null ? '#52525b' : deviationColor(pct) }}>
                {pct === null ? '—' : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] 2xl:text-xs font-mono min-w-0">
        {checks.map((c) => (
          <span key={c.name} className="flex items-center gap-1 text-zinc-400 whitespace-nowrap">
            <span className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: c.ok === true ? NVIDIA_THEME.accent : c.ok === false ? NVIDIA_THEME.critical : '#52525b' }} />
            {c.name} <span className={c.ok === false ? 'text-red-400' : 'text-zinc-500'}>{c.state}</span>
          </span>
        ))}
      </div>
      <SeriesStrip points={v12} color={NVIDIA_THEME.accent} label="+12 V rail, last 24 h" format={(v) => `${v.toFixed(2)} V`}
        caption={<><span style={{ color: NVIDIA_THEME.accent }}>+12 V</span> rail, 24 h{lo !== null && hi !== null ? ` · ${lo.toFixed(2)}–${hi.toFixed(2)} V` : ''}</>} />
    </div>
  )
}
