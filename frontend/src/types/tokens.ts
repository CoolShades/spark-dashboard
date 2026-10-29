/**
 * The Tokens page's three documents from the power source (docs/power.md,
 * "Token documents"): the engine's counters over today, the week and all time,
 * its latency percentiles over the last day and the energy per token; the last
 * hours in steps; and a week by local hour. The live figures (tokens a second,
 * requests running, cache, live percentiles) stay the snapshot's.
 */

/** Increases over a window: tokens out and in, prompt tokens served from the prefix cache, requests finished. */
export interface TokenCounts {
  output: number
  prompt: number
  cached: number
  requests: number
  preemptions: number
  /** Speculative decoding: tokens drafted, drafted tokens accepted, and drafts made. */
  draft: number
  accepted: number
  drafts: number
}

export interface Percentiles {
  p50: number | null
  p95: number | null
  p99: number | null
}

/** Energy at the wall per output token: all of it, and only the part above the idle floor ("work"). */
export interface TokenEnergy {
  wh_per_1k: number | null
  work_wh_per_1k: number | null
  cost_per_1m: number | null
  work_cost_per_1m: number | null
}

export interface TokenDoc {
  at: string
  currency: string
  /** The first reading the source holds: "all time" starts here. */
  since: string | null
  today: TokenCounts
  week: TokenCounts
  all_time: TokenCounts
  last_24h: TokenCounts
  /** Yesterday from midnight to this time of day. */
  yesterday_by_now: TokenCounts
  peak_output_per_min_24h: { tokens: number; at: string } | null
  /** Requests finished in the last 24 h by why they finished ("stop", "length", "abort", ...). */
  finished_24h: Record<string, number>
  /** Milliseconds, from the last 24 h of each histogram. */
  latency_24h_ms: Partial<Record<'ttft' | 'itl' | 'e2e' | 'queue', Percentiles>>
  energy: { today: TokenEnergy; week: TokenEnergy }
}

/** One step: tokens and requests in it, the most running and waiting, the fullest KV cache, latency percentiles. */
export interface TokenStep {
  t: number
  output: number
  prompt: number
  cached: number
  requests: number
  running: number | null
  waiting: number | null
  kv_percent: number | null
  ttft_p50_ms: number | null
  ttft_p95_ms: number | null
  itl_p50_ms: number | null
  itl_p95_ms: number | null
  e2e_p50_ms: number | null
  e2e_p95_ms: number | null
}

export interface TokenHistory {
  hours: number
  step_seconds: number
  points: TokenStep[]
}

export interface TokenDay {
  date: string
  output: number
  prompt: number
  cached: number
  requests: number
  /** Each local clock hour 0-23; null for an hour with no reading. */
  hourly_output: Array<number | null>
  hourly_prompt: Array<number | null>
  coverage: number
}

export interface TokenDaily {
  days: TokenDay[]
}
