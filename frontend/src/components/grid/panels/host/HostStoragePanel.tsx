import { useState } from 'react'
import { useLatestSnapshot, useMetricSeries } from '@/hooks/useMetricsStore'
import { POWER_POLL_MS, usePowerDocument } from '@/hooks/usePowerDocument'
import { bytesParts, formatRate, TEMP_LIMITS, tempTone } from '@/lib/host'
import { NVIDIA_THEME } from '@/lib/theme'
import type { HostDoc, HostDrive } from '@/types/host'
import type { PanelContentProps } from '../../panelRegistry'
import { Floating, Headline, PowerNotice, PowerStat, type Anchor } from '../power/PowerParts'
import { SeriesStrip } from '../tokens/TokenParts'

const PILL = 'text-[9px] uppercase tracking-wider border rounded px-1'

/** A drive's square: green when it is up and healthy, red when its array has it down or SMART says it is failing. */
function DriveSquare({ drive, up, onHover }: { drive: HostDrive | undefined; up: boolean; onHover: (d: HostDrive | undefined, el: HTMLElement) => void }) {
  const bad = !up || drive?.healthy === false
  return (
    <span className="inline-block h-3 w-3 rounded-[2px] cursor-default"
      style={{ backgroundColor: bad ? NVIDIA_THEME.critical : NVIDIA_THEME.accent, opacity: bad ? 1 : 0.85 }}
      aria-label={`${drive?.device ?? 'member'} ${bad ? 'down or failing' : 'up and healthy'}`}
      onMouseEnter={(e) => onHover(drive, e.currentTarget)} />
  )
}

/**
 * The storage, laid out like the other cards: its verdict as the headline (every
 * array whole and every drive's SMART health passing, or what is not), then a
 * row per RAID array (its level, what is mounted on it and how full, and a
 * square per member, red if the kernel has it down), the drives on their own
 * with what they are for, and the disk I/O now and the hottest drive. Hovering
 * a square gives the drive: model, temperature, wear and error counts.
 */
export function HostStoragePanel({ panel }: PanelContentProps) {
  const snapshot = useLatestSnapshot()
  const doc = usePowerDocument<HostDoc>('host', POWER_POLL_MS.host)
  const series = useMetricSeries('diskWrite', panel.window)
  const [hover, setHover] = useState<{ drive: HostDrive; at: Anchor } | null>(null)
  const d = doc.data
  if (!d) return <PowerNotice state={doc} />

  const byDevice = new Map(d.drives.map((x) => [x.device, x]))
  const memberDrive = (m: string) => byDevice.get(m.startsWith('nvme') ? m.replace(/n\d+p\d+$/, '') : m.replace(/\d+$/, ''))
  const degraded = d.arrays.filter((a) => (a.map ?? '').includes('_') || (a.DisksFailed ?? 0) > 0)
  const failing = d.drives.filter((x) => x.healthy === false)
  const ok = degraded.length === 0 && failing.length === 0
  const alone = d.drives.filter((x) => !x.array)
  const hottest = d.drives.reduce<HostDrive | null>((a, b) => ((b.temp_c ?? -1) > (a?.temp_c ?? -1) ? b : a), null)
  const fsFor = (path: string | null) => d.filesystems.find((f) => f.path === path)
  const hoverAt = (drive: HostDrive | undefined, el: HTMLElement) => {
    if (!drive) return
    const r = el.getBoundingClientRect()
    setHover({ drive, at: { top: r.top, bottom: r.bottom, x: r.left + r.width / 2, align: 'center' } })
  }
  const read = snapshot?.disk.read_bytes_per_sec ?? null
  const write = snapshot?.disk.write_bytes_per_sec ?? null

  return (
    <div className="h-full flex flex-col gap-1 min-w-0 overflow-hidden" onMouseLeave={() => setHover(null)}>
      <Headline value={ok ? 'Healthy' : degraded.length ? 'Degraded' : 'Failing'} color={ok ? NVIDIA_THEME.accent : NVIDIA_THEME.critical}
        tag={<span className={`${PILL} text-zinc-400 border-zinc-700`}>{d.drives.length} drives</span>} />
      <div className="flex flex-col gap-1.5 min-w-0 mt-0.5">
        {d.arrays.map((a) => {
          const f = fsFor(a.mount)
          const map = (a.map ?? '').split('')
          return (
            <div key={a.name} className="flex flex-col gap-0.5 min-w-0" aria-label={`${a.name} ${a.level ?? ''}`}>
              <div className="flex items-baseline gap-2 text-[10px] 2xl:text-xs font-mono tabular-nums min-w-0">
                <span className="text-zinc-200 uppercase">{a.level ?? 'md'}</span>
                <span className="text-zinc-500">{a.name}</span>
                <span className="text-zinc-400 truncate">{a.mount ?? ''}</span>
                <span className="ml-auto flex gap-0.5 shrink-0">
                  {a.devices.map((m, i) => <DriveSquare key={m} drive={memberDrive(m)} up={(map[i] ?? 'U') === 'U'} onHover={hoverAt} />)}
                </span>
              </div>
              {f?.used_percent != null && (
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-zinc-700/40">
                    <div className="h-full" style={{ width: `${f.used_percent}%`, backgroundColor: f.used_percent >= 90 ? NVIDIA_THEME.critical : f.used_percent >= 75 ? NVIDIA_THEME.warning : '#a1a1aa' }} />
                  </div>
                  <span className="text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-500 whitespace-nowrap">
                    {bytesParts(f.used).value} {bytesParts(f.used).unit} of {bytesParts(f.total).value} {bytesParts(f.total).unit}
                  </span>
                </div>
              )}
            </div>
          )
        })}
        {alone.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] 2xl:text-xs font-mono tabular-nums text-zinc-400 min-w-0">
            {alone.map((x) => (
              <span key={x.device} className="flex items-center gap-1.5">
                <DriveSquare drive={x} up onHover={hoverAt} />
                <span className="text-zinc-200">{x.role ?? x.device}</span>
                <span className="text-zinc-500">{x.model?.replace(/^Samsung (SSD |Portable SSD )?/, '')}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-2 min-w-0">
        <PowerStat label="Read" value={formatRate(read).split(' ')[0]} unit={formatRate(read).split(' ')[1]} sub="now" />
        <PowerStat label="Write" value={formatRate(write).split(' ')[0]} unit={formatRate(write).split(' ')[1]} sub="now" />
        <PowerStat label="Hottest" value={hottest?.temp_c != null ? Math.round(hottest.temp_c) : '—'} unit="°C"
          color={tempTone(hottest?.temp_c, ...TEMP_LIMITS.drive)} sub={hottest ? hottest.role ?? hottest.device : undefined} />
      </div>
      <SeriesStrip points={series} color="#a78bfa" label="Disk writes, last few minutes"
        caption={<><span className="text-violet-400">disk writes</span>, last {panel.window}</>} />
      {hover && (
        <Floating at={hover.at} className="grid items-start gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl min-w-44">
          <div className="font-medium text-foreground">{hover.drive.device}{hover.drive.array ? ` · ${hover.drive.array}` : hover.drive.role ? ` · ${hover.drive.role}` : ''}</div>
          <div className="text-muted-foreground">{hover.drive.model}</div>
          <div className="text-foreground">SMART {hover.drive.healthy === false ? 'FAILING' : hover.drive.healthy ? 'passed' : 'not reported'}
            {hover.drive.temp_c != null ? ` · ${Math.round(hover.drive.temp_c)} °C` : ''}</div>
          {(hover.drive.wear_percent != null || hover.drive.reallocated != null) && (
            <div className="text-muted-foreground">
              {hover.drive.wear_percent != null ? `wear left ${hover.drive.wear_percent} %` : ''}
              {hover.drive.reallocated != null ? ` · reallocated ${hover.drive.reallocated}` : ''}
              {hover.drive.uncorrectable != null ? ` · uncorrectable ${hover.drive.uncorrectable}` : ''}
            </div>
          )}
        </Floating>
      )}
    </div>
  )
}
