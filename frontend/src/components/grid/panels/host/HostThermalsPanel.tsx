import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { maxOf, TEMP_LIMITS, tempTone } from '@/lib/host'
import { NVIDIA_THEME } from '@/lib/theme'
import type { HostDoc } from '@/types/host'
import { PowerNotice, PowerStat } from '../power/PowerParts'

/** A fan's name for a tight row: "cha_fan3" -> "cha 3", "cpu_opt" -> "cpu opt". */
function fanName(n: string): string {
  return n.replace(/_fan(\d+)$/, ' $1').replace(/_fan$/, '').replace(/_/g, ' ')
}

/**
 * The board's temperatures and fans, from the BMC and the kernel's sensors:
 * the hottest of each kind of part in tiles (CPU, DIMMs, NVMe, the 10 GbE
 * controller, the PCIe slots, the board), each against its own limits, and
 * every fan as a bar of its speed. The rails and the BMC's own checks are the
 * BMC card's.
 */
export function HostThermalsPanel() {
  const doc = usePowerDocument<HostDoc>('host', POWER_POLL_MS.host)
  const d = doc.data
  if (!d) return <PowerNotice state={doc} />
  const t = d.temps
  const tiles: Array<[string, number | null, readonly [number, number], string?]> = [
    ['CPU', t.tctl, TEMP_LIMITS.tctl, 'Tctl'],
    ['DIMMs', maxOf(t.dimm.map((x) => x.c)), TEMP_LIMITS.dimm, `${t.dimm.length} sticks`],
    ['NVMe', maxOf(t.nvme.map((x) => x.c)), TEMP_LIMITS.nvme, `${t.nvme.length} drives`],
    ['LAN', t.lan ?? null, TEMP_LIMITS.lan, '10 GbE chip'],
    ['Slots', maxOf(t.slots.map((x) => x.c)), TEMP_LIMITS.slot, `${t.slots.length} read`],
    ['Board', maxOf(t.board), TEMP_LIMITS.slot, 'T sensors'],
  ]
  const top = Math.max(...d.fans.map((f) => f.rpm), 1)

  return (
    <div className="h-full flex flex-col gap-1.5 min-w-0 overflow-hidden">
      <div className="grid grid-cols-6 gap-2 min-w-0">
        {tiles.map(([label, c, lim, sub]) => (
          <PowerStat key={label} label={label} value={c != null ? Math.round(c) : '—'} unit="°C" color={tempTone(c, ...lim)} sub={sub} />
        ))}
      </div>
      <div className="grid gap-x-3 gap-y-0.5 min-w-0" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }} aria-label="Fans">
        {d.fans.map((f) => (
          <div key={f.name} className="flex flex-col gap-0.5 min-w-0" aria-label={`${f.name} ${f.rpm} rpm`}>
            <div className="flex items-baseline gap-1 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0">
              <span className="text-zinc-400 truncate">{fanName(f.name)}</span>
              <span className="ml-auto text-zinc-200">{f.rpm.toLocaleString('en-GB')}</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden bg-zinc-700/40">
              <div className="h-full" style={{ width: `${(f.rpm / top) * 100}%`, backgroundColor: f.rpm > 0 ? '#38bdf8' : NVIDIA_THEME.critical }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
