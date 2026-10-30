import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MetricsStoreContext } from '../hooks/useMetricsStore'
import { resetPowerPollers } from '../hooks/usePowerDocument'
import { MetricsHistoryStore } from '../lib/metricsHistoryStore'
import { formatCount, heldBy, rateParts } from '../lib/gpus'
import { formatClock } from '../lib/power'
import { GpuCardPanel } from '../components/grid/panels/gpus/GpuCardPanel'
import { GpuDayPanel } from '../components/grid/panels/gpus/GpuDayPanel'
import { GpuHealthPanel } from '../components/grid/panels/gpus/GpuHealthPanel'
import { GpuThermalsPanel } from '../components/grid/panels/gpus/GpuThermalsPanel'
import type { DashboardPanel } from '../lib/dashboard/schema'
import type { GpuMetrics, MetricsSnapshot } from '../types/metrics'
import type { GpuDoc, GpuHealth, GpuHistory } from '../types/gpus'

const GIB = 2 ** 30

function gpu(index: number, over: Partial<GpuMetrics> = {}): GpuMetrics {
  return {
    index,
    name: 'NVIDIA GeForce RTX 3090',
    utilization_percent: 0,
    memory_total_bytes: 24 * GIB,
    memory_used_bytes: 23.3 * GIB,
    temperature_celsius: 40,
    power_watts: 20,
    power_limit_watts: 350,
    clock_graphics_mhz: 210,
    clock_sm_mhz: 210,
    clock_memory_mhz: 405,
    fan_speed_percent: 0,
    pcie_rx_bytes_per_sec: 400_000,
    pcie_tx_bytes_per_sec: 600_000,
    ...over,
  }
}

function snapshot(gpus: GpuMetrics[]): MetricsSnapshot {
  return {
    timestamp_ms: Date.now(),
    gpu: gpus[0],
    gpus,
    cpu: { name: 'Threadripper', aggregate_percent: 10, per_core: [{ id: 0, usage_percent: 10 }] },
    memory: {
      total_bytes: 256 * GIB, display_total_bytes: 256 * GIB, used_bytes: 64 * GIB, available_bytes: 192 * GIB,
      cached_bytes: 8 * GIB, gpu_estimated_bytes: 0, gpu_memory_total_bytes: null, gpu_memory_used_bytes: null, is_unified: false,
    },
    disk: { name: 'nvme0n1', read_bytes_per_sec: 0, write_bytes_per_sec: 0 },
    network: { name: 'eno1', rx_bytes_per_sec: 0, tx_bytes_per_sec: 0 },
    engines: [],
    gpu_events: [],
  }
}

const HEALTHY: GpuHealth = {
  link_gen_max: 4, link_width_max: 16, replays: 26, naks: 3462, retrains: 10424, aer_corrected: 3515,
  rollovers: 0, uncorrectable: 0, xid: 0, xid_last: null, power_cap_s: 2330, thermal_s: 0, slowdown_s: 0,
  since_boot: { replays: 36, retrains: 13512, rollovers: 0 },
}

function doc(over: Partial<GpuDoc['gpus'][number]>[] = [{}, {}]): GpuDoc {
  return {
    at: '2026-10-29T21:40:00+00:00', driver: '615.71.09', health_at: '2026-10-29T21:37:19+00:00',
    gpus: over.map((o, i) => ({
      index: i, label: `GPU ${i} · slot ${[2, 7][i] ?? i}`, slot: [2, 7][i] ?? i, bus: `0${i + 1}:00.0`, pstate: 'P2',
      clock_reasons: ['power cap'], enforced_power_limit_watts: 350, pcie_gen: 4, pcie_width: 16, memory_util_percent: 41,
      vbios: '94.02.32.00.02', updated: '2026-10-29T21:39:58Z', health: HEALTHY, ...o,
    })),
  }
}

const T0 = Date.UTC(2026, 9, 29, 14, 0)
const HISTORY: GpuHistory = {
  hours: 24, step_seconds: 600, labels: ['GPU 0 · slot 2', 'GPU 1 · slot 7'],
  points: [
    { t: T0, gpus: [
      { util: 91, watts: 235, temp: 77, fan: 50, power_cap: 0.13, slowdown: 0 },
      { util: 91, watts: 215, temp: 68, fan: 36, power_cap: 0.13, slowdown: 0.2, thermal: 0.05 },
    ] },
    { t: T0 + 600_000, gpus: [
      { util: 0, watts: 23, temp: 40, fan: 0, power_cap: 0.68, slowdown: 0 },
      { util: 0, watts: 17, temp: 38, fan: 0, power_cap: 0, slowdown: 0 },
    ] },
  ],
  summary: [
    { index: 0, busy_hours: 1.7, util_avg: 6, kwh: 1.28, temp_max: 79, temp_max_at: '2026-10-29T01:50:00+00:00' },
    { index: 1, busy_hours: 1.7, util_avg: 6, kwh: 1.09, temp_max: 73, temp_max_at: '2026-10-29T16:20:00+00:00' },
  ],
  limits: { target_c: 83, max_operating_c: 93, slowdown_c: 95 },
}

/** Answers each power document by its path: /api/power/gpus, /api/power/gpu-history?... */
function respondBy(docs: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(docs).find((k) => String(url).includes(`/api/power/${k}`))
      return key ? new Response(JSON.stringify(docs[key]), { status: 200 }) : new Response('nope', { status: 404 })
    }),
  )
}

function withStore(ui: ReactNode, gpus: GpuMetrics[]) {
  const store = new MetricsHistoryStore()
  store.ingest(snapshot(gpus))
  return render(<MetricsStoreContext.Provider value={store}>{ui}</MetricsStoreContext.Provider>)
}

const CARD: DashboardPanel = { id: 'card-1', type: 'gpu-card', geometry: { x: 0, y: 0, w: 3, h: 3 }, binding: { kind: 'gpu', index: 1 }, window: '5m' }

beforeEach(() => resetPowerPollers())
afterEach(() => {
  resetPowerPollers()
  vi.unstubAllGlobals()
})

describe('the GPU card', () => {
  const busy = gpu(1, { utilization_percent: 93, power_watts: 246, temperature_celsius: 61, fan_speed_percent: 52,
    clock_sm_mhz: 1695, clock_memory_mhz: 9501, pcie_rx_bytes_per_sec: 1_234_000, pcie_tx_bytes_per_sec: 300_000 })

  it('heads with the load, tags the P-state and what holds the clocks, and fills three rows of three', async () => {
    respondBy({ gpus: doc(), 'gpu-history': HISTORY })
    withStore(<GpuCardPanel panel={CARD} />, [gpu(0), busy])
    expect(await screen.findByText('P2')).toBeInTheDocument()
    expect(screen.getByText('93')).toBeInTheDocument()
    expect(screen.getByText('power cap')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Power' })).toHaveTextContent('246Wof 350 W')
    expect(await screen.findByText('max 73 today')).toBeInTheDocument() // GPU 1's peak from the 24 h summary
    expect(screen.getByRole('group', { name: 'SM clock' })).toHaveTextContent('1,695MHzmem 9,501')
    expect(screen.getByRole('group', { name: 'VRAM' })).toHaveTextContent('23.3GBof 24.0 · 97 %')
    expect(screen.getByRole('group', { name: 'Mem bus' })).toHaveTextContent('41%controller load')
    expect(screen.getByRole('group', { name: 'PCIe' })).toHaveTextContent('Gen4x16Gen4 x16 today')
    expect(screen.getByRole('group', { name: 'RX' })).toHaveTextContent('1.2MB/s')
    expect(screen.getByText(/RTX 3090 · VBIOS 94\.02\.32\.00\.02 · 02:00\.0/)).toBeInTheDocument()
  })

  it('reads "idle" on an idle card whatever NVML flags, and still shows the snapshot without a source', async () => {
    respondBy({ gpus: doc() })
    const { unmount } = withStore(<GpuCardPanel panel={CARD} />, [gpu(0), gpu(1)])
    expect(await screen.findByText('idle')).toBeInTheDocument()
    expect(screen.queryByText('power cap')).toBeNull()
    expect(screen.getByRole('group', { name: 'Fan' })).toHaveTextContent('stopped')
    unmount()
    resetPowerPollers()
    respondBy({})
    withStore(<GpuCardPanel panel={CARD} />, [gpu(0), busy])
    expect(await screen.findByText('93')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Power' })).toHaveTextContent('246W')
    expect(screen.queryByText('P2')).toBeNull()
  })

  it('draws the strip of load and power you can hover once it has a few readings', async () => {
    respondBy({ gpus: doc() })
    const store = new MetricsHistoryStore()
    const t = Date.now()
    for (let k = 0; k < 3; k++) store.ingest({ ...snapshot([gpu(0), busy]), timestamp_ms: t - (2 - k) * 1000 })
    render(<MetricsStoreContext.Provider value={store}><GpuCardPanel panel={CARD} /></MetricsStoreContext.Provider>)
    expect(await screen.findByLabelText('Load and power, last few minutes')).toBeInTheDocument()
  })
})

describe('the GPUs’ 24 h heatmap', () => {
  it('draws each GPU by the step, marks a slowed step, and opens a card on hover', async () => {
    respondBy({ 'gpu-history': HISTORY })
    withStore(<GpuDayPanel />, [gpu(0), gpu(1)])
    const cell = await screen.findByLabelText(`GPU 1 · slot 7 ${formatClock(T0)} · 91 % load`)
    expect(cell.querySelector('span')).not.toBeNull() // the slowed mark
    expect(screen.getByLabelText(`GPU 0 · slot 2 ${formatClock(T0)} · 91 % load`).querySelector('span')).toBeNull()
    expect(screen.getAllByText(/busy/).length).toBeGreaterThan(0)
    expect(screen.getByText(/3\.4/)).toBeInTheDocument() // GPU-hours busy, both cards
    fireEvent.mouseEnter(cell)
    const tip = within(screen.getByText(`GPU 1 · slot 7 · ${formatClock(T0)}–${formatClock(T0 + 600_000)}`).parentElement!)
    expect(tip.getByText('91 %')).toBeInTheDocument()
    expect(tip.getByText('215 W')).toBeInTheDocument()
    expect(tip.getByText('power-capped 13 % of the time')).toBeInTheDocument()
    expect(tip.getByText('HW slowdown 20 % of the time')).toBeInTheDocument()
    expect(tip.getByText('capped for heat 5 % of the time')).toBeInTheDocument()
  })

  it('does not name a power cap on an idle step', async () => {
    respondBy({ 'gpu-history': HISTORY })
    withStore(<GpuDayPanel />, [gpu(0), gpu(1)])
    fireEvent.mouseEnter(await screen.findByLabelText(`GPU 0 · slot 2 ${formatClock(T0 + 600_000)} · 0 % load`))
    expect(screen.queryByText(/power-capped/)).toBeNull()
  })
})

describe('the GPU thermals chart', () => {
  it('names each card with its live temperature, and the hottest of the day', async () => {
    respondBy({ 'gpu-history': HISTORY })
    withStore(<GpuThermalsPanel />, [gpu(0, { temperature_celsius: 61 }), gpu(1, { temperature_celsius: 38 })])
    expect(await screen.findByText('61 °C')).toBeInTheDocument()
    expect(screen.getByText('38 °C')).toBeInTheDocument()
    expect(screen.getByText(/· GPU 0 at/)).toBeInTheDocument()
  })
})

describe('the GPU health card', () => {
  it('gives each GPU a verdict, its link, its faults in colour and its correctable errors in grey', async () => {
    respondBy({ gpus: doc([{ pcie_gen: 1 }, { health: { ...HEALTHY, xid: 2, xid_last: { at: '2026-10-29T20:00:00Z', code: 79 } } }]) })
    withStore(<GpuHealthPanel />, [gpu(0), gpu(1)])
    const ok = await screen.findByLabelText('GPU 0 · slot 2 health')
    expect(ok).toHaveTextContent('✓ no faults')
    expect(ok).toHaveTextContent('link Gen4 x16 at best · now Gen1 x16')
    expect(ok).toHaveTextContent('correctable: 26 replays · 3.5k NAKs · 10k retrains · 3.5k AER')
    expect(ok).not.toHaveTextContent('rollovers') // no faults: the zeros are in the hover, not the block
    const bad = screen.getByLabelText('GPU 1 · slot 7 health')
    expect(bad).toHaveTextContent('⚠ 2 faults')
    expect(bad).toHaveTextContent('Xid 2')
    expect(bad).not.toHaveTextContent('rollovers')
    expect(bad).toHaveAttribute('title', expect.stringContaining('Last Xid 79'))
    expect(screen.getByText(/driver 615\.71\.09/)).toBeInTheDocument()
  })
})

describe('the GPUs page helpers', () => {
  it('reads held clocks the way the card shows them', () => {
    expect(heldBy(['power cap'], 3)?.label).toBe('idle')
    expect(heldBy(['power cap', 'HW slowdown'], 90)?.label).toBe('HW slowdown')
    expect(heldBy([], 90)).toBeNull()
  })

  it('splits rates and shortens counts', () => {
    expect(rateParts(1_234_000)).toEqual({ value: '1.2', unit: 'MB/s' })
    expect(rateParts(400)).toEqual({ value: '400', unit: 'B/s' })
    expect(formatCount(36)).toBe('36')
    expect(formatCount(3462)).toBe('3.5k')
    expect(formatCount(13_512)).toBe('14k')
  })
})

describe('the GPU page’s colours', () => {
  it('draws a GPU temperature white, then amber near the target, red near the maximum', async () => {
    const { gpuTempColor } = await import('../lib/gpus')
    expect(gpuTempColor(30)).toBe('#f4f4f5')
    expect(gpuTempColor(82)).not.toBe('#f4f4f5')
    expect(gpuTempColor(91)).not.toBe(gpuTempColor(82))
  })

  it('keeps a few seconds of thermal capping grey, and a minute or more amber', async () => {
    respondBy({ gpus: doc([{ health: { ...HEALTHY, thermal_s: 6 } }, { health: { ...HEALTHY, thermal_s: 136 } }]) })
    withStore(<GpuHealthPanel />, [gpu(0), gpu(1)])
    expect(await screen.findByText('clocks capped for heat 6 s')).toHaveClass('text-zinc-500')
    expect(screen.getByText('clocks capped for heat 2 min')).toHaveClass('text-amber-400/90')
  })
})
