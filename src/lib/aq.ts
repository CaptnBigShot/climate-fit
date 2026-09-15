// Air quality — a separate data tier with its own dates. One file shape for both
// sources, so the panel never cares where a city's numbers came from:
//   epa          EPA AirData: validated daily AQI from nearby US monitors
//   cams_*       CAMS reanalysis via Open-Meteo, everywhere else
// Type-only imports, so scripts/air-quality.mjs imports the constants below (Node
// strips the types) and the fetch and the app share one definition of each.
import type { Window } from './prefs'

/** Bump when the file shape or how it's built changes: fetch-data rebuilds any file with an older `v`. */
export const AQ_FORMAT = 4

export type Pollutant = 'o3' | 'pm25' | 'pm10' | 'no2'
export type AqSource = 'epa' | 'cams_global' | 'cams_europe'

export interface PollutantMeta {
  key: Pollutant
  label: string
  /** EPA AQS parameter code — names the AirData file `daily_<code>_<year>.zip`. */
  epa: string
  /** Open-Meteo hourly variable holding this pollutant's US AQI sub-index. */
  cams: string
  /** How each day picks among the EPA monitors within EPA_RADIUS_KM: the nearest one that
   *  reported, or the highest reading (how EPA and AirNow report a metro area). */
  epaPick: 'nearest' | 'highest'
  /** The concentration at AQI 100 (EPA breakpoints). */
  at100: string
  about: string
}

/** Display order. Ozone and PM2.5 drive nearly every bad-air day in these cities.
 *  Ozone takes the highest monitor in range: it is regional, and downtown monitors read
 *  low because fresh traffic exhaust destroys ozone at street level. The rest are local,
 *  so they take the nearest. */
export const POLLUTANTS: PollutantMeta[] = [
  {
    key: 'o3',
    label: 'Ozone',
    epa: '44201',
    cams: 'us_aqi_ozone',
    epaPick: 'highest',
    at100: '70 ppb (8-hour mean)',
    about:
      'A gas formed in sunlight from vehicle, industry and oil-and-gas emissions (and wildfire smoke), so it peaks on hot, still summer afternoons.',
  },
  {
    key: 'pm25',
    label: 'PM2.5',
    epa: '88101',
    cams: 'us_aqi_pm2_5',
    epaPick: 'nearest',
    at100: '35.4 µg/m³ (24-hour mean)',
    about:
      'Fine particles. Wildfire smoke in summer; wood- and coal-heating smog trapped under winter inversions; traffic, industry, dust, fireworks.',
  },
  {
    key: 'pm10',
    label: 'PM10',
    epa: '81102',
    cams: 'us_aqi_pm10',
    epaPick: 'nearest',
    at100: '154 µg/m³ (24-hour mean)',
    about: 'Coarse particles, mostly dust: desert dust storms, construction, unpaved and sanded roads.',
  },
  {
    key: 'no2',
    label: 'NO₂',
    epa: '42602',
    cams: 'us_aqi_nitrogen_dioxide',
    epaPick: 'nearest',
    at100: '100 ppb (1-hour peak)',
    about: 'Nitrogen dioxide, mostly from traffic exhaust; highest near busy roads.',
  },
]

/** EPA category edges. A day counts at a level when its AQI is strictly above it. */
export const AQI_LEVELS = [
  { at: 50, name: 'moderate or worse' },
  { at: 100, name: 'unhealthy for sensitive groups or worse' },
  { at: 150, name: 'unhealthy for everyone or worse' },
] as const
/** The level the monthly chart and the per-year trend track: unhealthy for sensitive groups. */
export const AQI_TRACKED = AQI_LEVELS[1].at

/** EPA tier: monitors within this distance of the city count (see PollutantMeta.epaPick). */
export const EPA_RADIUS_KM = 50
/** 'highest' pick guard: with 3+ monitors reporting, a top reading more than this many AQI
 *  points above the next one is a faulty monitor, not weather, and the next one is used.
 *  (Fort McDowell, AZ reported summer-level ozone through the 2020–21 winters; the EPA's own
 *  metro AQI counted it, giving Phoenix 137 "unhealthy" days in 2020.) */
export const EPA_OUTLIER_AQI = 50
export const EPA_START_YEAR = 2000

export const AQ_SOURCE_LABEL: Record<AqSource, string> = {
  epa: 'EPA monitors',
  cams_global: 'CAMS global model · ~40 km grid',
  cams_europe: 'CAMS Europe model · ~10 km grid',
}

export interface AqSite {
  id: string
  name: string
  km: number
  days: number
}

/** One value per calendar day from `start` to `end` inclusive (Feb 29 kept — this tier
 *  is not on the weather archive's 365-day grid). */
export interface AqSeries {
  v: number
  id: string
  source: AqSource
  start: string
  end: string
  /** Daily AQI sub-index per pollutant; null = no reading that day. A pollutant with
   *  no readings at all is left out. */
  aqi: Partial<Record<Pollutant, (number | null)[]>>
  /** EPA only: every monitor that supplied a day's value for each pollutant, most days first. */
  sites?: Partial<Record<Pollutant, AqSite[]>>
}

export interface AqRow {
  key: Pollutant | 'any'
  label: string
  /** Days per year above each of AQI_LEVELS. */
  perYear: number[]
  /** Share of days in the span with a reading. */
  coverage: number
}

export interface AqStats {
  source: AqSource
  from: string
  to: string
  years: number
  /** 'any' first (the day's AQI: the worst pollutant), then each measured pollutant. */
  rows: AqRow[]
  /** Days per year above AQI_TRACKED, by month, split by the pollutant that set the day's AQI. */
  months: Record<'o3' | 'pm25' | 'other', number[]>
  /** Days above AQI_TRACKED in each calendar year the span covers (≥ 90% of days). */
  byYear: { year: number; days: number }[]
  worst: { date: string; aqi: number; by: Pollutant } | null
  sites: AqSeries['sites']
}

const DAY = 86_400_000
const ms = (date: string) => Date.parse(`${date}T00:00:00Z`)
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

/** Counts over the lookback window, clipped to the record. Null when they don't overlap. */
export function aqStats(aq: AqSeries, w: Window): AqStats | null {
  const t0 = ms(aq.start)
  const from = Math.max(t0, ms(`${w.from}-01-01`)),
    to = Math.min(ms(aq.end), ms(`${w.to}-12-31`))
  if (from > to) return null
  const i0 = (from - t0) / DAY,
    n = (to - from) / DAY + 1,
    years = n / 365.25
  const measured = POLLUTANTS.filter((p) => aq.aqi[p.key])
  const counts = new Map<AqRow['key'], { above: number[]; seen: number }>(
    ['any' as const, ...measured.map((p) => p.key)].map((k) => [k, { above: AQI_LEVELS.map(() => 0), seen: 0 }]),
  )
  const months = { o3: new Array(12).fill(0), pm25: new Array(12).fill(0), other: new Array(12).fill(0) }
  const yearDays = new Map<number, { days: number; bad: number }>()
  let worst: AqStats['worst'] = null

  const tally = (key: AqRow['key'], v: number) => {
    const c = counts.get(key)!
    c.seen++
    AQI_LEVELS.forEach((l, k) => {
      if (v > l.at) c.above[k]++
    })
  }
  for (let d = 0; d < n; d++) {
    const i = i0 + d,
      date = new Date(from + d * DAY)
    let top = -1,
      by: Pollutant = 'o3'
    for (const p of measured) {
      const v = aq.aqi[p.key]![i]
      if (v === null) continue
      tally(p.key, v)
      if (v > top) {
        top = v
        by = p.key
      }
    }
    const y = date.getUTCFullYear()
    const yd = yearDays.get(y) ?? { days: 0, bad: 0 }
    yearDays.set(y, yd)
    yd.days++
    if (top < 0) continue
    tally('any', top)
    if (top > AQI_TRACKED) {
      yd.bad++
      months[by === 'o3' || by === 'pm25' ? by : 'other'][date.getUTCMonth()]++
    }
    if (!worst || top > worst.aqi) worst = { date: iso(date.getTime()), aqi: top, by }
  }

  const label = (k: AqRow['key']) => (k === 'any' ? 'Any pollutant' : POLLUTANTS.find((p) => p.key === k)!.label)
  return {
    source: aq.source,
    from: iso(from),
    to: iso(to),
    years,
    rows: [...counts].map(([key, c]) => ({
      key,
      label: label(key),
      perYear: c.above.map((v) => v / years),
      coverage: c.seen / n,
    })),
    months: {
      o3: months.o3.map((v) => v / years),
      pm25: months.pm25.map((v) => v / years),
      other: months.other.map((v) => v / years),
    },
    byYear: [...yearDays].filter(([, v]) => v.days >= 0.9 * 365).map(([year, v]) => ({ year, days: v.bad })),
    worst,
    sites: aq.sites,
  }
}
