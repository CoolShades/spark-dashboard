# Power panels and the power source

The Power panels show a machine's draw at the wall, its UPS, its power supplies,
the energy it used and what that cost. None of that is anything the dashboard
can read itself: a UPS sits behind apcupsd or NUT, a supply behind a vendor USB
dongle or a kernel hwmon driver, and the history in whatever time-series
database the operator already keeps. So the dashboard reads it from a **power
source**: a small HTTP service the operator runs, which answers three JSON
documents. Point the dashboard at it:

```
spark-dashboard --power-url http://127.0.0.1:18031      # or SPARK_DASHBOARD_POWER_URL
```

The dashboard relays the documents to the browser under `/api/power/now`,
`/api/power/history?hours=N` (1-168, default 24) and `/api/power/daily?days=N`
(1-31, default 7). It passes on nothing else: GET only, those three paths,
bounded parameters, a 5 s timeout and a 1 MiB cap. The source's URL never
reaches the browser, so a source bound to loopback can stay there. Without
`--power-url` the routes answer 404 and the panels say no source is configured.

The source owns the arithmetic: its tariff, its day boundaries (local midnight,
including the 23- and 25-hour clock-change days), how it integrates samples into
kWh and how it treats gaps. The dashboard formats what it is given and computes
one thing itself: the live split of the wall figure into the GPUs (its own NVML
reading) and the rest.

Every number may be `null`; a panel then says the figure is not reported rather
than showing zero.

## `GET /now`

Live readings, polled every 2 s (the wall tile keeps the last 5 minutes of polls for its live strip).

```json
{
  "at": "2026-10-29T16:11:50+00:00",
  "total_watts": 1404,
  "total_source": "UPS output",
  "total_estimated": true,
  "cost_per_hour": 0.37,
  "ups": {
    "name": "Smart-UPS 3000",
    "status": "online",
    "status_detail": "ONLINE",
    "load_percent": 52.0,
    "output_watts": 1404,
    "capacity_watts": 2700,
    "battery_percent": 100,
    "runtime_seconds": 1200,
    "input_volts": 236.1,
    "input_hz": 50.1,
    "output_volts": 236.1,
    "temperature_c": 17.5,
    "last_transfer": "Automatic or explicit self test",
    "transfers": 1,
    "battery_date": "2026-10-15",
    "battery_volts": 54.5,
    "output_amps": 1.53,
    "output_va": 351,
    "capacity_va": 3000,
    "self_test": "passed",
    "avr": null,
    "battery_events": { "days": 30, "since": "2026-10-27T20:14:30Z", "events": [
      { "start": "2026-10-27T20:43:00+00:00", "seconds": 5, "reason": "Automatic or explicit self test", "self_test": true } ] },
    "shutdown_battery_percent": 20,
    "shutdown_runtime_seconds": 300
  },
  "supplies": [
    { "name": "PSU 1", "input_watts": 646, "output_watts": null, "capacity_watts": 1600,
      "temperature_c": 54.2, "fan_rpm": 780, "input_volts": 233, "warning": null,
      "connectors": [ { "name": "12V #6", "volts": 12.03, "amps": 5.4, "watts": 64, "ocp_amps": 40.5 } ] },
    { "name": "PSU 2", "input_watts": null, "output_watts": 460, "capacity_watts": 850,
      "temperature_c": 42, "fan_rpm": 0, "input_volts": 230, "warning": null,
      "rails": [ { "name": "12V", "nominal_volts": 12, "volts": 12.06, "amps": 36.8, "watts": 436,
                   "volts_min_24h": 12.01, "volts_max_24h": 12.14 } ] }
  ],
  "other_loads": [ { "name": "Router + switch", "watts": 25, "estimated": true } ],
  "energy": {
    "currency": "GBP",
    "unit_price": 0.2632,
    "standing_charge_per_day": 0.5483,
    "include_standing_charge": false,
    "tariff_label": "Price cap, Oct-Dec 2026",
    "today_kwh": 7.6,
    "today_cost": 2.0,
    "yesterday_same_time_kwh": 4.9,
    "month_kwh": 16.5,
    "month_cost": 4.35,
    "run_rate_kwh_per_day": 9.0,
    "run_rate_per_day": 2.37,
    "run_rate_per_month": 71.19,
    "floor_watts": 296,
    "floor_cost_per_month": 56.03,
    "today_idle_kwh": 5.1,
    "today_work_kwh": 3.3,
    "today_work_cost": 0.87
  },
  "mains": { "nominal_volts": 230, "min_volts": 216.2, "max_volts": 253,
             "nominal_hz": 50, "min_hz": 49.5, "max_hz": 50.5 }
}
```

- `total_watts` is the whole machine at the wall: what energy and cost are
  counted from. `total_estimated` says it is derived (for example a UPS's load
  percentage times its real-power rating) rather than metered; the panel marks
  it "est.".
- `ups.status` is one of `online`, `on_battery`, `low_battery`, `charging`,
  `offline`, `unknown`. On battery the UPS panel headlines the runtime left.
- The UPS panel's second row: the mains in (`input_volts`, `input_hz`), what
  the UPS hands the load (`output_volts`, with `avr` when its regulation is
  boosting or trimming), and `battery_events` (optional): the spells on battery
  in the last `days`, counted as power cuts apart from self-tests, the last one
  under the count. Its facts line adds `battery_volts`, `battery_date` and the
  last `self_test` result in words (one starting "failed" is drawn red); its
  caption, `shutdown_battery_percent` / `shutdown_runtime_seconds`, the
  thresholds at which the host's UPS daemon shuts it down on battery.
  `output_amps`, `output_va` and `capacity_va` are optional extras no panel
  draws today.
- A supply reports whichever side it meters, `input_watts` or `output_watts`.
  `warning` is a condition it flags, in words.
- Money is in the currency's major unit. `run_rate_per_month` is 30 days at the
  recent run rate (the reference source uses the last 7 days), not today x 30.
  The standing charge is shown, and only added when `include_standing_charge`
  says the source counted it: it is paid with or without the machine.
- `mains` is optional; without it the panels assume 230 V +10 % / -6 % and
  50 Hz +/-1 %.
- `other_loads` (optional) are loads on the same meter as `total_watts` that
  are not this machine (network gear on the UPS). The wall tile takes them out
  first, then the GPUs, and calls what is left "system"; `estimated` marks a
  figure no meter measures.
- `connectors` (optional, per supply) are a multi-rail supply's 12 V outputs,
  each with its own over-current limit; drawn as current against the limit.
- `rails` (optional, per supply) are its output rails; a rail more than 5 % off
  nominal, now or in its 24 h range, is drawn red (the ATX tolerance).
- The idle floor (optional, drives the Idle vs Work panel): `floor_watts` is
  what the machine draws doing nothing (the reference source takes the
  10th-percentile minute of the last 7 days), `floor_cost_per_month` that alone
  for 30 days, and today's energy split into `today_idle_kwh` (under the floor)
  and `today_work_kwh` / `today_work_cost` (above it).

## `GET /history?hours=N`

The wall figure over the last N hours, polled every minute.

```json
{
  "hours": 24, "step_seconds": 60, "currency": "GBP",
  "kwh": 10.1, "cost": 2.66, "average_watts": 421, "peak_watts": 1553,
  "input_volts_min": 230.4, "input_volts_max": 240.4, "input_hz_min": 49.8, "input_hz_max": 50.1,
  "points": [
    { "t": 1793290500000, "total_watts": 1404, "gpu_watts": 1025, "gpus_watts": [246, 260, 268, 251],
      "supplies_watts": [880, 460],
      "input_volts_min": 236.1, "input_volts_max": 236.1, "input_hz": 50.1, "on_battery": false }
  ],
  "gpu_labels": ["GPU 0", "GPU 1", "GPU 2", "GPU 3"],
  "supply_labels": ["PSU 1", "PSU 2"],
  "floor_watts": 296
}
```

`t` is the start of each step in epoch milliseconds. `gpu_watts` is the GPUs'
summed draw over the same step; with `gpus_watts` and `gpu_labels` the chart
stacks each GPU instead. The rest is `total_watts` minus the GPUs, floored at
zero (each GPU is capped so the stack never passes the wall figure). Steps with
`on_battery` are shaded; `floor_watts`, when given, is drawn as a dashed line.

`supplies_watts` (optional) is each supply's own reading over the step, in
`supply_labels` order, whose names match `supplies[].name` in `/now`: the side
it meters, as there. The Power supplies panel draws it as each supply's 24 h
chart, with its average and peak against the rating.

## `GET /daily?days=N`

One row per local day, oldest first, today last. Polled every 5 minutes.

```json
{ "currency": "GBP",
  "days": [ { "date": "2026-10-28", "kwh": 7.37, "gpu_kwh": 2.05, "cost": 1.94,
              "average_watts": 307, "peak_watts": 1280, "coverage": 1.0 } ] }
```

`coverage` is the share of the day's minutes with a reading (today: of the
minutes so far). A day under 95 % is drawn faded with its cost marked partial;
a day at 0 has no bar.

## Writing a source

Anything that serves these three documents works. A source reading apcupsd's
network information server, NUT's `upsd`, a supply's hwmon files or an InfluxDB
or Prometheus history is a few hundred lines. Keep the expensive parts cached:
`/now` is polled every 2 s by every open dashboard.

## GPU documents

The GPUs page reads two more documents from the same source, for what NVML's
snapshot cannot carry: a day of history and the link and fault counters an
operator checks after a crash. The dashboard relays them like the others,
under `/api/power/gpus` and `/api/power/gpu-history?hours=N` (1-168, default
24). Without them the GPU cards still show the snapshot's live figures; the
24 h, thermals and health panels say no source is configured.

### `GET /gpus`

Polled every 5 s. Per GPU, in NVML index order:

```json
{ "at": "2026-10-29T21:40:00+00:00", "driver": "615.71.09", "health_at": "2026-10-29T21:37:19+00:00",
  "gpus": [ { "index": 1, "label": "GPU 1 · slot 7", "slot": 7, "bus": "02:00.0", "pstate": "P2",
    "clock_reasons": ["power cap"], "enforced_power_limit_watts": 350, "pcie_gen": 4, "pcie_width": 16,
    "memory_util_percent": 41, "vbios": "94.02.32.00.02", "updated": "2026-10-29T21:39:58Z",
    "health": { "link_gen_max": 4, "link_width_max": 16, "replays": 26, "naks": 3462, "retrains": 10424,
      "aer_corrected": 3515, "rollovers": 0, "uncorrectable": 0, "xid": 0, "xid_last": null,
      "power_cap_s": 2330, "thermal_s": 136, "slowdown_s": 0,
      "since_boot": { "replays": 36, "retrains": 13512, "rollovers": 0 } } } ] }
```

- `clock_reasons` is NVML's clocks-event reasons in words (`idle`, `power cap`,
  `thermal`, `HW slowdown`, `HW thermal`, `power brake`, ...), an unnamed bit by
  value (`0x400`). The card names the most serious while the GPU is at 10 %
  load or more, and says `idle` below that: NVML flags a power cap on idle cards.
- `health` covers the last 24 h. `link_*_max` is the best link the GPU trained
  to (an idle card drops to Gen1). Replays, NAKs, retrains (L0 to recovery) and
  corrected AER reports are correctable: drawn grey. Rollovers, uncorrectable
  errors (the GPU's fatal and non-fatal counters plus uncorrectable AER), Xids
  and seconds of hardware slowdown are faults: drawn red when not zero.
  `thermal_s` is time under the driver's software thermal cap. `health` may be
  null until the source has computed it.

### `GET /gpu-history?hours=N`

Polled every minute. Steps (10 minutes for a day) oldest first, each with
every GPU in `labels` order, a summary per GPU, and the cards' own limits:

```json
{ "hours": 24, "step_seconds": 600, "labels": ["GPU 0 · slot 2", "GPU 1 · slot 7"],
  "points": [ { "t": 1793238000000, "gpus": [
    { "util": 91, "watts": 235, "temp": 77, "fan": 50, "power_cap": 0.13, "slowdown": 0 },
    { "util": 91, "watts": 215, "temp": 68, "fan": 36, "power_cap": 0.13, "slowdown": 0.01 } ] } ],
  "summary": [ { "index": 0, "busy_hours": 1.7, "util_avg": 6, "kwh": 1.28, "temp_max": 79,
                 "temp_max_at": "2026-10-29T01:50:00+00:00" } ],
  "limits": { "target_c": 83, "max_operating_c": 93, "slowdown_c": 95 } }
```

`util`, `watts` and `fan` are the step's means and `temp` its peak;
`power_cap` and `slowdown` are the share of the step with the clocks held by
each. `busy_hours` counts steps at 10 % load or more.
