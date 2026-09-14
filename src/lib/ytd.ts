// Current-year (partial) fetch. Self-contained — no app imports — so the browser
// uses it for the live fetch and scripts/fetch-data.mjs imports it (Node strips the
// types) to write the offline snapshot. Both produce the same YtdRaw shape.

export const YTD_API = 'https://archive-api.open-meteo.com/v1/archive'

/** Open-Meteo daily variable → our key, decimals kept. Shared with the archive fetch. */
export const DAILY_VARS: [string, string, number][] = [
  ['temperature_2m_max', 'high', 1],
  ['temperature_2m_min', 'low', 1],
  ['dew_point_2m_mean', 'dew', 1],
  ['cloud_cover_mean', 'cloud', 0],
  ['precipitation_sum', 'precip', 2],
  ['snowfall_sum', 'snow', 2],
  ['wind_speed_10m_max', 'wind', 1],
  ['shortwave_radiation_sum', 'rad', 2],
  ['sunshine_duration', 'sun', 1],
]

export interface YtdTerrainRef { id: string; lat: number; lon: number; elevFt: number }

export interface YtdRaw {
  year: number
  /** Last date (ISO) with an observed daily high and low; null if none yet. */
  through: string | null
  /** Number of observed days from Jan 1 (Feb 29 excluded). */
  days: number
  fetchedAt: string
  /** 365 entries per variable, null where not yet observed. */
  daily: Record<string, (number | null)[]>
  terrain: Record<string, { through: string | null; depth: (number | null)[] }>
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const round = (v: number | null | undefined, dp: number) => (v === null || v === undefined ? null : Number(v.toFixed(dp)))

/** Day-of-year index (0–364, Feb 29 → null) for an ISO date. */
function doyOf(date: string): number | null {
  if (date.endsWith('-02-29')) return null
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)
  let doy = Math.round(t / 86400000)
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  if (leap && m > 2) doy -= 1
  return doy
}

interface OmResponse { utc_offset_seconds: number; daily: { time: string[]; [variable: string]: (number | null)[] | string[] } }
const series = (r: OmResponse, k: string) => r.daily[k] as (number | null)[]

async function getJson(url: string, fetchImpl: typeof fetch): Promise<OmResponse | OmResponse[]> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`${res.status} ${body.reason ?? res.statusText}`)
  }
  return res.json()
}

/** Fetch Jan 1 → yesterday of `year`, where "yesterday" is in the city's own time zone.
 *  Today is excluded — it isn't over — and so is anything the API returns past it. */
export async function fetchYtdRaw(opts: {
  year: number; lat: number; lon: number; terrain: YtdTerrainRef[]; now?: Date; fetchImpl?: typeof fetch
}): Promise<YtdRaw> {
  const f = opts.fetchImpl ?? fetch
  const now = opts.now ?? new Date()
  const endOfYear = new Date(Date.UTC(opts.year, 11, 31))
  // Ask through UTC today (the latest any zone could have finished), then trim to local yesterday below.
  const end = isoDay(now < endOfYear ? now : endOfYear)
  const start = `${opts.year}-01-01`
  const daily: YtdRaw['daily'] = Object.fromEntries(DAILY_VARS.map(([, k]) => [k, new Array(365).fill(null)]))
  const out: YtdRaw = { year: opts.year, through: null, days: 0, fetchedAt: now.toISOString(), daily, terrain: {} }
  if (end < start) return out

  const q = new URLSearchParams({
    latitude: String(opts.lat), longitude: String(opts.lon), start_date: start, end_date: end,
    daily: DAILY_VARS.map((v) => v[0]).join(','), temperature_unit: 'fahrenheit', precipitation_unit: 'inch',
    wind_speed_unit: 'mph', timezone: 'auto',
  })
  const data = (await getJson(`${YTD_API}?${q}`, f)) as OmResponse
  const localToday = isoDay(new Date(now.getTime() + data.utc_offset_seconds * 1000))
  let last = -1
  data.daily.time.forEach((t, i) => {
    const d = doyOf(t)
    if (d === null || t >= localToday) return
    for (const [src, key, dp] of DAILY_VARS) {
      const v = series(data, src)[i]
      daily[key][d] = key === 'sun' ? round(v === null ? null : v / 3600, dp) : round(v, dp)
    }
    if (daily.high[d] !== null && daily.low[d] !== null) last = Math.max(last, d)
  })
  // Observed = the unbroken run from Jan 1. A gap ends it, so nothing after a hole is trusted.
  let days = 0
  while (days <= last && daily.high[days] !== null && daily.low[days] !== null) days++
  for (const [, key] of DAILY_VARS) for (let d = days; d < 365; d++) daily[key][d] = null
  out.days = days
  out.through = days ? data.daily.time.find((t) => doyOf(t) === days - 1) ?? null : null

  if (opts.terrain.length) {
    // One request for every terrain point: Open-Meteo accepts comma-separated coordinates.
    const tq = new URLSearchParams({
      latitude: opts.terrain.map((t) => t.lat).join(','), longitude: opts.terrain.map((t) => t.lon).join(','),
      elevation: opts.terrain.map((t) => Math.round(t.elevFt * 0.3048)).join(','),
      models: 'era5_land', start_date: start, end_date: end, daily: 'snow_depth_max', timezone: 'auto',
    })
    const td = await getJson(`${YTD_API}?${tq}`, f)
    const list = Array.isArray(td) ? td : [td]
    opts.terrain.forEach((t, k) => {
      const depth: (number | null)[] = new Array(365).fill(null)
      let tl = -1
      list[k].daily.time.forEach((ts, i) => {
        const d = doyOf(ts), m = series(list[k], 'snow_depth_max')[i]
        if (d === null || m === null || ts >= localToday) return
        depth[d] = Math.round(m * 39.37)
        tl = Math.max(tl, d)
      })
      out.terrain[t.id] = { through: tl >= 0 ? list[k].daily.time.find((ts) => doyOf(ts) === tl) ?? null : null, depth }
    })
  }
  return out
}
