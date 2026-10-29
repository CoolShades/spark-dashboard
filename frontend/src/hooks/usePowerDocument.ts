/**
 * The Power panels' data: one poller per document, shared by every panel that
 * reads it. Four panels on a page all show `/now`; they must cost the power
 * source one request per interval, not four, and agree on the figure.
 *
 * A poller runs only while some panel is mounted and stops with the last one,
 * so a dashboard without a Power page never calls `/api/power` at all. Its
 * last good document outlives it, though: a panel that mounts again (a tab
 * switched back to) paints that at once and refreshes, rather than starting
 * from "waiting" every time. `prefetchPowerDocuments` fills the same memory
 * for pages not opened yet.
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
/** The last good state of every document, kept after its poller stops, so a panel can paint before its first poll. */
const remembered = new Map<string, PowerDocumentState<unknown>>()

function remember(path: string, state: PowerDocumentState<unknown>): void {
  if (state.status === 'ready') remembered.set(path, state)
  else if (state.status === 'not-configured') remembered.delete(path)
}

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
  remember(path, next)
  if (!pollers.has(path)) return // the last panel went away while the request was in flight
  poller.state = next
  for (const listener of poller.listeners) listener()
}

function subscribe(path: string, intervalMs: number, listener: () => void): () => void {
  let poller = pollers.get(path)
  if (!poller) {
    poller = {
      state: remembered.get(path) ?? { status: 'loading', data: null, fetchedAt: null, recent: [] },
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
  // Before its first subscription a panel already reads the remembered document: no "waiting" flash on a tab switch.
  const get = useCallback(
    () => (pollers.get(path)?.state ?? remembered.get(path) ?? INITIAL) as PowerDocumentState<T>,
    [path],
  )
  return useSyncExternalStore(sub, get)
}

/** Polling intervals: live readings every 2 s; history and daily totals move slowly; the GPUs' extras every 5 s. */
export const POWER_POLL_MS = { now: 2_000, history: 60_000, daily: 300_000, gpus: 5_000, gpuHistory: 60_000, tokens: 15_000, tokenHistory: 60_000, tokenDaily: 300_000, host: 10_000, hostHistory: 60_000 } as const

/** Every page's documents, for `prefetchPowerDocuments`: the paths the panels ask for. */
export const POWER_DOCUMENTS = [
  'now', 'history?hours=24', 'daily?days=7', 'gpus', 'gpu-history?hours=24',
  'tokens', 'token-history?hours=24', 'token-daily?days=7', 'host', 'host-history?hours=24',
] as const

/**
 * Fetches documents no panel is polling, once, into the same memory the pollers
 * keep, so the first visit to a page paints at once. Stops at the first 404: a
 * dashboard without a power source asks for nothing more.
 */
export async function prefetchPowerDocuments(paths: readonly string[] = POWER_DOCUMENTS): Promise<void> {
  for (const path of paths) {
    if (pollers.has(path)) continue
    try {
      const resp = await fetch(`/api/power/${path}`, { headers: { Accept: 'application/json' } })
      if (resp.status === 404) return
      if (!resp.ok) continue
      const data: unknown = await resp.json()
      if (!pollers.has(path)) remember(path, { status: 'ready', data, fetchedAt: Date.now(), recent: [{ at: Date.now(), data }] })
    } catch {
      // the panel's own poll will say so when it mounts
    }
  }
}

/** For specs: forget every poller and every remembered document, as if no panel had ever mounted. */
export function resetPowerPollers(): void {
  for (const p of pollers.values()) if (p.timer) clearInterval(p.timer)
  pollers.clear()
  remembered.clear()
}
