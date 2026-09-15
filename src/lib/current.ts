// The current, partial year. It is never mixed into a lookback window — every
// window stays whole years — but it is shown alongside, always compared like for
// like: Jan 1 → last observed day, against the same span in each window year.
import { fetchYtdRaw, type YtdRaw } from './ytd'
import { ARCHIVE, SERIES_KEYS, TERRAIN, type CityMeta, type CitySeries, type TerrainSeries } from './data'
import { ACTIVITIES } from './activities'
import { score, seasonWeights, type Scored } from './scoring'
import { FIRST_YEAR, windowYears, type ActivityId, type Prefs, type Window } from './prefs'
import type { DayPred } from './aggregate'

export const YTD_YEAR = ARCHIVE.endYear + 1
/** Terrain snow depth lags the weather by several days; carry the last value forward this far. */
export const DEPTH_CARRY_DAYS = 7
/** Below this many observed days, year-to-date comparisons are withheld. */
export const YTD_MIN_DAYS = 14

export interface Ytd {
  raw: YtdRaw
  source: 'live' | 'snapshot'
  /** Archive series with the partial year appended (NaN past the last observed day). */
  sx: CitySeries
  /** Terrain series extended the same way. */
  tx: Record<string, TerrainSeries>
}

const base = import.meta.env.BASE_URL
const memo = new Map<string, Promise<{ raw: YtdRaw; source: 'live' | 'snapshot' }>>()

/** A build-time snapshot this recent is as current as a live fetch: both end at the city's
 *  local yesterday. fetch-data refreshes every snapshot on each daily run (free from S3). */
const SNAPSHOT_FRESH_MS = 24 * 3_600_000

/** The build-time snapshot while it's under a day old; otherwise a live fetch from Open-Meteo
 *  (cached per city per day), falling back to the snapshot however old. */
export function loadYtdRaw(city: CityMeta): Promise<{ raw: YtdRaw; source: 'live' | 'snapshot' }> {
  const day = new Date().toISOString().slice(0, 10)
  const key = `cf-ytd:${YTD_YEAR}:${city.id}:${day}`
  let p = memo.get(key)
  if (p) return p
  p = (async () => {
    try {
      const hit = localStorage.getItem(key)
      if (hit) return { raw: JSON.parse(hit) as YtdRaw, source: 'live' as const }
    } catch {
      /* storage unavailable */
    }
    const snapshot = await fetch(`${base}data/ytd/${city.id}.json`)
      .then((res) => (res.ok ? (res.json() as Promise<YtdRaw>) : null))
      .catch(() => null)
    if (snapshot?.year === YTD_YEAR && Date.now() - Date.parse(snapshot.fetchedAt) < SNAPSHOT_FRESH_MS) {
      return { raw: snapshot, source: 'snapshot' as const }
    }
    try {
      const raw = await fetchYtdRaw({
        year: YTD_YEAR,
        lat: city.lat,
        lon: city.lon,
        terrain: city.terrain.map(([id]) => ({ id, ...TERRAIN[id] })),
      })
      try {
        localStorage.setItem(key, JSON.stringify(raw))
      } catch {
        /* quota or disabled */
      }
      return { raw, source: 'live' as const }
    } catch {
      if (!snapshot) throw new Error('current year unavailable (live fetch failed, no snapshot)')
      return { raw: snapshot, source: 'snapshot' as const }
    }
  })()
  p.catch(() => memo.delete(key))
  memo.set(key, p)
  return p
}

const f32 = (xs: (number | null)[]) => Float32Array.from(xs, (v) => (v === null ? NaN : v))

export function extend(
  s: CitySeries,
  terrains: Record<string, TerrainSeries>,
  raw: YtdRaw,
  source: Ytd['source'],
): Ytd {
  const sx = { ...s, years: s.years + 1 } as CitySeries
  for (const k of SERIES_KEYS) {
    const a = new Float32Array((s.years + 1) * 365)
    a.set(s[k])
    a.set(f32(raw.daily[k]), s.years * 365)
    sx[k] = a
  }
  const tx: Record<string, TerrainSeries> = {}
  for (const [id, t] of Object.entries(terrains)) {
    const y = raw.terrain[id]
    if (!y) continue
    const depth = f32(y.depth)
    // Snow depth runs a few days behind the weather: persist the last value briefly so recent days aren't "no snow".
    let lastIdx = -1
    for (let d = 0; d < raw.days; d++) {
      if (!Number.isNaN(depth[d])) lastIdx = d
      else if (lastIdx >= 0 && d - lastIdx <= DEPTH_CARRY_DAYS) depth[d] = depth[lastIdx]
    }
    const a = new Float32Array((t.years + 1) * 365)
    a.set(t.depth)
    a.set(depth, t.years * 365)
    tx[id] = { ...t, years: t.years + 1, depth: a }
  }
  return { raw, source, sx, tx }
}

// ---------- like-for-like comparisons ----------

const ytdWindow: Window = { from: YTD_YEAR, to: YTD_YEAR }

/** Score the partial year using the lookback window's season boundaries. */
export function scoreYtd(y: Ytd, s: CitySeries, p: Prefs, w: Window): Scored | null {
  return score(y.sx, p, ytdWindow, 0, seasonWeights(s, w).warmW)
}

export interface YtdBudget {
  ytd: [number, number, number]
  hard: number
  typical: [number, number, number]
  typicalHard: number
}

/** Band counts over Jan 1 → day n: this year vs the mean of the window years over the same span. */
export function ytdBudget(ysc: Scored, wsc: Scored, n: number): YtdBudget {
  const ytd: [number, number, number] = [0, 0, 0],
    typical: [number, number, number] = [0, 0, 0]
  let hard = 0,
    th = 0
  for (let d = 0; d < n; d++) {
    ytd[ysc.band[d]]++
    if (ysc.hard[d]) hard++
  }
  for (let y = 0; y < wsc.years; y++)
    for (let d = 0; d < n; d++) {
      const i = y * 365 + d
      typical[wsc.band[i]]++
      if (wsc.hard[i]) th++
    }
  const k = 1 / wsc.years
  return { ytd, hard, typical: [typical[0] * k, typical[1] * k, typical[2] * k], typicalHard: th * k }
}

/** Days matching pred over Jan 1 → day n, this year vs window mean. */
export function ytdCount(y: Ytd, w: Window, pred: DayPred, n: number): { ytd: number; typical: number } {
  const yOff = (YTD_YEAR - FIRST_YEAR) * 365,
    wOff = (w.from - FIRST_YEAR) * 365
  let c = 0,
    t = 0
  for (let d = 0; d < n; d++) if (pred(y.sx, yOff + d)) c++
  for (let yr = 0; yr < windowYears(w); yr++) for (let d = 0; d < n; d++) if (pred(y.sx, wOff + yr * 365 + d)) t++
  return { ytd: c, typical: t / windowYears(w) }
}

/** Outdoor days (≥1 enabled activity) over Jan 1 → day n, this year vs window mean. */
export function ytdOutdoor(y: Ytd, w: Window, acts: ActivityId[], terrainId: string | null, n: number) {
  const enabled = ACTIVITIES.filter((a) => acts.includes(a.id))
  const t = terrainId ? y.tx[terrainId] : null
  const pred: DayPred = (s, j) => {
    const d = {
      hi: s.high[j],
      lo: s.low[j],
      dew: s.dew[j],
      precip: s.precip[j],
      wind: s.wind[j],
      depth: t ? t.depth[j - (t.startYear - FIRST_YEAR) * 365] : NaN,
    }
    return enabled.some((a) => a.test(d) === 0)
  }
  return ytdCount(y, w, pred, n)
}

export const isComplete = (y: Ytd) => y.raw.days >= 365

/** Local calendar date a snapshot was taken, for labels (fetchedAt is stored in UTC). */
export const fetchedDay = (y: Ytd) => new Date(y.raw.fetchedAt).toLocaleDateString('en-CA')
/** A snapshot shown because it's current, not because the live fetch failed. */
export const isFreshSnapshot = (y: Ytd) =>
  y.source === 'snapshot' && Date.now() - Date.parse(y.raw.fetchedAt) < SNAPSHOT_FRESH_MS
