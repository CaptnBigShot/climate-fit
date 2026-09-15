// Build-time data fetch: the daily archive for every catalogue city and snow-depth
// series for every terrain reference, plus two separate data tiers — hourly
// temperature (for the typical-day profile) and air quality (scripts/air-quality.mjs) —
// written as compact JSON into public/data/.
//
// Weather and CAMS air quality come from Open-Meteo's public S3 bucket by default
// (scripts/open-meteo-s3.mjs): the same data and the same computation as the API, with no
// API calls. --source api uses the API instead — the one way to get European air quality
// before 2024, which the bucket doesn't have.
//
// Then it works through src/data/queue.json in order, moving each city into the
// catalogue once all its files are written. With --source api, every request is metered
// against a per-run budget (--budget, default 9,000 of the free tier's 10,000 daily calls);
// a city is only started if its whole cost fits, so a run stops between cities and the
// next one carries on. Resumable: files that already exist are skipped.
//
//   npm run fetch-data                         catalogue gaps, then the queue
//   npm run fetch-data -- calgary prague       only these ids (catalogue or queue)
//   npm run fetch-data -- --budget 20000       spend more (or less) this run
//   npm run fetch-data -- --refresh-ytd        re-fetch every current-year snapshot
//   npm run fetch-data -- --hourly             also write hourly files (the app otherwise
//                                              fetches a new city's hourly tier live)
//   npm run fetch-data -- --rebuild            rewrite existing archive files (cities,
//                                              terrain, hourly) instead of skipping them
//   npm run fetch-data -- --source api         weather and air quality from the API, not S3
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { buildManifest } from './build-manifest.mjs'
import { camsRequest, fetchAirQuality, isCurrent } from './air-quality.mjs'
import { BudgetExhausted, archiveRequests, budget, budgetLeft, get, meteredFetch, weight } from './open-meteo.mjs'
import { archive, s3Fetch, s3Stats } from './open-meteo-s3.mjs'
import { promote, readCatalog, readQueue, writeCatalog, writeQueue } from './catalog-file.mjs'
import { DAILY_VARS, fetchYtdRaw } from '../src/lib/ytd.ts'
import { buildHourly } from '../src/lib/hourly.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'data')

const { values: opts, positionals: only } = parseArgs({
  allowPositionals: true,
  options: {
    budget: { type: 'string' }, 'refresh-ytd': { type: 'boolean' }, hourly: { type: 'boolean' },
    rebuild: { type: 'boolean' }, source: { type: 'string', default: 's3' },
  },
})
if (opts.budget !== undefined) {
  budget.limit = Number(opts.budget)
  if (!(budget.limit > 0)) throw new Error(`--budget must be a positive number of calls, not ${opts.budget}`)
}
if (!['s3', 'api'].includes(opts.source)) throw new Error(`--source must be s3 or api, not ${opts.source}`)
const S3 = opts.source === 's3'
/** An archive request, answered by S3 (free) or the API (metered). */
const fetchArchive = (params) => (S3 ? archive(params) : get(params))
const archiveCost = (params) => (S3 ? 0 : weight(params))
/** The app shows the current-year snapshot instead of fetching live while it's under a day
 *  old (src/lib/current.ts). From S3 a refresh is free, so every run more than 20 hours after
 *  the last refreshes them all; from the API, weekly with whatever budget is left. */
const YTD_MAX_AGE_DAYS = S3 ? 20 / 24 : 7

const catalog = await readCatalog()
const queue = await readQueue()
const { startYear, endYear } = catalog.archive
const REQ = archiveRequests(catalog.archive)

// Open-Meteo name → our key, and decimals kept — shared with the live current-year fetch.
const CITY_VARS = DAILY_VARS

const exists = (p) => access(p).then(() => true, () => false)
const file = (dir, id) => join(OUT, dir, `${id}.json`)
const terrainOf = (tid) => {
  const t = catalog.terrain[tid] ?? queue?.terrain[tid]
  if (!t) throw new Error(`terrain reference ${tid} is in neither the catalogue nor the queue`)
  return t
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

/** Physical bounds every archived value must fall in (°F, inches, mph, MJ/m², hours). A gap
 *  or anything outside means a bad read, so the file is refused rather than written. */
const BOUNDS = { high: [-90, 135], low: [-90, 135], dew: [-90, 135], cloud: [0, 100], precip: [0, 40], snow: [0, 100], wind: [0, 200], rad: [0, 45], sun: [0, 24] }
function check(id, out) {
  for (const [key, [lo, hi]] of Object.entries(BOUNDS)) {
    const bad = out[key].findIndex((v) => v === null || !(v >= lo && v <= hi))
    if (bad >= 0) throw new Error(`${id}: ${key} day ${bad} is ${out[key][bad]}, outside ${lo}…${hi}`)
  }
  const bad = out.high.findIndex((h, i) => out.low[i] > h || out.dew[i] > h + 0.1)
  if (bad >= 0) throw new Error(`${id}: day ${bad} has low ${out.low[bad]} / dew point ${out.dew[bad]} above high ${out.high[bad]}`)
}

async function fetchCity(city) {
  const data = await fetchArchive(REQ.daily(city, CITY_VARS.map((v) => v[0])))
  const grid = await fetchArchive(REQ.grid(city))
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
  check(city.id, out)
  await writeFile(file('cities', city.id), JSON.stringify(out))
}

async function fetchTerrain(id) {
  const data = await fetchArchive(REQ.terrain(terrainOf(id)))
  const keep = keepIndex(data.daily.time)
  const depthIn = keep.map((i) => {
    const m = data.daily.snow_depth_max[i]
    return m === null ? null : Math.round(m * 39.37)
  })
  // Glacier cells run to tens of metres of snow; nothing real goes negative or missing.
  const bad = depthIn.findIndex((v) => v === null || !(v >= 0 && v <= 3000))
  if (bad >= 0) throw new Error(`terrain/${id}: day ${bad} depth is ${depthIn[bad]}`)
  await writeFile(file('terrain', id), JSON.stringify({ id, startYear, years: endYear - startYear + 1, depth: depthIn }))
}

// Hourly temperature (src/lib/hourly.ts), stored as base64 Int16 tenths of °F — ~230 KB per
// city, loaded only when the panel opens. Only with --hourly: without a file, the app fetches
// a city's hourly tier live the first time its panel opens, which keeps public/data small.
async function fetchHourly(city) {
  const t = buildHourly(await fetchArchive(REQ.hourly(city)), endYear)
  await writeFile(file('hourly', city.id), JSON.stringify({ id: city.id, startYear: t.startYear, years: t.years, timezone: t.timezone, temp10: Buffer.from(t.temp.buffer).toString('base64') }))
}

// Current partial year: the app shows it while under a day old, else fetches live (and falls back to it).
async function fetchYtdSnapshot(city) {
  const raw = await fetchYtdRaw({
    year: endYear + 1, lat: city.lat, lon: city.lon,
    terrain: city.terrain.map(([id]) => ({ id, ...terrainOf(id) })),
    fetchImpl: S3 ? s3Fetch : meteredFetch,
  })
  await writeFile(file('ytd', city.id), JSON.stringify(raw))
}

/** What fetchYtdSnapshot will cost today: the city's daily variables plus one snow
 *  series per terrain point, Jan 1 → today. */
function ytdCost(city) {
  if (S3) return 0
  const start = `${endYear + 1}-01-01`
  const end = new Date().toISOString().slice(0, 10)
  const last = end < `${endYear + 1}-12-31` ? end : `${endYear + 1}-12-31`
  if (last < start) return 0
  const span = { start_date: start, end_date: last }
  const lats = city.terrain.map(([id]) => terrainOf(id).lat)
  return weight({ latitude: city.lat, daily: CITY_VARS.map((v) => v[0]).join(','), ...span })
    + (lats.length ? weight({ latitude: lats.join(','), daily: 'snow_depth_max', ...span }) : 0)
}

/** Days since the snapshot was fetched; Infinity if there isn't a usable one. */
async function ytdAge(city) {
  try {
    const raw = JSON.parse(await readFile(file('ytd', city.id), 'utf8'))
    return raw.year === endYear + 1 ? (Date.now() - Date.parse(raw.fetchedAt)) / 86_400_000 : Infinity
  } catch { return Infinity }
}

/** --rebuild rewrites each archive file once per run; a terrain shared by several cities
 *  isn't fetched again for each. */
const rebuilt = new Set()
async function needs(dir, id) {
  if (opts.rebuild && !rebuilt.has(`${dir}/${id}`)) { rebuilt.add(`${dir}/${id}`); return true }
  return !(await exists(file(dir, id)))
}

/** The files a city still needs, each with its cost in calls. */
async function missing(city) {
  const steps = []
  if (await needs('cities', city.id)) {
    steps.push({ what: city.id, cost: archiveCost(REQ.daily(city, CITY_VARS.map((v) => v[0]))) + archiveCost(REQ.grid(city)), run: () => fetchCity(city) })
  }
  for (const [tid] of city.terrain) {
    if (await needs('terrain', tid)) steps.push({ what: `terrain/${tid}`, cost: archiveCost(REQ.terrain(terrainOf(tid))), run: () => fetchTerrain(tid) })
  }
  if (opts.hourly && (await needs('hourly', city.id))) steps.push({ what: `hourly/${city.id}`, cost: archiveCost(REQ.hourly(city)), run: () => fetchHourly(city) })
  if (!(await exists(file('ytd', city.id)))) steps.push({ what: `ytd/${city.id}`, cost: ytdCost(city), run: () => fetchYtdSnapshot(city) })
  return steps
}

/** Calls the air-quality batch will spend on this city: none from S3, none for US cities
 *  (EPA monitors, not Open-Meteo), a CAMS request for everyone else. */
async function aqCost(city) {
  if (city.region.endsWith('United States') || (await isCurrent(file('aq', city.id)))) return 0
  return S3 ? 0 : weight(camsRequest(city, endYear))
}

for (const dir of ['cities', 'terrain', 'hourly', 'aq', 'ytd']) await mkdir(join(OUT, dir), { recursive: true })
console.log(`fetch-data ${new Date().toISOString()} · weather from ${S3 ? 'S3' : 'the API'} · budget ${budget.limit} calls`)

// A crash between the two writes of a promotion leaves a city in both files.
if (queue && queue.cities.some((q) => catalog.cities.some((c) => c.id === q.id))) {
  queue.cities = queue.cities.filter((q) => !catalog.cities.some((c) => c.id === q.id))
  await writeQueue(queue)
}

const queued = new Set((queue?.cities ?? []).map((c) => c.id))
const selected = [...catalog.cities, ...(queue?.cities ?? [])].filter((c) => !only.length || only.includes(c.id))
for (const id of only) if (!selected.some((c) => c.id === id)) console.warn(`? ${id} is in neither the catalogue nor the queue`)

// City by city, each with its terrain right after, so partial runs still leave
// complete, usable cities behind.
let failed = null, stoppedAt = null, complete = 0
for (const city of selected) {
  const steps = await missing(city)
  const aq = await aqCost(city)
  const cost = steps.reduce((sum, s) => sum + s.cost, 0) + aq
  if (cost > budgetLeft()) { stoppedAt = { city, cost }; break }
  try {
    if (steps.length) console.log(`↓ ${city.id} · ${steps.map((s) => s.what).join(', ')} · ~${Math.round(cost)} calls`)
    for (const s of steps) await s.run()
  } catch (e) {
    if (e instanceof BudgetExhausted) { stoppedAt = { city, cost }; break }
    failed = e
    console.error(`✗ ${city.id}: ${e.message}`)
    break
  }
  budget.reserved += aq
  if (queued.has(city.id)) {
    promote(catalog, queue, city.id)
    await writeCatalog(catalog)
    await writeQueue(queue)
    console.log(`+ ${city.id} added to the catalogue`)
  }
  complete++
}
if (stoppedAt) {
  console.log(`budget: stopping before ${stoppedAt.city.id} (needs ~${Math.round(stoppedAt.cost)} calls, ~${Math.max(0, Math.round(budgetLeft()))} left); the next run carries on from there`)
}

// Refresh stale current-year snapshots, stalest first, with whatever budget is left.
if (!failed && !stoppedAt) {
  const stale = []
  for (const city of catalog.cities) {
    if (only.length && !only.includes(city.id)) continue
    const age = await ytdAge(city)
    if (opts['refresh-ytd'] || age > YTD_MAX_AGE_DAYS) stale.push({ city, age })
  }
  stale.sort((a, b) => b.age - a.age)
  let refreshed = 0
  try {
    for (const { city } of stale) {
      if (ytdCost(city) > budgetLeft()) break
      await fetchYtdSnapshot(city)
      refreshed++
    }
  } catch (e) {
    if (!(e instanceof BudgetExhausted)) { failed = e; console.error(`✗ ytd: ${e.message}`) }
  }
  if (stale.length) console.log(`✓ ytd: ${refreshed} of ${stale.length} stale snapshots refreshed`)
}

// One batch, not per city: each EPA file covers every US city at once. Only cities whose
// weather is in, so a manual catalogue addition doesn't spend its air-quality calls early.
budget.reserved = 0
try {
  const ready = []
  for (const c of catalog.cities) if ((!only.length || only.includes(c.id)) && (await exists(file('cities', c.id)))) ready.push(c)
  await fetchAirQuality(ready, { out: join(OUT, 'aq'), cache: join(ROOT, '.cache'), endYear, source: opts.source })
} catch (e) {
  if (e instanceof BudgetExhausted) console.log(`air quality: ${e.message}; the rest next run`)
  else { failed ??= e; console.error(`✗ air quality: ${e.message}`) }
}
await buildManifest()
console.log(`${complete} of ${selected.length} cities complete · ${queue?.cities.length ?? 0} waiting in the queue · ~${Math.round(budget.spent)} calls spent${S3 ? ` · ${(s3Stats.bytes / 1e6).toFixed(0)} MB from S3` : ''}`)
if (failed) process.exit(1)
