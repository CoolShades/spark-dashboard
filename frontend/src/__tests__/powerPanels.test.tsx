import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MetricsStoreContext } from '../hooks/useMetricsStore'
import { resetPowerPollers } from '../hooks/usePowerDocument'
import { MetricsHistoryStore } from '../lib/metricsHistoryStore'
import { PowerBaselinePanel } from '../components/grid/panels/power/PowerBaselinePanel'
import { PowerCostPanel } from '../components/grid/panels/power/PowerCostPanel'
import { PowerEnergyPanel } from '../components/grid/panels/power/PowerEnergyPanel'
import { PowerSuppliesPanel } from '../components/grid/panels/power/PowerSuppliesPanel'
import { PowerUpsPanel } from '../components/grid/panels/power/PowerUpsPanel'
import { PowerWallPanel } from '../components/grid/panels/power/PowerWallPanel'
import type { GpuMetrics, MetricsSnapshot } from '../types/metrics'
import type { PowerNow } from '../types/power'

function gpu(index: number, watts: number): GpuMetrics {
  return {
    index,
    name: `RTX 3090 #${index}`,
    utilization_percent: 90,
    memory_total_bytes: 24 * 2 ** 30,
    memory_used_bytes: 20 * 2 ** 30,
    temperature_celsius: 60,
    power_watts: watts,
    power_limit_watts: 350,
    clock_graphics_mhz: 1700,
    clock_sm_mhz: 1700,
    clock_memory_mhz: 9500,
    fan_speed_percent: 50,
    pcie_rx_bytes_per_sec: 0,
    pcie_tx_bytes_per_sec: 0,
  }
}

/** A host whose GPUs draw these watts. */
function snapshot(watts: number[]): MetricsSnapshot {
  const gpus = watts.map((w, i) => gpu(i, w))
  return {
    timestamp_ms: Date.now(),
    gpu: gpus[0],
    gpus,
    cpu: { name: 'Threadripper', aggregate_percent: 10, per_core: [{ id: 0, usage_percent: 10 }] },
    memory: {
      total_bytes: 256 * 2 ** 30,
      display_total_bytes: 256 * 2 ** 30,
      used_bytes: 64 * 2 ** 30,
      available_bytes: 192 * 2 ** 30,
      cached_bytes: 8 * 2 ** 30,
      gpu_estimated_bytes: 0,
      gpu_memory_total_bytes: null,
      gpu_memory_used_bytes: null,
      is_unified: false,
    },
    disk: { name: 'nvme0n1', read_bytes_per_sec: 0, write_bytes_per_sec: 0 },
    network: { name: 'eno1', rx_bytes_per_sec: 0, tx_bytes_per_sec: 0 },
    engines: [],
    gpu_events: [],
  }
}

const NOW: PowerNow = {
  at: '2026-10-29T16:11:50+00:00',
  total_watts: 1404,
  total_source: 'UPS output',
  total_estimated: true,
  cost_per_hour: 0.37,
  ups: {
    name: 'Smart-UPS 3000',
    status: 'online',
    status_detail: 'ONLINE',
    load_percent: 52,
    output_watts: 1404,
    capacity_watts: 2700,
    battery_percent: 100,
    runtime_seconds: 1200,
    input_volts: 236.1,
    input_hz: 50.1,
    temperature_c: 17.5,
    last_transfer: 'Automatic or explicit self test',
    transfers: 1,
  },
  other_loads: [{ name: 'Router + switch', watts: 25, estimated: true }],
  supplies: [
    {
      name: 'AX1600i', input_watts: 646, output_watts: 600, capacity_watts: 1600, temperature_c: 54.25, fan_rpm: 780, input_volts: 233, warning: 'output current warning',
      connectors: [
        { name: '12V #0', volts: 12.05, amps: 0, watts: 0, ocp_amps: null },
        { name: '12V #6', volts: 12.03, amps: 5.4, watts: 64, ocp_amps: 40.5 },
      ],
    },
    {
      name: 'HX850i', input_watts: null, output_watts: 460, capacity_watts: 850, temperature_c: 42, fan_rpm: 0, input_volts: 230, warning: null,
      rails: [
        { name: '12V', nominal_volts: 12, volts: 12.06, amps: 36.8, watts: 436, volts_min_24h: 12.01, volts_max_24h: 12.14 },
        { name: '5V', nominal_volts: 5, volts: 5.32, amps: 1.9, watts: 9, volts_min_24h: 4.98, volts_max_24h: 5.32 },
      ],
    },
  ],
  energy: {
    currency: 'GBP',
    unit_price: 0.2632,
    standing_charge_per_day: 0.5483,
    include_standing_charge: false,
    tariff_label: null,
    today_kwh: 7.6,
    today_cost: 2.0,
    yesterday_same_time_kwh: 4.9,
    month_kwh: 16.5,
    month_cost: 4.35,
    run_rate_kwh_per_day: 9.0,
    run_rate_per_day: 2.37,
    run_rate_per_month: 71.19,
    floor_watts: 296,
    floor_cost_per_month: 56.03,
    today_idle_kwh: 5.1,
    today_work_kwh: 3.3,
    today_work_cost: 0.87,
  },
}

function respond(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body === undefined ? 'no power source configured' : JSON.stringify(body), { status })),
  )
}

function withStore(ui: ReactNode, store = new MetricsHistoryStore()) {
  return render(<MetricsStoreContext.Provider value={store}>{ui}</MetricsStoreContext.Provider>)
}

beforeEach(() => resetPowerPollers())
afterEach(() => {
  resetPowerPollers()
  vi.unstubAllGlobals()
})

describe('Power panels', () => {
  it('say no source is configured when the dashboard has none', async () => {
    respond(404)
    withStore(<PowerUpsPanel />)
    expect(await screen.findByText('No power source configured (--power-url)')).toBeInTheDocument()
  })

  it('show the wall figure, marked as an estimate, split against the GPUs this dashboard reads', async () => {
    respond(200, NOW)
    const store = new MetricsHistoryStore()
    store.ingest(snapshot([500, 525]))
    withStore(<PowerWallPanel />, store)
    expect(await screen.findByText('1,404')).toBeInTheDocument()
    expect(screen.getByText('est.')).toBeInTheDocument()
    expect(screen.getByText('1,025 W')).toBeInTheDocument()
    expect(screen.getByText('354 W')).toBeInTheDocument()
    expect(screen.getByText('Router + switch')).toBeInTheDocument()
    expect(screen.getByText('~25 W')).toBeInTheDocument()
    expect(screen.getByText('AX1600i in 646 W · HX850i out 460 W')).toBeInTheDocument()
  })

  it('draw a live strip once a few polls have landed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      respond(200, NOW)
      withStore(<PowerWallPanel />)
      await screen.findByText('1,404')
      expect(screen.queryByLabelText('Last few minutes')).toBeNull()
      await vi.advanceTimersByTimeAsync(4_500)
      expect(await screen.findByLabelText('Last few minutes')).toBeInTheDocument()
      expect(screen.getByText(/AX1600i in \(metered\)/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('headline the UPS state on mains, and the runtime left on battery', async () => {
    respond(200, NOW)
    const { unmount } = withStore(<PowerUpsPanel />)
    expect(await screen.findByText('Online')).toBeInTheDocument()
    expect(screen.getByText('20m')).toBeInTheDocument()
    unmount()
    resetPowerPollers()

    respond(200, { ...NOW, ups: { ...NOW.ups!, status: 'on_battery', runtime_seconds: 540 } })
    withStore(<PowerUpsPanel />)
    expect(await screen.findByText('9 min')).toBeInTheDocument()
    expect(screen.getByText('left')).toBeInTheDocument()
  })

  it('cost the hour in pence and the month from the run rate, naming the standing charge it leaves out', async () => {
    respond(200, NOW)
    withStore(<PowerCostPanel />)
    expect(await screen.findByText('37p')).toBeInTheDocument()
    expect(screen.getByText('~£71.19')).toBeInTheDocument()
    expect(screen.getByText(/26\.32p\/kWh · standing 55p\/day not included/)).toBeInTheDocument()
  })

  it('compare today with yesterday at the same time', async () => {
    respond(200, NOW)
    withStore(<PowerEnergyPanel />)
    expect(await screen.findByText('7.6')).toBeInTheDocument()
    expect(screen.getByText('▲ 2.7 vs yesterday by now')).toBeInTheDocument()
  })

  it('show each supply on the side it meters, with its warning', async () => {
    respond(200, NOW)
    withStore(<PowerSuppliesPanel />)
    expect(await screen.findByText('AX1600i · in')).toBeInTheDocument()
    expect(screen.getByText('HX850i · out')).toBeInTheDocument()
    expect(screen.getByText('⚠ output current warning')).toBeInTheDocument()
    expect(screen.getByText(/fan off/)).toBeInTheDocument()
    expect(screen.getByText('12V')).toBeInTheDocument()
    expect(screen.getByText(/out 600 W · 93 % efficient/)).toBeInTheDocument()
    expect(screen.getByText('#6')).toBeInTheDocument()
    expect(screen.getByText('5.4')).toBeInTheDocument()
    expect(screen.getByText('24 h 12.01–12.14')).toBeInTheDocument()
  })

  it('split today into the idle floor and the work above it', async () => {
    respond(200, NOW)
    withStore(<PowerBaselinePanel />)
    expect(await screen.findByText('296')).toBeInTheDocument()
    expect(screen.getByText('~£56.03')).toBeInTheDocument()
    expect(screen.getByText('87p')).toBeInTheDocument()
    expect(screen.getByText(/\(39 %\)/)).toBeInTheDocument()
  })

  it('say the idle floor is not reported by a source without one', async () => {
    respond(200, { ...NOW, energy: { ...NOW.energy!, floor_watts: null } })
    withStore(<PowerBaselinePanel />)
    expect(await screen.findByText('Idle floor not reported')).toBeInTheDocument()
  })

  it('share one request between panels reading the same document', async () => {
    respond(200, NOW)
    withStore(
      <>
        <PowerCostPanel />
        <PowerEnergyPanel />
      </>,
    )
    await screen.findByText('37p')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })
})
