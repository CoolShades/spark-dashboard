import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { recomputeGoodputPct } from '@/lib/slo'
import { NVIDIA_THEME } from '@/lib/theme'
import { bandColor, bucketQuantile, LATENCY_BANDS, msParts } from '@/lib/tokens'
import type { TokenDoc } from '@/types/tokens'
import { usePanelDevice } from '../../panelDevice'
import type { PanelContentProps } from '../../panelRegistry'
import { Headline, PowerNotice, PowerStat } from '../power/PowerParts'
import { SeriesStrip } from './TokenParts'
import { useEngineSeries, useTokensEngine } from './useTokensEngine'

const PILL = 'text-[9px] uppercase tracking-wider border rounded px-1'

/**
 * How fast it answers. Percentiles over the last 24 h from the power source,
 * or, while it has none yet, the engine's own since it started (the tile says
 * which). The headline is the median time to the first token, tagged with the
 * share of requests whose first token came inside TTFT's green band; then TTFT
 * p95 and p99 and the median gap between tokens; the gap's p95 and the whole
 * request's median and p95; the time queued, median and p95, and the time per
 * output token. Each figure is coloured by its band in LATENCY_BANDS (set for
 * long, mostly cached agent contexts); end-to-end time is left plain, as it is
 * mostly the answer's length. A strip of the live inter-token latency, its
 * value on hover.
 */
export function TokensLatencyPanel({ panel }: PanelContentProps) {
  const engine = useTokensEngine(panel)
  const doc = usePowerDocument<TokenDoc>('tokens', POWER_POLL_MS.tokens)
  const itl = useEngineSeries(engine, 'interTokenLatency', panel)
  usePanelDevice(engine?.model?.name ?? null)
  const m = engine?.metrics ?? null
  const d = doc.data
  if (!m && !d) return <PowerNotice state={doc} />

  const day = d?.latency_24h_ms ?? {}
  const live = {
    ttft: m?.ttft_percentiles ?? null,
    itl: m?.itl_percentiles ?? null,
    e2e: m?.e2e_percentiles ?? null,
  }
  const buckets = { ttft: m?.ttft_buckets ?? null, itl: m?.itl_buckets ?? null, e2e: m?.e2e_buckets ?? null }
  const Q = { p50: 0.5, p95: 0.95, p99: 0.99 } as const
  // The source's last 24 h first; then the engine's live percentiles; then its whole histogram since it started
  // (a quiet day still shows how the engine answers). The tile says which.
  const pick = (k: 'ttft' | 'itl' | 'e2e', p: 'p50' | 'p95' | 'p99'): { ms: number | null; since: string } => {
    const v = day[k]?.[p] ?? null
    if (v !== null) return { ms: v, since: '24 h' }
    const l = live[k]?.[`${p}_ms` as 'p50_ms'] ?? null
    if (l !== null) return { ms: l, since: 'live' }
    const b = bucketQuantile(buckets[k], Q[p])
    return { ms: b, since: b !== null ? 'since vLLM start' : 'no requests yet' }
  }
  const tile = (label: string, k: 'ttft' | 'itl' | 'e2e', p: 'p50' | 'p95' | 'p99', band: readonly [number, number] | null) => {
    const { ms, since } = pick(k, p)
    const parts = msParts(ms)
    return <PowerStat label={label} value={parts.value} unit={parts.unit} color={band ? bandColor(ms, band) : undefined} sub={since} />
  }
  const head = pick('ttft', 'p50')
  const headParts = msParts(head.ms)
  const queue = (p: 'p50' | 'p95') => msParts(day.queue?.[p] ?? null)
  const goodput = recomputeGoodputPct(m?.ttft_buckets, LATENCY_BANDS.ttft[0])
  const green = `${LATENCY_BANDS.ttft[0] / 1000} s`

  return (
    <div className="h-full flex flex-col gap-1 min-w-0 overflow-hidden">
      <Headline
        value={headParts.value}
        unit={`${headParts.unit} to first token`}
        color={bandColor(head.ms, LATENCY_BANDS.ttft)}
        tag={goodput !== null ? (
          <span className={PILL}
            style={{ color: goodput >= 95 ? NVIDIA_THEME.accent : goodput >= 80 ? NVIDIA_THEME.warning : NVIDIA_THEME.critical, borderColor: '#3f3f46' }}
            title={`Requests with their first token within ${green}, since vLLM started`}>
            {Math.round(goodput)} % under {green}
          </span>
        ) : undefined}
      />
      <div className="mt-1 grid grid-cols-3 gap-2 min-w-0">
        {tile('TTFT p95', 'ttft', 'p95', LATENCY_BANDS.ttft)}
        {tile('TTFT p99', 'ttft', 'p99', LATENCY_BANDS.ttft)}
        {tile('ITL p50', 'itl', 'p50', LATENCY_BANDS.itl)}
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        {tile('ITL p95', 'itl', 'p95', LATENCY_BANDS.itl)}
        {tile('E2E p50', 'e2e', 'p50', null)}
        {tile('E2E p95', 'e2e', 'p95', null)}
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Queue p50" value={queue('p50').value} unit={queue('p50').unit} sub="24 h"
          color={bandColor(day.queue?.p50 ?? null, LATENCY_BANDS.queue)} />
        <PowerStat label="Queue p95" value={queue('p95').value} unit={queue('p95').unit} sub="24 h"
          color={bandColor(day.queue?.p95 ?? null, LATENCY_BANDS.queue)} />
        <PowerStat label="TPOT" value={msParts(m?.tpot_ms).value} unit={msParts(m?.tpot_ms).unit} color={bandColor(m?.tpot_ms, LATENCY_BANDS.tpot)}
          sub="live" />
      </div>
      <SeriesStrip points={itl} color="#a78bfa" label="Inter-token latency, last few minutes"
        format={(v) => `${msParts(v).value} ${msParts(v).unit}`}
        caption={<><span className="text-violet-400">inter-token</span> latency, last {panel.window} · green ≤ {green} TTFT, ≤ {LATENCY_BANDS.itl[0]} ms ITL</>} />
    </div>
  )
}
