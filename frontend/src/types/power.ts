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
}

export interface PowerSupply {
  name: string
  input_watts: number | null
  output_watts: number | null
  capacity_watts: number | null
  temperature_c: number | null
  fan_rpm: number | null
  input_volts: number | null
  /** A condition the supply flags, in words; null when it flags nothing. */
  warning: string | null
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
  energy: PowerEnergy | null
  mains?: MainsLimits | null
}

export interface PowerHistoryPoint {
  /** Start of the step, epoch milliseconds. */
  t: number
  total_watts: number | null
  gpu_watts: number | null
  input_volts_min: number | null
  input_volts_max: number | null
  input_hz: number | null
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
