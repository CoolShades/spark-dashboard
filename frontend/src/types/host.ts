/**
 * The Host page's two documents from the power source (docs/power.md, "Host
 * documents"): what the snapshot's CPU, memory, disk and network rates do not
 * carry (load, temperatures, clocks, the BMC's fans and rails, memory in
 * detail, arrays, drives, filesystems, links, services), and the host over
 * the last hours.
 */

export interface HostArray {
  name: string
  /** e.g. "raid1", "raid10". */
  level: string | null
  state: string | null
  /** Member devices or partitions ("nvme0n1p2", "sda"). */
  devices: string[]
  /** The kernel's member map, one letter per slot: U up, _ down ("UU", "UUUU_U"). */
  map: string | null
  DisksActive: number | null
  DisksTotal: number | null
  DisksFailed: number | null
  DisksSpare: number | null
  BlocksSyncedPct: number | null
  /** Where the filesystem on it is mounted. */
  mount: string | null
}

export interface HostDrive {
  device: string
  model: string | null
  /** The array it belongs to, or null for a drive on its own. */
  array: string | null
  /** What a drive on its own is for ("models"). */
  role: string | null
  healthy: boolean | null
  temp_c: number | null
  wear_percent: number | null
  reallocated: number | null
  uncorrectable: number | null
  /** For a drive on its own, the filesystem on it (bytes), when the source can see it. */
  mount?: string
  total?: number | null
  used?: number | null
  used_percent?: number | null
}

export interface HostDoc {
  at: string
  uptime_s: number | null
  boot_time: number | null
  cpus: number | null
  load: Record<'1' | '5' | '15', number | null>
  /** CPU time shares, percent (all cores). */
  cpu: Record<'user' | 'system' | 'iowait' | 'irq' | 'softirq' | 'steal', number | null>
  clock_mhz: { avg: number | null; max: number | null }
  temps: {
    tctl: number | null
    ccd: number[]
    nvme: Array<{ name: string; c: number }>
    dimm: Array<{ name: string; c: number }>
    slots: Array<{ slot: number; c: number }>
    board: number[]
    cpu?: number
    lan?: number
  }
  fans: Array<{ name: string; rpm: number }>
  /** BMC voltage rails; `ok` is within ±5 % of nominal, null for a rail with no nominal in its name. */
  rails: Array<{ name: string; volts: number; nominal: number | null; ok: boolean | null }>
  /** BMC discrete sensors by name: "ok", "presence_detected", ... */
  bmc_flags: Record<string, string>
  memory: Record<'total' | 'used' | 'available' | 'cached' | 'buffered' | 'committed_as' | 'commit_limit' | 'dirty' | 'swap_total' | 'swap_used', number | null>
  arrays: HostArray[]
  drives: HostDrive[]
  filesystems: Array<{ path: string; device: string | null; fstype: string | null; total: number | null; used: number | null; used_percent: number | null }>
  net: Array<{ interface: string; speed_mbps: number | null; up?: boolean; errors_24h?: number; drops_24h?: number }>
  units: Array<{ name: string; active: string | null; sub: string | null }>
  containers: Array<{ name: string; status: string | null; uptime_ns: number | null; restart_count: number | null; oomkilled: number | null }>
  checks: Array<{ url: string | null; code: number | null }>
}

export interface HostStep {
  t: number
  user: number | null
  system: number | null
  iowait: number | null
  mem_percent: number | null
  load5: number | null
  tctl: number | null
  /** Bytes a second. */
  net_rx: number | null
  net_tx: number | null
  disk_read: number | null
  disk_write: number | null
}

export interface HostHistory {
  hours: number
  step_seconds: number
  points: HostStep[]
}
