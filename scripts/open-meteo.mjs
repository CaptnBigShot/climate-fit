// Open-Meteo request helper shared by the fetch scripts: waits out the per-minute and
// per-hour rate limits, stops cleanly at the daily one, and meters every request against
// a per-run budget so a scheduled run never spends the whole free-tier day.
import { hourlyParams } from '../src/lib/hourly.ts'

export const ARCHIVE_API = 'https://archive-api.open-meteo.com/v1/archive'
export const AQ_API = 'https://air-quality-api.open-meteo.com/v1/air-quality'

/** Free tier: 10,000 calls a day. A run leaves headroom for the app's own live fetches. */
export const DEFAULT_BUDGET = 9000

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DAY = 86_400_000
const count = (v) => (v === undefined || v === '' ? 0 : String(v).split(',').length)

/** What Open-Meteo counts one request as: every location separately, each weighted by
 *  variables (per 10) and days (per 14), never below 1 of either — so 35 years of 9 daily
 *  variables is ~913 calls. https://open-meteo.com/en/pricing */
export function weight(params) {
  const vars = count(params.daily) + count(params.hourly) + count(params.current)
  const days =
    params.start_date && params.end_date ? (Date.parse(params.end_date) - Date.parse(params.start_date)) / DAY + 1 : 1
  return count(params.latitude) * Math.max(1, vars / 10) * Math.max(1, days / 14)
}

export class BudgetExhausted extends Error {}

/** Calls spent this run. `reserved` is spending already promised to a later step (the
 *  air-quality batch), so planning leaves room for it; only `limit` is enforced. */
export const budget = { limit: DEFAULT_BUDGET, spent: 0, reserved: 0 }
export const budgetLeft = () => budget.limit - budget.spent - budget.reserved

function charge(w) {
  if (budget.spent + w > budget.limit) {
    throw new BudgetExhausted(`run budget reached (${Math.round(budget.spent)} of ${budget.limit} calls spent)`)
  }
  budget.spent += w
}

export async function get(params, api = ARCHIVE_API) {
  charge(weight(params))
  return request(`${api}?${new URLSearchParams(params)}`).then((res) => res.json())
}

/** A fetch that meters Open-Meteo URLs, for code that takes a fetch implementation (ytd.ts). */
export function meteredFetch(url) {
  charge(weight(Object.fromEntries(new URL(url).searchParams)))
  return request(String(url))
}

async function request(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url)
    if (res.ok) return res
    const body = await res.json().catch(() => ({}))
    const reason = body.reason || res.statusText
    if (res.status !== 429) throw new Error(`${res.status} ${reason}`)
    if (/daily/i.test(reason)) throw new Error(`Daily limit reached — re-run tomorrow. (${reason})`)
    const wait = /hourly/i.test(reason) ? 10 * 60_000 : 65_000
    console.log(`  rate limited (${reason}); waiting ${Math.round(wait / 1000)}s`)
    await sleep(wait)
  }
  throw new Error('gave up after repeated rate limits')
}

/** The archive requests fetch-data makes, as parameters — so a run can price a city
 *  before starting it, and the catalogue builder can price its queue. */
export function archiveRequests({ startYear, endYear }) {
  const start = `${startYear}-01-01`,
    end = `${endYear}-12-31`
  const at = (p) => ({ latitude: p.lat, longitude: p.lon, timezone: 'auto' })
  return {
    daily: (city, vars) => ({
      ...at(city),
      start_date: start,
      end_date: end,
      daily: vars.join(','),
      temperature_unit: 'fahrenheit',
      precipitation_unit: 'inch',
      wind_speed_unit: 'mph',
    }),
    // elevation=nan disables downscaling, so the response reports the raw grid-cell height.
    grid: (city) => ({ ...at(city), start_date: end, end_date: end, daily: 'temperature_2m_max', elevation: 'nan' }),
    // ERA5-Land (~9 km) resolves mountain snowpack far better than ERA5 (~25 km);
    // elevation is set to the reference elevation so the series is downscaled to it.
    terrain: (t) => ({
      ...at(t),
      elevation: String(Math.round(t.elevFt * 0.3048)),
      models: 'era5_land',
      start_date: start,
      end_date: end,
      daily: 'snow_depth_max',
    }),
    hourly: (city) => hourlyParams(city.lat, city.lon, endYear),
  }
}
