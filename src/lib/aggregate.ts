// Everything the dashboard shows, derived from one city's daily series, the
// scored window, and the resolved snow terrain. Counts are means per year.
import type { CitySeries, TerrainSeries } from './data'
import { MD, MONTH_START, doyMonth } from './calendar'
import { ACTIVITIES, RIDE_DEPTH_IN, SEASON_RELIABILITY, type DayInputs, type LossReason } from './activities'
import { BAND, BREACH, causeKind, causeLabel, type ReasonKind, type Scored } from './scoring'
import { FIRST_YEAR, windowYears, type ActivityId, type Window } from './prefs'
import { median, ols, type Fit } from './stats'

export interface Budget {
  counts: [number, number, number]
  perYear: number[]
  trend: Fit
  months: { c: number; t: number; u: number }[]
  reasons: { label: string; pct: number; kind: ReasonKind }[]
  nonComf: number
  compromise: { label: string; pct: number } | null
  bestStreak: number
  unbStreak: number
  worstGap: number
  worstMonth: number
  bestMonth: number
}

export function budget(sc: Scored): Budget {
  const counts = [0, 0, 0]
  let cur = 0,
    gap = 0,
    unb = 0,
    bestStreak = 0,
    worstGap = 0,
    unbStreak = 0
  const perYear: number[] = []
  const months = Array.from({ length: 12 }, () => ({ c: 0, t: 0, u: 0 }))
  const reasons = new Map<number, number>(),
    compro = new Map<number, number>()
  for (let y = 0; y < sc.years; y++) {
    let yc = 0
    for (let d = 0; d < 365; d++) {
      const i = y * 365 + d,
        b = sc.band[i],
        m = months[doyMonth(d)]
      counts[b]++
      if (b === BAND.comf) {
        yc++
        m.c++
        cur++
        gap = 0
        unb = 0
        bestStreak = Math.max(bestStreak, cur)
      } else {
        cur = 0
        gap++
        worstGap = Math.max(worstGap, gap)
        if (b === BAND.tol) {
          m.t++
          unb = 0
        } else {
          m.u++
          unb++
          unbStreak = Math.max(unbStreak, unb)
        }
        // Written-off days count under the full set of bounds they crossed, so
        // "too hot" and "too hot & humid" rank as the distinct climates they are.
        const cause = sc.breach[i] ? BREACH | sc.breach[i] : sc.why[i]
        if (cause) {
          reasons.set(cause, (reasons.get(cause) ?? 0) + 1)
          if (b === BAND.tol) compro.set(cause, (compro.get(cause) ?? 0) + 1)
        }
      }
    }
    perYear.push(yc)
  }
  const k = 1 / sc.years,
    nonComf = counts[1] + counts[2]
  const ranked = [...reasons.entries()].sort((a, b) => b[1] - a[1])
  const cr = [...compro.entries()].sort((a, b) => b[1] - a[1])[0]
  let worstMonth = 0,
    bestMonth = 0
  const share = (m: { c: number }, i: number) => m.c / MD[i]
  months.forEach((m, i) => {
    if (share(m, i) < share(months[worstMonth], worstMonth)) worstMonth = i
    if (share(m, i) > share(months[bestMonth], bestMonth)) bestMonth = i
  })
  return {
    counts: [counts[0] * k, counts[1] * k, counts[2] * k],
    perYear,
    trend: ols(perYear),
    months,
    reasons: ranked
      .slice(0, 4)
      .map(([r, n]) => ({ label: causeLabel(r), pct: Math.round((n / nonComf) * 100), kind: causeKind(r) })),
    nonComf: nonComf * k,
    compromise: cr && counts[1] ? { label: causeLabel(cr[0]), pct: Math.round((cr[1] / counts[1]) * 100) } : null,
    bestStreak,
    unbStreak,
    worstGap,
    worstMonth,
    bestMonth,
  }
}

// ---------- Terrain ----------

export interface TerrainChoice {
  id: string
  driveMin: number
  rideDays: number
}

/** Spec 6.12: within the drive-time stop, the reference with the most snow days over the window. */
export function resolveTerrain(
  cands: { id: string; driveMin: number; series: TerrainSeries }[],
  w: Window,
): TerrainChoice | null {
  let best: TerrainChoice | null = null
  for (const c of cands) {
    const off = (w.from - c.series.startYear) * 365,
      N = windowYears(w) * 365
    let n = 0
    for (let i = 0; i < N; i++) if (c.series.depth[off + i] >= RIDE_DEPTH_IN) n++
    const rideDays = n / windowYears(w)
    if (!best || rideDays > best.rideDays || (rideDays === best.rideDays && c.driveMin < best.driveMin))
      best = { id: c.id, driveMin: c.driveMin, rideDays }
  }
  return best
}

// ---------- Activities ----------

export interface ActivityAgg {
  per: Record<ActivityId, { days: number; lost: number[] }>
  outAny: number
  lost: number[]
  months: number[]
  season: { start: number; end: number; reliable: number } | 'year-round' | null
}

const dayInputs = (s: CitySeries, j: number, depth: Float32Array | null, dj: number): DayInputs => ({
  hi: s.high[j],
  lo: s.low[j],
  dew: s.dew[j],
  precip: s.precip[j],
  wind: s.wind[j],
  depth: depth ? depth[dj] : NaN,
})

export function activities(s: CitySeries, w: Window, acts: ActivityId[], terrain: TerrainSeries | null): ActivityAgg {
  const years = windowYears(w),
    off = (w.from - FIRST_YEAR) * 365
  const tOff = terrain ? (w.from - terrain.startYear) * 365 : 0
  const enabled = ACTIVITIES.filter((a) => acts.includes(a.id))
  const per = Object.fromEntries(
    ACTIVITIES.map((a) => [a.id, { days: 0, lost: [0, 0, 0, 0, 0, 0] }]),
  ) as ActivityAgg['per']
  const lost = [0, 0, 0, 0, 0, 0],
    months = new Array(12).fill(0)
  const walkOk = new Float32Array(365)
  let outAny = 0
  for (let y = 0; y < years; y++) {
    for (let d = 0; d < 365; d++) {
      const i = y * 365 + d,
        inp = dayInputs(s, off + i, terrain?.depth ?? null, tOff + i)
      let any = false,
        firstLoss: LossReason = 0
      for (const a of ACTIVITIES) {
        const r = a.test(inp)
        per[a.id].lost[r]++
        if (r === 0) per[a.id].days++
        if (a.id === 'walk' && r === 0) walkOk[d]++
        if (!enabled.includes(a)) continue
        if (r === 0) any = true
        else if (!firstLoss) firstLoss = r
      }
      if (any) {
        outAny++
        months[doyMonth(d)]++
      } else if (enabled.length) lost[firstLoss]++
    }
  }
  const k = 1 / years
  for (const a of ACTIVITIES) {
    per[a.id].days *= k
    per[a.id].lost = per[a.id].lost.map((v) => v * k)
  }
  return {
    per,
    outAny: outAny * k,
    lost: lost.map((v) => v * k),
    months: months.map((v) => v * k),
    season: outdoorSeason(walkOk, years),
  }
}

function outdoorSeason(walkOk: Float32Array, years: number): ActivityAgg['season'] {
  const ok = new Uint8Array(365)
  for (let d = 0; d < 365; d++) {
    let acc = 0
    for (let k = -3; k <= 3; k++) acc += walkOk[(d + k + 365) % 365]
    ok[d] = acc / (7 * years) >= SEASON_RELIABILITY ? 1 : 0
  }
  if (ok.every((v) => v)) return 'year-round'
  // Longest circular run, so a southern-hemisphere or winter-centred season wraps cleanly.
  let best = 0,
    bestEnd = -1,
    run = 0
  for (let k = 0; k < 730; k++) {
    if (ok[k % 365]) {
      run++
      if (run > best && run <= 365) {
        best = run
        bestEnd = k
      }
    } else run = 0
  }
  if (!best) return null
  return { start: (bestEnd - best + 1) % 365, end: bestEnd % 365, reliable: ok.reduce((a, v) => a + v, 0) }
}

// ---------- Monthly rollup ----------

export interface MonthRow {
  m: number
  hi: number
  lo: number
  rhi: number
  rlo: number
  swing: number
  dew: number
  cloud: number
  precip: number
  snow: number
  sun: number
  over: number | null
  comf: number | null
  out: number
  split: { c: number; t: number; u: number } | null
}

export function monthly(
  s: CitySeries,
  w: Window,
  hardMax: number | null,
  b: Budget | null,
  act: ActivityAgg,
): MonthRow[] {
  const years = windowYears(w),
    off = (w.from - FIRST_YEAR) * 365
  return MD.map((len, m) => {
    let hi = 0,
      lo = 0,
      dew = 0,
      cloud = 0,
      precip = 0,
      snow = 0,
      sun = 0,
      n = 0,
      over = 0,
      rhi = -Infinity,
      rlo = Infinity
    for (let y = 0; y < years; y++) {
      for (let d = MONTH_START[m]; d < MONTH_START[m] + len; d++) {
        const j = off + y * 365 + d
        hi += s.high[j]
        lo += s.low[j]
        dew += s.dew[j]
        cloud += s.cloud[j]
        precip += s.precip[j]
        snow += s.snow[j]
        sun += s.sun[j]
        n++
        rhi = Math.max(rhi, s.high[j])
        rlo = Math.min(rlo, s.low[j])
        if (hardMax !== null && s.high[j] > hardMax) over++
      }
    }
    return {
      m,
      hi: hi / n,
      lo: lo / n,
      rhi,
      rlo,
      swing: (hi - lo) / n,
      dew: dew / n,
      cloud: cloud / n,
      precip: precip / years,
      snow: snow / years,
      sun: sun / n,
      over: hardMax === null ? null : over / years,
      comf: b ? b.months[m].c / years : null,
      out: act.months[m],
      split: b ? b.months[m] : null,
    }
  })
}

// ---------- Threshold counters ----------

export type DayPred = (s: CitySeries, j: number) => boolean

export interface CounterAgg {
  perYear: number[]
  avg: number
  fit: Fit
}

export function counter(s: CitySeries, w: Window, pred: DayPred): CounterAgg {
  const years = windowYears(w),
    off = (w.from - FIRST_YEAR) * 365
  const perYear: number[] = []
  for (let y = 0; y < years; y++) {
    let c = 0
    for (let d = 0; d < 365; d++) if (pred(s, off + y * 365 + d)) c++
    perYear.push(c)
  }
  return { perYear, avg: perYear.reduce((a, b) => a + b, 0) / years, fit: ols(perYear) }
}

/** Mean per year of days matching pred, for arbitrary windows (drift baselines). */
export function perYear(s: CitySeries, w: Window, pred: DayPred): number {
  return counter(s, w, pred).avg
}

// ---------- Seasonality / sky ----------

export interface Facts {
  swing: number
  freezeThaw: number
  clear: number
  partly: number
  overcast: number
  grayStreak: number
  warmNights: number
  snowDays: number
  sunHours: number
  lastFreeze: number | null
  firstFreeze: number | null
  frostFree: number | null
  freezeYears: number
  warmestMonth: number
  coldestMonth: number
  daylight: [number, number]
}

/** Astronomical day length in hours (sunrise-to-sunset, standard −0.83° horizon). */
export function daylightHours(lat: number, doy: number): number {
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 80))
  const phi = (lat * Math.PI) / 180,
    del = (decl * Math.PI) / 180
  const c = (Math.sin((-0.83 * Math.PI) / 180) - Math.sin(phi) * Math.sin(del)) / (Math.cos(phi) * Math.cos(del))
  if (c <= -1) return 24
  if (c >= 1) return 0
  return (2 * Math.acos(c) * 180) / Math.PI / 15
}

export function facts(s: CitySeries, w: Window, lat: number): Facts {
  const years = windowYears(w),
    off = (w.from - FIRST_YEAR) * 365,
    N = years * 365
  let swing = 0,
    ft = 0,
    clear = 0,
    partly = 0,
    overcast = 0,
    gray = 0,
    grayBest = 0,
    warmN = 0,
    snowD = 0,
    sun = 0
  const monthT = new Float64Array(12)
  for (let i = 0; i < N; i++) {
    const j = off + i,
      hi = s.high[j],
      lo = s.low[j],
      cl = s.cloud[j]
    swing += hi - lo
    if (lo <= 32 && hi > 32) ft++
    if (cl <= 20) clear++
    else if (cl >= 80) overcast++
    else partly++
    if (cl >= 80) {
      gray++
      grayBest = Math.max(grayBest, gray)
    } else gray = 0
    if (lo > 60) warmN++
    if (s.snow[j] >= 0.1) snowD++
    sun += s.sun[j]
    monthT[doyMonth(i % 365)] += (hi + lo) / 2
  }
  const mMeans = [...monthT].map((v, m) => v / (MD[m] * years))
  const warmest = mMeans.indexOf(Math.max(...mMeans)),
    coldest = mMeans.indexOf(Math.min(...mMeans))
  // Freeze dates pivot on the middle of the warmest month, so the southern hemisphere works unchanged.
  const pivot = MONTH_START[warmest] + 15
  const last: number[] = [],
    first: number[] = []
  let freezeYears = 0
  for (let y = 0; y < years; y++) {
    let l = -1,
      f = -1
    for (let k = 1; k <= 182; k++) {
      const back = pivot - k,
        yb = y + Math.floor(back / 365)
      if (l < 0 && yb >= 0 && s.low[off + yb * 365 + (((back % 365) + 365) % 365)] <= 32) l = (back + 365) % 365
      const fwd = pivot + k,
        yf = y + Math.floor(fwd / 365)
      if (f < 0 && yf < years && s.low[off + yf * 365 + (fwd % 365)] <= 32) f = fwd % 365
    }
    if (l >= 0 && f >= 0) {
      last.push(l)
      first.push(f)
      freezeYears++
    }
  }
  const half = freezeYears >= years / 2
  const lastFreeze = half ? Math.round(median(last)) : null
  const firstFreeze = half ? Math.round(median(first)) : null
  let dMin = 24,
    dMax = 0
  for (let d = 0; d < 365; d += 1) {
    const h = daylightHours(lat, d)
    dMin = Math.min(dMin, h)
    dMax = Math.max(dMax, h)
  }
  return {
    swing: swing / N,
    freezeThaw: ft / years,
    clear: clear / years,
    partly: partly / years,
    overcast: overcast / years,
    grayStreak: grayBest,
    warmNights: warmN / years,
    snowDays: snowD / years,
    sunHours: sun / years,
    lastFreeze,
    firstFreeze,
    frostFree: lastFreeze !== null && firstFreeze !== null ? (firstFreeze - lastFreeze + 365) % 365 : null,
    freezeYears,
    warmestMonth: warmest,
    coldestMonth: coldest,
    daylight: [dMin, dMax],
  }
}

export function monthMeanHigh(s: CitySeries, w: Window, m: number): number {
  const years = windowYears(w),
    off = (w.from - FIRST_YEAR) * 365
  let acc = 0
  for (let y = 0; y < years; y++) for (let d = 0; d < MD[m]; d++) acc += s.high[off + y * 365 + MONTH_START[m] + d]
  return acc / (years * MD[m])
}
export function monthMeanLow(s: CitySeries, w: Window, m: number): number {
  const years = windowYears(w),
    off = (w.from - FIRST_YEAR) * 365
  let acc = 0
  for (let y = 0; y < years; y++) for (let d = 0; d < MD[m]; d++) acc += s.low[off + y * 365 + MONTH_START[m] + d]
  return acc / (years * MD[m])
}

export function terrainCover(t: TerrainSeries, w: Window, minDepth: number): number {
  const off = (w.from - t.startYear) * 365,
    years = windowYears(w)
  let n = 0
  for (let i = 0; i < years * 365; i++) if (t.depth[off + i] >= minDepth) n++
  return n / years
}
