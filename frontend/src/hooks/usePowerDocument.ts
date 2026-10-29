/**
 * The Power panels' data: one poller per document, shared by every panel that
 * reads it. Four panels on a page all show `/now`; they must cost the power
 * source one request per interval, not four, and agree on the figure.
 *
 * A poller runs only while some panel is mounted and stops with the last one,
 * so a dashboard without a Power page never calls `/api/power` at all.
 */

import { useCallback, useSyncExternalStore } from 'react'

export type PowerDocumentStatus = 'loading' | 'ready' | 'not-configured' | 'unavailable'

export interface PowerDocumentState<T> {
  status: PowerDocumentStatus
  /** The last good document. Kept through a failed poll, so a panel goes stale rather than blank. */
  data: T | null
  /** When `data` was fetched (epoch ms), or null before the first success. */
  fetchedAt: number | null
  /**
   * The good documents of the last few minutes, oldest first (RECENT_MS), for a panel that draws its own live
   * strip: the slow-moving history document is minute means, this is every poll.
   */
  recent: ReadonlyArray<{ at: number; data: T }>
}

/** How much of the poll history a document keeps for live strips. */
export const RECENT_MS = 5 * 60_000

interface Poller {
  state: PowerDocumentState<unknown>
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
  intervalMs: number
}

const pollers = new Map<string, Poller>()

async function poll(path: string, poller: Poller): Promise<void> {
  let next: PowerDocumentState<unknown>
  try {
    const resp = await fetch(`/api/power/${path}`, { headers: { Accept: 'application/json' } })
    if (resp.status === 404) {
      next = { status: 'not-configured', data: null, fetchedAt: null, recent: [] }
    } else if (!resp.ok) {
      next = { ...poller.state, status: 'unavailable' }
    } else {
      const data: unknown = await resp.json()
      const at = Date.now()
      const recent = [...poller.state.recent.filter((r) => at - r.at <= RECENT_MS), { at, data }]
      next = { status: 'ready', data, fetchedAt: at, recent }
    }
  } catch {
    next = { ...poller.state, status: 'unavailable' }
  }
  if (!pollers.has(path)) return // the last panel went away while the request was in flight
  poller.state = next
  for (const listener of poller.listeners) listener()
}

function subscribe(path: string, intervalMs: number, listener: () => void): () => void {
  let poller = pollers.get(path)
  if (!poller) {
    poller = {
      state: { status: 'loading', data: null, fetchedAt: null, recent: [] },
      listeners: new Set(),
      timer: null,
      intervalMs,
    }
    pollers.set(path, poller)
  }
  poller.listeners.add(listener)
  if (!poller.timer) {
    const p = poller
    void poll(path, p)
    p.timer = setInterval(() => void poll(path, p), p.intervalMs)
  }
  return () => {
    const p = pollers.get(path)
    if (!p) return
    p.listeners.delete(listener)
    if (p.listeners.size === 0) {
      if (p.timer) clearInterval(p.timer)
      pollers.delete(path)
    }
  }
}

const INITIAL: PowerDocumentState<never> = { status: 'loading', data: null, fetchedAt: null, recent: [] }

/**
 * One power document, re-rendering when a poll lands. `path` includes any
 * query (`history?hours=24`); panels asking for the same path share a poller
 * at the interval of whichever mounted first.
 */
export function usePowerDocument<T>(path: string, intervalMs: number): PowerDocumentState<T> {
  const sub = useCallback((listener: () => void) => subscribe(path, intervalMs, listener), [path, intervalMs])
  const get = useCallback(
    () => (pollers.get(path)?.state ?? INITIAL) as PowerDocumentState<T>,
    [path],
  )
  return useSyncExternalStore(sub, get)
}

/** Polling intervals: live readings every 2 s; history and daily totals move slowly. */
export const POWER_POLL_MS = { now: 2_000, history: 60_000, daily: 300_000 } as const

/** For specs: forget every poller, as if no panel had ever mounted. */
export function resetPowerPollers(): void {
  for (const p of pollers.values()) if (p.timer) clearInterval(p.timer)
  pollers.clear()
}
