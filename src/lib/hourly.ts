// Hourly temperature tier (the typical-day panel): the most recent HOURLY_YEARS of the
// archive, local clock time, 365 × 24 per year (Feb 29 dropped), as tenths of °F.
// Self-contained — no app imports — like ytd.ts: the browser fetches it live for a city
// with no file, and scripts/fetch-data.mjs imports it (Node strips the types) with --hourly.

export const HOURLY_YEARS = 10
export const HOURLY_API = 'https://archive-api.open-meteo.com/v1/archive'

export interface HourlyTier {
  startYear: number
  years: number
  timezone: string
  temp: Int16Array
}

/** The Open-Meteo request: ~261 free-tier calls (10 years ÷ 14 days, one variable). */
export function hourlyParams(lat: number, lon: number, endYear: number): Record<string, string> {
  return {
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'auto',
    start_date: `${endYear - HOURLY_YEARS + 1}-01-01`,
    end_date: `${endYear}-12-31`,
    hourly: 'temperature_2m',
    temperature_unit: 'fahrenheit',
  }
}

interface OmHourly {
  timezone: string
  hourly: { time: string[]; temperature_2m: (number | null)[] }
}

/** Open-Meteo's hourly response → the tier's fixed 365 × 24 grid. */
export function buildHourly(data: OmHourly, endYear: number): HourlyTier {
  // Bucket by local date and hour, so DST transitions (23- or 25-hour days) can't shift the grid.
  const byDate = new Map<string, (number | null)[]>()
  data.hourly.time.forEach((t, i) => {
    const date = t.slice(0, 10),
      hr = +t.slice(11, 13)
    if (date.endsWith('-02-29')) return
    let row = byDate.get(date)
    if (!row) byDate.set(date, (row = new Array<number | null>(24).fill(null)))
    if (row[hr] === null) row[hr] = data.hourly.temperature_2m[i]
  })
  const dates = [...byDate.keys()].sort()
  if (dates.length !== HOURLY_YEARS * 365)
    throw new Error(`hourly: expected ${HOURLY_YEARS * 365} days, got ${dates.length}`)
  const temp = new Int16Array(dates.length * 24)
  dates.forEach((d, di) => {
    const row = byDate.get(d)!
    for (let h = 0; h < 24; h++) {
      // A DST gap leaves one hour empty; carry the previous hour forward.
      const v = row[h] ?? row[h - 1] ?? row[h + 1] ?? 0
      temp[di * 24 + h] = Math.round(v * 10)
    }
  })
  return { startYear: endYear - HOURLY_YEARS + 1, years: HOURLY_YEARS, timezone: data.timezone, temp }
}

export async function fetchHourly(opts: {
  lat: number
  lon: number
  endYear: number
  fetchImpl?: typeof fetch
}): Promise<HourlyTier> {
  const res = await (opts.fetchImpl ?? fetch)(
    `${HOURLY_API}?${new URLSearchParams(hourlyParams(opts.lat, opts.lon, opts.endYear))}`,
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { reason?: string }
    throw new Error(`${res.status} ${body.reason ?? res.statusText}`)
  }
  return buildHourly((await res.json()) as OmHourly, opts.endYear)
}
