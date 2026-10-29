import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatClock, formatWattsValue, LOAD_THRESHOLDS, railOutOfSpec } from '@/lib/power'
import { NVIDIA_THEME, thresholdColor } from '@/lib/theme'
import type { PowerHistory, PowerNow, PowerSupply } from '@/types/power'
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
/** A supply with readings for less of the window than this says since when, rather than "24 h". */
const FULL_WINDOW = 0.95

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

/**
 * One supply as five cells of the panel's grid (name and figure, share of the
 * rating, facts, rails, 24 h chart), so the same row of two supplies lines up
 * even when one has more to say.
 */
function Supply({ s, history }: { s: PowerSupply; history: PowerHistory | null }) {
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
    <>
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
      {share !== null ? (
        <div className="flex h-1.5 lg:h-2 w-full rounded-full overflow-hidden bg-zinc-700/40">
          <div className="h-full transition-all duration-500"
            style={{ width: `${Math.min(100, share)}%`, backgroundColor: thresholdColor(share, LOAD_THRESHOLDS.warning, LOAD_THRESHOLDS.critical) }} />
        </div>
      ) : <div />}
      {facts.length > 0 ? <FactLine>{facts.join(' · ')}</FactLine> : <div />}
      {s.rails && s.rails.length > 0 ? (
        // One line per rail: voltage, current and the 24 h range (a sagging 12 V under load shows there first).
        <div className="grid gap-x-2 gap-y-0.5 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0 content-start" style={{ gridTemplateColumns: 'auto auto auto 1fr' }}>
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
      ) : <div />}
      <SupplyDay s={s} side={r?.side ?? null} history={history} />
    </>
  )
}

/**
 * A supply's own reading over the last 24 h, from the history document's
 * per-supply series: the card's bar is now, this is how close it came to its
 * rating and when. The time axis covers the whole window, so a supply that
 * started reporting late shows the gap, and its caption says since when.
 */
function SupplyDay({ s, side, history }: { s: PowerSupply; side: string | null; history: PowerHistory | null }) {
  const index = history?.supply_labels?.indexOf(s.name) ?? -1
  const rows = useMemo(
    () => (index < 0 ? [] : (history?.points ?? []).map((p) => ({ t: p.t, w: p.supplies_watts?.[index] ?? null }))),
    [history, index],
  )
  const read = rows.filter((p): p is { t: number; w: number } => p.w !== null)
  if (read.length < 2) return <div />

  const avg = read.reduce((sum, p) => sum + p.w, 0) / read.length
  const peak = read.reduce((a, b) => (b.w > a.w ? b : a))
  const ofRating = (w: number) => (s.capacity_watts ? ` (${Math.round((w / s.capacity_watts) * 100)} %)` : '')
  const label = side === 'in' ? 'Input' : 'Output'

  return (
    <div className="min-h-0 flex flex-col pt-1.5" aria-label={`${s.name}, last 24 h`}>
      <div className="shrink-0 flex items-baseline gap-2 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-500 min-w-0">
        <span className="shrink-0">{read.length < rows.length * FULL_WINDOW ? `since ${formatClock(read[0].t)}` : '24 h'}</span>
        <span className="ml-auto truncate">
          avg {formatWattsValue(avg)} W · peak <span className="text-zinc-300">{formatWattsValue(peak.w)} W</span>
          {ofRating(peak.w)} at {formatClock(peak.t)}
        </span>
      </div>
      <ChartContainer config={{ w: { label, color: NVIDIA_THEME.accent } }} className="w-full flex-1 min-h-0 aspect-auto">
        <AreaChart data={rows} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={NVIDIA_THEME.chartGrid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} stroke={NVIDIA_THEME.chartAxis}
            fontSize={10} tickLine={false} axisLine={false} tickFormatter={formatClock} minTickGap={50} height={16} />
          <YAxis width={32} stroke={NVIDIA_THEME.chartAxis} fontSize={10} tickLine={false} axisLine={false} tickCount={3}
            domain={[0, 'auto']} tickFormatter={(v: number) => formatWattsValue(v)} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, p) => formatClock(Number(p?.[0]?.payload?.t ?? 0))}
                formatter={(value) => (
                  <div className="flex w-full items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: NVIDIA_THEME.accent }} />
                    <span className="text-muted-foreground">{label}</span>
                    <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">
                      {formatWattsValue(Number(value))} W{ofRating(Number(value))}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Area dataKey="w" type="monotone" stroke={NVIDIA_THEME.accent} fill={NVIDIA_THEME.accent} fillOpacity={0.22}
            strokeWidth={1.2} isAnimationActive={false} connectNulls={false} />
        </AreaChart>
      </ChartContainer>
    </div>
  )
}

/**
 * The power supplies side by side: each one's draw against its rating, the
 * side it meters, temperature, fan, its rails with their 24 h range, a ⚠
 * carrying anything it flags (its own condition, or a 12 V connector near its
 * limit) in full on hover, and, filling the rest of the card, its own reading
 * over the last 24 h when the source sends one. No efficiency figure unless a
 * supply meters both sides. Two to a row; each row is one grid, so a supply's
 * rails and chart start level with its neighbour's.
 */
export function PowerSuppliesPanel() {
  const now = usePowerDocument<PowerNow>('now', POWER_POLL_MS.now)
  const history = usePowerDocument<PowerHistory>('history?hours=24', POWER_POLL_MS.history)
  if (!now.data) return <PowerNotice state={now} />
  const supplies = now.data.supplies
  if (supplies.length === 0) return <PanelNotice>No power supplies reported</PanelNotice>
  const cols = Math.min(supplies.length, 2)
  const rows = Array.from({ length: Math.ceil(supplies.length / cols) }, (_, i) => supplies.slice(i * cols, i * cols + cols))
  return (
    <div className="h-full min-h-0 flex flex-col gap-3 min-w-0 overflow-hidden">
      {rows.map((row) => (
        <div key={row[0].name} className="flex-1 min-h-0 grid gap-x-6 gap-y-1 min-w-0"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: 'auto auto auto auto minmax(0, 1fr)',
            gridAutoFlow: 'column',
          }}>
          {row.map((s) => <Supply key={s.name} s={s} history={history.data} />)}
        </div>
      ))}
    </div>
  )
}
