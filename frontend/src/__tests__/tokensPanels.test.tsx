import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MetricsStoreContext } from '../hooks/useMetricsStore'
import { resetPowerPollers } from '../hooks/usePowerDocument'
import { MetricsHistoryStore } from '../lib/metricsHistoryStore'
import { msParts, sloColor, tokenParts } from '../lib/tokens'
import { formatClock } from '../lib/power'
import { NVIDIA_THEME } from '../lib/theme'
import { TokensDailyPanel } from '../components/grid/panels/tokens/TokensDailyPanel'
import { TokensHistoryPanel } from '../components/grid/panels/tokens/TokensHistoryPanel'
import { TokensLatencyPanel } from '../components/grid/panels/tokens/TokensLatencyPanel'
import { TokensLedgerPanel } from '../components/grid/panels/tokens/TokensLedgerPanel'
import { TokensOutputPanel } from '../components/grid/panels/tokens/TokensOutputPanel'
import { TokensPromptPanel } from '../components/grid/panels/tokens/TokensPromptPanel'
import type { DashboardPanel } from '../lib/dashboard/schema'
import type { EngineMetrics, EngineSnapshot, MetricsSnapshot } from '../types/metrics'
import type { TokenCounts, TokenDoc, TokenHistory } from '../types/tokens'

const GIB = 2 ** 30
const GPU = {
  index: 0, name: 'NVIDIA GeForce RTX 3090', utilization_percent: 0, memory_total_bytes: 24 * GIB, memory_used_bytes: 23 * GIB,
  temperature_celsius: 30, power_watts: 20, power_limit_watts: 350, clock_graphics_mhz: 210, clock_sm_mhz: 210, clock_memory_mhz: 405,
  fan_speed_percent: 0, pcie_rx_bytes_per_sec: 0, pcie_tx_bytes_per_sec: 0,
}

function engine(metrics: Partial<EngineMetrics>): EngineSnapshot {
  return {
    engine_type: 'Vllm',
    endpoint: 'http://127.0.0.1:18020',
    status: { type: 'Running' },
    model: null,
    metrics: metrics as EngineMetrics,
  } as EngineSnapshot
}

function snapshot(engines: EngineSnapshot[]): MetricsSnapshot {
  return {
    timestamp_ms: Date.now(),
    gpu: GPU,
    gpus: [GPU],
    cpu: { name: 'CPU', aggregate_percent: 10, per_core: [] },
    memory: {
      total_bytes: 256 * GIB, display_total_bytes: 256 * GIB, used_bytes: 64 * GIB, available_bytes: 192 * GIB,
      cached_bytes: 0, gpu_estimated_bytes: 0, gpu_memory_total_bytes: null, gpu_memory_used_bytes: null, is_unified: false,
    },
    disk: { name: 'nvme0n1', read_bytes_per_sec: 0, write_bytes_per_sec: 0 },
    network: { name: 'eno1', rx_bytes_per_sec: 0, tx_bytes_per_sec: 0 },
    engines,
    gpu_events: [],
  } as MetricsSnapshot
}

const counts = (o: Partial<TokenCounts>): TokenCounts => ({
  output: 0, prompt: 0, cached: 0, requests: 0, preemptions: 0, draft: 0, accepted: 0, drafts: 0, ...o,
})

const DOC: TokenDoc = {
  at: '2026-10-29T22:06:25+00:00', currency: 'GBP', since: '2026-10-19T23:42:00Z',
  today: counts({ output: 1446188, prompt: 177475199, cached: 171325440, requests: 1997, draft: 1477684, accepted: 954204, drafts: 492654 }),
  week: counts({ output: 1832894, prompt: 199303297, cached: 189324224, requests: 2693 }),
  all_time: counts({ output: 6045406, prompt: 737517705, cached: 712126016, requests: 7611 }),
  last_24h: counts({ output: 1473188, prompt: 177518245, cached: 171329984, requests: 2007, preemptions: 3 }),
  yesterday_by_now: counts({ output: 109824, prompt: 567663, requests: 70 }),
  peak_output_per_min_24h: { tokens: 17692, at: '2026-10-29T03:27:00+00:00' },
  finished_24h: { stop: 1965, length: 42 },
  latency_24h_ms: { ttft: { p50: 210, p95: 840, p99: 1900 }, itl: { p50: 31, p95: 70, p99: 120 }, e2e: { p50: 4100, p95: 12000, p99: 20000 }, queue: { p50: 2, p95: 45, p99: 90 } },
  energy: {
    today: { wh_per_1k: 41.2, work_wh_per_1k: 9.8, cost_per_1m: 10.96, work_cost_per_1m: 2.61 },
    week: { wh_per_1k: 60, work_wh_per_1k: 10, cost_per_1m: 15.97, work_cost_per_1m: 2.66 },
  },
}

const T0 = Date.UTC(2026, 9, 29, 14, 0)
const HISTORY: TokenHistory = {
  hours: 24, step_seconds: 300,
  points: [
    { t: T0, output: 30000, prompt: 1_500_000, cached: 1_400_000, requests: 40, running: 4, waiting: 0, kv_percent: 30,
      ttft_p50_ms: 200, ttft_p95_ms: 840, itl_p50_ms: 30, itl_p95_ms: 70, e2e_p50_ms: 4000, e2e_p95_ms: 9000 },
    { t: T0 + 300_000, output: 0, prompt: 0, cached: 0, requests: 0, running: 0, waiting: 0, kv_percent: 17,
      ttft_p50_ms: null, ttft_p95_ms: null, itl_p50_ms: null, itl_p95_ms: null, e2e_p50_ms: null, e2e_p95_ms: null },
  ],
}

function respondBy(docs: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(docs).find((k) => String(url).includes(`/api/power/${k}`))
      return key ? new Response(JSON.stringify(docs[key]), { status: 200 }) : new Response('nope', { status: 404 })
    }),
  )
}

function withStore(ui: ReactNode, engines: EngineSnapshot[]) {
  const store = new MetricsHistoryStore()
  store.ingest(snapshot(engines))
  return render(<MetricsStoreContext.Provider value={store}>{ui}</MetricsStoreContext.Provider>)
}

const card = (type: string): DashboardPanel => ({ id: type, type, geometry: { x: 0, y: 0, w: 4, h: 3 }, binding: { kind: 'follow' }, window: '5m' })

beforeEach(() => resetPowerPollers())
afterEach(() => {
  resetPowerPollers()
  vi.unstubAllGlobals()
})

describe('the Output card', () => {
  it('heads with the live rate and what runs and waits, then the day, the requests and speculation', async () => {
    respondBy({ tokens: DOC })
    withStore(<TokensOutputPanel panel={card('tokens-output')} />, [engine({ tokens_per_sec: 87.4, active_requests: 2, queued_requests: 1, per_request_tps: 31.2 })])
    expect(await screen.findByRole('group', { name: 'Today' })).toHaveTextContent('1.4M▲ 1.3M vs yday')
    expect(screen.getByText('87')).toBeInTheDocument()
    expect(screen.getByText('2 running')).toBeInTheDocument()
    expect(screen.getByText('1 queued')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Peak' })).toHaveTextContent(`295tok/sbusiest min ${formatClock(Date.parse('2026-10-29T03:27:00+00:00'))}`)
    expect(screen.getByRole('group', { name: 'Per request' })).toHaveTextContent('724tok1,997 requests today')
    expect(screen.getByRole('group', { name: 'Decode' })).toHaveTextContent('31tok/s')
    expect(screen.getByRole('group', { name: 'Spec accept' })).toHaveTextContent('65%')
    expect(screen.getByRole('group', { name: 'Accept len' })).toHaveTextContent('2.94tok')
    expect(screen.getByRole('group', { name: 'Cut short' })).toHaveTextContent('2%')
    expect(screen.getByLabelText('Output tokens a second, last few minutes')).toBeInTheDocument() // the live chart
  })

  it('still shows the day when no engine is serving', async () => {
    respondBy({ tokens: DOC })
    withStore(<TokensOutputPanel panel={card('tokens-output')} />, [])
    expect(await screen.findByText('not serving')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Today' })).toHaveTextContent('1.4M')
  })
})

describe('the Prompt card', () => {
  it('tags the cached share and shows the cache live', async () => {
    respondBy({ tokens: DOC })
    withStore(<TokensPromptPanel panel={card('tokens-prompt')} />, [engine({ prompt_tokens_per_sec: 4210, prefix_cache_hit_rate: 64, kv_cache_percent: 17 })])
    expect(await screen.findByText('97 % cached')).toBeInTheDocument()
    expect(screen.getByText('4,210')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Prefix hit' })).toHaveTextContent('64%live')
    expect(screen.getByRole('group', { name: 'KV cache' })).toHaveTextContent('17%in use')
    expect(screen.getByRole('group', { name: 'Preemptions' })).toHaveTextContent('3last 24 h')
  })
})

describe('the Latency card', () => {
  it('reads the last day, coloured against the SLO, and the engine’s own figures while the day has none', async () => {
    respondBy({ tokens: DOC })
    const { unmount } = withStore(<TokensLatencyPanel panel={card('tokens-latency')} />, [engine({ ttft_goodput_pct: 97 })])
    expect(await screen.findByText('97 % in SLO')).toBeInTheDocument()
    expect(screen.getByText('210')).toHaveStyle({ color: NVIDIA_THEME.accent }) // TTFT p50 inside the 500 ms default
    expect(screen.getByRole('group', { name: 'TTFT p99' })).toHaveTextContent('1.90s24 h')
    expect(screen.getByRole('group', { name: 'E2E p95' })).toHaveTextContent('12.0s24 h')
    unmount()
    resetPowerPollers()
    respondBy({ tokens: { ...DOC, latency_24h_ms: {} } })
    withStore(<TokensLatencyPanel panel={card('tokens-latency')} />,
      [engine({ ttft_percentiles: { p50_ms: 180, p95_ms: 600, p99_ms: 900 } as never })])
    expect(await screen.findByRole('group', { name: 'TTFT p95' })).toHaveTextContent('600mslive')
  })

  it('falls back to the engine’s whole histogram on a quiet day', async () => {
    respondBy({ tokens: { ...DOC, latency_24h_ms: {} } })
    const buckets = [{ le_seconds: 0.1, cumulative_count: 0 }, { le_seconds: 0.5, cumulative_count: 8 }, { le_seconds: 1, cumulative_count: 10 }]
    withStore(<TokensLatencyPanel panel={card('tokens-latency')} />, [engine({ ttft_buckets: buckets })])
    expect(await screen.findByRole('group', { name: 'TTFT p95' })).toHaveTextContent('875mssince vLLM start')
  })
})

describe('the 24 h tokens chart', () => {
  it('totals the day and marks each step’s TTFT against the SLO', async () => {
    respondBy({ 'token-history': HISTORY })
    withStore(<TokensHistoryPanel />, [])
    expect(await screen.findByText(/requests · peak 100 tok\/s/)).toBeInTheDocument()
    expect(screen.getByLabelText(`${formatClock(T0)} TTFT p95 840 ms`)).toBeInTheDocument()
    expect(screen.queryByLabelText(new RegExp(`${formatClock(T0 + 300_000)} TTFT`))).toBeNull() // nothing finished: no mark
  })
})

describe('the 7-day tokens heatmap', () => {
  it('draws each day by the hour with its total, and opens a card on hover', async () => {
    const hourly = Array.from({ length: 24 }, (_, h) => (h === 14 ? 900_000 : 1000))
    respondBy({ 'token-daily': { days: [
      { date: '2026-10-28', output: 50_000, prompt: 2_000_000, cached: 1_500_000, requests: 40, hourly_output: Array(24).fill(0), hourly_prompt: Array(24).fill(0), coverage: 1 },
      { date: '2026-10-29', output: 1_446_188, prompt: 177_475_199, cached: 171_325_440, requests: 1997, hourly_output: hourly, hourly_prompt: hourly.map((v) => v * 120), coverage: 1 },
    ] } })
    withStore(<TokensDailyPanel />, [])
    expect(await screen.findByLabelText('Thu 29 tokens')).toHaveTextContent('1.4M')
    fireEvent.mouseEnter(screen.getByLabelText('Thu 29 14:00 · 900K tokens out'))
    const tip = within(screen.getByText('Thu 29 · 14:00–15:00').parentElement!)
    expect(tip.getByText('900K tok')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByLabelText('Thu 29 tokens'))
    expect(screen.getByText('97 %')).toBeInTheDocument() // from cache, that day
  })
})

describe('the token ledger', () => {
  it('lays today, the week and all time side by side, with the energy per token', async () => {
    respondBy({ tokens: DOC })
    withStore(<TokensLedgerPanel />, [])
    expect(await screen.findByText('6M')).toBeInTheDocument() // all-time output
    // The all-time column, headed with the first reading's local date.
    expect(screen.getByText(`since ${new Date(DOC.since!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`)).toBeInTheDocument()
    expect(screen.getByText('738M')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Per 1M out' })).toHaveTextContent('£10.96work £2.61, today')
    expect(screen.getByRole('group', { name: 'Wh / 1k out' })).toHaveTextContent('41.2work 9.8, today')
  })
})

describe('the token helpers', () => {
  it('reads a percentile off a cumulative histogram', async () => {
    const { bucketQuantile } = await import('../lib/tokens')
    expect(bucketQuantile([{ le_seconds: 0.1, cumulative_count: 5 }, { le_seconds: 0.2, cumulative_count: 10 }], 0.5)).toBeCloseTo(100)
    expect(bucketQuantile([{ le_seconds: 0.1, cumulative_count: 0 }], 0.5)).toBeNull()
  })

  it('splits counts and durations for tiles, and judges a latency against its SLO', () => {
    expect(tokenParts(1_446_188)).toEqual({ value: '1.4', unit: 'M' })
    expect(tokenParts(512)).toEqual({ value: '512', unit: '' })
    expect(msParts(840)).toEqual({ value: '840', unit: 'ms' })
    expect(msParts(1900)).toEqual({ value: '1.90', unit: 's' })
    expect(sloColor(400, 500)).toBe(NVIDIA_THEME.accent)
    expect(sloColor(900, 500)).toBe(NVIDIA_THEME.warning)
    expect(sloColor(1100, 500)).toBe(NVIDIA_THEME.critical)
  })
})
