import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MetricsStoreContext } from '../hooks/useMetricsStore'
import { resetPowerPollers } from '../hooks/usePowerDocument'
import { cumulativeCost, formatClock } from '../lib/power'
import { MetricsHistoryStore } from '../lib/metricsHistoryStore'
import { PowerBaselinePanel } from '../components/grid/panels/power/PowerBaselinePanel'
import { PowerCostPanel } from '../components/grid/panels/power/PowerCostPanel'
import { PowerEnergyPanel } from '../components/grid/panels/power/PowerEnergyPanel'
import { PowerSuppliesPanel } from '../components/grid/panels/power/PowerSuppliesPanel'
import { PowerSummaryPanel } from '../components/grid/panels/power/PowerSummaryPanel'
import { PowerMainsPanel } from '../components/grid/panels/power/PowerMainsPanel'
import { PowerHistoryPanel } from '../components/grid/panels/power/PowerHistoryPanel'
import { PowerDailyPanel } from '../components/grid/panels/power/PowerDailyPanel'
import { PowerUpsPanel } from '../components/grid/panels/power/PowerUpsPanel'
import { PowerWallPanel } from '../components/grid/panels/power/PowerWallPanel'
import type { GpuMetrics, MetricsSnapshot } from '../types/metrics'
import type { PowerHistory, PowerNow } from '../types/power'

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
    updated: new Date().toISOString(), // fresh: a reading older than 90 s shows as 'Not answering'
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
    run_rate_idle_per_month: 54.0,
    run_rate_work_per_month: 17.19,
    idle_hours_per_day: 21.2,
    idle_time_cost_per_month: 50.12,
    today_idle_cost: 1.13,
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
      expect(screen.getByText(/AX1600i \+ HX850i \(metered\)/)).toBeInTheDocument()
      expect(screen.getByText(/^last \d+ min/)).toBeInTheDocument() // the live chart's caption, its window
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

  it('cost the hour, and split the month and today into being on and work', async () => {
    respond(200, NOW)
    withStore(<PowerCostPanel />)
    expect(await screen.findByText('37p')).toBeInTheDocument()
    expect(screen.getByText(/of it work/)).toBeInTheDocument()
    expect(screen.getByText('~£71.19')).toBeInTheDocument()
    expect(screen.getByText('£54.00')).toBeInTheDocument()
    expect(screen.getByText('£17.19')).toBeInTheDocument()
    expect(screen.getByText(/= idle £1\.13 \+ work/)).toBeInTheDocument()
    expect(screen.getByText(/idle ~21 h\/day/)).toBeInTheDocument()
    expect(screen.getByText('£50.12/mo')).toBeInTheDocument()
    expect(screen.getByText(/26\.32p\/kWh · standing 55p\/day not included/)).toBeInTheDocument()
  })

  it('say the machine is idle when it draws no more than its floor', async () => {
    respond(200, { ...NOW, total_watts: 300, cost_per_hour: 0.08 })
    withStore(<PowerCostPanel />)
    expect(await screen.findByText('idle')).toBeInTheDocument()
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
    expect(screen.getByText(/fan off/)).toBeInTheDocument()
    expect(screen.getByText('12V')).toBeInTheDocument()
    expect(screen.getByText(/out 600 W · 93 % efficient/)).toBeInTheDocument()
    expect(screen.queryByText(/VA\)/)).toBeNull()
    expect(screen.getByText('24 h 12.01–12.14')).toBeInTheDocument()
    expect(screen.queryByText('#6')).toBeNull() // the connector list is not shown
    expect(screen.queryByText(/W rated/)).toBeNull() // the rating drives the bar, not a line of its own
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

describe('a supply with no input-watts meter', () => {
  it('shows its output, and its input as amps at volts, with no efficiency', async () => {
    respond(200, {
      ...NOW,
      supplies: [{ name: 'AX1600i', input_watts: null, output_watts: 282, input_amps: 1.3, capacity_watts: 1600,
        temperature_c: 41, fan_rpm: 0, input_volts: 236, warning: null }],
    })
    withStore(<PowerSuppliesPanel />)
    expect(await screen.findByText('AX1600i · out')).toBeInTheDocument()
    expect(screen.getByText(/in 1\.3 A at 236 V \(≈307 VA\)/)).toBeInTheDocument()
    expect(screen.queryByText(/efficient/)).toBeNull()
  })
})


/** Answers each power document by its path: /api/power/now, /api/power/history?..., /api/power/daily?... */
function respondBy(docs: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(docs).find((k) => String(url).includes(`/api/power/${k}`))
      return key ? new Response(JSON.stringify(docs[key]), { status: 200 }) : new Response('nope', { status: 404 })
    }),
  )
}

function history(points: Array<[number, number]>, extra: Partial<PowerHistory['points'][number]> = {}): PowerHistory {
  return {
    hours: 24, step_seconds: 3600, currency: 'GBP', kwh: 1, cost: 0.27, average_watts: 400, peak_watts: 900,
    input_volts_min: 230, input_volts_max: 240, input_hz_min: 49.9, input_hz_max: 50.1,
    points: points.map(([t, w]) => ({ t, total_watts: w, gpu_watts: 0, input_volts_min: 236, input_volts_max: 238,
      input_hz: 50, on_battery: false, ...extra })),
  }
}

describe('the Energy & Cost card', () => {
  it('heads with the running cost, splits 30 days at the idle floor, and puts each period in a tile', async () => {
    respondBy({ now: NOW, history: history([[Date.UTC(2026, 9, 29, 10), 300], [Date.UTC(2026, 9, 29, 11), 900]]) })
    withStore(<PowerSummaryPanel />)
    expect(await screen.findByText('37p')).toBeInTheDocument()
    expect(screen.getByText('£54.00')).toBeInTheDocument() // per 30 d, being on
    expect(screen.getByText('£17.19')).toBeInTheDocument() // per 30 d, work
    expect(screen.getByRole('group', { name: 'Today' })).toHaveTextContent('£2.007.6 kWh · work 87p')
    expect(screen.getByRole('group', { name: 'Month' })).toHaveTextContent('£4.3516.5 kWh so far')
    expect(screen.getByRole('group', { name: 'Per 30 d' })).toHaveTextContent('~£71.19270 kWh at 7-d rate')
    expect(screen.getByRole('group', { name: 'Vs yesterday' })).toHaveTextContent('▲ 2.7kWh+71p by now') // 2.7 kWh at 26.32p
    expect(screen.getByRole('group', { name: 'Per day' })).toHaveTextContent('£2.379.0 kWh · last 7 d')
    expect(screen.getByRole('group', { name: 'Sitting idle' })).toHaveTextContent('£50.12/mo~21 h a day')
  })

  it('draws today\'s spend against yesterday\'s from the 7-day document', async () => {
    const flat = (w: number) => Array.from({ length: 24 }, () => w)
    respondBy({
      now: NOW,
      daily: { currency: 'GBP', days: [
        { date: '2026-10-28', kwh: 9.6, cost: 2.53, average_watts: 400, peak_watts: 900, coverage: 1, hourly_watts: flat(400) },
        { date: '2026-10-29', kwh: 4.8, cost: 1.26, average_watts: 400, peak_watts: 900, coverage: 0.5, hourly_watts: flat(400) },
      ] },
    })
    withStore(<PowerSummaryPanel />)
    expect(await screen.findByLabelText('Today vs yesterday, cost through the day')).toBeInTheDocument()
    expect(screen.getByText(/£2\.53 all day/)).toBeInTheDocument() // 400 W for 24 h at 26.32p
  })
})

describe('a day\'s spend hour by hour', () => {
  it('adds each hour at the unit price, skips hours with no reading, and stops today at now', () => {
    const day = { date: '2026-10-29', kwh: 0, cost: 0, average_watts: null, peak_watts: null, coverage: 1,
      hourly_watts: [1000, null, 500, ...Array.from({ length: 21 }, () => 0)] }
    const all = cumulativeCost(day, 0.25)
    expect(all[0]).toEqual([0, 0])
    expect(all[1]).toEqual([1, 0.25])
    expect(all[2]).toEqual([2, 0.25]) // no reading: nothing added
    expect(all[3][1]).toBeCloseTo(0.375)
    expect(all).toHaveLength(25)
    const soFar = cumulativeCost(day, 0.25, 2.5)
    expect(soFar[soFar.length - 1][0]).toBe(2.5)
    expect(soFar[soFar.length - 1][1]).toBeCloseTo(0.3125) // half of hour 2's 0.125
  })
})

describe('the Mains panel', () => {
  it('draws what the UPS hands the PSUs when the source reports it', async () => {
    respondBy({ now: NOW, history: history([[Date.UTC(2026, 9, 29, 10), 300], [Date.UTC(2026, 9, 29, 11), 300]], { output_volts: 237 }) })
    withStore(<PowerMainsPanel />)
    expect(await screen.findByText('UPS out → PSUs')).toBeInTheDocument()
  })
})

describe('the 24 h wall chart', () => {
  it('puts the mains under the time axis as a quality ribbon', async () => {
    respondBy({ now: NOW, history: history([[Date.UTC(2026, 9, 29, 10), 300], [Date.UTC(2026, 9, 29, 11), 900]], { output_volts: 237 }) })
    withStore(<PowerHistoryPanel />)
    expect(await screen.findByLabelText('Mains quality, last 24 h')).toBeInTheDocument()
    expect(screen.getByText('within limits all day')).toBeInTheDocument()
    expect(screen.getByTitle(/within limits · mains in 236\.0–238\.0 V · UPS out 237\.0 V/)).toBeInTheDocument()
  })

  it('marks a minute near a limit, and time on battery', async () => {
    const h = history([[Date.UTC(2026, 9, 29, 10), 300], [Date.UTC(2026, 9, 29, 11), 300], [Date.UTC(2026, 9, 29, 12), 300]])
    h.points[1] = { ...h.points[1], input_volts_max: 251 }
    h.points[2] = { ...h.points[2], on_battery: true }
    respondBy({ now: NOW, history: h })
    withStore(<PowerHistoryPanel />)
    expect(await screen.findByTitle(/near a limit · mains in 236\.0–251\.0 V/)).toBeInTheDocument()
    expect(screen.getByTitle(/on battery/)).toBeInTheDocument()
    expect(screen.getByText('see the marks')).toBeInTheDocument()
  })
})

describe('a supply flagging a condition', () => {
  it('shows a ⚠ beside its name with the condition on hover', async () => {
    respond(200, NOW)
    withStore(<PowerSuppliesPanel />)
    const icon = await screen.findByRole('img', { name: 'output current warning' })
    expect(icon).toHaveAttribute('title', 'output current warning')
    expect(screen.queryByText('⚠ output current warning')).toBeNull()
  })
})

describe('the 7-day heatmap', () => {
  it('draws each day by the hour, with its energy split and cost', async () => {
    const hourly = Array.from({ length: 24 }, (_, h) => (h >= 1 && h <= 4 ? 900 : 300))
    respondBy({
      now: NOW,
      daily: {
        currency: 'GBP',
        days: [
          { date: '2026-10-28', kwh: 7.37, idle_kwh: 7.1, work_kwh: 0.27, cost: 1.96, average_watts: 307, peak_watts: 1280, coverage: 1, gpu_kwh: 2.05, hourly_watts: hourly },
          { date: '2026-10-29', kwh: 8.8, idle_kwh: 5.5, work_kwh: 3.3, cost: 2.34, average_watts: 466, peak_watts: 1553, coverage: 1, hourly_watts: [...hourly.slice(0, 19), null, null, null, null, null] },
        ],
      },
    })
    withStore(<PowerDailyPanel />)
    expect(await screen.findByLabelText('Wed 28 by hour')).toBeInTheDocument()
    expect(screen.getByLabelText('Wed 28 02:00–03:00 · 900 W average')).toBeInTheDocument()
    expect(screen.getByLabelText('Thu 29 20:00–21:00 · no reading')).toBeInTheDocument()
    // newest day first
    expect(screen.getAllByText(/^(Wed 28|Thu 29)$/).map((e) => e.textContent)).toEqual(['Thu 29', 'Wed 28'])
    // an hour's tooltip: its draw and what it cost, split at the idle floor (296 W, 26.32p/kWh in the fixture)
    fireEvent.mouseEnter(screen.getByLabelText('Wed 28 02:00–03:00 · 900 W average'))
    const tip = within(screen.getByText('Wed 28 · 02:00–03:00').parentElement!)
    expect(tip.getByText('900 W')).toBeInTheDocument()
    expect(tip.getByText('8p')).toBeInTheDocument() // being on: 296 W for an hour
    expect(tip.getByText('16p')).toBeInTheDocument() // work: 604 W for an hour
    expect(screen.getByText('£2.34')).toBeInTheDocument()
    expect(screen.getByText(/16\.2 kWh/)).toBeInTheDocument()
  })
})

describe('a 12 V connector near its limit', () => {
  it('raises the supply\'s ⚠ with the connector named', async () => {
    respond(200, {
      ...NOW,
      supplies: [{ name: 'AX1600i', input_watts: null, output_watts: 900, capacity_watts: 1600, temperature_c: 50,
        fan_rpm: 400, input_volts: 236, warning: null,
        connectors: [{ name: '12V #6', volts: 11.9, amps: 35, watts: 416, ocp_amps: 40.5 }, { name: '12V #1', volts: 12, amps: 3, watts: 36, ocp_amps: 40.5 }] }],
    })
    withStore(<PowerSuppliesPanel />)
    expect(await screen.findByRole('img', { name: '12V #6 at 35.0 A of its 40.5 A limit' })).toBeInTheDocument()
  })
})

describe('a UPS that has stopped answering', () => {
  it('says so instead of repeating its last state', async () => {
    const old = new Date(Date.now() - 526_000).toISOString()
    respond(200, { ...NOW, ups: { ...NOW.ups!, updated: old } })
    withStore(<PowerUpsPanel />)
    expect(await screen.findByText('Not answering')).toBeInTheDocument()
    expect(screen.queryByText('Online')).toBeNull()
    expect(screen.getByText(/no reading for 9 min/)).toBeInTheDocument()
  })
})

describe('each supply\'s last 24 h', () => {
  it('fills the card under the rails, with the peak against the rating, and says since when a supply was read', async () => {
    const t = [10, 11, 12].map((h) => Date.UTC(2026, 9, 29, h))
    const h = history([[t[0], 1000], [t[1], 1400], [t[2], 1200]])
    h.supply_labels = ['AX1600i', 'HX850i']
    h.points = h.points.map((p, i) => ({ ...p, supplies_watts: [[600, 900, 700][i], [null, 400, 460][i]] }))
    respondBy({ now: NOW, history: h })
    withStore(<PowerSuppliesPanel />)
    const ax = await screen.findByLabelText('AX1600i, last 24 h')
    expect(ax.textContent).toContain(`last 24 h · peak 900 W (56 %) at ${formatClock(t[1])}`)
    expect(ax.textContent).toContain('avg 733 W')
    const hx = screen.getByLabelText('HX850i, last 24 h')
    expect(hx.textContent).toContain(`since ${formatClock(t[1])} · peak 460 W (54 %) at ${formatClock(t[2])}`)
    expect(hx.textContent).toContain('avg 430 W')
  })

  it('leaves the space empty for a source that sends no per-supply series', async () => {
    respondBy({ now: NOW, history: history([[Date.UTC(2026, 9, 29, 10), 300], [Date.UTC(2026, 9, 29, 11), 900]]) })
    withStore(<PowerSuppliesPanel />)
    expect(await screen.findByText('HX850i · out')).toBeInTheDocument()
    expect(screen.queryByLabelText(/last 24 h/)).toBeNull()
  })
})

describe('the 7-day heatmap key', () => {
  it('reads "kWh · on/work", with each day\'s kWh in a column of its own', async () => {
    const hourly = Array.from({ length: 24 }, () => 300)
    respondBy({
      now: NOW,
      daily: {
        currency: 'GBP',
        days: [{ date: '2026-10-29', kwh: 8.8, idle_kwh: 5.5, work_kwh: 3.3, cost: 2.34, average_watts: 466, peak_watts: 1553, coverage: 1, hourly_watts: hourly }],
      },
    })
    withStore(<PowerDailyPanel />)
    expect(await screen.findByText('8.8')).toBeInTheDocument()
    expect(screen.getAllByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'kWh · on/work')).toHaveLength(1)
    expect(screen.queryByText(/being on \//)).toBeNull()
  })
})

describe('a day in the 7-day heatmap', () => {
  it('writes its kWh inside the bar and opens a day card on hover, with no browser tooltip', async () => {
    respondBy({
      now: NOW,
      daily: {
        currency: 'GBP',
        days: [{ date: '2026-10-29', kwh: 8.8, idle_kwh: 5.5, work_kwh: 3.3, cost: 2.34, average_watts: 466, peak_watts: 1553, coverage: 1, gpu_kwh: 2.2, hourly_watts: Array.from({ length: 24 }, () => 300) }],
      },
    })
    withStore(<PowerDailyPanel />)
    const bar = await screen.findByLabelText('Thu 29 energy')
    expect(within(bar).getByText('8.8')).toBeInTheDocument()
    expect(bar).not.toHaveAttribute('title')
    fireEvent.mouseEnter(bar)
    const tip = within(screen.getByText('Thu 29 · so far').parentElement!)
    expect(tip.getByText('5.5 kWh · £1.46')).toBeInTheDocument() // being on: the cost shared out by kWh
    expect(tip.getByText('3.3 kWh · 88p')).toBeInTheDocument()
    expect(tip.getByText('8.8 kWh · £2.34')).toBeInTheDocument()
    expect(tip.getByText('GPUs 25 % of the energy')).toBeInTheDocument()
  })
})

describe('the UPS card\'s supply and battery rows', () => {
  const UPS_MORE = {
    ...NOW.ups!, output_volts: 236.1, avr: null, battery_volts: 54.5, self_test: 'passed', battery_date: '2026-10-15',
    shutdown_battery_percent: 20, shutdown_runtime_seconds: 300,
    battery_events: { days: 30, since: '2026-09-01T00:00:00Z', events: [
      { start: '2026-10-24T12:02:00Z', seconds: 12, reason: 'Low line voltage', self_test: false },
      { start: '2026-10-27T20:43:00Z', seconds: 5, reason: 'Automatic or explicit self test', self_test: true },
    ] },
  }

  it('shows the mains in, what the PSUs get, the power cuts, the temperature, battery volts and battery age', async () => {
    respond(200, { ...NOW, ups: UPS_MORE })
    withStore(<PowerUpsPanel />)
    expect(await screen.findByRole('group', { name: 'Mains in' })).toHaveTextContent('236.1V50.1 Hz')
    expect(screen.getByRole('group', { name: 'To PSUs' })).toHaveTextContent('mains passed through')
    const cuts = screen.getByRole('group', { name: 'Power cuts' })
    expect(cuts).toHaveTextContent('Power cuts1in 30 dlast 24 Oct, ~12 s') // the self-test is not a cut
    expect(cuts.parentElement).toHaveAttribute('title', expect.stringContaining('(Low line voltage)'))
    expect(screen.getByRole('group', { name: 'Temperature' })).toHaveTextContent('17.5°C')
    expect(screen.getByRole('group', { name: 'Battery V' })).toHaveTextContent('54.5Vself-test passed')
    expect(screen.getByRole('group', { name: 'Battery age' })).toHaveTextContent(/dated 15 Oct 2026$/)
    expect(screen.getByText(/shuts down at 20 % or 5 min left/)).toBeInTheDocument()
  })

  it('names the AVR at work, draws a failed self-test red, and counts from when monitoring began', async () => {
    respond(200, { ...NOW, ups: { ...UPS_MORE, avr: 'trim', self_test: 'failed (battery capacity)',
      battery_events: { days: 30, since: new Date(Date.now() - 2 * 86_400_000).toISOString(), events: [] } } })
    withStore(<PowerUpsPanel />)
    expect(await screen.findByText('AVR trimming high mains')).toBeInTheDocument()
    expect(screen.getByText('self-test failed (battery capacity)')).toHaveClass('text-red-400')
    expect(screen.getByRole('group', { name: 'Power cuts' })).toHaveTextContent(/^Power cuts0since \d+ \w+none recorded$/)
  })

  it('leaves out what the source does not report', async () => {
    respond(200, NOW)
    withStore(<PowerUpsPanel />)
    await screen.findByText('Online')
    expect(screen.getByRole('group', { name: 'Mains in' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'To PSUs' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Power cuts' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Battery age' })).toBeNull()
  })
})

describe('the wall card\'s GPU row', () => {
  it('shows each card\'s draw with its slot, against its power limit', async () => {
    const h = history([[Date.UTC(2026, 9, 29, 10), 300], [Date.UTC(2026, 9, 29, 11), 900]])
    h.gpu_labels = ['GPU 0 · slot 2', 'GPU 1 · slot 7']
    respondBy({ now: NOW, history: h })
    const store = new MetricsHistoryStore()
    store.ingest(snapshot([175, 21]))
    withStore(<PowerWallPanel />, store)
    expect(await screen.findByText('slot 7')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'GPU 0' })).toHaveTextContent('GPU 0175Wslot 2')
    expect(screen.getByLabelText('GPU 0, 50 % of its power limit')).toBeInTheDocument() // 175 of 350 W
    expect(screen.getByLabelText('GPU 1, 6 % of its power limit')).toBeInTheDocument()
  })
})
