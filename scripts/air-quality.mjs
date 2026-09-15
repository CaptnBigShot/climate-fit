// Air-quality tier → public/data/aq/<city>.json, one shape for every city (src/lib/aq.ts).
//
// US cities: EPA AirData (https://aqs.epa.gov/aqsweb/airdata/download_files.html), the
// validated regulatory record: daily AQI per monitor from EPA_START_YEAR. AirData
// publishes one zip per pollutant per year covering every US monitor, so all cities
// come out of a single pass over each file. Per pollutant, each day picks among the
// monitors within EPA_RADIUS_KM by that pollutant's epaPick rule (src/lib/aq.ts).
//
// Everywhere else — and any US city with no monitor in range — CAMS via Open-Meteo: from the
// API, or computed from Open-Meteo's S3 bucket (scripts/open-meteo-s3.mjs airQuality). The
// two agree exactly where the bucket has the data — global from Aug 2022, Europe from 2024;
// Europe's 2013–2023 reanalysis is API-only, so an S3 fetch starts European cities in 2024.
//
// Zips are cached in .cache/airdata/ (~350 MB for the full history) and revalidated on
// every run with a conditional request, so EPA's twice-yearly revisions are picked up
// without re-downloading anything unchanged. Needs the `unzip` command (standard on
// macOS and Linux).
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AQ_FORMAT, EPA_OUTLIER_AQI, EPA_RADIUS_KM, EPA_START_YEAR, POLLUTANTS } from '../src/lib/aq.ts'
import { AQ_API, get } from './open-meteo.mjs'
import { airQuality } from './open-meteo-s3.mjs'

const AIRDATA = 'https://aqs.epa.gov/aqsweb/airdata'
/** CAMS history via Open-Meteo: global from Aug 2022, Europe from 2013 through the API but
 *  only from 2024 in the bucket (see the header). */
const CAMS_GLOBAL_START = '2022-08-01'
const CAMS_EUROPE_START = { api: '2013-01-01', s3: '2024-01-01' }
const DAY = 86_400_000
const iso = (t) => new Date(t).toISOString().slice(0, 10)

/** Writes every city whose file is missing or from an older AQ_FORMAT. `source` ('s3' or
 *  'api') only affects the CAMS cities. */
export async function fetchAirQuality(cities, { out, cache, endYear, source = 'api' }) {
  const todo = []
  for (const city of cities) if (!(await isCurrent(join(out, `${city.id}.json`)))) todo.push(city)
  if (cities.length > todo.length) console.log(`✓ aq: ${cities.length - todo.length} cities current`)
  if (!todo.length) return
  const epa = await fetchEpa(todo, join(cache, 'airdata'), endYear)
  for (const city of todo) {
    const data = epa.get(city.id) ?? (await fetchCams(city, endYear, source))
    await writeFile(join(out, `${city.id}.json`), JSON.stringify({ v: AQ_FORMAT, id: city.id, ...data }))
    console.log(`✓ aq/${city.id} · ${data.source} · ${data.start} → ${data.end}`)
  }
}

export async function isCurrent(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8')).v === AQ_FORMAT
  } catch {
    return false
  }
}

// ---------- EPA AirData ----------

/** EPA series for each city that has monitor readings in range; the rest are left out. */
async function fetchEpa(cities, dir, endYear) {
  await mkdir(dir, { recursive: true })
  const t0 = Date.UTC(EPA_START_YEAR, 0, 1),
    n = (Date.UTC(endYear, 11, 31) - t0) / DAY + 1

  // site id → the cities it is in range of, with the distance to each
  const sites = await readSites(dir)
  const near = new Map()
  for (const [ci, city] of cities.entries()) {
    for (const s of sites) {
      const km = distanceKm(city, s)
      if (km <= EPA_RADIUS_KM) near.set(s.id, [...(near.get(s.id) ?? []), { ci, km }])
    }
  }
  if (!near.size) return new Map()

  // Per city and pollutant, the reading picked for each day and which monitor gave it.
  // 'highest' needs every monitor's reading for the outlier guard, so it collects them
  // per day and picks after the scan; 'nearest' picks as rows stream past.
  const best = cities.map(() =>
    Object.fromEntries(
      POLLUTANTS.map((p) => [
        p.key,
        {
          aqi: new Int16Array(n).fill(-1),
          km: new Float32Array(n).fill(Infinity),
          site: new Array(n),
          readings: p.epaPick === 'highest' ? new Array(n) : null,
        },
      ]),
    ),
  )
  for (let year = EPA_START_YEAR; year <= endYear; year++) {
    for (const p of POLLUTANTS) {
      const zip = await download(dir, `daily_${p.epa}_${year}`)
      if (!zip) {
        console.log(`  airdata: EPA has not published ${p.label} for ${year}`)
        continue
      }
      for await (const [id, row] of readCsv(zip, (id) => near.has(id))) {
        const aqi = row.AQI === '' ? NaN : Number(row.AQI)
        const d = (Date.parse(`${row['Date Local']}T00:00:00Z`) - t0) / DAY
        if (!Number.isFinite(aqi) || !(d >= 0 && d < n)) continue
        // Several rows per monitor-day (instruments, wildfire-event flags): the highest wins.
        for (const { ci, km } of near.get(id)) {
          const b = best[ci][p.key]
          if (b.readings) {
            const day = (b.readings[d] ??= new Map())
            day.set(id, Math.max(day.get(id) ?? -1, aqi))
          } else if (km < b.km[d] || (km === b.km[d] && aqi > b.aqi[d])) {
            b.km[d] = km
            b.aqi[d] = aqi
            b.site[d] = id
          }
        }
      }
    }
  }
  for (const b of best.flatMap((c) => Object.values(c))) {
    b.readings?.forEach((day, d) => {
      ;[b.site[d], b.aqi[d]] = pickHighest(day)
    })
  }

  const siteById = new Map(sites.map((s) => [s.id, s]))
  const result = new Map()
  for (const [ci, city] of cities.entries()) {
    const measured = POLLUTANTS.filter((p) => best[ci][p.key].aqi.some((v) => v >= 0))
    if (!measured.length) continue
    let first = n,
      last = -1
    for (const p of measured) {
      const a = best[ci][p.key].aqi
      first = Math.min(
        first,
        a.findIndex((v) => v >= 0),
      )
      last = Math.max(
        last,
        a.findLastIndex((v) => v >= 0),
      )
    }
    const aqi = {},
      used = {}
    for (const p of measured) {
      const b = best[ci][p.key]
      aqi[p.key] = Array.from(b.aqi.subarray(first, last + 1), (v) => (v < 0 ? null : v))
      const days = new Map()
      for (let d = first; d <= last; d++) if (b.site[d]) days.set(b.site[d], (days.get(b.site[d]) ?? 0) + 1)
      used[p.key] = [...days]
        .sort((x, y) => y[1] - x[1])
        .map(([id, count]) => ({
          id,
          name: siteById.get(id).name,
          km: Number(distanceKm(city, siteById.get(id)).toFixed(1)),
          days: count,
        }))
    }
    result.set(city.id, { source: 'epa', start: iso(t0 + first * DAY), end: iso(t0 + last * DAY), aqi, sites: used })
  }
  return result
}

/** [site, AQI] of the day's highest monitor, unless it stands alone far above the rest. */
function pickHighest(day) {
  const [top, next] = [...day].sort((a, b) => b[1] - a[1])
  return day.size >= 3 && top[1] - next[1] > EPA_OUTLIER_AQI ? next : top
}

/** Every monitoring site still open in EPA_START_YEAR or later. */
async function readSites(dir) {
  const zip = await download(dir, 'aqs_sites')
  if (!zip) throw new Error('AirData site list (aqs_sites.zip) not found')
  const sites = []
  for await (const [id, r] of readCsv(zip, () => true)) {
    const lat = Number(r.Latitude),
      lon = Number(r.Longitude),
      closed = r['Site Closed Date']
    if (!lat || !lon || (closed && closed < `${EPA_START_YEAR}-01-01`)) continue
    sites.push({ id, lat, lon, name: r['Local Site Name'] || r['City Name'] || r.Address })
  }
  return sites
}

/** A cached AirData zip, revalidated against the server. Null if EPA hasn't published it. */
async function download(dir, name) {
  const file = join(dir, `${name}.zip`)
  const cached = await stat(file).catch(() => null)
  const res = await fetch(`${AIRDATA}/${name}.zip`, {
    headers: cached ? { 'If-Modified-Since': cached.mtime.toUTCString() } : {},
  })
  if (res.status === 304) return file
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`AirData ${name}.zip: ${res.status} ${res.statusText}`)
  console.log(`↓ airdata/${name}.zip`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${file}.part`))
  await rename(`${file}.part`, file)
  const modified = new Date(res.headers.get('last-modified') ?? Date.now())
  await utimes(file, modified, modified)
  return file
}

/** Rows of the CSV inside `zip` whose site id (first three columns) passes `keep`,
 *  as [site id, { header: value }]. Only kept rows are fully parsed. */
async function* readCsv(zip, keep) {
  const unzip = spawn('unzip', ['-p', zip], { stdio: ['ignore', 'pipe', 'inherit'] })
  const exit = new Promise((resolve) => {
    unzip.on('error', resolve)
    unzip.on('close', resolve)
  })
  let head = null
  for await (const line of createInterface({ input: unzip.stdout, crlfDelay: Infinity })) {
    if (!head) {
      head = parseCsvLine(line)
      continue
    }
    const id = line
      .split(',', 3)
      .map((f) => f.replaceAll('"', ''))
      .join('-')
    if (!keep(id)) continue
    const f = parseCsvLine(line)
    yield [id, Object.fromEntries(head.map((h, i) => [h, f[i]]))]
  }
  const code = await exit
  if (code instanceof Error) throw new Error(`unzip: ${code.message} (is the unzip command installed?)`)
  if (code !== 0) throw new Error(`unzip exited with ${code} on ${zip}`)
}

function parseCsvLine(line) {
  const out = []
  let field = '',
    quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (line[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(field)
      field = ''
    } else field += c
  }
  out.push(field)
  return out
}

function distanceKm(a, b) {
  const rad = Math.PI / 180,
    dLat = (b.lat - a.lat) * rad,
    dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

// ---------- CAMS via Open-Meteo ----------

/** The CAMS request for a city — exported so a fetch run can price it before starting. */
export function camsRequest(city, endYear, source = 'api') {
  const europe = city.lon >= -25 && city.lon <= 45 && city.lat >= 30 && city.lat <= 72
  return {
    latitude: city.lat,
    longitude: city.lon,
    timezone: 'auto',
    domains: europe ? 'cams_europe' : 'cams_global',
    start_date: europe ? CAMS_EUROPE_START[source] : CAMS_GLOBAL_START,
    end_date: `${endYear}-12-31`,
    hourly: POLLUTANTS.map((p) => p.cams).join(','),
  }
}

/** Daily max of each pollutant's hourly US AQI sub-index (Open-Meteo's rolling averages). */
async function fetchCams(city, endYear, from) {
  const params = camsRequest(city, endYear, from),
    source = params.domains
  const data = from === 's3' ? await airQuality(params) : await get(params, AQ_API)
  const dates = [...new Set(data.hourly.time.map((t) => t.slice(0, 10)))]
  const index = new Map(dates.map((d, i) => [d, i]))
  const daily = Object.fromEntries(POLLUTANTS.map((p) => [p.key, new Array(dates.length).fill(null)]))
  data.hourly.time.forEach((t, h) => {
    const d = index.get(t.slice(0, 10))
    for (const p of POLLUTANTS) {
      const v = data.hourly[p.cams][h]
      if (v !== null) daily[p.key][d] = Math.max(daily[p.key][d] ?? 0, Math.round(v))
    }
  })
  // The archive starts before the model has output; trim to the first day with any.
  const first = dates.findIndex((_, d) => POLLUTANTS.some((p) => daily[p.key][d] !== null))
  if (first < 0) throw new Error(`no ${source} air-quality data for ${city.id}`)
  const aqi = {}
  for (const p of POLLUTANTS) if (daily[p.key].some((v) => v !== null)) aqi[p.key] = daily[p.key].slice(first)
  for (const [k, v] of Object.entries(aqi)) {
    const bad = v.findIndex((x) => x !== null && !(x >= 0 && x <= 1000))
    if (bad >= 0) throw new Error(`aq/${city.id}: ${k} day ${bad} is ${v[bad]}`)
  }
  return { source, start: dates[first], end: dates[dates.length - 1], aqi }
}
