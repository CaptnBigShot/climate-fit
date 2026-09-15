// Drafts the fetch queue, src/data/queue.json: the cities to add, ranked by how well they
// suit the person choosing where to move (scripts/catalog.config.mjs says who that is and
// what they want), each with the metadata the app needs — region, population, coastal
// flag, and ski terrain with drive times. Spends no Open-Meteo calls. Review the queue
// (reorder, delete, edit), then fetch-data works through it in order, a night at a time.
//
// Sources, cached in .cache/catalog/ (delete a file there to refresh it):
//   GeoNames cities15000       candidates: name, coordinates, population, country, admin1
//   CRU CL 2.0 climatology     1961–1990 monthly normals on a 10′ grid, for choosing and ranking only
//   OpenSkiMap                 operating downhill ski areas, their run elevations and lifts
//   OSRM demo server           drive times from each chosen city to the ski areas near it
//   Natural Earth coastline    1:10m, for the coastal flag
//   BLS QCEW, ACS, Gazetteer   US tech jobs and commuting (scripts/us-metrics.mjs)
//
//   npm run catalog -- --force      redraft the queue (replaces it, edits there included)
//   npm run catalog -- --dry-run    print the choice and ranking only (no routing, no queue)
//   npm run catalog -- --count 150  a different number of cities
//   npm run catalog -- --check      the rules against the hand-set seed catalogue
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createGunzip } from 'node:zlib'
import config from './catalog.config.mjs'
import { climateScore, reach, snowFromDrive, snowFromKm, techScore, total, walkScore } from './fit-score.mjs'
import { koppen, koppenName } from './koppen.mjs'
import { DEFAULT_BUDGET, archiveRequests, sleep, weight } from './open-meteo.mjs'
import { camsRequest } from './air-quality.mjs'
import { readCatalog, readQueue, writeQueue, QUEUE_FILE } from './catalog-file.mjs'
import { loadUsMetrics } from './us-metrics.mjs'
import { DAILY_VARS } from '../src/lib/ytd.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache', 'catalog')
/** Everything the review page needs about the queue, beyond the queue file itself. */
export const REVIEW_FILE = join(CACHE, 'review.json')

/** Default size of the whole set, catalogue included — the spec's "few hundred metros". */
const SET_SIZE = 300
/** GeoNames place types that are towns and cities (not city districts, historical or abandoned places). */
const PLACE_CODES = new Set(['PPLC', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPL', 'PPLG', 'PPLS', 'PPLF', 'PPLR', 'PPLL'])
/** A smaller place this close to a bigger candidate is part of the same metro. */
const METRO_KM = 25
/** Outside the US (where metro membership decides, see below), a place is a suburb when it's
 *  within this many km of a place this many times bigger: [km, ratio]. */
const SATELLITE = [[50, 4], [70, 15]]
/** In the US, a city is a suburb when its metro area (CBSA) has a city this many times bigger —
 *  so Minneapolis and St. Paul both stay, but Aurora (Denver) and Kent (Seattle) don't. */
const US_SUBURB_RATIO = 1.5
/** For the one-city-per-country rule, the capital wins unless another city fits this much better. */
const CAPITAL_BONUS = 0.15
/** A candidate this close to a catalogue city is that city. */
const SAME_CITY_KM = 15
/** Within this distance of the sea coast. Every hand-set flag in the seed catalogue agrees at this value. */
const COAST_KM = 20
/** Ski areas smaller than this are left out. Echo Mountain (182 m), Denver's ≤1 hr reference, is about the floor. */
const SKI_MIN_VERT_M = 150
/** Not somewhere to ski in winter, or not open to the public (Beartooth Basin, Osler Bluff Ski Club). */
const NOT_PUBLIC_WINTER = /\b(summer|private)\b/i
const NA_CLUB = /\bski club\b/i
/** Within a band, a bigger resort counts this many metres higher per doubling of its run count,
 *  so a real resort beats a slightly higher two-run hill. */
const SIZE_BONUS_M = 40
/** "Big" ski terrain, for the pre-routing snow score. */
const BIG_SKI_VERT_M = 300
/** Straight-line pre-filter before routing: nothing farther is inside a 3-hour drive. */
const SKI_SEARCH_KM = 250
/** OSRM's demo car profile runs slow on highways: across the seed catalogue's 18 hand-set
 *  routes, hand-set ÷ OSRM minutes has a median of 0.86 (range 0.71–1.04). Unscaled, Phoenix
 *  loses Snowbowl (185 OSRM minutes, ~145 by car). `--check` prints the ratio to re-derive it. */
const DRIVE_SCALE = 0.86
/** The app's drive-time stops, in minutes (prefs.ts: drive 1 | 2 | 3 hours). */
const DRIVE_STOPS = [60, 120, 180]
/** A reference that's already fetched or queued is kept unless a new one sits this much higher.
 *  Every new reference costs ~913 calls; at 150 m the queue needed 225 of them. */
const REUSE_BONUS_M = 300
/** A farther band only adds a reference if it sits this much higher than the best closer one:
 *  a slightly higher hill an hour farther rarely changes the answer, and each costs ~913 calls. */
const BAND_STEP_M = 200
/** A month is muggy when its mean dew point is at least this (°F): the usual "oppressive" line. */
const MUGGY_DEW_F = 65
/** Axis scales for climate distance: the app's "like [city] but" scales (CLIMATE_SCALE in
 *  src/lib/discover.ts: mean high °F, dew point °F, cloud %, shortwave MJ/m²), with
 *  sunshine % standing in for cloud, plus seasonality (std of monthly mean temperature, °F). */
const SCALE = { hi: 16, dew: 13, sun: 20, rad: 4, seas: 8 }
/** A city this far from everything already chosen counts one extra unit apart, so the
 *  same climate on another continent is still worth having — but no more than that. */
const REGION_KM = 2000
const CA_PROVINCES = { '01': 'AB', '02': 'BC', '03': 'MB', '04': 'NB', '05': 'NL', '07': 'NS', '08': 'ON', '09': 'PE', 10: 'QC', 11: 'SK', 12: 'YT', 13: 'NT', 14: 'NU' }
const CONTINENTS = { AF: 'Africa', AS: 'Asia', EU: 'Europe', NA: 'North America', OC: 'Oceania', SA: 'South America', AN: 'Antarctica' }
const UA = 'climate-fit build-catalog (personal, non-commercial)'

const { values: opts } = parseArgs({
  options: { count: { type: 'string' }, force: { type: 'boolean' }, check: { type: 'boolean' }, 'dry-run': { type: 'boolean' } },
})
const { minPop, floors, shares, countryCap, caps, perCountry, maxMuggy, minFit, weights } = config
const floorOf = (p) => floors[p.cc] ?? minPop
/** The countries given their own floor are the focus and aren't capped. */
const capOf = (cc) => caps[cc] ?? (cc in floors ? Infinity : countryCap)

const catalog = await readCatalog()
const count = opts.count ? Number(opts.count) : SET_SIZE - catalog.cities.length
if (!opts.check && !opts['dry-run'] && !opts.force && (await readQueue())?.cities.length) {
  throw new Error(`${QUEUE_FILE} already has cities waiting — pass --force to replace it (edits there are lost)`)
}
await mkdir(CACHE, { recursive: true })

// ---------- helpers ----------

const exists = (p) => access(p).then(() => true, () => false)
const rad = Math.PI / 180
function km(a, b) {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}
const slug = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const toF = (c) => c * 1.8 + 32
const clamp01 = (x) => Math.max(0, Math.min(1, x))
const round2 = (x) => Math.round(x * 100) / 100

async function download(name, url) {
  const file = join(CACHE, name)
  if (await exists(file)) return file
  console.log(`↓ ${name}`)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
  await writeFile(file, Buffer.from(await res.arrayBuffer()))
  return file
}
const tsv = async (file) => (await readFile(file, 'utf8')).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'))

async function jsonCache(name) {
  const file = join(CACHE, name)
  const data = (await exists(file)) ? JSON.parse(await readFile(file, 'utf8')) : {}
  // Saves queue behind each other, so two workers can't interleave writes to one file.
  let last = Promise.resolve()
  return { data, save: () => (last = last.then(() => writeFile(file, JSON.stringify(data)))) }
}

// ---------- GeoNames ----------

const geo = join(CACHE, 'cities15000.txt')
if (!(await exists(geo))) {
  execFileSync('unzip', ['-o', '-q', await download('cities15000.zip', 'https://download.geonames.org/export/dump/cities15000.zip'), '-d', CACHE])
}
const countries = new Map((await tsv(await download('countryInfo.txt', 'https://download.geonames.org/export/dump/countryInfo.txt')))
  .map((r) => [r[0], { name: r[4], continent: CONTINENTS[r[8]] }]))
const admin1 = new Map((await tsv(await download('admin1CodesASCII.txt', 'https://download.geonames.org/export/dump/admin1CodesASCII.txt')))
  .map((r) => [r[0], r[1]]))

const places = (await tsv(geo)).filter((r) => PLACE_CODES.has(r[7]) && !(r[8] in config.skipCountries)).map((r) => ({
  gid: r[0], name: r[1], ascii: r[2], alt: r[3], lat: Number(r[4]), lon: Number(r[5]), fcode: r[7], cc: r[8], admin1: r[10], admin2: r[11], pop: Number(r[14]),
}))

/** How the catalogue labels a place: US states and Canadian provinces by postal code, everything else by country. */
function label(p) {
  const country = countries.get(p.cc)
  if (!country) throw new Error(`${p.name}: unknown country ${p.cc}`)
  const sub = p.cc === 'US' ? p.admin1 : p.cc === 'CA' ? CA_PROVINCES[p.admin1] : null
  const subName = admin1.get(`${p.cc}.${p.admin1}`)
  // GeoNames files all of Russia under Europe; east of the Urals it's Asia.
  const continent = p.cc === 'RU' && p.lon > 60 ? 'Asia' : country.continent
  return {
    code: sub ?? p.cc,
    region: sub && subName ? `${subName} · ${country.name}` : country.name,
    continent,
  }
}

/** Case- and accent-blind ("Iași" and GeoNames' "Iaşi" match). */
const fold = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
/** "Name", "Name, ST" (US state / Canadian province) or "Name, CC" (country) → the largest match,
 *  or null. GeoNames' alternate names ("Cologne" for Köln) are the fallback. */
function resolve(text) {
  const [name, where] = text.split(',').map((s) => s.trim())
  const want = fold(name)
  const here = places.filter((p) => !where || where.toUpperCase() === p.cc || where.toUpperCase() === label(p).code)
  const largest = (hits) => (hits.length ? hits.reduce((a, b) => (b.pop > a.pop ? b : a)) : null)
  return largest(here.filter((p) => fold(p.name) === want || fold(p.ascii) === want))
    ?? largest(here.filter((p) => p.alt.split(',').some((a) => fold(a) === want)))
}

const inCatalog = (p) => catalog.cities.some((c) => km(p, c) < SAME_CITY_KM)
const includes = [], why = new Map()
for (const [text, reason] of config.include) {
  const p = resolve(text)
  if (!p) throw new Error(`catalog.config include "${text}": no GeoNames town or city by that name`)
  if (inCatalog(p)) console.log(`  include "${text}": already in the catalogue`)
  else if (!includes.includes(p)) { includes.push(p); why.set(p.gid, reason) }
}
const excluded = new Set()
for (const [text] of config.exclude) {
  const p = resolve(text)
  if (p) excluded.add(p.gid)
  else console.warn(`  exclude "${text}": no GeoNames match (nothing to leave out)`)
}

// Suburbs: in the US, by metro area (a bigger city in the same CBSA); elsewhere, by distance
// to a much bigger place (SATELLITE).
const us = await loadUsMetrics(download, km)
const metroTop = new Map()
for (const p of places) {
  if (p.cc !== 'US') continue
  const m = us.metroOf(p)
  if (m && p.pop > (metroTop.get(m) ?? 0)) metroTop.set(m, p.pop)
}
const bigPlaces = places.filter((p) => p.pop >= 150_000)
function suburb(p) {
  if (p.cc === 'US') { const m = us.metroOf(p); return !!m && metroTop.get(m) >= US_SUBURB_RATIO * p.pop }
  return bigPlaces.some((q) => q !== p && SATELLITE.some(([d, ratio]) => q.pop >= ratio * p.pop && km(p, q) <= d))
}

// Candidates: above the floor, one per metro (the biggest place in it), not a suburb, not
// already in the catalogue. A place left out (by name or as a suburb) still claims its
// 25 km, so a smaller neighbour doesn't stand in for it.
const candidates = []
const metros = []
let suburbs = 0
for (const p of places.filter((q) => q.pop >= floorOf(q)).sort((a, b) => b.pop - a.pop)) {
  if (inCatalog(p) || includes.includes(p) || metros.some((q) => km(p, q) < METRO_KM)) continue
  metros.push(p)
  if (excluded.has(p.gid)) continue
  if (suburb(p)) { suburbs++; continue }
  candidates.push(p)
}
// Countries that must be represented but may have nothing above the floor (Luxembourg,
// Andorra, Malta…): their five biggest places, and the capital, stand by.
const required = Object.entries(perCountry).flatMap(([continent, n]) =>
  [...countries].filter(([cc, c]) => c.continent === continent && !(cc in config.skipCountries)).map(([cc]) => ({ cc, n })))
const standby = required.flatMap(({ cc }) => {
  const own = places.filter((p) => p.cc === cc && !excluded.has(p.gid) && !inCatalog(p) && !suburb(p)).sort((a, b) => b.pop - a.pop)
  return [...new Set([...own.slice(0, 5), ...own.filter((p) => p.fcode === 'PPLC')])]
}).filter((p) => !candidates.includes(p) && !includes.includes(p))
const floorNote = Object.entries(floors).map(([cc, n]) => ` (${cc} ${n.toLocaleString('en-US')}+)`).join('')
console.log(`candidates: ${candidates.length} metros of ${minPop.toLocaleString('en-US')}+ people${floorNote} · ${includes.length} included by name · ${excluded.size} left out by name · ${suburbs} suburbs left out`)

// ---------- CRU CL 2.0 climatology ----------
// New et al. (2002), Climate Research 21:1–25: 1961–1990 monthly normals on a 10′ land grid,
// one plain-text file per variable (lat, lon, 12 monthly values). Bulk files rather than a
// per-point API, so choosing is fast, repeatable and never rate-limited. The normals predate
// recent warming by about 1 °C, which doesn't matter for choosing and ranking a set; the app
// scores on the ERA5 archive, not on these.

const CRU_VARS = ['tmp', 'dtr', 'pre', 'reh', 'sunp']
const cellIndex = (x) => Math.floor(x * 6)
const cellKey = (i, j) => `${i}:${((j + 1080) % 2160 + 2160) % 2160 - 1080}`
/** The cells within three of a place's own: a coastal city's own cell can be sea, which CRU leaves out. */
function around(p) {
  const i0 = cellIndex(p.lat), j0 = cellIndex(p.lon), out = []
  for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) out.push(cellKey(i0 + di, j0 + dj))
  return out
}

const everyone = [...catalog.cities, ...includes, ...candidates, ...standby]
const want = new Set(everyone.flatMap(around))
const cru = new Map()
for (const v of CRU_VARS) {
  const file = await download(`cru_${v}.dat.gz`, `https://crudata.uea.ac.uk/cru/data/hrg/tmc/grid_10min_${v}.dat.gz`)
  for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) {
    const f = line.trim().split(/\s+/)
    const lat = Number(f[0]), lon = Number(f[1]), key = cellKey(cellIndex(lat), cellIndex(lon))
    if (!want.has(key)) continue
    if (!cru.has(key)) cru.set(key, { lat, lon })
    // Precipitation carries 12 coefficients of variation after the means; only the means are used.
    cru.get(key)[v] = f.slice(2, 14).map(Number)
  }
}

/** Extraterrestrial radiation, MJ/m²/day, mid-month (FAO-56 eq. 21). */
function ra(latDeg, month) {
  const J = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349][month]
  const phi = latDeg * rad, dr = 1 + 0.033 * Math.cos((2 * Math.PI * J) / 365), delta = 0.409 * Math.sin((2 * Math.PI * J) / 365 - 1.39)
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))))
  return ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws))
}
/** Dew point, °C, from mean temperature and relative humidity (Magnus). */
function dewPoint(t, rh) {
  const g = Math.log(Math.max(1, rh) / 100) + (17.625 * t) / (243.04 + t)
  return (243.04 * g) / (17.625 - g)
}

/** Climate-space position, Köppen class and the ranking's climate inputs, from the nearest land cell. */
function climateOf(p) {
  let c = null, best = Infinity
  for (const key of around(p)) {
    const g = cru.get(key)
    if (!g || !CRU_VARS.every((v) => g[v])) continue
    const d = km(p, g)
    if (d < best) { best = d; c = g }
  }
  if (!c) return null
  const t = c.tmp, highs = t.map((v, m) => v + c.dtr[m] / 2), dews = t.map((v, m) => toF(dewPoint(v, c.reh[m])))
  return {
    hi: toF(mean(highs)),
    dew: mean(dews),
    sun: mean(c.sunp),
    // Shortwave from sunshine fraction (Ångström–Prescott, FAO-56 eq. 35 defaults).
    rad: mean(c.sunp.map((s, m) => (0.25 + (0.5 * s) / 100) * ra(c.lat, m))),
    seas: Math.sqrt(mean(t.map((v) => (v - mean(t)) ** 2))) * 1.8,
    koppen: koppen(t, c.pre),
    hotHigh: toF(Math.max(...highs)),
    coldMean: toF(Math.min(...t)),
    muggy: dews.filter((d) => d >= MUGGY_DEW_F).length,
  }
}
function distance(a, b) {
  let d2 = 0
  for (const k of Object.keys(SCALE)) d2 += ((a.clim[k] - b.clim[k]) / SCALE[k]) ** 2
  return Math.sqrt(d2 + Math.min(km(a, b) / REGION_KM, 1) ** 2)
}

// ---------- ski terrain ----------

// Where a drive to each ski area ends: the bottom stations of its operating lifts, the
// quickest one winning. Routing to the area's centre snaps to whatever track is nearest
// mid-mountain (+25 min on Denver → Loveland), and routing to the lowest lift alone can
// land on a back side (Stevens Pass's Mill Valley, +70 min). An area with no operating
// lift is left out, which also catches hills OpenStreetMap still tags as operating.
const liftFile = await download('lifts.geojson', 'https://tiles.openskimap.org/geojson/lifts.geojson')
/** Bottom stations per area kept for routing, lowest first, at least 500 m apart. */
const BASES_PER_AREA = 3
const bottoms = new Map()
for (const f of JSON.parse(await readFile(liftFile, 'utf8')).features) {
  if (f.properties.status !== 'operating' || f.geometry.type !== 'LineString') continue
  const line = f.geometry.coordinates
  if (line[0].length < 3 || line.at(-1).length < 3) continue
  const [lon, lat, elev] = line[0][2] <= line.at(-1)[2] ? line[0] : line.at(-1)
  for (const area of f.properties.skiAreas ?? []) {
    const id = area.properties?.id
    if (id) bottoms.set(id, [...(bottoms.get(id) ?? []), { lon, lat, elev }])
  }
}
const basesOf = (id) => (bottoms.get(id) ?? []).sort((a, b) => a.elev - b.elev)
  .reduce((kept, b) => (kept.length < BASES_PER_AREA && kept.every((k) => km(k, b) > 0.5) ? [...kept, b] : kept), [])

const skiFile = await download('ski_areas.geojson', 'https://tiles.openskimap.org/geojson/ski_areas.geojson')
const skiAreas = JSON.parse(await readFile(skiFile, 'utf8')).features.flatMap((f) => {
  const p = f.properties, runs = p.statistics?.runs, bases = basesOf(p.id)
  if (p.status !== 'operating' || !p.activities?.includes('downhill') || !p.name || !bases.length) return []
  const cc = p.places?.[0]?.iso3166_1Alpha2
  if (NOT_PUBLIC_WINTER.test(p.name) || ((cc === 'US' || cc === 'CA') && NA_CLUB.test(p.name))) return []
  if (runs?.minElevation == null || runs?.maxElevation == null || runs.maxElevation - runs.minElevation < SKI_MIN_VERT_M) return []
  const [lon, lat] = p.viewportHint?.center ?? f.geometry.coordinates.flat(Infinity)
  // The reference elevation is mid-mountain: the hand-set catalogue entries all sit there.
  const count = Object.values(runs.byActivity?.downhill?.byDifficulty ?? {}).reduce((n, d) => n + (d.count ?? 0), 0)
  return [{ key: p.id, name: p.name, lat, lon, bases, runs: count, midM: (runs.minElevation + runs.maxElevation) / 2, vertM: runs.maxElevation - runs.minElevation }]
})
const bigSki = skiAreas.filter((s) => s.vertM >= BIG_SKI_VERT_M)
const bigSkiKm = (p) => bigSki.reduce((best, s) => Math.min(best, km(p, s)), Infinity)

// Terrain ids already known: the catalogue's, matched to OpenSkiMap by position.
const terrainIds = new Map()
for (const [tid, t] of Object.entries(catalog.terrain)) {
  const near = skiAreas.filter((s) => km(s, t) < 5).sort((a, b) => km(a, t) - km(b, t))[0]
  if (near) terrainIds.set(near.key, tid)
}
const newTerrain = {}
function terrainId(s) {
  if (terrainIds.has(s.key)) return terrainIds.get(s.key)
  const base = slug(s.name.replace(/\b(ski ?(area|resort|center|centre)|resort|skigebiet|skiarena)\b/gi, '')).split('-').slice(0, 3).join('-') || slug(s.name) || 'ski'
  let id = base
  for (let n = 2; catalog.terrain[id] || newTerrain[id]; n++) id = `${base}-${n}`
  newTerrain[id] = { name: s.name, lat: Number(s.lat.toFixed(4)), lon: Number(s.lon.toFixed(4)), elevFt: Math.round((s.midM * 3.28084) / 100) * 100 }
  terrainIds.set(s.key, id)
  return id
}

const osrm = await jsonCache('osrm.json')
/** Raw OSRM drive minutes from `p` to each ski area (null where there's no road), via the
 *  demo server — one request per city, at most one a second, per its usage policy. */
async function driveMinutes(p, skis) {
  const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`
  const cached = osrm.data[key] ?? {}
  if (skis.every((s) => s.key in cached)) return skis.map((s) => cached[s.key])
  const ends = skis.flatMap((s) => s.bases.map((b) => ({ key: s.key, b })))
  const coords = [p, ...ends.map((e) => e.b)].map((q) => `${q.lon.toFixed(5)},${q.lat.toFixed(5)}`).join(';')
  for (let attempt = 1; ; attempt++) {
    await sleep(1100)
    const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration`, { headers: { 'User-Agent': UA } })
    const json = res.ok ? await res.json() : null
    if (json?.code === 'Ok') {
      for (const s of skis) cached[s.key] = null
      ends.forEach((e, i) => {
        const d = json.durations[0][i + 1]
        if (d != null && (cached[e.key] === null || d / 60 < cached[e.key])) cached[e.key] = d / 60
      })
      osrm.data[key] = cached
      return skis.map((s) => cached[s.key])
    }
    if (attempt === 4) throw new Error(`OSRM ${p.name}: ${res.status} ${json?.code ?? res.statusText}`)
    await sleep(3000 * attempt)
  }
}

/** Up to one reference per drive-time band: the highest ski area in the band (snow cover
 *  tracks elevation), and only if it's BAND_STEP_M higher than anything picked closer in. */
async function terrainFor(p) {
  // What's worth routing to (OSRM's demo takes ~100 points a request): the highest areas in
  // reach, the nearest few for the one-hour band, and any reference already fetched or queued.
  const inReach = skiAreas.filter((s) => km(p, s) <= SKI_SEARCH_KM)
  const skis = [...new Set([
    ...[...inReach].sort((a, b) => b.midM - a.midM).slice(0, 15),
    ...[...inReach].sort((a, b) => km(p, a) - km(p, b)).slice(0, 8),
    ...inReach.filter((s) => terrainIds.has(s.key)).slice(0, 6),
  ])]
  if (!skis.length) return []
  const minutes = await driveMinutes(p, skis)
  const reached = skis.map((s, i) => ({ s, min: minutes[i] == null ? null : minutes[i] * DRIVE_SCALE }))
    .filter((x) => x.min != null && x.min <= DRIVE_STOPS.at(-1))
  const known = (s) => terrainIds.has(s.key)
  const score = (x) => x.s.midM + SIZE_BONUS_M * Math.log2(1 + x.s.runs) + (known(x.s) ? REUSE_BONUS_M : 0)
  const picks = []
  let from = 0, highest = -Infinity
  for (const stop of DRIVE_STOPS) {
    const band = reached.filter((x) => x.min > from && x.min <= stop)
    from = stop
    if (!band.length) continue
    const best = band.reduce((a, b) => (score(b) > score(a) ? b : a))
    if (best.s.midM < highest + BAND_STEP_M) continue
    highest = best.s.midM
    picks.push(best)
  }
  return picks.map((x) => [x.s, Math.max(5, Math.round(x.min / 5) * 5)])
}

// ---------- coastline ----------

const coastFile = await download('ne_10m_coastline.geojson', 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson')
const coastLines = JSON.parse(await readFile(coastFile, 'utf8')).features.flatMap((f) =>
  f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates)
  .map((pts) => {
    const lons = pts.map((q) => q[0]), lats = pts.map((q) => q[1])
    return { pts, box: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] }
  })
/** Within COAST_KM of the sea, measured to the nearest coastline segment. */
function coastal(p) {
  const dLat = COAST_KM / 111, dLon = COAST_KM / (111 * Math.max(0.05, Math.cos(p.lat * rad)))
  const kx = 111 * Math.cos(p.lat * rad), ky = 111
  for (const { pts, box } of coastLines) {
    if (p.lon < box[0] - dLon || p.lon > box[2] + dLon || p.lat < box[1] - dLat || p.lat > box[3] + dLat) continue
    for (let i = 1; i < pts.length; i++) {
      // Local flat projection around p, in km; fine at this range.
      const ax = (pts[i - 1][0] - p.lon) * kx, ay = (pts[i - 1][1] - p.lat) * ky
      const bx = (pts[i][0] - p.lon) * kx, by = (pts[i][1] - p.lat) * ky
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0
      if (Math.hypot(ax + t * dx, ay + t * dy) <= COAST_KM) return true
    }
  }
  return false
}

// ---------- --check: the rules against the hand-set seed catalogue ----------

if (opts.check) {
  const name = (tid) => catalog.terrain[tid]?.name ?? newTerrain[tid]?.name ?? tid
  const skiOf = new Map([...terrainIds].map(([key, tid]) => [tid, skiAreas.find((s) => s.key === key)]))
  const ratios = []
  for (const c of catalog.cities) {
    const clim = climateOf(c), terrain = await terrainFor(c)
    const hand = c.terrain.filter(([tid]) => skiOf.has(tid))
    const routed = await driveMinutes(c, hand.map(([tid]) => skiOf.get(tid)))
    hand.forEach(([, m], i) => routed[i] && ratios.push(m / routed[i]))
    console.log(`${c.name}: ${clim?.koppen ?? '?'} · coastal ${coastal(c)} (set: ${c.coastal})`)
    console.log(`  rules     ${terrain.map(([s, m]) => `${name(terrainId(s))} ${m}`).join(', ') || '—'}`)
    console.log(`  hand-set  ${c.terrain.map(([tid, m]) => `${name(tid)} ${m}${skiOf.has(tid) ? ` (OSRM ${Math.round(routed[hand.findIndex(([t]) => t === tid)])})` : ''}`).join(', ') || '—'}`)
  }
  ratios.sort((a, b) => a - b)
  console.log(`hand-set ÷ OSRM minutes: median ${ratios[ratios.length >> 1].toFixed(2)} · range ${ratios[0].toFixed(2)}–${ratios.at(-1).toFixed(2)} over ${ratios.length} routes`)
  await osrm.save()
  process.exit(0)
}

// ---------- fit: how well each place suits (scripts/fit-score.mjs) ----------

const hubs = Object.entries(config.techHubs).flatMap(([text, tier]) => {
  const p = resolve(text)
  if (!p) console.warn(`  techHubs "${text}": no GeoNames match`)
  return p ? [{ p, jobs: config.tierJobs[tier] }] : []
})
const walkOverride = new Map(Object.entries(config.walk.override).flatMap(([text, v]) => {
  const p = resolve(text)
  if (!p) console.warn(`  walk.override "${text}": no GeoNames match`)
  return p ? [[p.gid, v]] : []
}))
const walkBase = (p) => config.walk.base[p.cc] ?? (countries.get(p.cc)?.continent === 'Europe' ? config.walk.base.europe : config.walk.base.default)

const usJobs = new Map()
/** The parts of the fit (each 0–1), their weighted total, and where each came from. */
function fitOf(p, snow) {
  const hubJobs = Math.max(0, ...hubs.map((h) => h.jobs * reach(km(p, h.p))))
  if (p.cc === 'US' && !usJobs.has(p.gid)) usJobs.set(p.gid, us.techJobs(p))
  const measured = usJobs.get(p.gid) ?? 0
  const jobs = Math.max(hubJobs, measured)
  const commute = p.cc === 'US' ? us.activeCommute(p, p.admin1) : null
  const walk = commute ? walkScore(commute.share)
    : walkOverride.get(p.gid) ?? clamp01(walkBase(p) + 0.15 * Math.log10(Math.max(p.pop, 1000) / 1e6))
  const parts = { climate: climateScore(p.clim, snow), tech: techScore(jobs), walk }
  return {
    ...parts, score: total(parts, weights), jobs: Math.round(jobs),
    jobsFrom: measured > 0 && measured >= hubJobs ? 'BLS' : hubJobs > 0 ? 'estimate' : 'none',
    commute: commute ? round2(commute.share) : null, walkFrom: commute ? 'ACS' : 'estimate',
  }
}

// ---------- choose ----------

// Three steps. Named cities first (config.include). Then every country that must be
// represented (config.perCountry) gets its best-fitting city. Then the rest, inside
// continent quotas (config.shares; unnamed continents split what's left by the square root
// of their candidate counts) and country caps: each pick is the best fit, with a place whose
// climate is already in the set counting half — so the set stays varied without passing over
// a major city just because its neighbour is similar. Fit here uses straight-line distance
// to big ski terrain; the final ranking, after routing, uses drive times.
const placed = (p) => { const clim = climateOf(p); return clim ? [{ ...p, continent: p.continent ?? label(p).continent, clim }] : [] }
const withFit = (p) => ({ ...p, fit: fitOf(p, snowFromKm(bigSkiKm(p))) })
const set = catalog.cities.flatMap(placed)
const located = candidates.flatMap(placed)
const pool = located.filter((p) => p.clim.muggy <= maxMuggy).map(withFit)
const reserve = standby.flatMap(placed).map(withFit)
const skipped = candidates.length - located.length, muggy = located.length - pool.length
const nearestIn = (p, among) => among.reduce((best, q) => { const d = distance(p, q); return d < best.d ? { q, d } : best }, { q: null, d: Infinity })
const countryOf = (c) => c.cc ?? [...countries].find(([, v]) => c.region.endsWith(v.name))?.[0]

const picks = []
const pick = (p, reason) => { picks.push({ p, nearest: nearestIn(p, set), why: reason }); set.push(p) }
for (const p of includes.flatMap(placed).map(withFit)) pick(p, why.get(p.gid))
const taken = new Set(picks.map(({ p }) => p.gid))
for (const { cc, n } of required) {
  const rank = (p) => p.fit.score + (p.fcode === 'PPLC' ? CAPITAL_BONUS : 0)
  const options = [...pool, ...reserve].filter((p) => p.cc === cc && !taken.has(p.gid)).sort((a, b) => rank(b) - rank(a))
  for (let have = set.filter((c) => countryOf(c) === cc).length; have < n && options.length; have++) {
    const p = options.shift()
    taken.add(p.gid)
    pick(p, `best fit in ${countries.get(cc).name}`)
  }
}

const byContinent = (xs) => xs.reduce((m, p) => ({ ...m, [p.continent]: (m[p.continent] ?? 0) + 1 }), {})
const perCountryCount = set.reduce((m, c) => { const cc = countryOf(c); return { ...m, [cc]: (m[cc] ?? 0) + 1 } }, {})
const available = byContinent(pool), have = byContinent(set)
const setTotal = set.length - picks.length + count
const named = Object.values(shares).reduce((a, b) => a + b, 0)
const rest = Object.fromEntries(Object.entries(available).filter(([k]) => !(k in shares)).map(([k, n]) => [k, Math.sqrt(n)]))
const restSum = Object.values(rest).reduce((a, b) => a + b, 0) || 1
const pct = (k) => (k in shares ? shares[k] : ((100 - named) * (rest[k] ?? 0)) / restSum)
const quota = Object.fromEntries(Object.keys({ ...available, ...have }).map((k) => [k, Math.round((setTotal * pct(k)) / 100)]))
const minD = pool.map((p) => nearestIn(p, set).d)
// A continent without enough good fits (minFit) stays short rather than handing its places to
// another: the queue can come out under the count, which also makes it cheaper.
while (picks.length < count) {
  let bi = -1, bg = -Infinity
  pool.forEach((p, i) => {
    if (taken.has(p.gid) || p.fit.score < (minFit[p.continent] ?? minFit.default) || (perCountryCount[p.cc] ?? 0) >= capOf(p.cc)) return
    if ((have[p.continent] ?? 0) >= quota[p.continent]) return
    const gain = p.fit.score * (0.5 + 0.5 * Math.min(minD[i], 1))
    if (gain > bg) { bg = gain; bi = i }
  })
  if (bi < 0) break
  const p = pool[bi]
  taken.add(p.gid)
  have[p.continent] = (have[p.continent] ?? 0) + 1
  perCountryCount[p.cc] = (perCountryCount[p.cc] ?? 0) + 1
  pick(p)
  pool.forEach((q, i) => { if (!taken.has(q.gid)) minD[i] = Math.min(minD[i], distance(q, p)) })
}
// The best candidates each continent passed over (quota, cap or minFit), for the review.
const nextInLine = Object.fromEntries(Object.keys(quota).map((k) => [k, pool
  .filter((p) => p.continent === k && !taken.has(p.gid)).sort((a, b) => b.fit.score - a.fit.score).slice(0, 10)
  .map((p) => ({ name: p.name, code: label(p).code, score: round2(p.fit.score), why: p.fit.score < (minFit[k] ?? minFit.default) ? 'below minFit' : (perCountryCount[p.cc] ?? 0) >= capOf(p.cc) ? 'country cap' : 'quota full' }))]))
// Route the best fits first, so the terrain references they mint are there for later cities to reuse.
picks.sort((a, b) => b.p.fit.score - a.p.fit.score)

const tally = (xs) => Object.entries(xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')
if (opts['dry-run']) {
  console.log(`quotas      ${Object.entries(quota).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ')} (whole set, catalogue included)`)
  console.log(`continents  ${tally(picks.map(({ p }) => p.continent))}`)
  console.log(`Köppen      ${tally(picks.map(({ p }) => p.clim.koppen[0]))}   (candidates: ${tally(pool.map((p) => p.clim.koppen[0]))})`)
  console.log(`countries   ${tally(picks.map(({ p }) => p.cc)).split(' · ').slice(0, 14).join(' · ')}`)
  console.log(`left out    ${muggy} muggy · ${skipped} without climate`)
  for (const k of Object.keys(quota)) {
    const next = pool.filter((p) => p.continent === k && !taken.has(p.gid)).sort((a, b) => b.fit.score - a.fit.score).slice(0, 12)
    console.log(`next in ${k}: ${next.map((p) => `${p.name}${p.cc === 'US' || p.cc === 'CA' ? `/${label(p).code}` : ''} ${p.fit.score.toFixed(2)}`).join(', ')}`)
  }
  picks.forEach(({ p, why: w }, i) => console.log(`${String(i + 1).padStart(3)}. ${p.fit.score.toFixed(2)} ${p.name}, ${label(p).code} · c ${p.fit.climate.toFixed(2)} t ${p.fit.tech.toFixed(2)} (${p.fit.jobsFrom}) w ${p.fit.walk.toFixed(2)} (${p.fit.walkFrom})${w ? ` · ${w}` : ''}`))
  process.exit(0)
}

// ---------- metadata, final ranking ----------

console.log(`routing to ski terrain for ${picks.length} cities (OSRM, ~1 request a second)`)
const ids = new Set(catalog.cities.map((c) => c.id))
const rows = []
for (const [i, { p, nearest, why: reason }] of picks.entries()) {
  const l = label(p)
  let id = slug(p.ascii || p.name)
  if (ids.has(id)) id = `${id}-${l.code.toLowerCase()}`
  if (ids.has(id)) id = `${id}-${p.gid}`
  ids.add(id)
  const routed = await terrainFor(p)
  const terrain = routed.map(([s, min]) => [terrainId(s), min])
  const fit = fitOf(p, snowFromDrive(Math.min(...terrain.map(([, m]) => m))))
  const c = p.clim
  const city = {
    id, name: p.name, code: l.code, region: l.region,
    lat: Number(p.lat.toFixed(4)), lon: Number(p.lon.toFixed(4)), pop: p.pop, coastal: coastal(p), continent: l.continent,
    terrain,
    note: `fit ${fit.score.toFixed(2)} (climate ${fit.climate.toFixed(2)} · tech ${fit.tech.toFixed(2)} · walk ${fit.walk.toFixed(2)}) · ${c.koppen} ${koppenName(c.koppen)} · ${reason ?? `nearest in the set: ${nearest.q.name}`}`,
  }
  rows.push({
    city, fit, reason: reason ?? null, nearest: nearest.q?.name ?? null, cc: p.cc, country: countries.get(p.cc).name,
    climate: { koppen: c.koppen, koppenName: koppenName(c.koppen), hi: Math.round(c.hi), hotHigh: Math.round(c.hotHigh), coldMean: Math.round(c.coldMean), dew: Math.round(c.dew), sun: Math.round(c.sun), muggy: c.muggy },
    skiNames: routed.map(([s, min]) => `${s.name} ${min}`),
  })
  if ((i + 1) % 25 === 0) { console.log(`  ${i + 1} / ${picks.length}`); await osrm.save() }
}
await osrm.save()
// Ranked by fit, except config.fetchLast countries (Do Not Travel advisories), which go to the back.
const last = (r) => (r.cc in config.fetchLast ? 1 : 0)
rows.sort((a, b) => last(a) - last(b) || b.fit.score - a.fit.score)
for (const r of rows) if (last(r)) r.city.note += ` · fetched last: ${config.fetchLast[r.cc]}`
const cities = rows.map((r) => r.city)
rows.forEach((r, i) => { r.rank = i + 1; r.fetchLast = config.fetchLast[r.cc] ?? null })

// Only terrain the queue actually uses (a --check or reuse may have minted others).
const used = new Set(cities.flatMap((c) => c.terrain.map(([tid]) => tid)))
const terrain = Object.fromEntries(Object.entries(newTerrain).filter(([tid]) => used.has(tid)))
await writeQueue({
  generated: { on: new Date().toISOString().slice(0, 10), config: 'scripts/catalog.config.mjs', sources: 'GeoNames · CRU CL 2.0 · OpenSkiMap · OSRM · Natural Earth · BLS QCEW · ACS' },
  terrain, cities,
})

// ---------- cost, summary, review data ----------

const REQ = archiveRequests(catalog.archive)
const { endYear } = catalog.archive
const ytdSpan = { start_date: `${endYear + 1}-01-01`, end_date: new Date().toISOString().slice(0, 10) }
const seenTerrain = new Set(Object.keys(catalog.terrain))
rows.forEach((r) => {
  const c = r.city
  let calls = weight(REQ.daily(c, DAILY_VARS.map((v) => v[0]))) + weight(REQ.grid(c))
  calls += weight({ latitude: c.lat, daily: DAILY_VARS.map((v) => v[0]).join(','), ...ytdSpan })
  if (c.terrain.length) calls += weight({ latitude: c.terrain.map(() => 0).join(','), daily: 'snow_depth_max', ...ytdSpan })
  if (!c.region.endsWith('United States')) calls += weight(camsRequest(c, endYear))
  for (const [tid] of c.terrain) if (!seenTerrain.has(tid)) { seenTerrain.add(tid); calls += weight(REQ.terrain(terrain[tid])) }
  r.calls = Math.round(calls)
})
let night = 0, left = 0
for (const r of rows) { if (r.calls > left) { night++; left = DEFAULT_BUDGET } left -= r.calls; r.night = night }
await writeFile(REVIEW_FILE, JSON.stringify({
  generated: new Date().toISOString(), weights, minFit, budget: DEFAULT_BUDGET, nights: night,
  catalog: catalog.cities.map((c) => ({ id: c.id, name: c.name, code: c.code, lat: c.lat, lon: c.lon, continent: c.continent })),
  leftOut: { suburbs, muggy, maxMuggy, byName: config.exclude, skipCountries: config.skipCountries },
  quota, nextInLine, rows,
}))

console.log(`\nqueue: ${cities.length} cities → ${QUEUE_FILE} (ranked by fit)`)
console.log(`  continents   ${tally(cities.map((c) => c.continent))}`)
console.log(`  Köppen       ${tally(rows.map((r) => r.climate.koppen[0]))}`)
console.log(`  coastal      ${cities.filter((c) => c.coastal).length} · with ski terrain ${cities.filter((c) => c.terrain.length).length} · new terrain refs ${Object.keys(terrain).length}`)
console.log(`  cost         ~${rows.reduce((a, r) => a + r.calls, 0).toLocaleString('en-US')} Open-Meteo calls ≈ ${night} nightly runs at ${DEFAULT_BUDGET.toLocaleString('en-US')}`)
console.log(`  top 15       ${rows.slice(0, 15).map((r) => r.city.name).join(', ')}`)
if (skipped) console.log(`  (${skipped} candidates had no CRU land cell within ~50 km and were left out)`)
if (muggy) console.log(`  (${muggy} candidates have more than ${maxMuggy} muggy months and were left out)`)
