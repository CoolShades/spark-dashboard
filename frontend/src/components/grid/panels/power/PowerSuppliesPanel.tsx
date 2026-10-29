import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { LOAD_THRESHOLDS, railOutOfSpec } from '@/lib/power'
import { NVIDIA_THEME, thresholdColor } from '@/lib/theme'
import type { PowerNow, PowerSupply } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { FactLine, PowerNotice } from './PowerParts'

/** The figure a supply reports, and which side of it: some meter their input, some only their output. */
function reading(s: PowerSupply): { watts: number; side: string } | null {
  if (s.input_watts !== null) return { watts: s.input_watts, side: 'in' }
  if (s.output_watts !== null) return { watts: s.output_watts, side: 'out' }
  return null
}

/** A connector this close to its own over-current limit is worth a mention; below it, nobody needs the per-connector list. */
const CONNECTOR_WARN = LOAD_THRESHOLDS.warning / 100

/**
 * Everything a supply flags, for the ⚠ beside its name: its own condition, and
 * any 12 V connector running near its over-current limit (multi-rail mode).
 * None means no icon.
 */
function conditions(s: PowerSupply): string[] {
  const out = s.warning ? [s.warning] : []
  for (const c of s.connectors ?? []) {
    if (c.amps !== null && c.ocp_amps && c.amps >= c.ocp_amps * CONNECTOR_WARN) {
      out.push(`${c.name} at ${c.amps.toFixed(1)} A of its ${c.ocp_amps.toFixed(1)} A limit`)
    }
  }
  return out
}

function Supply({ s }: { s: PowerSupply }) {
  const r = reading(s)
  const flags = conditions(s)
  const share = r && s.capacity_watts ? (r.watts / s.capacity_watts) * 100 : null
  // Both sides known: say so, with the efficiency they imply. Input as current only: amps at volts (apparent VA).
  const both = s.input_watts !== null && s.output_watts !== null && s.input_watts > 0
  const va = !s.input_watts && s.input_amps != null && s.input_volts !== null ? s.input_amps * s.input_volts : null
  const facts = [
    both ? `out ${Math.round(s.output_watts!)} W · ${Math.round((s.output_watts! / s.input_watts!) * 100)} % efficient` : null,
    va !== null ? `in ${s.input_amps!.toFixed(1)} A at ${Math.round(s.input_volts!)} V (≈${Math.round(va)} VA)` : null,
    s.temperature_c !== null ? `${s.temperature_c.toFixed(1)} °C` : null,
    s.fan_rpm !== null ? (s.fan_rpm > 0 ? `fan ${Math.round(s.fan_rpm)} rpm` : 'fan off') : null,
    s.input_volts !== null && va === null ? `${Math.round(s.input_volts)} V in` : null,
    s.capacity_watts ? `${s.capacity_watts.toLocaleString('en-GB')} W rated` : null,
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-[10px] 2xl:text-xs text-zinc-400 uppercase tracking-wider truncate min-w-0">
          {s.name}{r ? ` · ${r.side}` : ''}
        </span>
        {flags.length > 0 && (
          <span role="img" aria-label={flags.join('; ')} title={flags.join('\n')} className="text-amber-400 text-[11px] leading-none cursor-help">⚠</span>
        )}
        {r && (
          <span className="ml-auto shrink-0 font-mono font-bold tabular-nums text-sm 2xl:text-lg text-zinc-100 leading-none">
            {Math.round(r.watts)}
            <span className="ml-0.5 text-[10px] text-zinc-500">W</span>
          </span>
        )}
      </div>
      {share !== null && (
        <div className="flex h-1.5 lg:h-2 w-full rounded-full overflow-hidden bg-zinc-700/40">
          <div className="h-full transition-all duration-500"
            style={{ width: `${Math.min(100, share)}%`, backgroundColor: thresholdColor(share, LOAD_THRESHOLDS.warning, LOAD_THRESHOLDS.critical) }} />
        </div>
      )}
      {facts.length > 0 && <FactLine>{facts.join(' · ')}</FactLine>}
      {s.rails && s.rails.length > 0 && (
        // One line per rail: voltage, current and the 24 h range (a sagging 12 V under load shows there first).
        <div className="grid gap-x-2 gap-y-0.5 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0" style={{ gridTemplateColumns: 'auto auto auto 1fr' }}>
          {s.rails.map((rl) => {
            const bad = railOutOfSpec(rl.volts, rl.nominal_volts) || railOutOfSpec(rl.volts_min_24h ?? null, rl.nominal_volts)
            return (
              <div key={rl.name} className="contents" title="Now, current, and the lowest-highest reading in the last 24 h; ATX allows ±5 %">
                <span className="text-zinc-400">{rl.name}</span>
                <span style={{ color: bad ? NVIDIA_THEME.critical : '#e4e4e7' }}>{rl.volts !== null ? `${rl.volts.toFixed(2)} V` : '—'}</span>
                <span className="text-zinc-500 text-right">{rl.amps !== null ? `${rl.amps.toFixed(1)} A` : ''}</span>
                <span className="text-zinc-500 truncate">
                  {rl.volts_min_24h != null && rl.volts_max_24h != null ? `24 h ${rl.volts_min_24h.toFixed(2)}–${rl.volts_max_24h.toFixed(2)}` : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * The power supplies side by side: each one's draw against its rating, the
 * side it meters, temperature, fan, its rails with their 24 h range, and a ⚠
 * carrying anything it flags (its own condition, or a 12 V connector near its
 * limit) in full on hover. No efficiency figure unless a supply meters both
 * sides.
 */
export function PowerSuppliesPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  if (!now.data) return <PowerNotice state={now} />
  const supplies = now.data.supplies
  if (supplies.length === 0) return <PanelNotice>No power supplies reported</PanelNotice>
  return (
    <div className="h-full grid gap-x-6 gap-y-3 min-w-0 overflow-hidden content-start"
      style={{ gridTemplateColumns: `repeat(${Math.min(supplies.length, 2)}, minmax(0, 1fr))` }}>
      {supplies.map((s) => <Supply key={s.name} s={s} />)}
    </div>
  )
}
