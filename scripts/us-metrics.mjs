// Ranking inputs for US cities, from federal open data (no API keys):
//   tech jobs    BLS QCEW, 2024 annual average private employment by county in NAICS 5132
//                (software publishers), 5182 (computing infrastructure, data processing,
//                hosting), 5192 (web search portals and other information services) and
//                5415 (computer systems design) — the industries software engineers work in
//   walk         ACS 2019–2023 5-year table B08301: the share of commuters, leaving out
//                those who work from home, who take transit, walk or cycle, by place
//   locations    Census 2023 Gazetteer: county and place centroids
//   metros       NBER's copy of the Census 2023 CBSA delineation: which metro each county is in
// Everywhere else there's no common source, so catalog.config.mjs estimates (and says so).
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { reach } from './fit-score.mjs'

const TECH_NAICS = ['5132', '5182', '5192', '5415']
const QCEW_YEAR = 2024
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer'
const ACS = 'https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData/acsdt5y2023-b08301.dat'
const CBSA = 'https://data.nber.org/cbsa-csa-fips-county-crosswalk/2023/cbsa2fipsxw_2023.csv'
/** How a Gazetteer place name continues after the city's own name ("Boise City city", "Nashville-Davidson metropolitan government (balance)"). */
const NAME_TAIL = /^([\s/-]|$)/
/** A place's internal point can sit far from downtown: San Francisco's is out in the Pacific. */
const NAME_KM = 60

/** @param download (name, url) → local path, cached  @param km great-circle distance */
export async function loadUsMetrics(download, km) {
  const gazetteer = async (kind) => {
    const zip = await download(`gaz_${kind}.zip`, `${GAZ}/2023_Gaz_${kind}_national.zip`)
    const txt = join(dirname(zip), `2023_Gaz_${kind}_national.txt`)
    execFileSync('unzip', ['-o', '-q', zip, '-d', dirname(zip)])
    const [head, ...rows] = (await readFile(txt, 'utf8')).trim().split('\n').map((l) => l.split('\t').map((f) => f.trim()))
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
  }

  const countyRows = await gazetteer('counties')
  const counties = new Map(countyRows.map((c) => [c.GEOID, { lat: Number(c.INTPTLAT), lon: Number(c.INTPTLONG), jobs: 0 }]))
  const stateFips = new Map(countyRows.map((c) => [c.USPS, c.GEOID.slice(0, 2)]))
  const metroOfCounty = new Map()
  const [cbsaHead, ...cbsaRows] = (await readFile(await download('cbsa2fips.csv', CBSA), 'utf8')).trim().split('\n').map((l) => l.split(',').map((f) => f.replaceAll('"', '')))
  const col = Object.fromEntries(cbsaHead.map((h, i) => [h, i]))
  // Titles contain commas ("Seattle-Tacoma-Bellevue, WA"), which the plain split breaks; only codes are read.
  for (const r of cbsaRows) metroOfCounty.set(r.at(-2), r[col.cbsacode])
  for (const naics of TECH_NAICS) {
    const csv = await readFile(await download(`qcew_${naics}.csv`, `https://data.bls.gov/cew/data/api/${QCEW_YEAR}/a/industry/${naics}.csv`), 'utf8')
    for (const line of csv.split('\n').slice(1)) {
      const f = line.split(',').map((x) => x.replaceAll('"', ''))
      // Private ownership, county rows (5-digit FIPS); suppressed cells report 0.
      if (f[1] !== '5' || !counties.has(f[0])) continue
      counties.get(f[0]).jobs += Number(f[9]) || 0
    }
  }

  const places = new Map()
  for (const p of await gazetteer('place')) {
    const list = places.get(p.USPS) ?? []
    list.push({ geoid: p.GEOID, name: p.NAME.toLowerCase(), lat: Number(p.INTPTLAT), lon: Number(p.INTPTLONG) })
    places.set(p.USPS, list)
  }
  const commute = new Map()
  let cols = null
  for await (const line of createInterface({ input: createReadStream(await download('acs_b08301.dat', ACS)), crlfDelay: Infinity })) {
    const f = line.split('|')
    if (!cols) { cols = Object.fromEntries(f.map((h, i) => [h, i])); continue }
    if (!f[0].startsWith('1600000US')) continue
    const n = (k) => Number(f[cols[`B08301_E0${k}`]])
    const commuters = n('01') - n('21')
    if (commuters > 0) commute.set(f[0].slice(9), (n('10') + n('18') + n('19')) / commuters)
  }

  return {
    /** The CBSA (metro or micro area) a GeoNames place is in, by its county; null outside one. */
    metroOf: (p) => metroOfCounty.get(`${stateFips.get(p.admin1)}${p.admin2}`) ?? null,
    /** Tech jobs within reach of a point: every county's, faded by distance. */
    techJobs: (p) => {
      let jobs = 0
      for (const c of counties.values()) if (c.jobs) jobs += c.jobs * reach(km(p, c))
      return jobs
    },
    /** { share, place } for the Census place matching a GeoNames city (state postal code in
     *  `code`), by name within NAME_KM, else the nearest place within 5 km; null if neither. */
    activeCommute: (p, code) => {
      const inState = (places.get(code) ?? []).filter((q) => commute.has(q.geoid))
      const names = [p.name, p.ascii].map((s) => s.toLowerCase())
      const named = inState.filter((q) => names.some((n) => q.name.startsWith(n) && NAME_TAIL.test(q.name.slice(n.length))) && km(p, q) < NAME_KM)
      const near = (qs) => qs.reduce((b, q) => (!b || km(p, q) < km(p, b) ? q : b), null)
      const match = near(named) ?? near(inState.filter((q) => km(p, q) < 5))
      return match ? { share: commute.get(match.geoid), place: match.name } : null
    },
  }
}
