import { HBar } from '@/components/gauges/HBar'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { LOAD_THRESHOLDS } from '@/lib/power'
import type { PowerNow, PowerSupply } from '@/types/power'
import { PanelNotice } from '../PanelNotice'
import { FactLine, PowerNotice } from './PowerParts'

/** The figure a supply reports, and which side of it: some meter their input, some only their output. */
function reading(s: PowerSupply): { watts: number; side: string } | null {
  if (s.input_watts !== null) return { watts: s.input_watts, side: 'in' }
  if (s.output_watts !== null) return { watts: s.output_watts, side: 'out' }
  return null
}

/**
 * Each power supply: its draw against its rating, temperature, fan, and any
 * condition it flags. No efficiency figure: a supply that meters only one
 * rail on its output side would show a "loss" that is really the other rails.
 */
export function PowerSuppliesPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  if (!now.data) return <PowerNotice state={now} />
  const supplies = now.data.supplies
  if (supplies.length === 0) return <PanelNotice>No power supplies reported</PanelNotice>

  return (
    <div className="h-full flex flex-col justify-center gap-3 min-w-0 overflow-hidden">
      {supplies.map((s) => {
        const r = reading(s)
        const facts = [
          s.temperature_c !== null ? `${s.temperature_c.toFixed(1)} °C` : null,
          s.fan_rpm !== null ? (s.fan_rpm > 0 ? `fan ${Math.round(s.fan_rpm)} rpm` : 'fan off') : null,
          s.input_volts !== null ? `${Math.round(s.input_volts)} V in` : null,
          s.capacity_watts ? `${s.capacity_watts.toLocaleString('en-GB')} W rated` : null,
        ].filter(Boolean)
        return (
          <div key={s.name} className="flex flex-col gap-1 min-w-0">
            {r ? (
              <HBar
                label={`${s.name} · ${r.side}`}
                unit="W"
                value={s.capacity_watts ? (r.watts / s.capacity_watts) * 100 : 0}
                displayValue={r.watts}
                thresholds={LOAD_THRESHOLDS}
              />
            ) : (
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">{s.name}</span>
            )}
            {facts.length > 0 && <FactLine>{facts.join(' · ')}</FactLine>}
            {s.warning && <p className="text-[10px] 2xl:text-xs text-amber-400 truncate" title={s.warning}>⚠ {s.warning}</p>}
          </div>
        )
      })}
    </div>
  )
}
