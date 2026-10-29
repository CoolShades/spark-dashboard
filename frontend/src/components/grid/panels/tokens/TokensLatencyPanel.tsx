import { useSloSettings } from '@/hooks/useSloSettings'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { engineKey } from '@/lib/identity'
import { NVIDIA_THEME } from '@/lib/theme'
import { msParts, sloColor } from '@/lib/tokens'
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
 * share of requests inside the TTFT SLO; then TTFT p95 and p99 and the median
 * gap between tokens; the gap's p95 and the whole request's median and p95; the
 * time queued, median and p95, and the time per output token. Each figure is
 * coloured against its SLO threshold (green within it, amber to twice it, red
 * beyond). A strip of the live inter-token latency.
 */
export function TokensLatencyPanel({ panel }: PanelContentProps) {
  const engine = useTokensEngine(panel)
  const doc = usePowerDocument<TokenDoc>('tokens', POWER_POLL_MS.tokens)
  const itl = useEngineSeries(engine, 'interTokenLatency', panel)
  const { thresholds: slo } = useSloSettings(engine ? engineKey(engine) : null, engine?.model?.name ?? null)
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
  // The 24 h figure when the source has one, else the engine's own since it started.
  const pick = (k: 'ttft' | 'itl' | 'e2e', p: 'p50' | 'p95' | 'p99'): { ms: number | null; since: string } => {
    const v = day[k]?.[p] ?? null
    if (v !== null) return { ms: v, since: '24 h' }
    const l = live[k]?.[`${p}_ms` as 'p50_ms'] ?? null
    return { ms: l, since: l !== null ? 'since vLLM start' : '24 h' }
  }
  const tile = (label: string, k: 'ttft' | 'itl' | 'e2e', p: 'p50' | 'p95' | 'p99', threshold: number) => {
    const { ms, since } = pick(k, p)
    const parts = msParts(ms)
    return <PowerStat label={label} value={parts.value} unit={parts.unit} color={sloColor(ms, threshold)} sub={since} />
  }
  const head = pick('ttft', 'p50')
  const headParts = msParts(head.ms)
  const queue = (p: 'p50' | 'p95') => msParts(day.queue?.[p] ?? null)
  const goodput = m?.ttft_goodput_pct ?? null

  return (
    <div className="h-full flex flex-col gap-1 min-w-0 overflow-hidden">
      <Headline
        value={headParts.value}
        unit={`${headParts.unit} to first token`}
        color={sloColor(head.ms, slo.ttftMs)}
        tag={goodput !== null ? (
          <span className={PILL} style={{ color: goodput >= 95 ? NVIDIA_THEME.accent : NVIDIA_THEME.warning, borderColor: '#3f3f46' }}
            title={`Requests with their first token inside the ${slo.ttftMs} ms TTFT SLO, since vLLM started`}>
            {Math.round(goodput)} % in SLO
          </span>
        ) : undefined}
      />
      <div className="mt-1 grid grid-cols-3 gap-2 min-w-0">
        {tile('TTFT p95', 'ttft', 'p95', slo.ttftMs)}
        {tile('TTFT p99', 'ttft', 'p99', slo.ttftMs)}
        {tile('ITL p50', 'itl', 'p50', slo.itlMs)}
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        {tile('ITL p95', 'itl', 'p95', slo.itlMs)}
        {tile('E2E p50', 'e2e', 'p50', slo.e2eMs)}
        {tile('E2E p95', 'e2e', 'p95', slo.e2eMs)}
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Queue p50" value={queue('p50').value} unit={queue('p50').unit} sub="24 h, waiting to start" />
        <PowerStat label="Queue p95" value={queue('p95').value} unit={queue('p95').unit} sub="24 h" />
        <PowerStat label="TPOT" value={msParts(m?.tpot_ms).value} unit={msParts(m?.tpot_ms).unit} color={sloColor(m?.tpot_ms, slo.tpotMs)}
          sub="per output token, live" />
      </div>
      <SeriesStrip points={itl} color="#a78bfa" label="Inter-token latency, last few minutes"
        caption={<><span className="text-violet-400">inter-token</span> latency, last {panel.window} · SLO {slo.ttftMs} ms TTFT, {slo.itlMs} ms ITL</>} />
    </div>
  )
}
