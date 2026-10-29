import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatClock } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import { formatRate, formatTokens, share, tokenParts } from '@/lib/tokens'
import type { TokenDoc } from '@/types/tokens'
import { usePanelDevice } from '../../panelDevice'
import type { PanelContentProps } from '../../panelRegistry'
import { Headline, PowerNotice, PowerStat } from '../power/PowerParts'
import { HoverStrip } from './TokenParts'
import { useEngineSeries, useTokensEngine } from './useTokensEngine'

const PILL = 'text-[9px] uppercase tracking-wider border rounded px-1'

/**
 * What the engine writes, laid out like the Power page's cards. The headline is
 * its output tokens a second now, tagged with how many requests run and wait;
 * then three rows of three: today against yesterday by this time, the busiest
 * minute of the day, tokens per request; requests running, waiting, and each
 * one's decode speed; speculative decoding's acceptance and length, and the
 * share of requests cut short at their max tokens. A chart of the live rate
 * fills the rest, with its value on hover. Live figures are the snapshot's;
 * the rest is the power source's /tokens.
 */
export function TokensOutputPanel({ panel }: PanelContentProps) {
  const engine = useTokensEngine(panel)
  const doc = usePowerDocument<TokenDoc>('tokens', POWER_POLL_MS.tokens)
  const tps = useEngineSeries(engine, 'tps', panel)
  usePanelDevice(engine?.model?.name ?? null)
  const m = engine?.metrics ?? null
  const d = doc.data
  if (!m && !d) return <PowerNotice state={doc} />

  const today = d?.today
  const delta = today && d ? today.output - d.yesterday_by_now.output : null
  const finished = d ? Object.values(d.finished_24h).reduce((a, b) => a + b, 0) : 0
  const cut = d ? share(d.finished_24h.length ?? 0, finished) : null
  const accept = today ? share(today.accepted, today.draft) : null
  const len = today && today.drafts ? 1 + today.accepted / today.drafts : null
  const running = m?.active_requests ?? null
  const queued = m?.queued_requests ?? null
  const t = tokenParts(today?.output)

  return (
    <div className="h-full flex flex-col gap-1 min-w-0 overflow-hidden">
      <Headline
        value={formatRate(m?.tokens_per_sec)}
        unit="tok/s out"
        color={(m?.tokens_per_sec ?? 0) > 0 ? NVIDIA_THEME.accent : '#d4d4d8'}
        tag={
          <>
            {engine ? (
              <span className={PILL} style={(running ?? 0) > 0 ? { color: NVIDIA_THEME.accent, borderColor: `${NVIDIA_THEME.accent}66` } : { color: '#a1a1aa', borderColor: '#3f3f46' }}>
                {(running ?? 0) > 0 ? `${running} running` : 'idle'}
              </span>
            ) : (
              <span className={`${PILL} text-zinc-500 border-zinc-700`}>not serving</span>
            )}
            {(queued ?? 0) > 0 && (
              <span className={PILL} style={{ color: NVIDIA_THEME.warning, borderColor: `${NVIDIA_THEME.warning}66` }}>{queued} queued</span>
            )}
          </>
        }
      />
      <div className="mt-1 grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Today" value={t.value} unit={t.unit}
          sub={delta !== null ? <span className={delta >= 0 ? 'text-[#76B900]' : 'text-zinc-500'}>{delta >= 0 ? '▲' : '▼'} {formatTokens(Math.abs(delta))} vs yday</span> : undefined} />
        <PowerStat label="Peak" value={d?.peak_output_per_min_24h ? formatRate(d.peak_output_per_min_24h.tokens / 60) : '—'} unit="tok/s"
          sub={d?.peak_output_per_min_24h ? `busiest min ${formatClock(Date.parse(d.peak_output_per_min_24h.at))}` : undefined} />
        <PowerStat label="Per request" value={today?.requests ? formatTokens(today.output / today.requests) : '—'} unit="tok"
          sub={today ? `${today.requests.toLocaleString('en-GB')} requests today` : undefined} />
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Running" value={running ?? '—'} sub="requests" />
        <PowerStat label="Waiting" value={queued ?? '—'} color={(queued ?? 0) > 0 ? NVIDIA_THEME.warning : undefined} sub="queued" />
        <PowerStat label="Decode" value={formatRate(m?.per_request_tps)} unit="tok/s" sub="per request" />
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Spec accept" value={accept ?? '—'} unit={accept !== null ? '%' : undefined} sub="of drafts, today" />
        <PowerStat label="Accept len" value={len !== null ? len.toFixed(2) : '—'} unit={len !== null ? 'tok' : undefined} sub="per draft step" />
        <PowerStat label="Cut short" value={cut ?? '—'} unit={cut !== null ? '%' : undefined} sub="hit max tokens, 24 h" />
      </div>
      <div className="mt-1 flex-1 min-h-[44px] flex flex-col gap-0.5 min-w-0">
        <HoverStrip points={tps} color={NVIDIA_THEME.accent} label="Output tokens a second, last few minutes" axis
          format={(v) => `${formatRate(v)} tok/s`} />
        <p className="shrink-0 text-[10px] 2xl:text-xs text-zinc-500 font-mono tabular-nums truncate">
          <span style={{ color: NVIDIA_THEME.accent }}>output</span> tok/s, last {panel.window}
        </p>
      </div>
    </div>
  )
}
