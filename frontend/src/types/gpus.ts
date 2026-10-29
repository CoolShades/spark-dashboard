/**
 * The GPUs page's two documents from the power source (docs/power.md, "GPU
 * documents"): what NVML's snapshot does not carry (P-state, why the clocks
 * are held, the PCIe link, the memory controller's load) with each GPU's last
 * 24 h of trouble, and each GPU over the last hours. The live figures (load,
 * power, temperature, clocks, memory, fan, PCIe traffic) stay the snapshot's.
 */

/** One GPU's last 24 h: its link's growth in counters, AER at its root port, Xids, and held clocks. */
export interface GpuHealth {
  /** The fastest link it trained to in the window: an idle card drops to Gen1, so "now" alone says little. */
  link_gen_max: number | null
  link_width_max: number | null
  /** Correctable: the link retried and lost nothing. */
  replays: number | null
  naks: number | null
  retrains: number | null
  aer_corrected: number | null
  /** Faults: the ones to act on. */
  rollovers: number | null
  uncorrectable: number | null
  xid: number | null
  xid_last: { at: string; code: number | null } | null
  /** Seconds with the clocks held, by reason group. */
  power_cap_s: number | null
  thermal_s: number | null
  slowdown_s: number | null
  /** Counters since the driver loaded, for the hover. */
  since_boot?: { replays: number | null; retrains: number | null; rollovers: number | null } | null
}

export interface GpuExtra {
  index: number | null
  /** e.g. "GPU 0 · slot 2". */
  label: string
  slot: number | null
  bus: string | null
  /** P0 (full speed) to P8 (idle) and below. */
  pstate: string | null
  /** Why the clocks are held now, in words ("idle", "power cap", "HW slowdown"); an unnamed bit by value ("0x400"). */
  clock_reasons: string[]
  enforced_power_limit_watts: number | null
  pcie_gen: number | null
  pcie_width: number | null
  memory_util_percent: number | null
  vbios: string | null
  health: GpuHealth | null
  updated: string | null
}

export interface GpuDoc {
  at: string
  driver: string | null
  /** When the health was last computed (it refreshes every few minutes). */
  health_at: string | null
  gpus: GpuExtra[]
}

/** One GPU over one step. */
export interface GpuStep {
  util: number | null
  watts: number | null
  /** The step's peak. */
  temp: number | null
  fan: number | null
  /** Share of the step (0-1) with the clocks held by the power cap, and slowed (thermal or hardware). */
  power_cap: number | null
  slowdown: number | null
}

export interface GpuHistory {
  hours: number
  step_seconds: number
  /** Names in `points[].gpus` order. */
  labels: string[]
  /** Oldest first; `t` is the start of the step, epoch ms. */
  points: Array<{ t: number; gpus: GpuStep[] }>
  summary: Array<{
    index: number | null
    /** Hours of steps at 10 % load or more. */
    busy_hours: number | null
    util_avg: number | null
    kwh: number | null
    temp_max: number | null
    temp_max_at: string | null
  }>
  /** The cards' own temperature limits, drawn on the thermals chart. */
  limits?: { target_c?: number | null; max_operating_c?: number | null; slowdown_c?: number | null } | null
}
