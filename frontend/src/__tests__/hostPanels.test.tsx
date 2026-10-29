import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MetricsStoreContext } from '../hooks/useMetricsStore'
import { resetPowerPollers } from '../hooks/usePowerDocument'
import { MetricsHistoryStore } from '../lib/metricsHistoryStore'
import { bytesParts, formatUptime, tempTone, TEMP_LIMITS } from '../lib/host'
import { NVIDIA_THEME } from '../lib/theme'
import { HostCpuPanel } from '../components/grid/panels/host/HostCpuPanel'
import { HostHistoryPanel } from '../components/grid/panels/host/HostHistoryPanel'
import { HostMemoryPanel } from '../components/grid/panels/host/HostMemoryPanel'
import { HostServicesPanel } from '../components/grid/panels/host/HostServicesPanel'
import { HostStoragePanel } from '../components/grid/panels/host/HostStoragePanel'
import { HostThermalsPanel } from '../components/grid/panels/host/HostThermalsPanel'
import type { DashboardPanel } from '../lib/dashboard/schema'
import type { MetricsSnapshot } from '../types/metrics'
import type { HostDoc, HostHistory } from '../types/host'

const GB = 1e9

function snapshot(): MetricsSnapshot {
  const gpu = {
    index: 0, name: 'NVIDIA GeForce RTX 3090', utilization_percent: 0, memory_total_bytes: 24e9, memory_used_bytes: 23e9,
    temperature_celsius: 30, power_watts: 20, power_limit_watts: 350, clock_graphics_mhz: 210, clock_sm_mhz: 210,
    clock_memory_mhz: 405, fan_speed_percent: 0, pcie_rx_bytes_per_sec: 0, pcie_tx_bytes_per_sec: 0,
  }
  return {
    timestamp_ms: Date.now(),
    gpu,
    gpus: [gpu],
    cpu: { name: 'AMD Ryzen Threadripper 3970X', aggregate_percent: 12.4, per_core: Array.from({ length: 64 }, (_, i) => ({ id: i, usage_percent: i === 3 ? 100 : 5 })) },
    memory: {
      total_bytes: 270 * GB, display_total_bytes: 270 * GB, used_bytes: 72 * GB, available_bytes: 190 * GB, cached_bytes: 145 * GB,
      gpu_estimated_bytes: 0, gpu_memory_total_bytes: null, gpu_memory_used_bytes: null, is_unified: false,
    },
    disk: { name: 'md0', read_bytes_per_sec: 1_200_000, write_bytes_per_sec: 524_000 },
    network: { name: 'enp37s0f0', rx_bytes_per_sec: 80_000, tx_bytes_per_sec: 98_000 },
    engines: [],
    gpu_events: [],
  } as MetricsSnapshot
}

const DOC: HostDoc = {
  at: '2026-10-29T22:30:00+00:00', uptime_s: 181298, boot_time: null, cpus: 64,
  load: { '1': 0.85, '5': 1.75, '15': 2.0 },
  cpu: { user: 0.1, system: 0.5, iowait: 0.1, irq: 0, softirq: 0, steal: 0 },
  clock_mhz: { avg: 3967, max: 4287 },
  temps: {
    tctl: 54.2, ccd: [50.8, 41.5, 39.5, 44.5], nvme: [{ name: 'nvme-pci-2300', c: 44.85 }], dimm: [{ name: 'dimma1', c: 49 }, { name: 'dimmf1', c: 55 }],
    slots: [{ slot: 2, c: 36 }], board: [36, 37], lan: 73,
  },
  fans: [{ name: 'cha_fan1', rpm: 2700 }, { name: 'cpu_fan', rpm: 1400 }],
  rails: [{ name: '+12v', volts: 11.88, nominal: 12, ok: true }, { name: '+vcore', volts: 1.27, nominal: null, ok: null }],
  bmc_flags: { memory_train_err: 'ok', watchdog2: 'ok', cpu_ecc: 'presence_detected' },
  memory: { total: 270 * GB, used: 72 * GB, available: 190 * GB, cached: 145 * GB, buffered: 1 * GB, committed_as: 126 * GB, commit_limit: 143.6 * GB, dirty: 532480, swap_total: 8.6 * GB, swap_used: 18.9e6 },
  arrays: [
    { name: 'md0', level: 'raid1', state: 'active', devices: ['nvme0n1p2', 'nvme2n1p2'], map: 'UU', DisksActive: 2, DisksTotal: 2, DisksFailed: 0, DisksSpare: 0, BlocksSyncedPct: 0, mount: '/' },
    { name: 'md127', level: 'raid10', state: 'active', devices: ['sda', 'sdb'], map: 'UU', DisksActive: 2, DisksTotal: 2, DisksFailed: 0, DisksSpare: 0, BlocksSyncedPct: 0, mount: '/mnt/encrypted_drive' },
  ],
  drives: [
    { device: 'nvme0', model: 'Seagate ZP2000GV30012', array: 'md0', role: null, healthy: true, temp_c: 45, wear_percent: null, reallocated: null, uncorrectable: null },
    { device: 'nvme1', model: 'Samsung SSD 990 EVO Plus 2TB', array: null, role: 'models', healthy: true, temp_c: 46, wear_percent: null, reallocated: null, uncorrectable: null },
    { device: 'nvme2', model: 'GIGABYTE GP-ASM2NE6200TTTD', array: 'md0', role: null, healthy: true, temp_c: 47, wear_percent: null, reallocated: null, uncorrectable: null },
    { device: 'sda', model: 'Samsung SSD 870 EVO 1TB', array: 'md127', role: null, healthy: true, temp_c: 26, wear_percent: 100, reallocated: 0, uncorrectable: 0 },
    { device: 'sdb', model: 'Samsung SSD 870 EVO 1TB', array: 'md127', role: null, healthy: true, temp_c: 26, wear_percent: 100, reallocated: 0, uncorrectable: 0 },
  ],
  filesystems: [
    { path: '/', device: 'md0p1', fstype: 'ext4', total: 1966.6 * GB, used: 452.3 * GB, used_percent: 24.2 },
    { path: '/mnt/encrypted_drive', device: 'dm-0', fstype: 'ext4', total: 2952 * GB, used: 131 * GB, used_percent: 4.7 },
  ],
  net: [
    { interface: 'enp37s0f0', speed_mbps: 10000, up: true, drops_24h: 28797, errors_24h: 0 },
    { interface: 'tailscale0', speed_mbps: -1, drops_24h: 0, errors_24h: 0 },
  ],
  units: [{ name: 'vllm-qwen38.service', active: 'active', sub: 'running' }, { name: 'apcupsd.service', active: 'active', sub: 'running' }],
  containers: [{ name: 'power-api', status: 'running', uptime_ns: 3.6e12, restart_count: 0, oomkilled: null }, { name: 'newt', status: 'exited', uptime_ns: null, restart_count: 2, oomkilled: null }],
  checks: [{ url: 'http://127.0.0.1:18020/health', code: 200 }],
}

const T0 = Date.UTC(2026, 9, 29, 14, 0)
const HISTORY: HostHistory = {
  hours: 24, step_seconds: 300,
  points: [
    { t: T0, user: 6.9, system: 2.5, iowait: 0.1, mem_percent: 26.5, load5: 6.91, tctl: 71.9, net_rx: 87339, net_tx: 2472376, disk_read: 1691979, disk_write: 3858022 },
    { t: T0 + 300_000, user: 0.4, system: 0.7, iowait: 0.1, mem_percent: 26.7, load5: 2.6, tctl: 57.8, net_rx: 80446, net_tx: 98091, disk_read: 273, disk_write: 523578 },
  ],
}

function respondBy(docs: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(docs).find((k) => String(url).includes(`/api/power/${k}`))
      return key ? new Response(JSON.stringify(docs[key]), { status: 200 }) : new Response('nope', { status: 404 })
    }),
  )
}

function withStore(ui: ReactNode) {
  const store = new MetricsHistoryStore()
  store.ingest(snapshot())
  return render(<MetricsStoreContext.Provider value={store}>{ui}</MetricsStoreContext.Provider>)
}

const card = (type: string): DashboardPanel => ({ id: type, type, geometry: { x: 0, y: 0, w: 4, h: 3 }, binding: { kind: 'follow' }, window: '5m' })

beforeEach(() => resetPowerPollers())
afterEach(() => {
  resetPowerPollers()
  vi.unstubAllGlobals()
})

describe('the CPU card', () => {
  it('heads with the load, draws every core, and gives the temperature, clocks and load averages', async () => {
    respondBy({ host: DOC })
    withStore(<HostCpuPanel panel={card('host-cpu')} />)
    expect(await screen.findByText('load 1.75')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByLabelText('core 3 · 100 %')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Tctl' })).toHaveTextContent('54°Chottest CCD 51')
    expect(screen.getByRole('group', { name: 'Clock' })).toHaveTextContent('3.97GHzmax 4.29')
    expect(screen.getByRole('group', { name: 'Load 1 m' })).toHaveTextContent('0.855 m 1.75 · 15 m 2.00')
    expect(screen.getByText(/64 threads · up 2 d 2 h/)).toBeInTheDocument()
  })
})

describe('the Memory card', () => {
  it('splits used, cache and free, and gives the commit, swap, DIMMs and the BMC check', async () => {
    respondBy({ host: DOC })
    withStore(<HostMemoryPanel panel={card('host-memory')} />)
    expect(await screen.findByRole('group', { name: 'Committed' })).toHaveTextContent('126GBof 144 GB limit')
    expect(screen.getByText('72.0')).toBeInTheDocument()
    expect(screen.getByText('27 %')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'DIMMs' })).toHaveTextContent('55°Chottest of 2')
    expect(screen.getByRole('group', { name: 'Training' })).toHaveTextContent('okBMC memory check')
  })
})

describe('the Storage card', () => {
  it('names each array by level and mount, a square per member, the lone drives by role, and a drive card on hover', async () => {
    respondBy({ host: DOC })
    withStore(<HostStoragePanel panel={card('host-storage')} />)
    expect(await screen.findByText('Healthy')).toBeInTheDocument()
    expect(screen.getByLabelText('md0 raid1')).toHaveTextContent('raid1md0/')
    expect(screen.getByLabelText('md127 raid10')).toHaveTextContent('raid10md127/mnt/encrypted_drive')
    expect(screen.getByText('models')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByLabelText('nvme1 up and healthy'))
    expect(screen.getByText('nvme1 · models')).toBeInTheDocument()
    expect(screen.getByText('SMART passed · 46 °C')).toBeInTheDocument()
  })

  it('says degraded when the kernel has a member down', async () => {
    respondBy({ host: { ...DOC, arrays: [{ ...DOC.arrays[1], map: 'U_' }] } })
    withStore(<HostStoragePanel panel={card('host-storage')} />)
    expect(await screen.findByText('Degraded')).toHaveStyle({ color: NVIDIA_THEME.critical })
    expect(screen.getByLabelText('sdb down or failing')).toBeInTheDocument()
  })
})

describe('the 24 h host chart', () => {
  it('heads with the day’s CPU average and peak and the hottest Tctl', async () => {
    respondBy({ 'host-history': HISTORY })
    withStore(<HostHistoryPanel />)
    expect(await screen.findByText(/peak/)).toHaveTextContent(/CPU avg 5\.[34] % · peak 9\.5 %/)
    expect(screen.getByText('72 °C')).toBeInTheDocument()
  })
})

describe('the Thermals & fans card', () => {
  it('gives the hottest of each part, each fan, and the rails as one verdict', async () => {
    respondBy({ host: DOC })
    withStore(<HostThermalsPanel />)
    expect(await screen.findByRole('group', { name: 'LAN' })).toHaveTextContent('73°C10 GbE chip')
    expect(screen.getByLabelText('cha_fan1 2700 rpm')).toHaveTextContent('cha 12,700')
    expect(screen.getByText('✓ 1 rails within ±5 %')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByText('✓ 1 rails within ±5 %'))
    expect(screen.getByText('11.88 V (-1.0 %)')).toBeInTheDocument()
  })
})

describe('the Services & network card', () => {
  it('counts what is not running, and lists units, containers and links', async () => {
    respondBy({ host: DOC })
    withStore(<HostServicesPanel />)
    expect(await screen.findByText('⚠ 1 not running')).toBeInTheDocument()
    expect(screen.getByText('vllm-qwen38')).toBeInTheDocument()
    expect(screen.getByText('newt ↻2')).toBeInTheDocument()
    expect(screen.getByText('10 GbE')).toBeInTheDocument()
    expect(screen.getByText('28,797 drops')).toBeInTheDocument()
  })
})

describe('the host helpers', () => {
  it('formats bytes and uptime, and judges a temperature against its limits', () => {
    expect(bytesParts(72e9)).toEqual({ value: '72.0', unit: 'GB' })
    expect(bytesParts(1966.6e9)).toEqual({ value: '2.0', unit: 'TB' })
    expect(formatUptime(181298)).toBe('2 d 2 h')
    expect(formatUptime(4000)).toBe('1 h 6 min')
    expect(tempTone(54, ...TEMP_LIMITS.tctl)).toBe('#f4f4f5')
    expect(tempTone(85, ...TEMP_LIMITS.tctl)).toBe(NVIDIA_THEME.warning)
  })
})
