import { useMemo } from 'react'
import { DEFAULT_MAINS, formatClock } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import type { MainsLimits, PowerHistory } from '@/types/power'

/** How far a voltage sits towards the statutory limit on its side of nominal: 0 at nominal, 1 at the limit. */
function towardsLimit(v: number, m: MainsLimits): number {
  return v >= m.nominal_volts ? (v - m.nominal_volts) / (m.max_volts - m.nominal_volts) : (m.nominal_volts - v) / (m.nominal_volts - m.min_volts)
}

type Band = 'ok' | 'near' | 'out' | 'battery' | 'none'
const BAND_COLOR: Record<Band, string> = {
  ok: NVIDIA_THEME.accent,
  near: NVIDIA_THEME.warning,
  out: NVIDIA_THEME.critical,
  battery: NVIDIA_THEME.critical,
  none: 'transparent',
}
const BAND_LABEL: Record<Exclude<Band, 'none'>, string> = {
  ok: 'within limits',
  near: 'near a limit',
  out: 'outside 216–253 V',
  battery: 'on battery',
}

/** Within 70 % of the way to a limit is ordinary mains (UK supply sits at 235–245 V); past it, near a limit. */
const NEAR = 0.7

/**
 * Mains quality as a strip under the 24 h chart: each step coloured by its
 * worst reading (green inside the statutory range, amber near a limit, red
 * outside it or on battery), runs of one colour merged, the values on hover.
 * It answers what a voltage line only implies, "was the supply ever a
 * problem, and when", without competing with the watts for the chart.
 */
export function MainsRibbon({
  history,
  limits = DEFAULT_MAINS,
  inset,
  nowVolts,
  nowHz,
}: {
  history: PowerHistory
  limits?: MainsLimits | null
  /** The chart's plot-area insets in px, so the strip lines up with the time axis above it. */
  inset: { left: number; right: number }
  nowVolts: number | null
  nowHz: number | null
}) {
  const m = limits ?? DEFAULT_MAINS
  const { segments, t0, t1, seen } = useMemo(() => {
    const pts = history.points
    const step = history.step_seconds * 1000
    const segs: Array<{ from: number; to: number; band: Band; lo: number | null; hi: number | null; out: number | null }> = []
    const seenBands = new Set<Band>()
    for (const p of pts) {
      let band: Band = 'none'
      if (p.on_battery) band = 'battery'
      else if (p.input_volts_min !== null && p.input_volts_max !== null) {
        const worst = Math.max(towardsLimit(p.input_volts_min, m), towardsLimit(p.input_volts_max, m))
        band = worst > 1 ? 'out' : worst > NEAR ? 'near' : 'ok'
      }
      seenBands.add(band)
      const last = segs[segs.length - 1]
      if (last && last.band === band && p.t - last.to <= step) {
        last.to = p.t + step
        if (p.input_volts_min !== null) last.lo = last.lo === null ? p.input_volts_min : Math.min(last.lo, p.input_volts_min)
        if (p.input_volts_max !== null) last.hi = last.hi === null ? p.input_volts_max : Math.max(last.hi, p.input_volts_max)
        if (p.output_volts != null) last.out = p.output_volts
      } else {
        segs.push({ from: p.t, to: p.t + step, band, lo: p.input_volts_min, hi: p.input_volts_max, out: p.output_volts ?? null })
      }
    }
    return { segments: segs, t0: pts[0]?.t ?? 0, t1: pts[pts.length - 1]?.t ?? 1, seen: seenBands }
  }, [history, m])
  if (!segments.some((s) => s.band !== 'none')) return null
  const span = Math.max(t1 - t0, 1)
  const range = (a: number | null, b: number | null, d: number) => (a !== null && b !== null ? `${a.toFixed(d)}–${b.toFixed(d)}` : '—')
  const fine = !seen.has('near') && !seen.has('out') && !seen.has('battery')

  return (
    <div className="shrink-0 flex flex-col gap-0.5 min-w-0">
      <div className="relative h-2 rounded-sm overflow-hidden bg-zinc-800/60" style={{ marginLeft: inset.left, marginRight: inset.right }}
        aria-label="Mains quality, last 24 h">
        {segments.filter((s) => s.band !== 'none').map((s) => (
          <div key={s.from} className="absolute top-0 h-full"
            style={{
              left: `${((s.from - t0) / span) * 100}%`,
              width: `${(Math.min(s.to, t1) - s.from) / span * 100}%`,
              backgroundColor: BAND_COLOR[s.band],
              opacity: s.band === 'ok' ? 0.45 : 0.9,
            }}
            title={`${formatClock(s.from)}–${formatClock(Math.min(s.to, t1))} · ${BAND_LABEL[s.band as Exclude<Band, 'none'>]} · mains in ${range(s.lo, s.hi, 1)} V${s.out !== null ? ` · UPS out ${s.out.toFixed(1)} V` : ''}`} />
        ))}
      </div>
      <div className="flex items-center gap-3 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-500 min-w-0 whitespace-nowrap overflow-hidden" style={{ marginLeft: inset.left }}>
        <span className="text-zinc-400">mains</span>
        <span>
          {nowVolts !== null && <span className="text-zinc-300">{nowVolts.toFixed(1)} V</span>} 24 h {range(history.input_volts_min, history.input_volts_max, 1)} V
          {' · '}
          {nowHz !== null && <span className="text-zinc-300">{nowHz.toFixed(1)} Hz</span>} 24 h {range(history.input_hz_min, history.input_hz_max, 2)} Hz
        </span>
        <span className={fine ? 'text-[#76B900]' : 'text-amber-400'}>{fine ? 'within limits all day' : 'see the marks'}</span>
      </div>
    </div>
  )
}
