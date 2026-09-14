// Build-time data fetch: pulls the daily archive for every catalogue city and
// snow-depth series for every terrain reference from the Open-Meteo Historical
// Weather API, plus two separate data tiers — hourly temperature (for the
// typical-day profile) and air quality (scripts/air-quality.mjs) — and writes
// compact JSON into public/data/. Resumable: files that already exist are skipped,
// so re-running after a rate limit picks up where it stopped. Run: npm run fetch-data
import { mkdir, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import catalog from '../src/data/catalog.json' with { type: 'json' }
import { buildManifest } from './build-manifest.mjs'
import { fetchAirQuality } from './air-quality.mjs'
import { get } from './open-meteo.mjs'
import { DAILY_VARS, fetchYtdRaw } from '../src/lib/ytd.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'data')
/** Hourly tier: the most recent decade only, to stay inside the free-tier budget. */
const HOURLY_YEARS = 10
const { startYear, endYear } = catalog.archive
const START = `${startYear}-01-01`
const END = `${endYear}-12-31`

// Open-Meteo name → our key, and decimals kept — shared with the live current-year fetch.
const CITY_VARS = DAILY_VARS

const exists = (p) => access(p).then(() => true, () => false)

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

// Hourly temperature, local time, 365 × 24 per year (Feb 29 dropped), stored as
// base64 Int16 tenths of °F — ~230 KB per city, loaded only when the panel opens.
async function fetchHourly(city) {
  const file = join(OUT, 'hourly', `${city.id}.json`)
  if (await exists(file)) return console.log(`✓ hourly/${city.id} (cached)`)
  console.log(`↓ hourly/${city.id}`)
  const y0 = endYear - HOURLY_YEARS + 1
  const data = await get({
    latitude: city.lat, longitude: city.lon, start_date: `${y0}-01-01`, end_date: END,
    hourly: 'temperature_2m', temperature_unit: 'fahrenheit', timezone: 'auto',
  })
  // Bucket by local date and hour, so DST transitions (23- or 25-hour days) can't shift the grid.
  const byDate = new Map()
  data.hourly.time.forEach((t, i) => {
    const date = t.slice(0, 10), hr = +t.slice(11, 13)
    if (date.endsWith('-02-29')) return
    if (!byDate.has(date)) byDate.set(date, new Array(24).fill(null))
    const row = byDate.get(date)
    if (row[hr] === null) row[hr] = data.hourly.temperature_2m[i]
  })
  const dates = [...byDate.keys()].sort()
  if (dates.length !== HOURLY_YEARS * 365) throw new Error(`hourly: expected ${HOURLY_YEARS * 365} days, got ${dates.length}`)
  const buf = new Int16Array(dates.length * 24)
  dates.forEach((d, di) => {
    const row = byDate.get(d)
    for (let h = 0; h < 24; h++) {
      // A DST gap leaves one hour empty; carry the previous hour forward.
      const v = row[h] ?? row[h - 1] ?? row[h + 1] ?? 0
      buf[di * 24 + h] = Math.round(v * 10)
    }
  })
  await writeFile(file, JSON.stringify({ id: city.id, startYear: y0, years: HOURLY_YEARS, timezone: data.timezone, temp10: Buffer.from(buf.buffer).toString('base64') }))
}

// Current partial year: an offline fallback for the app's live fetch. Always
// re-fetched (never cached) so each run refreshes it.
async function fetchYtdSnapshot(city) {
  console.log(`↓ ytd/${city.id}`)
  const raw = await fetchYtdRaw({
    year: endYear + 1, lat: city.lat, lon: city.lon,
    terrain: city.terrain.map(([id]) => ({ id, ...catalog.terrain[id] })),
  })
  await writeFile(join(OUT, 'ytd', `${city.id}.json`), JSON.stringify(raw))
}

for (const dir of ['cities', 'terrain', 'hourly', 'aq', 'ytd']) await mkdir(join(OUT, dir), { recursive: true })

// Fetch city-by-city with its terrain right after, so partial runs still leave
// complete, usable cities behind.
const only = process.argv.slice(2)
const selected = catalog.cities.filter((c) => !only.length || only.includes(c.id))
let failed = null
for (const city of selected) {
  try {
    await fetchCity(city)
    for (const [tid] of city.terrain) await fetchTerrain(tid)
    await fetchHourly(city)
    await fetchYtdSnapshot(city)
  } catch (e) {
    failed = e
    console.error(`✗ ${city.id}: ${e.message}`)
    break
  }
}
// One batch, not per city: each EPA file covers every US city at once.
try {
  await fetchAirQuality(selected, { out: join(OUT, 'aq'), cache: join(ROOT, '.cache'), endYear })
} catch (e) {
  failed ??= e
  console.error(`✗ air quality: ${e.message}`)
}
await buildManifest()
if (failed) process.exit(1)
