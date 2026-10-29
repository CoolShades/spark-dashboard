/**
 * The power source's three documents, as the dashboard relays them under
 * `/api/power/` (docs/power.md). The dashboard does not compute energy or
 * cost: the source owns its tariff and its day boundaries, and these types
 * only say what the panels read. Every figure may be null — a UPS without a
 * temperature probe, a supply without an input meter — and a panel shows
 * "not reported" for it rather than a zero.
 */

export type UpsStatus = 'online' | 'on_battery' | 'low_battery' | 'charging' | 'offline' | 'unknown'

export interface PowerUps {
  name: string | null
  status: UpsStatus
  /** The UPS's own status words, e.g. "ONLINE" or "ONBATT LOWBATT". */
  status_detail?: string | null
  load_percent: number | null
  output_watts: number | null
  capacity_watts: number | null
  battery_percent: number | null
  runtime_seconds: number | null
  input_volts: number | null
  input_hz: number | null
  output_volts?: number | null
  temperature_c: number | null
  last_transfer?: string | null
  transfers?: number | null
  battery_date?: string | null
  /** When the UPS last reported (ISO), so a panel can show the reading's age. */
  updated?: string | null
}

/** One output rail of a supply, for the ones that report per-rail readings. */
export interface PowerRail {
  /** e.g. "12V". */
  name: string
  nominal_volts: number
  volts: number | null
  amps: number | null
  watts: number | null
  /** The rail's voltage range over the last 24 h: a droop under load shows here first. */
  volts_min_24h?: number | null
  volts_max_24h?: number | null
}

/** One 12 V output connector of a multi-rail supply, with its own over-current limit. */
export interface PowerConnector {
  name: string
  volts: number | null
  amps: number | null
  watts: number | null
  /** The connector's OCP limit; null when it has none. */
  ocp_amps: number | null
}

/** A load on the same meter that nothing measures on its own (a router on the UPS): its own slice, marked estimated. */
export interface PowerOtherLoad {
  name: string
  watts: number
  estimated?: boolean
}

export interface PowerSupply {
  name: string
  input_watts: number | null
  output_watts: number | null
  capacity_watts: number | null
  temperature_c: number | null
  fan_rpm: number | null
  input_volts: number | null
  /** Input current, for a supply that meters it but not its input watts: shown as amps at volts (apparent VA). */
  input_amps?: number | null
  /** A condition the supply flags, in words; null when it flags nothing. */
  warning: string | null
  rails?: PowerRail[]
  connectors?: PowerConnector[]
}

export interface PowerEnergy {
  /** ISO 4217, e.g. "GBP". */
  currency: string
  /** Price per kWh, in the currency's major unit. */
  unit_price: number
  standing_charge_per_day: number | null
  include_standing_charge: boolean
  tariff_label: string | null
  today_kwh: number | null
  today_cost: number | null
  /** Yesterday's energy from midnight to the same time of day as now. */
  yesterday_same_time_kwh: number | null
  month_kwh: number | null
  month_cost: number | null
  run_rate_kwh_per_day: number | null
  run_rate_per_day: number | null
  /** Cost per 30 days at the recent run rate. */
  run_rate_per_month: number | null
  /**
   * The idle floor: what the machine draws doing nothing (the reference source uses the 10th-percentile minute
   * of the last 7 days), and what that alone costs per 30 days. Today's energy splits into the part under it
   * (being on) and the part above it (work).
   */
  floor_watts?: number | null
  floor_cost_per_month?: number | null
  today_idle_kwh?: number | null
  today_work_kwh?: number | null
  today_work_cost?: number | null
  today_idle_cost?: number | null
  /** The 30-day run rate split at the floor: the price of being on, and of the work above it. */
  run_rate_idle_per_month?: number | null
  run_rate_work_per_month?: number | null
  /** Hours a day spent at the floor (recent average), and what that time alone costs per 30 days. */
  idle_hours_per_day?: number | null
  idle_time_cost_per_month?: number | null
  /** Set when the live tariff could not be refreshed; the figures then use the last or fallback rates. */
  tariff_error?: string | null
}

/** Acceptable mains limits, for shading the voltage chart. */
export interface MainsLimits {
  nominal_volts: number
  min_volts: number
  max_volts: number
  nominal_hz: number
  min_hz: number
  max_hz: number
}

export interface PowerNow {
  at: string
  /** The whole machine at the wall: what energy and cost are counted from. */
  total_watts: number | null
  /** What `total_watts` measures, e.g. "UPS output". */
  total_source: string | null
  /** True when `total_watts` is derived (e.g. load % x rating) rather than metered. */
  total_estimated?: boolean
  cost_per_hour: number | null
  ups: PowerUps | null
  supplies: PowerSupply[]
  /** Loads on the wall figure besides this machine, subtracted before "system" in the wall split. */
  other_loads?: PowerOtherLoad[]
  energy: PowerEnergy | null
  mains?: MainsLimits | null
}

export interface PowerHistoryPoint {
  /** Start of the step, epoch milliseconds. */
  t: number
  total_watts: number | null
  gpu_watts: number | null
  /** Each GPU's draw over the step, in `gpu_labels` order; optional, the chart then stacks them one by one. */
  gpus_watts?: Array<number | null>
  input_volts_min: number | null
  input_volts_max: number | null
  input_hz: number | null
  /** What the UPS hands the load over the step: equal to the input while it passes mains through. */
  output_volts?: number | null
  on_battery: boolean
}

export interface PowerHistory {
  hours: number
  step_seconds: number
  points: PowerHistoryPoint[]
  kwh: number | null
  cost: number | null
  currency: string
  average_watts: number | null
  peak_watts: number | null
  input_volts_min: number | null
  input_volts_max: number | null
  input_hz_min: number | null
  input_hz_max: number | null
  /** Names for `points[].gpus_watts`, e.g. "GPU 0 · slot 2". */
  gpu_labels?: string[]
  /** The idle floor, drawn as a dashed line. */
  floor_watts?: number | null
}

export interface PowerDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string
  kwh: number
  gpu_kwh?: number | null
  cost: number
  average_watts: number | null
  peak_watts: number | null
  /** Share of the day's minutes with a reading, 0-1 (today: of the minutes so far). */
  coverage: number
}

export interface PowerDaily {
  currency: string
  days: PowerDay[]
}
