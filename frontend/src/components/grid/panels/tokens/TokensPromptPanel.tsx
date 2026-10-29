import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatRate, formatTokens, share, tokenParts } from '@/lib/tokens'
import type { TokenDoc } from '@/types/tokens'
import { usePanelDevice } from '../../panelDevice'
import type { PanelContentProps } from '../../panelRegistry'
import { Headline, PowerNotice, PowerStat } from '../power/PowerParts'
import { SeriesStrip } from './TokenParts'
import { useEngineSeries, useTokensEngine } from './useTokensEngine'

const PROMPT = '#38bdf8'
const PILL = 'text-[9px] uppercase tracking-wider border rounded px-1'

/**
 * What the engine reads. The headline is its prompt tokens a second now, tagged
 * with today's share served from the prefix cache; then today against
 * yesterday by this time, tokens per request and the last 24 h; the live prefix
 * hit rate, KV cache in use and today's cached share; each request's prefill
 * speed, the batch size and preemptions. A strip of the live rate.
 */
export function TokensPromptPanel({ panel }: PanelContentProps) {
  const engine = useTokensEngine(panel)
  const doc = usePowerDocument<TokenDoc>('tokens', POWER_POLL_MS.tokens)
  const tps = useEngineSeries(engine, 'promptTps', panel)
  usePanelDevice(engine?.model?.name ?? null)
  const m = engine?.metrics ?? null
  const d = doc.data
  if (!m && !d) return <PowerNotice state={doc} />

  const today = d?.today
  const cached = today ? share(today.cached, today.prompt) : null
  const delta = today && d ? today.prompt - d.yesterday_by_now.prompt : null
  const t = tokenParts(today?.prompt)
  const h = tokenParts(d?.last_24h.prompt)
  const pct = (v: number | null | undefined) => (v != null ? Math.round(v) : '—')

  return (
    <div className="h-full flex flex-col gap-1 min-w-0 overflow-hidden">
      <Headline
        value={formatRate(m?.prompt_tokens_per_sec)}
        unit="tok/s in"
        color={(m?.prompt_tokens_per_sec ?? 0) > 0 ? PROMPT : '#d4d4d8'}
        tag={cached !== null ? (
          <span className={PILL} style={{ color: PROMPT, borderColor: `${PROMPT}66` }} title="Prompt tokens served from the prefix cache today">
            {cached} % cached
          </span>
        ) : undefined}
      />
      <div className="mt-1 grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Today" value={t.value} unit={t.unit}
          sub={delta !== null ? `${delta >= 0 ? '▲' : '▼'} ${formatTokens(Math.abs(delta))} vs yday` : undefined} />
        <PowerStat label="Per request" value={today?.requests ? formatTokens(today.prompt / today.requests) : '—'} unit="tok" sub="in, today" />
        <PowerStat label="Last 24 h" value={h.value} unit={h.unit} sub={d ? `${d.last_24h.requests.toLocaleString('en-GB')} requests` : undefined} />
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Prefix hit" value={pct(m?.prefix_cache_hit_rate)} unit="%" sub="live" />
        <PowerStat label="KV cache" value={pct(m?.kv_cache_percent)} unit="%" sub={m?.kv_cache_is_estimated ? 'in use (est.)' : 'in use'} />
        <PowerStat label="Cached" value={cached ?? '—'} unit={cached !== null ? '%' : undefined} sub="from cache, today" />
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Prefill" value={formatRate(m?.per_request_prompt_tps)} unit="tok/s" sub="per request" />
        <PowerStat label="Batch" value={m?.avg_batch_size != null ? m.avg_batch_size.toFixed(1) : '—'} sub="requests per step" />
        <PowerStat label="Preemptions" value={d ? d.last_24h.preemptions : '—'} sub="last 24 h" />
      </div>
      <SeriesStrip points={tps} color={PROMPT} label="Prompt tokens a second, last few minutes"
        caption={<><span style={{ color: PROMPT }}>prompt</span> tok/s, last {panel.window}</>} />
    </div>
  )
}
