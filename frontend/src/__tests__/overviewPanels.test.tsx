import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MetricsStoreContext } from '../hooks/useMetricsStore'
import { resetPowerPollers } from '../hooks/usePowerDocument'
import { MetricsHistoryStore } from '../lib/metricsHistoryStore'
import { GpuSummaryPanel } from '../components/grid/panels/overview/GpuSummaryPanel'
import { OverviewHealthPanel } from '../components/grid/panels/overview/OverviewHealthPanel'
import type { EngineMetrics, EngineSnapshot, GpuMetrics, MetricsSnapshot } from '../types/metrics'

const GIB = 2 ** 30

function gpu(index: number, over: Partial<GpuMetrics> = {}): GpuMetrics {
  return {
    index, name: 'NVIDIA GeForce RTX 3090', utilization_percent: 0, memory_total_bytes: 24 * GIB, memory_used_bytes: 23 * GIB,
    temperature_celsius: 33, power_watts: 20, power_limit_watts: 350, clock_graphics_mhz: 210, clock_sm_mhz: 210,
    clock_memory_mhz: 405, fan_speed_percent: 0, pcie_rx_bytes_per_sec: 0, pcie_tx_bytes_per_sec: 0, ...over,
  }
}

function snapshot(gpus: GpuMetrics[], engines: EngineSnapshot[] = []): MetricsSnapshot {
  return {
    timestamp_ms: Date.now(), gpu: gpus[0], gpus,
    cpu: { name: 'Threadripper', aggregate_percent: 3, per_core: [] },
    memory: {
      total_bytes: 270e9, display_total_bytes: 270e9, used_bytes: 79e9, available_bytes: 190e9, cached_bytes: 147e9,
      gpu_estimated_bytes: 0, gpu_memory_total_bytes: null, gpu_memory_used_bytes: null, is_unified: false,
    },
    disk: { name: 'md0', read_bytes_per_sec: 0, write_bytes_per_sec: 0 },
    network: { name: 'enp37s0f0', rx_bytes_per_sec: 0, tx_bytes_per_sec: 0 },
    engines, gpu_events: [],
  } as MetricsSnapshot
}

const HEALTH = { link_gen_max: 4, link_width_max: 16, replays: 0, naks: 0, retrains: 0, aer_corrected: 0, rollovers: 0, uncorrectable: 0,
  xid: 0, xid_last: null, power_cap_s: 0, thermal_s: 0, slowdown_s: 0 }
const GPUS = { at: '', driver: '615', health_at: '', gpus: [0, 1].map((i) => ({
  index: i, label: `GPU ${i} · slot ${[2, 7][i]}`, slot: [2, 7][i], bus: null, pstate: 'P8', clock_reasons: ['idle'],
  enforced_power_limit_watts: 350, pcie_gen: 1, pcie_width: 16, memory_util_percent: 0, vbios: null, health: HEALTH, updated: null,
})) }

function respondBy(docs: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(docs).sort((a, b) => b.length - a.length).find((k) => String(url).includes(`/api/power/${k}`))
      return key ? new Response(JSON.stringify(docs[key]), { status: 200 }) : new Response('nope', { status: 404 })
    }),
  )
}

function withStore(ui: ReactNode, snap: MetricsSnapshot) {
  const store = new MetricsHistoryStore()
  store.ingest(snap)
  return render(<MetricsStoreContext.Provider value={store}>{ui}</MetricsStoreContext.Provider>)
}

beforeEach(() => resetPowerPollers())
afterEach(() => {
  resetPowerPollers()
  vi.unstubAllGlobals()
})

describe('the overview’s GPUs card', () => {
  it('lists every GPU with its load, power and temperature, under the totals and the day’s verdict', async () => {
    respondBy({ gpus: GPUS })
    withStore(<GpuSummaryPanel />, snapshot([gpu(0, { utilization_percent: 93, power_watts: 246 }), gpu(1)]))
    expect(await screen.findByText('✓ no faults, 24 h')).toBeInTheDocument()
    expect(screen.getByText('GPU 0 · slot 2')).toBeInTheDocument()
    const tile = screen.getByLabelText('GPU 0')
    expect(tile).toHaveTextContent('93% load')
    expect(tile).toHaveTextContent('246 W')
    expect(screen.getByLabelText('GPU 0 power 70 % of its limit')).toBeInTheDocument() // 246 of 350 W
    expect(screen.getByText('266 W')).toBeInTheDocument() // board power, both cards
  })
})

describe('the overview’s health row', () => {
  it('gives each area a verdict and opens its page on a click', async () => {
    const engine = { engine_type: 'Vllm', endpoint: 'x', status: { type: 'Running' }, model: { name: 'flash-next' }, metrics: { active_requests: 2 } as EngineMetrics } as EngineSnapshot
    respondBy({
      gpus: GPUS,
      now: { total_watts: 297, cost_per_hour: 0.08, ups: { status: 'online', battery_percent: 100, runtime_seconds: 5580 }, supplies: [],
        energy: { currency: 'GBP', today_cost: 2.56 } },
      host: { load: { '1': 1, '5': 2.01, '15': 2 }, arrays: [{ name: 'md0', level: 'raid1', map: 'UU', DisksFailed: 0 }],
        drives: [{ device: 'nvme0', healthy: true }], rails: [{ name: '+12v', volts: 11.88, nominal: 12, ok: true }], fans: [{ name: 'f', rpm: 1 }],
        bmc_flags: { watchdog2: 'ok', memory_train_err: 'ok' }, units: [{ name: 'a.service', active: 'active', sub: 'running' }],
        containers: [{ name: 'newt', status: 'exited' }] },
      tokens: { today: { output: 1_446_188 } },
    })
    withStore(<OverviewHealthPanel />, snapshot([gpu(0), gpu(1)], [engine]))
    expect(await screen.findByRole('button', { name: 'Storage: Healthy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Engine: 2 running' })).toHaveTextContent('flash-next · 1.4M out today')
    expect(await screen.findByRole('button', { name: 'GPUs: No faults' })).toHaveTextContent('2/2 at Gen4 · hottest 33 °C')
    expect(screen.getByRole('button', { name: 'Power: 297 W' })).toHaveTextContent('£2.56 today · 8p/h')
    expect(screen.getByRole('button', { name: 'UPS: Online' })).toHaveTextContent('100 % · 1h 33m runtime')
    expect(screen.getByRole('button', { name: 'Services: 1 down' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Power: 297 W' }))
    expect(window.location.pathname).toBe('/pages/power')
  })
})
