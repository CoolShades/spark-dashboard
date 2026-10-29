import { useMetricSeries } from '@/hooks/useMetricsStore'
import { engineKey } from '@/lib/identity'
import { engineSeries, type DataPoint, type EngineSeriesName } from '@/lib/metricsHistoryStore'
import type { DashboardPanel } from '@/lib/dashboard/schema'
import type { EngineSnapshot } from '@/types/metrics'
import { useEngineTarget } from '../useEnginePanel'

/** The engine a Tokens card shows live (the page's, as the engine panels resolve it), or null when none is serving. */
export function useTokensEngine(panel: DashboardPanel): EngineSnapshot | null {
  const target = useEngineTarget(panel)
  return target.status === 'resolved' ? target.engine : null
}

/** One of the engine's live series over the panel's window (empty without an engine). */
export function useEngineSeries(engine: EngineSnapshot | null, name: EngineSeriesName, panel: DashboardPanel): DataPoint[] {
  return useMetricSeries(engineSeries(name, engine ? engineKey(engine) : 'none'), panel.window)
}
