import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useEffect } from 'react'
import { MetricsStoreProvider } from '../hooks/MetricsStoreProvider'
import { useMetricSeries } from '../hooks/useMetricsStore'
import { useMetrics } from '../hooks/useMetrics'
import { useMetricsIngest } from '../hooks/useMetricsIngest'
import { MockWebSocket, substituteWebSocket } from '../test/websocket'
import type { MetricsSnapshot } from '../types/metrics'

// The store is deliberately tested through the substituted WebSocket — the
// same seam the log panel spec uses — so the real ingest and subscription
// logic runs end to end instead of being mocked away.
substituteWebSocket()

function snapshot(ts: number, util: number, temp: number | null): MetricsSnapshot {
  return {
    timestamp_ms: ts,
    gpu: {
      index: 0,
      name: 'GPU 0',
      utilization_percent: util,
      temperature_celsius: temp,
      power_watts: null,
      power_limit_watts: null,
      clock_graphics_mhz: null,
      clock_sm_mhz: null,
      clock_memory_mhz: null,
      fan_speed_percent: null,
      pcie_rx_bytes_per_sec: null,
      pcie_tx_bytes_per_sec: null,
    },
    cpu: { name: 'CPU', aggregate_percent: 25, per_core: [] },
    memory: {
      total_bytes: 128,
      used_bytes: 64,
      available_bytes: 64,
      cached_bytes: 8,
      gpu_estimated_bytes: null,
      gpu_memory_total_bytes: null,
      gpu_memory_used_bytes: null,
      is_unified: false,
    },
    disk: { name: 'disk', read_bytes_per_sec: 1, write_bytes_per_sec: 2 },
    network: { name: 'net', rx_bytes_per_sec: 3, tx_bytes_per_sec: 4 },
    engines: [],
    gpu_events: [],
  }
}

/** The app's real wiring: the socket hook feeding the store, as App does. */
function Feed() {
  const { batch } = useMetrics()
  useMetricsIngest(batch)
  return null
}

/** Answers the history route with `kept` (only the snapshots after `since`), and records each request. */
function serveHistory(kept: MetricsSnapshot[]) {
  const asked: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(String(url))
      const since = Number(new URL(String(url), 'http://x').searchParams.get('since') ?? 0)
      return new Response(JSON.stringify(kept.filter((s) => s.timestamp_ms > since)), { status: 200 })
    }),
  )
  return asked
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

const renderCounts: Record<string, number> = {}

/** A component subscribed to a single series, the way a panel will be. The
 *  dependency-less effect runs once per committed render, which is the count
 *  the spec asserts on — a skipped re-render leaves it untouched. */
function Probe({ series }: { series: string }) {
  const data = useMetricSeries(series)
  useEffect(() => {
    renderCounts[series] = (renderCounts[series] ?? 0) + 1
  })
  return <output data-testid={series}>{data.map((p) => p.value).join(',')}</output>
}

describe('metrics store through the substituted socket', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    for (const key of Object.keys(renderCounts)) delete renderCounts[key]
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    setHidden(false)
  })

  it('re-renders only the subscribers of the series a snapshot changed', () => {
    render(
      <MetricsStoreProvider>
        <Feed />
        <Probe series="gpuUtil" />
        <Probe series="gpuTemp" />
      </MetricsStoreProvider>,
    )
    const socket = MockWebSocket.instances[0]

    // The very first frame flushes into the UI immediately.
    act(() => socket.receive(JSON.stringify(snapshot(1000, 11, 40))))
    expect(screen.getByTestId('gpuUtil')).toHaveTextContent('11')
    expect(screen.getByTestId('gpuTemp')).toHaveTextContent('40')

    const utilRenders = renderCounts['gpuUtil']
    const tempRenders = renderCounts['gpuTemp']

    // The next frame carries no temperature; later frames flush on the timer.
    act(() => {
      socket.receive(JSON.stringify(snapshot(2000, 12, null)))
      vi.advanceTimersByTime(2000)
    })

    expect(screen.getByTestId('gpuUtil')).toHaveTextContent('11,12')
    expect(renderCounts['gpuUtil']).toBeGreaterThan(utilRenders)
    // The temperature series gained nothing, so its subscriber did not render.
    expect(renderCounts['gpuTemp']).toBe(tempRenders)
    expect(screen.getByTestId('gpuTemp')).toHaveTextContent('40')
  })

  it('keeps every frame a hidden tab receives and charts them all when it is shown again', () => {
    render(
      <MetricsStoreProvider>
        <Feed />
        <Probe series="gpuUtil" />
      </MetricsStoreProvider>,
    )
    const socket = MockWebSocket.instances[0]
    act(() => socket.receive(JSON.stringify(snapshot(1000, 1, 40))))
    act(() => setHidden(true))
    act(() => {
      for (let t = 2; t <= 5; t++) socket.receive(JSON.stringify(snapshot(t * 1000, t, 40)))
      vi.advanceTimersByTime(8000)
    })
    // Hidden: nothing is drawn, but nothing is dropped either.
    expect(screen.getByTestId('gpuUtil')).toHaveTextContent(/^1$/)
    act(() => setHidden(false))
    expect(screen.getByTestId('gpuUtil')).toHaveTextContent('1,2,3,4,5')
  })

  it('fills the minutes the server kept before the live frames, once the socket opens', async () => {
    const asked = serveHistory([snapshot(1000, 5, 40), snapshot(2000, 6, 40), snapshot(3000, 7, 40)])
    render(
      <MetricsStoreProvider>
        <Feed />
        <Probe series="gpuUtil" />
      </MetricsStoreProvider>,
    )
    const socket = MockWebSocket.instances[0]
    await act(async () => {
      socket.connect()
      // A live frame the server also kept, and a newer one, arrive while the backfill is in flight.
      socket.receive(JSON.stringify(snapshot(3000, 7, 40)))
      socket.receive(JSON.stringify(snapshot(4000, 8, 40)))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(asked).toEqual(['/api/metrics/history?since=0'])
    expect(screen.getByTestId('gpuUtil')).toHaveTextContent('5,6,7,8')

    // A dropped socket reconnects and asks only for what it missed.
    await act(async () => {
      socket.close()
      await vi.advanceTimersByTimeAsync(1000)
      MockWebSocket.instances[1].connect()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(asked[1]).toBe('/api/metrics/history?since=4000')
  })

  it('replaces a socket that went silent without closing, as one does across a sleep', async () => {
    serveHistory([])
    render(
      <MetricsStoreProvider>
        <Feed />
      </MetricsStoreProvider>,
    )
    const socket = MockWebSocket.instances[0]
    await act(async () => {
      socket.connect()
      await vi.advanceTimersByTimeAsync(0)
      socket.receive(JSON.stringify(snapshot(1000, 1, 40)))
    })
    expect(MockWebSocket.instances).toHaveLength(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000)
    })
    expect(MockWebSocket.instances).toHaveLength(2)
  })
})
