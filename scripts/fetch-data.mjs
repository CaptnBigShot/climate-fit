// Build-time data fetch: pulls the daily archive for every catalogue city and
// snow-depth series for every terrain reference from the Open-Meteo Historical
// Weather API, plus two separate data tiers — hourly temperature (for the
// typical-day profile) and air quality (scripts/air-quality.mjs) — and writes
// compact JSON into public/data/.
//
// Then it works through src/data/queue.json in order, moving each city into the
// catalogue once all its files are written. Every request is metered against a
// per-run budget (--budget, default 9,000 of the free tier's 10,000 daily calls);
// a city is only started if its whole cost fits, so a run stops between cities and
// the next one carries on. Resumable: files that already exist are skipped.
//
//   npm run fetch-data                         catalogue gaps, then the queue
//   npm run fetch-data -- calgary prague       only these ids (catalogue or queue)
//   npm run fetch-data -- --budget 20000       spend more (or less) this run
//   npm run fetch-data -- --refresh-ytd        re-fetch every current-year snapshot
//   npm run fetch-data -- --hourly             also write hourly files (the app otherwise
//                                              fetches a new city's hourly tier live)
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { buildManifest } from './build-manifest.mjs'
import { camsRequest, fetchAirQuality, isCurrent } from './air-quality.mjs'
import { BudgetExhausted, archiveRequests, budget, budgetLeft, get, meteredFetch, weight } from './open-meteo.mjs'
import { promote, readCatalog, readQueue, writeCatalog, writeQueue } from './catalog-file.mjs'
import { DAILY_VARS, fetchYtdRaw } from '../src/lib/ytd.ts'
import { buildHourly } from '../src/lib/hourly.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'data')
/** The current-year snapshot is only a fallback for the app's live fetch, so refresh it
 *  weekly, with whatever budget is left after new cities. */
const YTD_MAX_AGE_DAYS = 7

const { values: opts, positionals: only } = parseArgs({
  allowPositionals: true,
  options: { budget: { type: 'string' }, 'refresh-ytd': { type: 'boolean' }, hourly: { type: 'boolean' } },
})
if (opts.budget !== undefined) {
  budget.limit = Number(opts.budget)
  if (!(budget.limit > 0)) throw new Error(`--budget must be a positive number of calls, not ${opts.budget}`)
}

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

async function fetchCity(city) {
  const data = await get(REQ.daily(city, CITY_VARS.map((v) => v[0])))
  const grid = await get(REQ.grid(city))
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
  await writeFile(file('cities', city.id), JSON.stringify(out))
}

async function fetchTerrain(id) {
  const data = await get(REQ.terrain(terrainOf(id)))
  const keep = keepIndex(data.daily.time)
  const depthIn = keep.map((i) => {
    const m = data.daily.snow_depth_max[i]
    return m === null ? null : Math.round(m * 39.37)
  })
  await writeFile(file('terrain', id), JSON.stringify({ id, startYear, years: endYear - startYear + 1, depth: depthIn }))
}

// Hourly temperature (src/lib/hourly.ts), stored as base64 Int16 tenths of °F — ~230 KB per
// city, loaded only when the panel opens. Only with --hourly: without a file, the app fetches
// a city's hourly tier live the first time its panel opens, which saves ~261 calls a city here.
async function fetchHourly(city) {
  const t = buildHourly(await get(REQ.hourly(city)), endYear)
  await writeFile(file('hourly', city.id), JSON.stringify({ id: city.id, startYear: t.startYear, years: t.years, timezone: t.timezone, temp10: Buffer.from(t.temp.buffer).toString('base64') }))
}

// Current partial year: an offline fallback for the app's live fetch.
async function fetchYtdSnapshot(city) {
  const raw = await fetchYtdRaw({
    year: endYear + 1, lat: city.lat, lon: city.lon,
    terrain: city.terrain.map(([id]) => ({ id, ...terrainOf(id) })),
    fetchImpl: meteredFetch,
  })
  await writeFile(file('ytd', city.id), JSON.stringify(raw))
}

/** What fetchYtdSnapshot will cost today: the city's daily variables plus one snow
 *  series per terrain point, Jan 1 → today. */
function ytdCost(city) {
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

/** The files a city still needs, each with its cost in calls. */
async function missing(city) {
  const steps = []
  if (!(await exists(file('cities', city.id)))) {
    steps.push({ what: city.id, cost: weight(REQ.daily(city, CITY_VARS.map((v) => v[0]))) + weight(REQ.grid(city)), run: () => fetchCity(city) })
  }
  for (const [tid] of city.terrain) {
    if (!(await exists(file('terrain', tid)))) steps.push({ what: `terrain/${tid}`, cost: weight(REQ.terrain(terrainOf(tid))), run: () => fetchTerrain(tid) })
  }
  if (opts.hourly && !(await exists(file('hourly', city.id)))) steps.push({ what: `hourly/${city.id}`, cost: weight(REQ.hourly(city)), run: () => fetchHourly(city) })
  if (!(await exists(file('ytd', city.id)))) steps.push({ what: `ytd/${city.id}`, cost: ytdCost(city), run: () => fetchYtdSnapshot(city) })
  return steps
}

/** Calls the air-quality batch will spend on this city: none for US cities (EPA monitors,
 *  not Open-Meteo), a CAMS request for everyone else. */
async function aqCost(city) {
  if (city.region.endsWith('United States') || (await isCurrent(file('aq', city.id)))) return 0
  return weight(camsRequest(city, endYear))
}

for (const dir of ['cities', 'terrain', 'hourly', 'aq', 'ytd']) await mkdir(join(OUT, dir), { recursive: true })
console.log(`fetch-data ${new Date().toISOString()} · budget ${budget.limit} calls`)

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
  await fetchAirQuality(ready, { out: join(OUT, 'aq'), cache: join(ROOT, '.cache'), endYear })
} catch (e) {
  if (e instanceof BudgetExhausted) console.log(`air quality: ${e.message}; the rest next run`)
  else { failed ??= e; console.error(`✗ air quality: ${e.message}`) }
}
await buildManifest()
console.log(`${complete} of ${selected.length} cities complete · ${queue?.cities.length ?? 0} waiting in the queue · ~${Math.round(budget.spent)} calls spent`)
if (failed) process.exit(1)
