import { useState } from 'react'
import { useLatestSnapshot } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { bytesParts, maxOf, TEMP_LIMITS, tempTone, THERMAL_STOPS, thermalColor } from '@/lib/host'
import { NVIDIA_THEME } from '@/lib/theme'
import type { HostDoc } from '@/types/host'
import { Floating, Headline, PowerStat, type Anchor } from '../power/PowerParts'

const CACHE = '#38bdf8'
const FREE = '#3f3f46'
const PILL = 'text-[9px] uppercase tracking-wider border rounded px-1'
/** DDR4 DIMMs are rated to 85 °C. */
const DIMM_RATED = 85

/** "dimma1" -> "A1". */
function slotName(n: string): string {
  const m = n.match(/^dimm([a-h])(\d)$/i)
  return m ? `${m[1].toUpperCase()}${m[2]}` : n
}

/**
 * Memory, laid out like the wall card: what is used as the headline, a bar of
 * used, page cache and free (the cache gives way to programs, so "available" is
 * used's real headroom), then what is available, the cache, swap, the memory
 * committed against the kernel's limit, the hottest DIMM, and the BMC's memory
 * training check; along the bottom, the DIMMs as the board's manual draws them
 * (horizontal sticks, four above the CPU socket and four below), each coloured
 * on the thermal scale by its temperature, its reading on hover. Used is the snapshot's; the
 * rest is /host.
 */
export function HostMemoryPanel() {
  const snapshot = useLatestSnapshot()
  const doc = usePowerDocument<HostDoc>('host', POWER_POLL_MS.host)
  const [hover, setHover] = useState<{ name: string; c: number; at: Anchor } | null>(null)
  const m = snapshot?.memory ?? null
  const d = doc.data
  const total = m?.total_bytes ?? d?.memory.total ?? null
  const used = m?.used_bytes ?? d?.memory.used ?? null
  const cache = (d?.memory.cached ?? m?.cached_bytes ?? 0) + (d?.memory.buffered ?? 0)
  const free = total !== null && used !== null ? Math.max(0, total - used - cache) : null
  const u = bytesParts(used)
  const t = bytesParts(total)
  const dimm = maxOf(d?.temps.dimm.map((x) => x.c) ?? [])
  const swapUsed = d?.memory.swap_used ?? null
  const training = d?.bmc_flags.memory_train_err ?? null
  const slices = total ? [
    { name: 'used', v: used ?? 0, color: NVIDIA_THEME.accent },
    { name: 'cache', v: cache, color: CACHE },
    { name: 'free', v: free ?? 0, color: FREE },
  ] : []

  return (
    <div className="h-full flex flex-col gap-1 min-w-0 overflow-hidden">
      <Headline value={u.value} unit={`${u.unit} used of ${t.value} ${t.unit}`}
        tag={total && used !== null ? <span className={`${PILL} text-zinc-400 border-zinc-700`}>{Math.round((used / total) * 100)} %</span> : undefined} />
      {slices.length > 0 && (
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex h-2 w-full rounded-full overflow-hidden bg-zinc-700/40" aria-label="Used, cache and free memory">
            {slices.map((s) => <div key={s.name} className="h-full transition-all duration-500" style={{ width: `${(s.v / total!) * 100}%`, backgroundColor: s.color }} />)}
          </div>
          <div className="flex flex-wrap gap-x-3 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0">
            {slices.map((s) => {
              const p = bytesParts(s.v)
              return (
                <span key={s.name} className="flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color === FREE ? '#71717a' : s.color }} />
                  <span className="text-zinc-400">{s.name}</span><span className="text-zinc-200">{p.value} {p.unit}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}
      <div className="mt-1 grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Available" value={bytesParts(d?.memory.available ?? m?.available_bytes).value} unit={bytesParts(d?.memory.available ?? m?.available_bytes).unit}
          sub="used + free-able" />
        <PowerStat label="Committed" value={bytesParts(d?.memory.committed_as).value} unit={bytesParts(d?.memory.committed_as).unit}
          sub={d?.memory.commit_limit ? `of ${bytesParts(d.memory.commit_limit).value} ${bytesParts(d.memory.commit_limit).unit} limit` : undefined} />
        <PowerStat label="Swap" value={bytesParts(swapUsed).value} unit={bytesParts(swapUsed).unit}
          sub={d?.memory.swap_total ? `of ${bytesParts(d.memory.swap_total).value} ${bytesParts(d.memory.swap_total).unit}` : undefined} />
      </div>
      <div className="grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="DIMMs" value={dimm !== null ? Math.round(dimm) : '—'} unit="°C" color={tempTone(dimm, ...TEMP_LIMITS.dimm)}
          sub={d?.temps.dimm.length ? `hottest of ${d.temps.dimm.length}` : undefined} />
        <PowerStat label="Dirty" value={bytesParts(d?.memory.dirty).value} unit={bytesParts(d?.memory.dirty).unit} sub="waiting to write" />
        <PowerStat label="Training" value={training ?? '—'} color={training === 'ok' ? NVIDIA_THEME.accent : training ? NVIDIA_THEME.critical : undefined}
          sub="BMC memory check" />
      </div>
      {/* The board as the manual draws it: horizontal sticks, a bank above the CPU socket and one below, each stick
          coloured on the thermal scale by its temperature (the legend under it), the socket showing Tctl. The rows share
          whatever height the card has left; hovering a stick gives its reading. */}
      {d && d.temps.dimm.length > 0 && (() => {
        const banks = d.dimm_layout ?? [d.temps.dimm.slice(0, 4).map((x) => slotName(x.name)), d.temps.dimm.slice(4).map((x) => slotName(x.name))]
        const stick = (slot: string) => {
          const x = d.temps.dimm.find((t) => slotName(t.name) === slot)
          return (
            <div key={slot} className="flex-1 min-h-[3px] flex items-center gap-1.5 min-w-0">
              <span className="w-4 text-right text-[8px] 2xl:text-[9px] font-mono text-zinc-500 leading-none shrink-0">{slot}</span>
              <div className="h-full flex-1 rounded-[2px] border border-black/40 cursor-default"
                style={{ backgroundColor: x ? thermalColor(x.c) : '#27272a', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
                aria-label={x ? `DIMM ${slot} ${Math.round(x.c)} °C` : `DIMM ${slot} no reading`}
                onMouseEnter={(e) => {
                  if (!x) return
                  const r = e.currentTarget.getBoundingClientRect()
                  setHover({ name: x.name, c: x.c, at: { top: r.top, bottom: r.bottom, x: r.left + r.width / 2, align: 'center' } })
                }} />
            </div>
          )
        }
        return (
          <div className="mt-auto flex flex-col gap-0.5 min-w-0">
            <div className="h-24 2xl:h-28 flex flex-col gap-[2px] px-[12%]" aria-label="DIMMs as they sit on the board" onMouseLeave={() => setHover(null)}>
              {banks.map((bank, bi) => (
                <div key={bi} className="contents">
                  {bank.map(stick)}
                  {bi < banks.length - 1 && (
                    <div className="flex-[3.5] min-h-[14px] flex items-center justify-center pl-5 py-[2px]">
                      <div className="h-full aspect-[1.6] max-w-[45%] rounded-[3px] border border-zinc-600 bg-zinc-800/80 flex items-center justify-center gap-1.5"
                        aria-label="CPU socket">
                        <span className="text-[8px] uppercase tracking-wider text-zinc-500 leading-none">CPU</span>
                        {d.temps.tctl != null && (
                          <span className="text-[10px] font-mono font-medium leading-none" style={{ color: thermalColor(d.temps.tctl) }}>{Math.round(d.temps.tctl)}°</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] 2xl:text-xs text-zinc-500 font-mono tabular-nums flex items-center gap-2 min-w-0">
              <span className="truncate">{d.temps.dimm.length} DIMMs{dimm !== null ? <> · hottest <span className="text-zinc-300">{slotName(d.temps.dimm.find((x) => x.c === dimm)!.name)} {Math.round(dimm)} °C</span></> : null}</span>
              <span className="ml-auto flex items-center gap-1 shrink-0">
                {THERMAL_STOPS[0][0]}°
                <span className="inline-block h-1.5 w-14 rounded-full" style={{ background: `linear-gradient(90deg, ${THERMAL_STOPS.map(([, c]) => c).join(', ')})` }} />
                {THERMAL_STOPS[THERMAL_STOPS.length - 1][0]}°
              </span>
            </p>
          </div>
        )
      })()}
      {hover && (
        <Floating at={hover.at} className="grid items-start gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl min-w-36">
          <div className="font-medium text-foreground">DIMM {slotName(hover.name)}</div>
          <div className="flex w-full items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: thermalColor(hover.c) }} />
            <span className="text-muted-foreground">Temperature</span>
            <span className="ml-auto pl-3 font-mono font-medium text-foreground tabular-nums">{Math.round(hover.c)} °C</span>
          </div>
          <div className="text-muted-foreground">rated to {DIMM_RATED} °C · read by the BMC</div>
        </Floating>
      )}
    </div>
  )
}
