// Checks that the S3 source (scripts/open-meteo-s3.mjs) still reproduces the Open-Meteo
// API: for each city, the requests fetch-data makes — daily archive, grid cell, terrain snow
// depth, hourly temperature, CAMS air quality — are sent both ways over a short random
// window and compared value by value. Air quality is checked where the bucket has it
// (global from Aug 2022, Europe from 2024), and on values only: the API reports another
// model's grid point for it. Both sides use timezone=GMT, so the S3 source's own time-zone convention
// doesn't enter into it. Costs ~6 API calls per city and ~4 per terrain point (60 days).
// Exits non-zero on any mismatch beyond one rounding step.
//
//   npm run verify-s3                        6 random cities from the catalogue and queue
//   npm run verify-s3 -- st-john-s adelaide  these cities
//   npm run verify-s3 -- --days 365 --n 10
import { parseArgs } from 'node:util'
import { AQ_API, archiveRequests, budget, get } from './open-meteo.mjs'
import { airQuality, archive } from './open-meteo-s3.mjs'
import { camsRequest } from './air-quality.mjs'
import { readCatalog, readQueue } from './catalog-file.mjs'
import { DAILY_VARS } from '../src/lib/ytd.ts'

const { values: opts, positionals: ids } = parseArgs({
  allowPositionals: true,
  options: { days: { type: 'string', default: '60' }, n: { type: 'string', default: '6' } },
})
const catalog = await readCatalog(),
  queue = await readQueue()
const cities = [...catalog.cities, ...(queue?.cities ?? [])]
const terrain = { ...catalog.terrain, ...queue?.terrain }
const picked = ids.length
  ? ids.map(
      (id) =>
        cities.find((c) => c.id === id) ??
        (() => {
          throw new Error(`unknown city ${id}`)
        })(),
    )
  : [...cities].sort(() => Math.random() - 0.5).slice(0, Number(opts.n))

const DAY = 86_400_000
const iso = (t) => new Date(t).toISOString().slice(0, 10)
/** A random window between `from` and a week ago, so it can land in any model era. */
function window(days, from = '1991-01-01') {
  const lo = Date.parse(`${from}T00:00:00Z`),
    hi = Date.now() - 7 * DAY - days * DAY
  const start = lo + Math.floor(Math.random() * ((hi - lo) / DAY)) * DAY
  return { start_date: iso(start), end_date: iso(start + (days - 1) * DAY) }
}

/** Sunshine is a float32 sum of 24 values derived through trigonometry near sunrise and
 *  sunset; the server's sinf/cosf and ours differ in the last bit, which shows as up to
 *  ~0.1 s a day. A second of slack is 1/360 of the 0.1 h the app keeps. */
const NOISE = { sunshine_duration: 1 }

/** Compare two responses' series; a difference of one unit in the last printed digit is
 *  rounding at a .5 boundary and passes. Returns the problems found. */
function compare(what, api, s3, block, vars, coords = true) {
  const problems = []
  for (const k of coords ? ['latitude', 'longitude', 'elevation'] : [])
    if (api[k] !== s3[k]) problems.push(`${what} ${k} ${s3[k]} ≠ API ${api[k]}`)
  if (api[block].time.join() !== s3[block].time.join()) problems.push(`${what} ${block} times differ`)
  for (const v of vars) {
    const a = api[block][v],
      b = s3[block][v]
    let bad = 0,
      worst = 0
    a.forEach((x, i) => {
      if (x === null || b[i] === null) {
        if (x !== b[i]) bad++
        return
      }
      const step = 10 ** -(Math.max(decimals(x), decimals(b[i])) || 0),
        d = Math.abs(x - b[i])
      if (d > step + 1e-9 && d > (NOISE[v] ?? 0)) {
        bad++
        worst = Math.max(worst, d)
      }
    })
    if (bad) problems.push(`${what} ${v}: ${bad}/${a.length} differ (worst ${worst.toFixed(3)})`)
  }
  return problems
}
const decimals = (x) => (String(x).split('.')[1] ?? '').length

const days = Number(opts.days)
let failed = 0
for (const city of picked) {
  const R = archiveRequests({ startYear: 1991, endYear: 2025 })
  const w = window(days),
    gmt = { timezone: 'GMT' }
  const daily = {
    ...R.daily(
      city,
      DAILY_VARS.map((v) => v[0]),
    ),
    ...w,
    ...gmt,
  }
  const grid = { ...R.grid(city), ...gmt }
  const hourly = { ...R.hourly(city), ...window(14), ...gmt }
  const problems = [
    ...compare(
      'daily',
      await get(daily),
      await archive(daily),
      'daily',
      DAILY_VARS.map((v) => v[0]),
    ),
    ...compare('grid', await get(grid), await archive(grid), 'daily', []),
    ...compare('hourly', await get(hourly), await archive(hourly), 'hourly', ['temperature_2m']),
  ]
  for (const [tid] of city.terrain) {
    const t = { ...R.terrain(terrain[tid]), ...w, ...gmt }
    problems.push(...compare(`terrain/${tid}`, await get(t), await archive(t), 'daily', ['snow_depth_max']))
  }
  const cams = camsRequest(city, 2025, 's3')
  const aq = { ...cams, ...window(14, cams.start_date), ...gmt }
  problems.push(
    ...compare(
      `aq/${cams.domains}`,
      await get(aq, AQ_API),
      await airQuality(aq),
      'hourly',
      cams.hourly.split(','),
      false,
    ),
  )
  if (problems.length) failed++
  console.log(
    `${problems.length ? '✗' : '✓'} ${city.id} · ${w.start_date} → ${w.end_date} · ${city.terrain.length} terrain · aq ${cams.domains} from ${aq.start_date}${problems.length ? `\n    ${problems.join('\n    ')}` : ''}`,
  )
}
console.log(
  `${picked.length - failed} of ${picked.length} cities match the API · ~${Math.round(budget.spent)} API calls`,
)
if (failed) process.exit(1)
