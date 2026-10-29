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

Live readings, polled every 5 s.

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
    "battery_date": "2026-10-15"
  },
  "supplies": [
    { "name": "PSU 1", "input_watts": 646, "output_watts": null, "capacity_watts": 1600,
      "temperature_c": 54.2, "fan_rpm": 780, "input_volts": 233, "warning": null }
  ],
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
    "run_rate_per_month": 71.19
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
- A supply reports whichever side it meters, `input_watts` or `output_watts`.
  `warning` is a condition it flags, in words.
- Money is in the currency's major unit. `run_rate_per_month` is 30 days at the
  recent run rate (the reference source uses the last 7 days), not today x 30.
  The standing charge is shown, and only added when `include_standing_charge`
  says the source counted it: it is paid with or without the machine.
- `mains` is optional; without it the panels assume 230 V +10 % / -6 % and
  50 Hz +/-1 %.

## `GET /history?hours=N`

The wall figure over the last N hours, polled every minute.

```json
{
  "hours": 24, "step_seconds": 60, "currency": "GBP",
  "kwh": 10.1, "cost": 2.66, "average_watts": 421, "peak_watts": 1553,
  "input_volts_min": 230.4, "input_volts_max": 240.4, "input_hz_min": 49.8, "input_hz_max": 50.1,
  "points": [
    { "t": 1793290500000, "total_watts": 1404, "gpu_watts": 1025,
      "input_volts_min": 236.1, "input_volts_max": 236.1, "input_hz": 50.1, "on_battery": false }
  ]
}
```

`t` is the start of each step in epoch milliseconds. `gpu_watts` is the GPUs'
summed draw over the same step; the chart stacks it under the rest
(`total_watts - gpu_watts`, floored at zero). Steps with `on_battery` are shaded.

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
`/now` is polled every 5 s by every open dashboard.
