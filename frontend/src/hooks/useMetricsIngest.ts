import { useEffect } from 'react'
import { useMetricsStore } from './useMetricsStore'
import type { MetricsBatch } from './useMetrics'

/**
 * Feeds each flushed batch into the metrics store — and nothing else. The page
 * mounts this once at its root and stays out of the render path: panels
 * subscribe to their own series through `useMetricSeries`, so a batch
 * re-renders the panels it touched rather than the whole page.
 */
export function useMetricsIngest(batch: MetricsBatch | null): void {
  const store = useMetricsStore()

  useEffect(() => {
    if (!batch) return
    store.ingestAll(batch.history, { history: true })
    store.ingestAll(batch.live)
  }, [store, batch])
}
