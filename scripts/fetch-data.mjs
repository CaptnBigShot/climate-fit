// Build-time data fetch: pulls the daily archive for every catalogue city and
// snow-depth series for every terrain reference from the Open-Meteo Historical
// Weather API, and writes compact JSON into public/data/. Resumable: files that
// already exist are skipped, so re-running after a rate limit picks up where it
// stopped. Run: npm run fetch-data
import { mkdir, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import catalog from '../src/data/catalog.json' with { type: 'json' }
import { buildManifest } from './build-manifest.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'data')
const API = 'https://archive-api.open-meteo.com/v1/archive'
const { startYear, endYear } = catalog.archive
const START = `${startYear}-01-01`
const END = `${endYear}-12-31`

// Open-Meteo name → our key, and decimals kept in the output.
const CITY_VARS = [
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

const exists = (p) => access(p).then(() => true, () => false)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(params) {
  const url = `${API}?${new URLSearchParams(params)}`
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url)
    if (res.ok) return res.json()
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

// Drop Feb 29 so every year is exactly 365 days — the calendar and all
// day-of-year statistics assume a fixed 365-column year.
function keepIndex(times) {
  const keep = []
  times.forEach((t, i) => { if (!t.endsWith('-02-29')) keep.push(i) })
  const expected = (endYear - startYear + 1) * 365
  if (keep.length !== expected) throw new Error(`expected ${expected} days, got ${keep.length}`)
  return keep
}

const round = (v, dp) => (v === null || v === undefined ? null : Number(v.toFixed(dp)))

async function fetchCity(city) {
  const file = join(OUT, 'cities', `${city.id}.json`)
  if (await exists(file)) return console.log(`✓ ${city.id} (cached)`)
  console.log(`↓ ${city.id}`)
  const common = { latitude: city.lat, longitude: city.lon, timezone: 'auto' }
  const data = await get({
    ...common, start_date: START, end_date: END,
    daily: CITY_VARS.map((v) => v[0]).join(','),
    temperature_unit: 'fahrenheit', precipitation_unit: 'inch', wind_speed_unit: 'mph',
  })
  // elevation=nan disables downscaling, so the response reports the raw grid-cell height.
  const grid = await get({ ...common, start_date: END, end_date: END, daily: 'temperature_2m_max', elevation: 'nan' })
  const keep = keepIndex(data.daily.time)
  const out = {
    id: city.id, startYear, years: endYear - startYear + 1,
    demElevM: data.elevation, gridElevM: grid.elevation,
    gridLat: data.latitude, gridLon: data.longitude,
  }
  for (const [src, key, dp] of CITY_VARS) {
    const series = data.daily[src]
    out[key] = keep.map((i) => {
      const v = series[i]
      return key === 'sun' ? round(v / 3600, dp) : round(v, dp)
    })
  }
  await writeFile(file, JSON.stringify(out))
}

async function fetchTerrain(id) {
  const t = catalog.terrain[id]
  const file = join(OUT, 'terrain', `${id}.json`)
  if (await exists(file)) return console.log(`✓ terrain/${id} (cached)`)
  console.log(`↓ terrain/${id}`)
  // ERA5-Land (~9 km) resolves mountain snowpack far better than ERA5 (~25 km);
  // elevation is set to the reference elevation so the series is downscaled to it.
  const data = await get({
    latitude: t.lat, longitude: t.lon, elevation: String(Math.round(t.elevFt * 0.3048)),
    models: 'era5_land', start_date: START, end_date: END, daily: 'snow_depth_max', timezone: 'auto',
  })
  const keep = keepIndex(data.daily.time)
  const depthIn = keep.map((i) => {
    const m = data.daily.snow_depth_max[i]
    return m === null ? null : Math.round(m * 39.37)
  })
  await writeFile(file, JSON.stringify({ id, startYear, years: endYear - startYear + 1, depth: depthIn }))
}

await mkdir(join(OUT, 'cities'), { recursive: true })
await mkdir(join(OUT, 'terrain'), { recursive: true })

// Fetch city-by-city with its terrain right after, so partial runs still leave
// complete, usable cities behind.
const only = process.argv.slice(2)
let failed = null
for (const city of catalog.cities) {
  if (only.length && !only.includes(city.id)) continue
  try {
    await fetchCity(city)
    for (const [tid] of city.terrain) await fetchTerrain(tid)
  } catch (e) {
    failed = e
    console.error(`✗ ${city.id}: ${e.message}`)
    break
  }
}
await buildManifest()
if (failed) process.exit(1)
