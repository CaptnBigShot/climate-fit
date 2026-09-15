// Derives the set-relative city metrics (Solar Intensity Index, four-season
// distinctness) that need every city at once, and records which data files
// exist. Runs automatically at the end of fetch-data; also: npm run manifest
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCatalog } from './catalog-file.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
const MD = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
// Indices are computed over the most recent decade of the archive, a fixed
// reference so the index doesn't shift when the user changes the lookback.
const REF_YEARS = 10

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const std = (xs) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
const normalize = (vals) => {
  const lo = Math.min(...vals),
    hi = Math.max(...vals)
  return vals.map((v) => (hi === lo ? 50 : Math.round(((v - lo) / (hi - lo)) * 100)))
}

export async function buildManifest() {
  // Read at call time: fetch-data adds cities to the catalogue during a run.
  const catalog = await readCatalog()
  const files = new Set(await readdir(join(OUT, 'cities')).catch(() => []))
  const terrainFiles = new Set(await readdir(join(OUT, 'terrain')).catch(() => []))
  const hourlyFiles = new Set(await readdir(join(OUT, 'hourly')).catch(() => []))
  const rows = []
  for (const c of catalog.cities) {
    if (!files.has(`${c.id}.json`)) continue
    const d = JSON.parse(await readFile(join(OUT, 'cities', `${c.id}.json`), 'utf8'))
    const off = (d.years - REF_YEARS) * 365
    const rad = d.rad.slice(off).filter((v) => v !== null)
    const monthly = []
    let doy = 0
    for (let m = 0; m < 12; m++) {
      const vals = []
      for (let y = 0; y < REF_YEARS; y++) {
        for (let k = 0; k < MD[m]; k++) {
          const i = off + y * 365 + doy + k
          vals.push((d.high[i] + d.low[i]) / 2)
        }
      }
      monthly.push(mean(vals))
      doy += MD[m]
    }
    rows.push({ id: c.id, meanRadMJ: mean(rad), seasonStd: std(monthly), demElevM: d.demElevM, gridElevM: d.gridElevM })
  }
  const solar = normalize(rows.map((r) => r.meanRadMJ))
  const seasons = normalize(rows.map((r) => r.seasonStd))
  const cities = {}
  rows.forEach((r, i) => {
    cities[r.id] = {
      solarIdx: solar[i],
      seasonsIdx: seasons[i],
      meanRadMJ: Number(r.meanRadMJ.toFixed(2)),
      seasonStdF: Number(r.seasonStd.toFixed(2)),
      demElevM: r.demElevM,
      gridElevM: r.gridElevM,
    }
  })
  const terrain = Object.keys(catalog.terrain).filter((t) => terrainFiles.has(`${t}.json`))
  // Cities with a pre-fetched hourly file; the app fetches the rest live.
  const hourly = catalog.cities.map((c) => c.id).filter((id) => hourlyFiles.has(`${id}.json`))
  const manifest = { refYears: REF_YEARS, cities, terrain, hourly }
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1))
  console.log(`manifest: ${rows.length} cities, ${terrain.length} terrain refs`)
}

if (import.meta.url === `file://${process.argv[1]}`) await buildManifest()
