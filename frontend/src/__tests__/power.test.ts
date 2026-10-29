import { describe, it, expect, vi } from 'vitest'
import {
  batteryColor,
  DEFAULT_MAINS,
  formatDay,
  formatKwh,
  formatMoney,
  formatRuntime,
  formatRuntimeShort,
  formatUnitPrice,
  formatWattsValue,
  onBattery,
  railOutOfSpec,
  runtimeColor,
  splitWall,
  sumGpuWatts,
  upsStatusColor,
  voltsColor,
} from '../lib/power'
import { NVIDIA_THEME } from '../lib/theme'

describe('power formatting', () => {
  it('writes watts whole, with separators', () => {
    expect(formatWattsValue(1403.6)).toBe('1,404')
    expect(formatWattsValue(87)).toBe('87')
  })

  it('writes kWh to one decimal below 100', () => {
    expect(formatKwh(7.55)).toBe('7.5')
    expect(formatKwh(182.4)).toBe('182')
  })

  it('writes sterling under a pound in pence, the way a bill does', () => {
    expect(formatMoney(0.37, 'GBP')).toBe('37p')
    expect(formatMoney(4.35, 'GBP')).toBe('£4.35')
    expect(formatMoney(171.19, 'GBP')).toBe('£171')
    expect(formatMoney(0.37, 'EUR')).toBe('€0.37')
  })

  it('survives a currency code Intl does not know', () => {
    expect(formatMoney(2, 'XYZ1')).toBe('2.00 XYZ1')
  })

  it('writes unit prices per kWh', () => {
    expect(formatUnitPrice(0.2632, 'GBP')).toBe('26.32p/kWh')
    expect(formatUnitPrice(0.31, 'EUR')).toBe('€0.31/kWh')
  })

  it('writes runtime as people say it', () => {
    expect(formatRuntime(45)).toBe('45 s')
    expect(formatRuntime(1200)).toBe('20 min')
    expect(formatRuntime(4320)).toBe('1 h 12 min')
    expect(formatRuntime(7200)).toBe('2 h')
  })

  it('shortens runtime for a tight tile', () => {
    expect(formatRuntimeShort(45)).toBe('45s')
    expect(formatRuntimeShort(1200)).toBe('20m')
    expect(formatRuntimeShort(5820)).toBe('1h 37m')
    expect(formatRuntimeShort(7200)).toBe('2h')
  })

  it('flags a rail beyond ±5 % of nominal', () => {
    expect(railOutOfSpec(12.14, 12)).toBe(false)
    expect(railOutOfSpec(11.35, 12)).toBe(true)
    expect(railOutOfSpec(5.3, 5)).toBe(true)
    expect(railOutOfSpec(null, 3.3)).toBe(false)
  })

  it('names a local date without shifting it across a time zone', () => {
    expect(formatDay('2026-10-27')).toBe('Tue 27')
    expect(formatDay('2026-10-25')).toBe('Sun 25')
  })
})

describe('UPS judgements', () => {
  it('is green only on mains', () => {
    expect(upsStatusColor('online')).toBe(NVIDIA_THEME.healthy)
    expect(upsStatusColor('on_battery')).toBe(NVIDIA_THEME.warning)
    expect(upsStatusColor('charging')).toBe(NVIDIA_THEME.warning)
    expect(upsStatusColor('low_battery')).toBe(NVIDIA_THEME.critical)
    expect(upsStatusColor('offline')).toBe(NVIDIA_THEME.critical)
  })

  it('treats low battery as running on battery', () => {
    expect(onBattery('on_battery')).toBe(true)
    expect(onBattery('low_battery')).toBe(true)
    expect(onBattery('charging')).toBe(false)
  })

  it('warns on runtime under 10 min and alarms under 5', () => {
    expect(runtimeColor(1200)).not.toBe(NVIDIA_THEME.warning)
    expect(runtimeColor(540)).toBe(NVIDIA_THEME.warning)
    expect(runtimeColor(240)).toBe(NVIDIA_THEME.critical)
  })

  it('warns on battery under 30 % and alarms under 15 %', () => {
    expect(batteryColor(100)).not.toBe(NVIDIA_THEME.warning)
    expect(batteryColor(25)).toBe(NVIDIA_THEME.warning)
    expect(batteryColor(10)).toBe(NVIDIA_THEME.critical)
  })

  it('alarms on mains outside the statutory range', () => {
    expect(voltsColor(236.1, DEFAULT_MAINS)).not.toBe(NVIDIA_THEME.critical)
    expect(voltsColor(214, DEFAULT_MAINS)).toBe(NVIDIA_THEME.critical)
    expect(voltsColor(254, DEFAULT_MAINS)).toBe(NVIDIA_THEME.critical)
  })
})

describe('the wall split', () => {
  it('is GPUs plus the system', () => {
    expect(splitWall(1404, 1025)).toEqual({ gpus: 1025, system: 379, others: [] })
  })

  it('takes the other loads on the meter out before the system', () => {
    expect(splitWall(400, 100, [{ name: 'Router + switch', watts: 25, estimated: true }])).toEqual({
      gpus: 100,
      system: 275,
      others: [{ name: 'Router + switch', watts: 25, estimated: true }],
    })
  })

  it('never goes negative when the GPUs spike between two readings', () => {
    expect(splitWall(900, 950)).toEqual({ gpus: 900, system: 0, others: [] })
    expect(splitWall(100, 90, [{ name: 'Router', watts: 25 }])).toEqual({
      gpus: 75,
      system: 0,
      others: [{ name: 'Router', watts: 25, estimated: false }],
    })
  })

  it('is unknown without both figures', () => {
    expect(splitWall(null, 300)).toBeNull()
    expect(splitWall(1000, null)).toBeNull()
  })

  it('sums the GPUs that report, and is null when none does', () => {
    expect(sumGpuWatts([{ power_watts: 246.5 }, { power_watts: null }, { power_watts: 280 }])).toBe(526.5)
    expect(sumGpuWatts([{ power_watts: null }])).toBeNull()
    expect(sumGpuWatts(undefined)).toBeNull()
  })
})

describe('power documents across a tab switch', () => {
  it('paints a remembered document at once when a panel mounts again, and prefetches pages not opened yet', async () => {
    const { prefetchPowerDocuments, resetPowerPollers, usePowerDocument } = await import('../hooks/usePowerDocument')
    const { renderHook, waitFor } = await import('@testing-library/react')
    resetPowerPollers()
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls += 1
      return new Response(JSON.stringify({ path: String(url) }), { status: 200 })
    }))
    const first = renderHook(() => usePowerDocument<{ path: string }>('host', 10_000))
    await waitFor(() => expect(first.result.current.status).toBe('ready'))
    first.unmount()
    // Mounted again (the tab switched back to): the document is there on the first render, before any new poll lands.
    const again = renderHook(() => usePowerDocument<{ path: string }>('host', 10_000))
    expect(again.result.current.status).toBe('ready')
    expect(again.result.current.data?.path).toContain('/api/power/host')
    again.unmount()
    await prefetchPowerDocuments(['tokens'])
    const fresh = renderHook(() => usePowerDocument<{ path: string }>('tokens', 15_000))
    expect(fresh.result.current.data?.path).toContain('/api/power/tokens')
    fresh.unmount()
    expect(calls).toBeGreaterThanOrEqual(3)
    resetPowerPollers()
    vi.unstubAllGlobals()
  })

  it('stops prefetching at the first 404: no power source', async () => {
    const { prefetchPowerDocuments, resetPowerPollers } = await import('../hooks/usePowerDocument')
    resetPowerPollers()
    const fetchMock = vi.fn(async () => new Response('no power source configured', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    await prefetchPowerDocuments()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
