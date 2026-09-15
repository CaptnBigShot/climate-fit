// Spec section 5 — additional features. Pure functions, like aggregate.ts.
import type { CitySeries, HourlySeries } from './data'
import { MD, MONTH_START, doyMonth } from './calendar'
import { BAND, score, type Scored } from './scoring'
import { FIRST_YEAR, LAST_YEAR, windowYears, type Prefs, type Window } from './prefs'
import { daylightHours } from './aggregate'
import { ols, quantileSorted, type Fit } from './stats'

// ---------- 5.1 / 5.2 Best time to visit · worst two weeks ----------

export interface DateSpan {
  start: number
  len: number
  score: number
  comf: number
  unb: number
}

/** Mean fit score (unbearable = 0) and band shares for every `len`-day span of the
 *  year, across all years in the window. Spans wrap across New Year. */
export function spans(sc: Scored, len: number) {
  const sum = new Float64Array(365),
    comf = new Float64Array(365),
    unb = new Float64Array(365)
  for (let i = 0; i < sc.band.length; i++) {
    const d = i % 365
    sum[d] += sc.band[i] === BAND.unb ? 0 : sc.score[i]
    if (sc.band[i] === BAND.comf) comf[d]++
    if (sc.band[i] === BAND.unb) unb[d]++
  }
  const n = sc.years * len
  const out: DateSpan[] = []
  for (let s0 = 0; s0 < 365; s0++) {
    let a = 0,
      c = 0,
      u = 0
    for (let k = 0; k < len; k++) {
      const d = (s0 + k) % 365
      a += sum[d]
      c += comf[d]
      u += unb[d]
    }
    out.push({ start: s0, len, score: a / n, comf: c / n, unb: u / n })
  }
  return out
}

const overlaps = (a: DateSpan, b: DateSpan) => {
  const d = Math.abs(a.start - b.start)
  return Math.min(d, 365 - d) < a.len
}

/** Top `n` non-overlapping spans by comfortable share, then mean score. */
export function bestSpans(all: DateSpan[], n: number): DateSpan[] {
  const sorted = [...all].sort((a, b) => b.comf - a.comf || b.score - a.score)
  const picked: DateSpan[] = []
  for (const sp of sorted) {
    if (picked.every((p) => !overlaps(p, sp))) picked.push(sp)
    if (picked.length === n) break
  }
  return picked
}

/** The span with the most unbearable days, then the lowest mean score. */
export function worstSpan(all: DateSpan[]): DateSpan {
  return [...all].sort((a, b) => b.unb - a.unb || a.score - b.score)[0]
}

// ---------- 5.6 Annotated extremes ----------

export interface Extreme {
  label: string
  value: number
  kind: 'temp' | 'len' | 'speed' | 'delta'
  index: number
}

export function extremes(s: CitySeries, w: Window): Extreme[] {
  const off = (w.from - FIRST_YEAR) * 365,
    N = windowYears(w) * 365
  const find = (f: (j: number) => number, max: boolean) => {
    let bi = 0,
      bv = max ? -Infinity : Infinity
    for (let i = 0; i < N; i++) {
      const v = f(off + i)
      if (max ? v > bv : v < bv) {
        bv = v
        bi = i
      }
    }
    return { value: bv, index: bi }
  }
  return [
    { label: 'Hottest day (daily high)', kind: 'temp', ...find((j) => s.high[j], true) },
    { label: 'Coldest night (daily low)', kind: 'temp', ...find((j) => s.low[j], false) },
    { label: 'Coldest day (daily high)', kind: 'temp', ...find((j) => s.high[j], false) },
    { label: 'Warmest night (daily low)', kind: 'temp', ...find((j) => s.low[j], true) },
    { label: 'Most humid (dew point)', kind: 'temp', ...find((j) => s.dew[j], true) },
    { label: 'Biggest day–night swing', kind: 'delta', ...find((j) => s.high[j] - s.low[j], true) },
    { label: 'Wettest day (precipitation)', kind: 'len', ...find((j) => s.precip[j], true) },
    { label: 'Snowiest day (snowfall)', kind: 'len', ...find((j) => s.snow[j], true) },
    { label: 'Windiest day (max wind)', kind: 'speed', ...find((j) => s.wind[j], true) },
  ]
}

// ---------- 5.4 Mosquito proxy ----------

/** Rough proxy, not an observation: overnight low ≥ 50°F (warm all day) and mean dew point ≥ 55°F. */
export const MOSQUITO_LOW_F = 50
export const MOSQUITO_DEW_F = 55
export const isMosquitoDay = (s: CitySeries, j: number) => s.low[j] >= MOSQUITO_LOW_F && s.dew[j] >= MOSQUITO_DEW_F

export interface Mosquito {
  perYear: number[]
  avg: number
  fit: Fit
  months: number[]
}

export function mosquito(s: CitySeries, w: Window): Mosquito {
  const years = windowYears(w),
    off = (w.from - FIRST_YEAR) * 365
  const perYear: number[] = [],
    months = new Array(12).fill(0)
  for (let y = 0; y < years; y++) {
    let c = 0
    for (let d = 0; d < 365; d++)
      if (isMosquitoDay(s, off + y * 365 + d)) {
        c++
        months[doyMonth(d)]++
      }
    perYear.push(c)
  }
  return {
    perYear,
    avg: perYear.reduce((a, b) => a + b, 0) / years,
    fit: ols(perYear),
    months: months.map((m) => m / years),
  }
}

// ---------- 5.7 What would have to change ----------

export const SHIFTS = [-4, -2, 0, 2, 4, 6, 8, 10, 12]

export interface Sensitivity {
  shift: number
  comf: number
  unb: number
}

/** Day budget under uniform warming of highs, lows and dew point by each shift (°F). */
export function sensitivity(s: CitySeries, p: Prefs, w: Window): Sensitivity[] {
  return SHIFTS.map((shift) => {
    const sc = score(s, p, w, shift)!
    let c = 0,
      u = 0
    for (let i = 0; i < sc.band.length; i++) {
      if (sc.band[i] === BAND.comf) c++
      else if (sc.band[i] === BAND.unb) u++
    }
    return { shift, comf: c / sc.years, unb: u / sc.years }
  })
}

/** First warming (°F, linearly interpolated between sampled shifts) at which comfortable days fall below target. */
export function crossing(sens: Sensitivity[], target: number): number | null {
  const pos = sens.filter((x) => x.shift >= 0)
  if (pos[0].comf < target) return 0
  for (let i = 1; i < pos.length; i++) {
    const a = pos[i - 1],
      b = pos[i]
    if (b.comf < target) return a.shift + ((a.comf - target) / (a.comf - b.comf)) * (b.shift - a.shift)
  }
  return null
}

/** OLS on annual mean temperature over the whole archive. */
export function warmingTrend(s: CitySeries): Fit & { from: number; to: number } {
  const ys: number[] = []
  for (let y = 0; y < s.years; y++) {
    let acc = 0
    for (let d = 0; d < 365; d++) {
      const j = y * 365 + d
      acc += (s.high[j] + s.low[j]) / 2
    }
    ys.push(acc / 365)
  }
  return { ...ols(ys), from: s.startYear, to: s.startYear + s.years - 1 }
}

export const yearAt = (deltaF: number, slopeFPerYear: number) =>
  slopeFPerYear > 0 ? Math.round(LAST_YEAR + deltaF / slopeFPerYear) : null

// ---------- 5.5 Typical day profile ----------

export interface DayProfile {
  p10: number[]
  p25: number[]
  p50: number[]
  p75: number[]
  p90: number[]
  years: [number, number] | null
  days: number
}

/** Hour-of-day distribution for one month, over the years where the window and the hourly tier overlap. */
export function typicalDay(h: HourlySeries, month: number, w: Window): DayProfile {
  const y0 = Math.max(w.from, h.startYear),
    y1 = Math.min(w.to, h.startYear + h.years - 1)
  const empty = { p10: [], p25: [], p50: [], p75: [], p90: [], years: null, days: 0 }
  if (y0 > y1) return empty
  const cols: number[][] = Array.from({ length: 24 }, () => [])
  for (let y = y0; y <= y1; y++) {
    const base = (y - h.startYear) * 365
    for (let d = MONTH_START[month]; d < MONTH_START[month] + MD[month]; d++) {
      for (let hr = 0; hr < 24; hr++) cols[hr].push(h.temp[(base + d) * 24 + hr] / 10)
    }
  }
  const q = (k: number) => cols.map((c) => quantileSorted(c, k))
  cols.forEach((c) => c.sort((a, b) => a - b))
  return { p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), years: [y0, y1], days: cols[0].length }
}

/** Minutes east of UTC for a named zone on a date, via Intl (handles DST). */
export function tzOffsetMin(timeZone: string, date: Date): number {
  const s =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(s)
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] ?? 0)) : 0
}

/** Local clock sunrise and sunset (fractional hours) at mid-month. */
export function sunTimes(
  lat: number,
  lon: number,
  timeZone: string,
  month: number,
): { rise: number; set: number } | null {
  const doy = MONTH_START[month] + 14
  const dl = daylightHours(lat, doy)
  if (dl <= 0 || dl >= 24) return null
  const B = (2 * Math.PI * (doy - 81)) / 364
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B)
  const offset = tzOffsetMin(timeZone, new Date(Date.UTC(LAST_YEAR, month, 15, 12)))
  const noon = (720 - 4 * lon - eot + offset) / 60
  return { rise: noon - dl / 2, set: noon + dl / 2 }
}

// ---------- 3.5 Month × year matrix ----------

export function monthYearMatrix(s: CitySeries, w: Window, pred: (s: CitySeries, j: number) => boolean): number[][] {
  const off = (w.from - FIRST_YEAR) * 365
  return Array.from({ length: windowYears(w) }, (_, y) =>
    MD.map((len, m) => {
      let c = 0
      for (let d = MONTH_START[m]; d < MONTH_START[m] + len; d++) if (pred(s, off + y * 365 + d)) c++
      return c
    }),
  )
}
