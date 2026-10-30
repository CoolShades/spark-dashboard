import { useState, useEffect, useRef } from 'react'
import { BUFFER_CAPACITY } from '@/lib/metricsHistoryStore'
import type { MetricsSnapshot } from '../types/metrics'

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

/** What one flush hands the store, oldest first within each list. */
export interface MetricsBatch {
  /**
   * Snapshots the server kept for the time this client was away (closed, asleep,
   * or reconnecting), all older than `live`. Slimmed by the server: they fill
   * the series and never become the latest reading.
   */
  history: MetricsSnapshot[]
  /** Every frame received since the last flush. */
  live: MetricsSnapshot[]
}

/** The most frames a hidden tab queues: the store keeps no more than this. */
const MAX_QUEUED = BUFFER_CAPACITY
/** How long a backfill may hold the live stream back before it is given up. */
const BACKFILL_TIMEOUT_MS = 5000
/**
 * Silence that means the socket died while the page slept or was frozen, and
 * no close event came: the hook reconnects, and the reconnect backfills.
 */
const SILENT_MS = 10_000

export function useMetrics() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null)
  const [batch, setBatch] = useState<MetricsBatch | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [isStale, setIsStale] = useState(false)
  const lastMessageTime = useRef<number>(0)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)
  const pendingRef = useRef<MetricsSnapshot[]>([])
  const historyRef = useRef<MetricsSnapshot[]>([])
  const backfills = useRef(0)
  const connectedRef = useRef(false)
  const newestRef = useRef(0)
  const initialFlushDone = useRef(false)

  // `connect` is declared inside the effect rather than as a `useCallback`
  // because the reconnect path schedules `connect` itself. A `useCallback`
  // cannot reference its own binding without reading it before it is
  // initialised; a function declaration in the effect scope is hoisted, so
  // the self-reference is well-defined. The socket and the flush timer are
  // mount-scoped external resources, so the effect is their natural owner.
  useEffect(() => {
    let disposed = false

    /** Hand everything queued to React state as one batch, so the store notifies once. */
    function deliver() {
      const live = pendingRef.current
      // A kept snapshot the live stream also delivered is dropped for the live
      // one, which is whole.
      const history = live.length > 0
        ? historyRef.current.filter((s) => s.timestamp_ms < live[0].timestamp_ms)
        : historyRef.current
      if (history.length === 0 && live.length === 0) return
      pendingRef.current = []
      historyRef.current = []
      setBatch({ history, live })
      if (live.length > 0) {
        initialFlushDone.current = true
        setMetrics(live[live.length - 1])
      }
      setIsStale(false)
    }

    /** Fetch the snapshots the server kept since the newest this client has. */
    async function backfill() {
      backfills.current++
      const since = newestRef.current
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), BACKFILL_TIMEOUT_MS)
      try {
        const resp = await fetch(`/api/metrics/history?since=${since}`, { signal: controller.signal })
        const kept: unknown = resp.ok ? await resp.json() : []
        if (!disposed && Array.isArray(kept)) {
          const fresh = (kept as MetricsSnapshot[]).filter((s) => s.timestamp_ms > since)
          historyRef.current = [...historyRef.current, ...fresh].slice(-MAX_QUEUED)
          for (const s of fresh) newestRef.current = Math.max(newestRef.current, s.timestamp_ms)
        }
      } catch {
        // A server without the route, or a slow one: the live stream goes on without it.
      } finally {
        clearTimeout(timer)
        backfills.current--
        if (!disposed && backfills.current === 0 && !document.hidden) deliver()
      }
    }

    function connect() {
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        connectedRef.current = true
        setConnectionStatus('connected')
        attemptRef.current = 0
        void backfill()
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as MetricsSnapshot
          lastMessageTime.current = Date.now()
          // Every frame is kept, not just the newest: a hidden tab flushes the
          // minutes it queued when it is shown again.
          pendingRef.current.push(data)
          if (pendingRef.current.length > MAX_QUEUED) pendingRef.current.shift()
          newestRef.current = Math.max(newestRef.current, data.timestamp_ms)
          // Render the very first snapshot immediately so the UI isn't blank
          // (after the backfill, which has to land first to stay in order).
          if (!initialFlushDone.current && backfills.current === 0) deliver()
        } catch { /* ignore parse errors */ }
      }

      ws.onclose = () => {
        wsRef.current = null
        connectedRef.current = false
        if (disposed) return
        setConnectionStatus('reconnecting')
        const delay = Math.min(1000 * Math.pow(2, attemptRef.current), 10000)
        attemptRef.current++
        reconnectTimeout.current = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    /** A socket silent for SILENT_MS is dead without having said so: drop it and start over. */
    function reconnectIfSilent() {
      const ws = wsRef.current
      if (!ws || lastMessageTime.current === 0 || Date.now() - lastMessageTime.current < SILENT_MS) return
      ws.onclose = null
      ws.onmessage = null
      ws.onerror = null
      ws.close()
      connectedRef.current = false
      lastMessageTime.current = Date.now()
      connect()
    }

    // Periodic flush: push the queued frames into React state. Skips when the
    // tab is hidden so the browser can fully throttle the page; the frames
    // stay queued for when it is shown.
    function flush() {
      if (document.hidden) return
      if (pendingRef.current.length > 0 || historyRef.current.length > 0) {
        if (backfills.current === 0) deliver()
      } else if (connectedRef.current && lastMessageTime.current > 0) {
        setIsStale(Date.now() - lastMessageTime.current > 5000)
        reconnectIfSilent()
      }
    }

    // When the tab becomes visible again, flush immediately
    function onVisible() {
      if (document.hidden) return
      reconnectIfSilent()
      flush()
    }

    connect()
    const id = setInterval(flush, 2000)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      disposed = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      wsRef.current?.close()
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current)
    }
  }, [])

  return { metrics, batch, connectionStatus, isStale }
}
