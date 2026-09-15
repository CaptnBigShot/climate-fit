// The Open-Meteo Historical Weather API, answered from Open-Meteo's public S3 bucket
// (AWS Open Data, CC-BY 4.0) instead of the API — no API calls, no daily limit.
//
// archive(params) takes the same parameters fetch-data sends the API and returns the same
// JSON, computed the way the API server computes it (github.com/open-meteo/open-meteo,
// AGPL-3.0; each step below names the server code it follows):
//   • best match mixes three reanalyses, highest priority first: ECMWF IFS 9 km (2017→),
//     ERA5-Land 0.1° (temperature and dew point only), ERA5 0.25°; a lower one fills only
//     the hours a higher one lacks, blended over 3 hours at the seam
//     (Era5Factory.makeArchiveBestMatch, GenericReaderMixerRaw)
//   • each model picks, among the 3×3 cells around the point, the one whose elevation best
//     matches the target (cell_selection=land: Gridable/GaussianGrid.findPointTerrainOptimised);
//     the target is the Copernicus 90 m DEM unless `elevation` is given (Dem90.read)
//   • temperature and dew point are corrected 0.65 °C per 100 m from the cell's elevation
//     to the target (GenericReader.scale)
//   • daily values are 24-hour aggregations of hourly data (DailyReaderConverter), in
//     32-bit floats, then unit-converted and rounded as the API's JSON writer does
//
// One deliberate difference: time zones. The API applies the zone's offset *at the moment
// of the request* to the whole record, so a file fetched in July runs on daylight time all
// year and one fetched in January doesn't. Here daily values always use the zone's winter
// (standard) offset, the climatological convention, so a file doesn't depend on when it
// was fetched; hourly values use the local clock, daylight saving included, since that's
// what the typical-day panel labels them with. Both follow the API in truncating
// half-hour offsets to whole hours for the data read.
import { OmDataType, OmFileReader } from '@openmeteo/file-reader'
import tzlookup from '@photostructure/tz-lookup'
import { sunshineDuration } from './solar.mjs'

const BUCKET = 'https://openmeteo.s3.amazonaws.com'
const HOUR = 3600
const CHUNK_HOURS = 504 // chunk_N.om holds hours [N·504, (N+1)·504) since the epoch
const f = Math.fround
/** Foundation.round on Float: half away from zero. */
const roundAway = (x) => Math.sign(x) * Math.round(Math.abs(x))

/** Traffic so far, for the run log. */
export const s3Stats = { requests: 0, bytes: 0 }

// ---------- HTTP ----------

const MAX_INFLIGHT = 48
let inflight = 0
const waiting = []
async function http(url, init) {
  if (inflight >= MAX_INFLIGHT) await new Promise((r) => waiting.push(r))
  inflight++
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, init)
        if (res.status < 500 || attempt >= 4) return res
      } catch (e) {
        if (attempt >= 4) throw e
      }
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  } finally {
    inflight--
    waiting.shift()?.()
  }
}

/** OmFileReader backend reading byte ranges of one bucket object. */
class RangeBackend {
  constructor(url, size) { this.url = url; this.size = size }
  async count() { return this.size }
  async getBytes(offset, size) {
    const res = await http(this.url, { headers: { Range: `bytes=${offset}-${offset + size - 1}` } })
    if (res.status !== 206 && res.status !== 200) throw new Error(`S3 ${this.url} ${res.status}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    s3Stats.requests++
    s3Stats.bytes += buf.length
    return buf
  }
  async close() {}
}

const readers = new Map()
function open(path) {
  if (!readers.has(path)) {
    readers.set(path, (async () => {
      const res = await http(`${BUCKET}/${path}`, { method: 'HEAD' })
      if (!res.ok) throw new Error(`S3 ${path}: ${res.status}`)
      return OmFileReader.create(new RangeBackend(`${BUCKET}/${path}`, Number(res.headers.get('content-length'))))
    })())
  }
  return readers.get(path)
}

const read = async (path, ranges) => (await open(path)).read({ type: OmDataType.FloatArray, ranges: ranges.map(([start, end]) => ({ start, end })) })

const listings = new Map()
/** File names under data/<dir>/<variable>/ — one listing per variable, cached for the run. */
function listFiles(dir, variable) {
  const key = `${dir}/${variable}`
  if (!listings.has(key)) {
    listings.set(key, (async () => {
      const names = new Set()
      let token = ''
      do {
        const q = new URLSearchParams({ 'list-type': '2', prefix: `data/${key}/`, 'max-keys': '1000', ...(token && { 'continuation-token': token }) })
        const res = await http(`${BUCKET}/?${q}`)
        if (!res.ok) throw new Error(`S3 listing ${key}: ${res.status}`)
        const xml = await res.text()
        for (const m of xml.matchAll(/<Key>[^<]*\/([^/<]+)<\/Key>/g)) names.add(m[1])
        token = xml.match(/<NextContinuationToken>([^<]*)/)?.[1] ?? ''
      } while (token)
      return names
    })())
  }
  return listings.get(key)
}

// ---------- grids ----------

/** Regular lat/lon grid (RegularGrid). Cells are {y, x}; data files are [ny, nx, time]. */
function regularGrid(nx, ny, latMin, lonMin, d) {
  return {
    nx, ny,
    nearest(lat, lon) {
      let x = roundAway(f(f(lon - lonMin) / d)), y = roundAway(f(f(lat - latMin) / d))
      if (x === -1) x = 0
      if (x === nx || x === nx + 1) x = nx - 1
      if (y === -1) y = 0
      if (y === ny) y = ny - 1
      return { y, x }
    },
    coords: ({ y, x }) => ({ lat: f(latMin + f(y * f(d))), lon: f(lonMin + f(x * f(d))) }),
    elevations: async (dir, { y, x }) => {
      const y0 = Math.max(0, y - 1), y1 = Math.min(ny, y + 2), x0 = Math.max(0, x - 1), x1 = Math.min(nx, x + 2)
      const v = await read(`data/${dir}/static/HSURF.om`, [[y0, y1], [x0, x1]])
      return Array.from(v, (e, i) => ({ cell: { y: y0 + Math.floor(i / (x1 - x0)), x: x0 + (i % (x1 - x0)) }, e }))
    },
  }
}

/** ECMWF's O1280 reduced Gaussian grid (GaussianGrid). Cells are {y: 0, x: gridpoint};
 *  data files are [1, 6599680, time]. */
const O = 1280
const O_COUNT = 4 * O * (O + 9)
const oNx = (y) => (y < O ? 20 + y * 4 : (2 * O - y - 1) * 4 + 20)
const oIntegral = (y) => (y < O ? 2 * y * y + 18 * y : O_COUNT - (2 * (2 * O - y) ** 2 + 18 * (2 * O - y)))
const O_DY = f(180 / f(2 * O + 0.5))
const oLat = (y) => f(f(f(O - y - 1) * O_DY) + f(O_DY / 2))
const gaussianGrid = {
  nearest(lat, lon) {
    const y = Math.max(0, Math.min(2 * O - 2, Math.trunc(f(O - 1 - f(f(lat - f(O_DY / 2)) / O_DY))))), yU = y + 1
    const pick = (yy) => { const nx = oNx(yy), dx = f(360 / nx), x = roundAway(f(lon / dx)); return { gp: oIntegral(yy) + ((x + nx) % nx), d: (oLat(yy) - lat) ** 2 + (x * dx - lon) ** 2 } }
    const a = pick(y), b = pick(yU)
    return { y: 0, x: a.d < b.d ? a.gp : b.gp }
  },
  coords({ x: gp }) {
    const y = gp < O_COUNT / 2 ? Math.trunc((Math.sqrt(2 * gp + 81) - 9) / 2) : 2 * O - 1 - Math.trunc((Math.sqrt(2 * (O_COUNT - gp - 1) + 81) - 9) / 2)
    const lon = f(f(gp - oIntegral(y)) * f(360 / oNx(y)))
    return { lat: oLat(y), lon: lon >= 180 ? f(lon - 360) : lon }
  },
  /** The 3×3 neighbourhood (getSurroundingGridpoints), nearest first in `center`. */
  surrounding(lat, lon) {
    const cy = Math.max(1, Math.min(2 * O - 2, roundAway(f(O - 1 - f(f(lat - f(O_DY / 2)) / O_DY)))))
    const out = []
    for (let j = 0; j < 3; j++) {
      const y = cy + j - 1, nx = oNx(y), dx = f(360 / nx), xc = roundAway(f(lon / dx)), start = Math.max(0, 1 - xc)
      for (let i = 0; i < 3; i++) {
        const x = xc + ((i + start) % 3) - 1
        out.push({ cell: { y: 0, x: oIntegral(y) + ((x + 2 * nx) % nx) }, d: (oLat(y) - lat) ** 2 + (x * dx - lon) ** 2 })
      }
    }
    return out
  },
}

const MODELS = {
  era5: { dir: 'copernicus_era5', grid: regularGrid(1440, 721, -90, -180, 0.25) },
  era5_land: { dir: 'copernicus_era5_land', grid: regularGrid(3600, 1801, -90, -180, 0.1) },
  ecmwf_ifs: { dir: 'ecmwf_ifs', grid: gaussianGrid },
}

/** HSURF value → the elevation used for the lapse-rate correction: sea cells count as 0 m,
 *  and cells without data (NaN, or ≥ 9999 "land without elevation") disable it. */
const numeric = (e) => (e <= -999 ? 0 : e >= 9999 ? NaN : e)

/** The cell a model reads for a point, and the elevations the correction uses. Returns null
 *  where the model has no land cell nearby (the API refuses such a point). */
async function findCell(model, lat, lon, elevation) {
  const { dir, grid } = MODELS[model]
  const hsurf = `data/${dir}/static/HSURF.om`
  let cell, gridElev
  if (Number.isNaN(elevation)) {
    // No target: the nearest cell, and the target becomes that cell's own height.
    cell = grid.nearest(lat, lon)
    gridElev = (await read(hsurf, [[cell.y, cell.y + 1], [cell.x, cell.x + 1]]))[0]
    if (Number.isNaN(gridElev)) return null
    return { cell, ...grid.coords(cell), modelElev: numeric(gridElev), target: numeric(gridElev) }
  }
  if (grid === gaussianGrid) {
    const around = grid.surrounding(lat, lon)
    const center = around.reduce((a, b) => (b.d < a.d ? b : a))
    const ce = (await read(hsurf, [[0, 1], [center.cell.x, center.cell.x + 1]]))[0]
    // Within 100 m the server reports the *target* as the cell height: no correction.
    if (Math.abs(ce - elevation) <= 100) return { cell: center.cell, ...grid.coords(center.cell), modelElev: elevation, target: elevation }
    const elev = await Promise.all(around.map(({ cell: c }) => read(hsurf, [[0, 1], [c.x, c.x + 1]]).then((v) => v[0])))
    let best = null, bestDelta = Infinity
    around.forEach(({ cell: c, d }, i) => {
      if (Number.isNaN(elev[i]) || elev[i] <= -999) return
      const km = Math.sqrt(d) * 111, delta = Math.abs(elev[i] - elevation) + km * 30
      if (delta < bestDelta && km < 50) { bestDelta = delta; best = { cell: c, e: elev[i] } }
    })
    if (!best || bestDelta > 1500) best = { cell: center.cell, e: ce }
    return { cell: best.cell, ...grid.coords(best.cell), modelElev: numeric(best.e), target: elevation }
  }
  const center = grid.nearest(lat, lon)
  const block = await grid.elevations(dir, center)
  const c = block.find((b) => b.cell.y === center.y && b.cell.x === center.x)
  let best = c
  if (Math.abs(c.e - elevation) > 100) {
    let bestDelta = Math.abs(c.e - elevation), found = false
    for (const b of block) {
      if (Number.isNaN(b.e) || b.e <= -999) continue
      const p = grid.coords(b.cell), km = Math.sqrt((p.lat - lat) ** 2 + (p.lon - lon) ** 2) * 111
      const delta = (b.e >= 9999 ? 0 : Math.abs(b.e - elevation)) + km * 30
      if (delta < bestDelta && km < 50) { bestDelta = delta; best = b; found = true }
    }
    if (!found || bestDelta > 1500) best = c
  }
  if (Number.isNaN(best.e)) return null
  return { cell: best.cell, ...grid.coords(best.cell), modelElev: numeric(best.e), target: elevation }
}

/** Dem90.read: the elevation the API assumes for a coordinate when none is given. */
async function dem90(lat, lon) {
  const lati = Math.floor(lat)
  const px = lati < -85 ? 120 : lati < -80 ? 240 : lati < -70 ? 400 : lati < -60 ? 600 : lati < -50 ? 800 : lati < 50 ? 1200 : lati < 60 ? 800 : lati < 70 ? 600 : lati < 80 ? 400 : lati < 85 ? 240 : 120
  const row = Math.trunc(f(f(lat * 1200) + 90 * 1200)) % 1200, col = Math.trunc(f(f(lon + 180) * px))
  return (await read(`data/copernicus_dem90/static/lat_${lati}.om`, [[row, row + 1], [col, col + 1]]))[0]
}

// ---------- time series ----------

/** OmFileSplitter.read: one model variable at one cell over hours [h0, h1) since the epoch —
 *  yearly files where they exist, 21-day chunks after the last of them. `need`, when
 *  given, marks the hours still missing, so files covering none of them aren't read. */
async function series(model, variable, cell, h0, h1, need) {
  const { dir } = MODELS[model]
  const out = new Float32Array(h1 - h0).fill(NaN)
  const have = await listFiles(dir, variable)
  if (!have.size) return out
  const jobs = []
  const add = (name, fileStart, a, b) => {
    if (a >= b || !have.has(name)) return
    if (need && !need.subarray(a - h0, b - h0).some(Boolean)) return
    jobs.push(read(`data/${dir}/${variable}/${name}`, [[cell.y, cell.y + 1], [cell.x, cell.x + 1], [a - fileStart, b - fileStart]]).then((v) => out.set(v, a - h0)))
  }
  let start = h0
  for (let y = new Date(h0 * 1000 * HOUR).getUTCFullYear(); y <= new Date((h1 - 1) * 1000 * HOUR).getUTCFullYear(); y++) {
    if (!have.has(`year_${y}.om`)) continue
    const ys = Date.UTC(y, 0, 1) / 1000 / HOUR, ye = Date.UTC(y + 1, 0, 1) / 1000 / HOUR
    add(`year_${y}.om`, ys, Math.max(ys, h0), Math.min(ye, h1))
    start = ye
  }
  for (let c = Math.floor(start / CHUNK_HOURS); c * CHUNK_HOURS < h1; c++) {
    add(`chunk_${c}.om`, c * CHUNK_HOURS, Math.max(c * CHUNK_HOURS, start), Math.min((c + 1) * CHUNK_HOURS, h1))
  }
  await Promise.all(jobs)
  return out
}

const CORRECTED = new Set(['temperature_2m', 'dew_point_2m'])

/** One raw variable through the mixer: highest-priority model first, the next filling what's
 *  still missing (integrateIfNaNSmooth), stopping once nothing is. */
async function mixed(cells, variable, h0, h1) {
  let result = null
  for (const c of cells) {
    const need = result && result.map((v) => (Number.isNaN(v) ? 1 : 0))
    if (need && !need.includes(1)) break
    const d = await series(c.model, variable, c.cell, h0, h1, need)
    if (CORRECTED.has(variable) && !Number.isNaN(c.modelElev) && !Number.isNaN(c.target) && c.target !== c.modelElev) {
      const k = f(f(c.modelElev - c.target) * f(0.0065))
      for (let i = 0; i < d.length; i++) d[i] = f(d[i] + k)
    }
    if (!result) { result = d; continue }
    let since = 3
    for (let x = d.length - 1; x >= 0; x--) {
      since++
      if (Number.isNaN(d[x])) continue
      if (Number.isNaN(result[x])) { since = 0; result[x] = d[x]; continue }
      if (since > 3) continue
      result[x] = f(f(f(d[x] * (4 - since)) + f(result[x] * since)) / 4)
    }
  }
  return result
}

// ---------- daily aggregation (Array.max/min/sum/mean(by:), float32) ----------

const by24 = (a, fn) => { const n = a.length / 24, out = new Float32Array(n); for (let d = 0; d < n; d++) out[d] = fn(a, d * 24); return out }
// Swift's reduce here doesn't skip NaN — a NaN hour is replaced by the next value.
const dMax = (a, i) => { let m = -3.4028234663852886e38; for (let k = i; k < i + 24; k++) m = a[k] < m ? m : a[k]; return m }
const dMin = (a, i) => { let m = 3.4028234663852886e38; for (let k = i; k < i + 24; k++) m = a[k] > m ? m : a[k]; return m }
const dSum = (a, i) => { let s = 0; for (let k = i; k < i + 24; k++) s = f(s + a[k]); return s }
const dMean = (a, i) => f(dSum(a, i) / 24)
const dRadiation = (a, i) => { let s = 0; for (let k = i; k < i + 24; k++) s = f(s + f(f(a[k] * 3600) / 1e6)); return f(roundAway(f(s * 100)) / 100) }

const toF = (c) => f(f(f(c * 9) / 5) + 32)

/** Daily variable → raw inputs, aggregation, conversion for the requested units, and the
 *  decimals the API's JSON writer keeps for that unit. */
const DAILY = {
  temperature_2m_max: { raw: ['temperature_2m'], agg: ([t]) => by24(t, dMax), unit: (v, p) => (p.temperature_unit === 'fahrenheit' ? toF(v) : v), dp: 1 },
  temperature_2m_min: { raw: ['temperature_2m'], agg: ([t]) => by24(t, dMin), unit: (v, p) => (p.temperature_unit === 'fahrenheit' ? toF(v) : v), dp: 1 },
  dew_point_2m_mean: { raw: ['dew_point_2m'], agg: ([t]) => by24(t, dMean), unit: (v, p) => (p.temperature_unit === 'fahrenheit' ? toF(v) : v), dp: 1 },
  cloud_cover_mean: { raw: ['cloud_cover'], agg: ([c]) => by24(c, dMean), unit: (v) => v, dp: 0 },
  precipitation_sum: { raw: ['precipitation'], agg: ([p]) => by24(p, dSum), unit: (v, p) => (p.precipitation_unit === 'inch' ? f(v / f(25.4)) : v), dp: (p) => (p.precipitation_unit === 'inch' ? 3 : 2) },
  snowfall_sum: { raw: ['snowfall_water_equivalent'], agg: ([s]) => by24(s.map((v) => f(v * f(0.7))), dSum), unit: (v, p) => (p.precipitation_unit === 'inch' ? f(v / f(2.54)) : v), dp: (p) => (p.precipitation_unit === 'inch' ? 3 : 2) },
  wind_speed_10m_max: {
    raw: ['wind_u_component_10m', 'wind_v_component_10m'],
    agg: ([u, v]) => by24(u.map((x, i) => f(Math.sqrt(f(f(x * x) + f(v[i] * v[i]))))), dMax),
    unit: (v, p) => (p.wind_speed_unit === 'mph' ? f(v * f(2.237)) : p.wind_speed_unit === 'ms' ? v : f(v * f(3.6))), dp: 1,
  },
  shortwave_radiation_sum: { raw: ['shortwave_radiation'], agg: ([r]) => by24(r, dRadiation), unit: (v) => v, dp: 2 },
  sunshine_duration: { raw: ['direct_radiation'], agg: ([d], ctx) => by24(sunshineDuration(d, ctx.lat, ctx.lon, ctx.h0 * HOUR), dSum), unit: (v) => v, dp: 2 },
  snow_depth_max: { raw: ['snow_depth'], agg: ([s]) => by24(s, dMax), unit: (v) => v, dp: 2 },
}
const HOURLY = {
  temperature_2m: { unit: (v, p) => (p.temperature_unit === 'fahrenheit' ? toF(v) : v), dp: 1 },
}

/** JsonWriter's Float.formatted(decimals:), as the number it prints; NaN → null. */
function emit(v, dp) {
  if (!Number.isFinite(v)) return null
  const k = 10 ** dp, scaled = roundAway(f(Math.abs(v) * k))
  return (v < 0 ? -scaled : scaled) / k
}

/** Shortest decimal that reads back as the same float32 — how the API prints coordinates. */
function float32(v) {
  for (let p = 1; p < 10; p++) { const s = Number(v.toPrecision(p)); if (f(s) === f(v)) return s }
  return v
}

// ---------- time zones ----------

function offsetMinutes(timeZone, date) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(date).find((p) => p.type === 'timeZoneName').value
  const m = name.match(/GMT([+-])(\d\d):(\d\d)/)
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0
}

/** The zone's winter offset in seconds: the smaller of January's and July's, so daylight
 *  saving is never included in either hemisphere. */
export function standardOffsetSeconds(timeZone, year = new Date().getUTCFullYear()) {
  return 60 * Math.min(offsetMinutes(timeZone, new Date(Date.UTC(year, 0, 1))), offsetMinutes(timeZone, new Date(Date.UTC(year, 6, 1))))
}

const zoneOf = (tz, lat, lon) => (!tz || tz === 'auto' ? tzlookup(lat, lon) : tz)
/** The API's read offset: whole hours, truncated toward zero. */
const readHours = (offsetSec) => Math.trunc(offsetSec / HOUR)

function localClock(timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return (sec) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]))
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
  }
}

// ---------- the API ----------

const list = (v) => (v === undefined || v === '' ? [] : String(v).split(','))
const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`)

/** Answers one Open-Meteo archive request; an array when it names several locations. */
export async function archive(params) {
  const lats = list(params.latitude).map(Number), lons = list(params.longitude).map(Number)
  const elevs = list(params.elevation).map((e) => (e === 'nan' ? NaN : Number(e)))
  const out = await Promise.all(lats.map((lat, i) => location(params, lat, lons[i], elevs.length ? elevs[i] : undefined)))
  return out.length === 1 ? out[0] : out
}

async function location(params, lat, lon, elevation) {
  const models = params.models ? list(params.models) : ['best_match']
  if (models.length !== 1 || !['best_match', 'era5_land'].includes(models[0])) throw new Error(`S3 source: unsupported models=${params.models}`)
  const daily = list(params.daily), hourly = list(params.hourly)
  for (const v of daily) if (!DAILY[v]) throw new Error(`S3 source: unsupported daily variable ${v}`)
  for (const v of hourly) if (!HOURLY[v]) throw new Error(`S3 source: unsupported hourly variable ${v}`)

  const target = elevation === undefined ? await dem90(lat, lon) : elevation
  const order = models[0] === 'era5_land' ? ['era5_land'] : ['ecmwf_ifs', 'era5_land', 'era5'] // highest priority first
  const cells = []
  for (const model of order) {
    const c = await findCell(model, lat, lon, target)
    if (!c) throw new Error(`S3 source: no ${model} land cell near ${lat}, ${lon}`)
    cells.push({ model, ...c })
  }
  // The mixer reports the highest-priority model's cell and target elevation.
  const top = cells[0]
  const timezone = zoneOf(params.timezone, lat, lon)
  const std = standardOffsetSeconds(timezone, +params.end_date.slice(0, 4))
  const res = {
    latitude: float32(top.lat), longitude: float32(top.lon), elevation: float32(top.target),
    utc_offset_seconds: std, timezone,
  }
  const first = dayMs(params.start_date) / 1000, last = dayMs(params.end_date) / 1000 + 86400

  if (daily.length) {
    const h0 = first / HOUR - readHours(std), h1 = last / HOUR - readHours(std)
    const raw = {}
    for (const v of new Set(daily.flatMap((d) => DAILY[d].raw))) raw[v] = mixed(cells, v, h0, h1)
    const ctx = { lat: top.lat, lon: top.lon, h0 }
    res.daily = { time: Array.from({ length: (h1 - h0) / 24 }, (_, d) => new Date((first + d * 86400) * 1000).toISOString().slice(0, 10)) }
    for (const v of daily) {
      const spec = DAILY[v], dp = typeof spec.dp === 'function' ? spec.dp(params) : spec.dp
      const agg = spec.agg(await Promise.all(spec.raw.map((r) => raw[r])), ctx)
      res.daily[v] = Array.from(agg, (x) => emit(spec.unit(x, params), dp))
    }
  }
  if (hourly.length) {
    // Local clock time: read a margin either side, keep the hours whose local date is in range.
    const clock = localClock(timezone)
    const h0 = first / HOUR - readHours(std) - 26, h1 = last / HOUR - readHours(std) + 26
    const times = Array.from({ length: h1 - h0 }, (_, i) => clock((h0 + i) * HOUR))
    const keep = times.map((t) => t >= params.start_date && t.slice(0, 10) <= params.end_date)
    res.hourly = { time: times.filter((_, i) => keep[i]) }
    for (const v of hourly) {
      const d = await mixed(cells, v, h0, h1)
      res.hourly[v] = Array.from(d, (x) => emit(HOURLY[v].unit(x, params), HOURLY[v].dp)).filter((_, i) => keep[i])
    }
  }
  return res
}

/** A fetch() for code that takes one (ytd.ts): archive URLs are answered from S3. */
export async function s3Fetch(url) {
  const body = await archive(Object.fromEntries(new URL(url).searchParams))
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}
