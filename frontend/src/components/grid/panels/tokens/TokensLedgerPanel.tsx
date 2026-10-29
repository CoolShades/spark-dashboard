import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { formatMoney } from '@/lib/power'
import { NVIDIA_THEME } from '@/lib/theme'
import { formatTokens, share } from '@/lib/tokens'
import type { TokenCounts, TokenDoc } from '@/types/tokens'
import { PowerNotice, PowerStat } from '../power/PowerParts'

/**
 * The totals and what they cost to make. A ledger of today, the last seven days
 * and all time (headed with the source's first reading): output and prompt tokens, the
 * prompt share served from cache, and requests. Then the energy at the wall per
 * thousand output tokens and the cost of a million at the current tariff, today
 * and over the week, each with the part above the idle floor ("work"): the
 * all-in figure counts the machine sitting idle between requests, the work
 * figure only what generating cost.
 */
export function TokensLedgerPanel() {
  const doc = usePowerDocument<TokenDoc>('tokens', POWER_POLL_MS.tokens)
  const d = doc.data
  if (!d) return <PowerNotice state={doc} />
  // Local, like every date on the page: a first reading at 23:42 UTC is the next day in the UK in summer.
  const since = d.since ? new Date(d.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null
  const cols: Array<[string, TokenCounts]> = [['today', d.today], ['7 days', d.week], [since ? `since ${since}` : 'all time', d.all_time]]
  const money = (v: number | null | undefined) => (v != null ? formatMoney(v, d.currency) : '—')
  const label = 'text-[10px] 2xl:text-xs uppercase tracking-wider text-zinc-400'
  const num = 'text-sm 2xl:text-base font-bold font-mono tabular-nums text-zinc-100 text-right'
  const rows: Array<[string, (c: TokenCounts) => string, string?]> = [
    ['output', (c) => formatTokens(c.output), NVIDIA_THEME.accent],
    ['prompt', (c) => formatTokens(c.prompt), '#38bdf8'],
    ['from cache', (c) => (share(c.cached, c.prompt) ?? '—') + ' %'],
    ['requests', (c) => c.requests.toLocaleString('en-GB')],
  ]
  const e = d.energy
  return (
    <div className="h-full flex flex-col gap-1.5 min-w-0 overflow-hidden">
      <div className="grid items-baseline gap-x-4 gap-y-0.5 min-w-0" style={{ gridTemplateColumns: 'auto repeat(3, minmax(0, 1fr))' }}>
        <span />
        {cols.map(([name]) => <span key={name} className="text-[9px] uppercase tracking-wider text-zinc-500 text-right">{name}</span>)}
        {rows.map(([name, f, color]) => (
          <div key={name} className="contents">
            <span className={label} style={color ? { color } : undefined}>{name}</span>
            {cols.map(([col, c]) => <span key={col} className={num}>{f(c)}</span>)}
          </div>
        ))}
      </div>
      <div className="mt-auto grid grid-cols-3 gap-2 min-w-0" title="Energy at the wall at the current tariff; work is the part above the idle floor">
        <PowerStat label="Wh / 1k out" value={e.today.wh_per_1k ?? '—'} sub={e.today.work_wh_per_1k != null ? `work ${e.today.work_wh_per_1k}, today` : 'today'} />
        <PowerStat label="Per 1M out" value={money(e.today.cost_per_1m)} sub={e.today.work_cost_per_1m != null ? `work ${money(e.today.work_cost_per_1m)}, today` : 'today'} />
        <PowerStat label="Per 1M, 7 d" value={money(e.week.cost_per_1m)} sub={e.week.work_cost_per_1m != null ? `work ${money(e.week.work_cost_per_1m)}` : undefined} />
      </div>
    </div>
  )
}
