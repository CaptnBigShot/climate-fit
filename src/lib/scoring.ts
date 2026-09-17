// Per-day comfort scoring. Pure functions over typed arrays so the whole window
// re-scores in a few milliseconds while a control-bar handle is being dragged.
import type { CitySeries } from './data'
import { doyMonth } from './calendar'
import { CUTOFF, FIRST_YEAR, WEIGHT_VALUE, hasPreference, windowYears, type Prefs, type Window } from './prefs'

export const BAND = { comf: 0, tol: 1, unb: 2 } as const

// Published constants — every one of these is listed in Data & Methods.
/** Width of the soft ramp beyond an ideal edge whose hard bound is open (°F, %, mph, in). */
export const SOFT = { temp: 30, dew: 15, cloud: 40, wind: 15, precip: 0.5 }
/** In-sun mode: °F added to the daytime temperature per MJ/m² of daily shortwave radiation. */
export const SUN_F_PER_MJ = 0.45
export const CLOUD_OVERCAST_IDEAL = 60
export const CLOUD_CLEAR_IDEAL = 40
export const DRY_IDEAL = 0.02
/** Days over which the cold- and warm-season bands blend at each season boundary. */
export const SEASON_BLEND_DAYS = 31

/** Soft shortfalls, as bare adjectives and clauses so a pair reads under one "too" —
 *  the same grammar the breach labels use. */
const SOFT_ADJ: Record<number, string> = {
  1: 'warm',
  2: 'cold',
  5: 'humid',
  6: 'clear',
  7: 'cloudy',
  8: 'windy',
  9: 'wet',
}
const SOFT_CLAUSE: Record<number, string> = { 3: 'warm nights', 4: 'cold nights' }

/** A tolerable day names a second shortfall when it cost at least this much of what the
 *  first did. Around a third of tolerable days have one: filing them all under whichever
 *  deficit merely edged out splits "warm and humid" across two unrelated rows. */
export const SOFT_PAIR = 0.5

const softLabel = (r1: number, r2: number): string => {
  const rs = [r1, r2].filter((r) => r > 0)
  const adj = rs.filter((r) => SOFT_ADJ[r]).map((r) => SOFT_ADJ[r])
  const parts = adj.length ? [`too ${adj.join(' & ')}`] : []
  for (const r of rs) if (SOFT_CLAUSE[r]) parts.push(SOFT_CLAUSE[r])
  return parts.join(' · ')
}

/** Single-cause soft labels, derived so there is one source of truth for the wording. */
export const REASONS: readonly string[] = Array.from({ length: 10 }, (_, r) => (r ? softLabel(r, 0) : ''))

const R = {
  warm: 1,
  cold: 2,
  warmNight: 3,
  coldNight: 4,
  dew: 5,
  clear: 6,
  cloudy: 7,
  wind: 8,
  wet: 9,
}

/** Breach flags. A written-off day records every bound it crossed, not just the first —
 *  90%+ of Miami's over-ceiling days are also over the dew limit while only 19% of
 *  Phoenix's are, and collapsing both to "too hot" hides the distinction that matters. */
export const B = {
  hot: 1,
  cold: 2,
  humid: 4,
  hotNight: 8,
  coldNight: 16,
  cloud: 32,
  wind: 64,
  wet: 128,
  /** Feels-like basis only: the ceiling fell to humidity as much as to heat — the air
   *  temperature on its own would have passed. Miami's air never reaches 95°F, yet a 95°F
   *  feels-like ceiling writes off 1,672 days there. Labelled the same as a day that crossed
   *  the temperature and dew-point limits separately, because it is the same weather: which
   *  control noticed the humidity is not something the reader should have to care about. */
  humidHeat: 256,
  /** Feels-like basis only: the floor fell to wind chill, not to cold air alone. */
  windChill: 512,
} as const
/** Adjectives that share one "too"; order fixes how a combination reads. */
const ADJECTIVES: [number, string][] = [
  [B.hot, 'hot'],
  [B.cold, 'cold'],
  [B.humidHeat, 'hot & humid'],
  [B.windChill, 'cold & windy'],
  [B.humid, 'humid'],
]
const CLAUSES: [number, string][] = [
  [B.hotNight, 'hot nights'],
  [B.coldNight, 'cold nights'],
  [B.cloud, 'cloud'],
  [B.wind, 'wind'],
  [B.wet, 'precip'],
]
/** Every hard limit reads the same way, whether it was drawn on a control-bar slider or
 *  toggled in More controls — one vocabulary, because a written-off day is a written-off
 *  day. The suffix is what separates "too hot" (tolerable) from "too hot · deal-breaker". */
export const DEAL = 'deal-breaker'

/** A cause code: a soft-shortfall index into REASONS, or BREACH | a mask of B flags.
 *  The tag keeps the two spaces from colliding when both are counted in one map. */
export type Cause = number
export const BREACH = 4096

export const causeLabel = (c: Cause): string => {
  if (!(c & BREACH)) return softLabel(c & 15, (c >> 4) & 15)
  // humidHeat already reads "hot & humid"; the dew-limit bit would say humid twice.
  const m = c & B.humidHeat ? c & ~B.humid : c
  const adj = ADJECTIVES.filter(([b]) => m & b).map(([, l]) => l)
  const parts = adj.length ? [`too ${adj.join(' & ')}`] : []
  for (const [b, l] of CLAUSES) if (m & b) parts.push(l)
  parts.push(DEAL)
  return parts.join(' · ')
}

/** The measurements that explain a cause — what a tooltip quotes numbers for. */
export type CauseVar = 'temp' | 'low' | 'dew' | 'cloud' | 'wind' | 'precip'
/** Indexed by REASONS: which measurement a soft shortfall is about. */
const SOFT_VAR: CauseVar[] = ['temp', 'temp', 'temp', 'low', 'low', 'dew', 'cloud', 'cloud', 'wind', 'precip']

export function causeVars(c: Cause): CauseVar[] {
  if (!(c & BREACH)) {
    const v = new Set<CauseVar>()
    for (const r of [c & 15, (c >> 4) & 15]) if (r && SOFT_VAR[r]) v.add(SOFT_VAR[r])
    return [...v]
  }
  const v = new Set<CauseVar>()
  if (c & (B.hot | B.cold | B.humidHeat | B.windChill)) v.add('temp')
  if (c & (B.hotNight | B.coldNight)) v.add('low')
  if (c & (B.humid | B.humidHeat)) v.add('dew')
  // Wind explains a wind-chill breach as much as the temperature does.
  if (c & (B.wind | B.windChill)) v.add('wind')
  if (c & B.cloud) v.add('cloud')
  if (c & B.wet) v.add('precip')
  return [...v]
}

/** The soft reason inside a cause that concerns one measurement, or 0. A cause can pack two
 *  reasons, so "which direction did this variable go" cannot be read off the code itself. */
export const softReasonFor = (c: Cause, v: CauseVar): number => {
  if (c & BREACH) return 0
  for (const r of [c & 15, (c >> 4) & 15]) if (r && SOFT_VAR[r] === v) return r
  return 0
}

/** True when a soft temperature reason means "above the ideal edge" rather than below. */
export const softIsUpper = (r: number): boolean => r === R.warm || r === R.warmNight

/** The cause code for one scored day: a breach mask, or up to two soft reasons packed one
 *  per nibble, smaller index first so the same pair always yields the same code and label. */
export const dayCause = (sc: Scored, i: number): Cause => {
  if (sc.breach[i]) return BREACH | sc.breach[i]
  const a = sc.why[i],
    b = sc.why2[i]
  return b ? Math.min(a, b) | (Math.max(a, b) << 4) : a
}

/** Soft shortfalls only ever explain tolerable days, deal-breakers only unbearable ones —
 *  so each cause belongs to exactly one band. */
export type ReasonKind = 'soft' | 'deal'
export const causeKind = (c: Cause): ReasonKind => (c & BREACH ? 'deal' : 'soft')

export interface Scored {
  window: Window
  years: number
  /** Index of the window's first day in the archive series. */
  off: number
  band: Uint8Array
  score: Float32Array
  /** Worst soft-shortfall reason, 0 on comfortable and on written-off days (see `breach`). */
  why: Uint8Array
  /** Runner-up soft shortfall when it cost at least SOFT_PAIR of the worst; 0 otherwise. */
  why2: Uint8Array
  /** Mask of every B flag the day tripped; 0 unless the day was written off. */
  breach: Uint16Array
  /** Warm-season weight per day of year (0 = cold-season band, 1 = warm-season band). */
  warmW: Float32Array
}

const OUT = -1

/** Four-point ramp: 1 inside ideal, linear to 0 at a hard bound, OUT beyond it.
 *  An open hard bound (null) never disqualifies; the score instead fades over a
 *  soft span, so the day is never free but never written off. */
export function ramp(
  v: number,
  hardMin: number | null,
  idealMin: number | null,
  idealMax: number | null,
  hardMax: number | null,
  soft: number,
): number {
  if (hardMax !== null && v > hardMax) return OUT
  if (hardMin !== null && v < hardMin) return OUT
  if (idealMax !== null && v > idealMax) {
    if (hardMax === null) return Math.max(0, 1 - (v - idealMax) / soft)
    return hardMax > idealMax ? (hardMax - v) / (hardMax - idealMax) : 0
  }
  if (idealMin !== null && v < idealMin) {
    if (hardMin === null) return Math.max(0, 1 - (idealMin - v) / soft)
    return idealMin > hardMin ? (v - hardMin) / (idealMin - hardMin) : 0
  }
  return 1
}

/** Relative humidity from temperature and dew point, both °F (Magnus). */
export function relHumidity(tF: number, dF: number): number {
  const t = ((tF - 32) * 5) / 9,
    d = ((dF - 32) * 5) / 9
  return 100 * Math.exp((17.625 * d) / (243.04 + d) - (17.625 * t) / (243.04 + t))
}

/** Apparent temperature, °F: NWS heat index at ≥80°F, NWS wind chill at ≤50°F with wind ≥3 mph, else air temperature. */
export function apparent(tF: number, dewF: number, windMph: number): number {
  if (tF >= 80) {
    const rh = Math.min(100, relHumidity(tF, dewF))
    const simple = 0.5 * (tF + 61 + (tF - 68) * 1.2 + rh * 0.094)
    if (simple < 80) return simple
    return (
      -42.379 +
      2.04901523 * tF +
      10.14333127 * rh -
      0.22475541 * tF * rh -
      0.00683783 * tF * tF -
      0.05481717 * rh * rh +
      0.00122874 * tF * tF * rh +
      0.00085282 * tF * rh * rh -
      0.00000199 * tF * tF * rh * rh
    )
  }
  if (tF <= 50 && windMph >= 3) {
    const v = windMph ** 0.16
    return 35.74 + 0.6215 * tF - 35.75 * v + 0.4275 * tF * v
  }
  return tF
}

/** Warm-season weight per day of year, derived from the city's own data over the window:
 *  the six warmest months (by mean temperature) are warm season, the six coolest cold.
 *  Hemisphere-agnostic. Boundaries blend linearly over SEASON_BLEND_DAYS. */
export function seasonWeights(s: CitySeries, w: Window): { warmW: Float32Array; warmMonths: boolean[] } {
  const off = (w.from - FIRST_YEAR) * 365,
    years = windowYears(w)
  const sum = new Float64Array(12),
    n = new Float64Array(12)
  for (let y = 0; y < years; y++) {
    for (let d = 0; d < 365; d++) {
      const j = off + y * 365 + d,
        v = (s.high[j] + s.low[j]) / 2
      if (Number.isNaN(v)) continue
      const m = doyMonth(d)
      sum[m] += v
      n[m]++
    }
  }
  const order = [...Array(12).keys()].sort((a, b) => sum[b] / n[b] - sum[a] / n[a])
  const warmMonths = Array.from({ length: 12 }, (_, m) => order.indexOf(m) < 6)
  const member = Float32Array.from({ length: 365 }, (_, d) => (warmMonths[doyMonth(d)] ? 1 : 0))
  const half = (SEASON_BLEND_DAYS - 1) / 2
  const warmW = new Float32Array(365)
  for (let d = 0; d < 365; d++) {
    let acc = 0
    for (let k = -half; k <= half; k++) acc += member[(d + k + 365) % 365]
    warmW[d] = acc / SEASON_BLEND_DAYS
  }
  return { warmW, warmMonths }
}

/** Ideal band in force on a given day of year (seasonal bands blend by warm weight). */
export function idealFor(p: Prefs, warmW: number): [number, number] {
  const t = p.temp!
  if (!p.seasonal) return [t.idealMin, t.idealMax]
  return [
    p.cold.idealMin + (t.idealMin - p.cold.idealMin) * warmW,
    p.cold.idealMax + (t.idealMax - p.cold.idealMax) * warmW,
  ]
}

/** The day's plain air temperature under the same shift and sun load — what the score would
 *  have compared against had the basis not been feels-like. Used only to attribute a breach. */
export function airTemp(s: CitySeries, j: number, p: Prefs, shift = 0): number {
  return s.high[j] + shift + (p.sun === 'sun' ? SUN_F_PER_MJ * (s.rad[j] || 0) : 0)
}

/** Temperature the score uses for the day's daytime reading, °F. `shift` adds uniform warming. */
export function dayTemp(s: CitySeries, j: number, p: Prefs, shift = 0): number {
  const sun = p.sun === 'sun' ? SUN_F_PER_MJ * (s.rad[j] || 0) : 0
  if (p.basis === 'apparent') return apparent(s.high[j] + shift, s.dew[j] + shift, s.wind[j]) + sun
  if (p.basis === 'low') return s.low[j] + shift
  return s.high[j] + shift + sun
}

/** Score every day in the window. `shift` (°F) warms highs, lows and dew point uniformly —
 *  used only by the "what would have to change" inverse query. `warmOverride` supplies
 *  season weights from another window (for the partial current year). */
export function score(s: CitySeries, p: Prefs, w: Window, shift = 0, warmOverride?: Float32Array): Scored | null {
  if (!hasPreference(p)) return null
  const years = windowYears(w),
    N = years * 365,
    off = (w.from - FIRST_YEAR) * 365
  const cut = CUTOFF[p.strict]
  const band = new Uint8Array(N),
    sc = new Float32Array(N),
    why = new Uint8Array(N),
    why2 = new Uint8Array(N),
    breach = new Uint16Array(N)
  // A partial year can't define its own seasons; callers scoring one pass the window's.
  const warmW = warmOverride ?? seasonWeights(s, w).warmW
  const t = p.temp
  const wt = {
    temp: WEIGHT_VALUE[p.weights.temp],
    dew: WEIGHT_VALUE[p.weights.dew],
    cloud: WEIGHT_VALUE[p.weights.cloud],
    wind: WEIGHT_VALUE[p.weights.wind],
    precip: WEIGHT_VALUE[p.weights.precip],
  }
  const both = p.basis === 'both'
  const cloudIdealMin = p.cloud === 'overcast' ? CLOUD_OVERCAST_IDEAL : null
  const cloudIdealMax = p.cloud === 'clear' ? CLOUD_CLEAR_IDEAL : null

  for (let i = 0; i < N; i++) {
    const j = off + i,
      doy = i % 365
    let wsum = 0,
      acc = 0,
      mask = 0,
      worst = 0,
      worstDef = -1,
      second = 0,
      secondDef = -1
    const take = (r: number, weight: number, reason: number) => {
      wsum += weight
      acc += weight * r
      if (r >= 1) return
      const def = weight * (1 - r)
      if (def > worstDef) {
        second = worst
        secondDef = worstDef
        worstDef = def
        worst = reason
      } else if (def > secondDef) {
        secondDef = def
        second = reason
      }
    }

    if (t) {
      const [iMin, iMax] = idealFor(p, warmW[doy])
      const v = dayTemp(s, j, p, shift)
      const r = ramp(v, t.hardMin, iMin, iMax, t.hardMax, SOFT.temp)
      const low = p.basis === 'low'
      const over = (x: number) => t.hardMax !== null && x > t.hardMax
      if (r === OUT) {
        if (over(v)) {
          // On the feels-like basis humidity is hidden inside the temperature. Re-check the
          // air alone: if it would have passed, the humidity broke the ceiling, not the heat.
          mask |= p.basis === 'apparent' && !over(airTemp(s, j, p, shift)) ? B.humidHeat : B.hot
        } else {
          // Same on the cold side, where wind chill is what the air hides.
          const air = airTemp(s, j, p, shift)
          mask |= p.basis === 'apparent' && !(t.hardMin !== null && air < t.hardMin) ? B.windChill : B.cold
        }
      }
      if (both) {
        const lo = s.low[j] + shift
        const rl = ramp(lo, t.hardMin, iMin, iMax, t.hardMax, SOFT.temp)
        if (rl === OUT) mask |= over(lo) ? B.hotNight : B.coldNight
        else if (r !== OUT) {
          const rMin = Math.min(r, rl),
            lowWorse = rl < r
          take(rMin, wt.temp, lowWorse ? (lo > iMax ? R.warmNight : R.coldNight) : v > iMax ? R.warm : R.cold)
        }
      } else if (r !== OUT) take(r, wt.temp, low ? (v > iMax ? R.warmNight : R.coldNight) : v > iMax ? R.warm : R.cold)
    }
    if (p.dew) {
      const r = ramp(s.dew[j] + shift, null, null, p.dew.idealMax, p.dew.hardMax, SOFT.dew)
      if (r === OUT) mask |= B.humid
      else take(r, wt.dew, R.dew)
    }
    if (p.cloud !== 'any') {
      const deal = p.deal.cloud
      const hMin = cloudIdealMin !== null && deal ? cloudIdealMin - SOFT.cloud : null
      const hMax = cloudIdealMax !== null && deal ? cloudIdealMax + SOFT.cloud : null
      const r = ramp(s.cloud[j], hMin, cloudIdealMin, cloudIdealMax, hMax, SOFT.cloud)
      if (r === OUT) mask |= B.cloud
      else take(r, wt.cloud, p.cloud === 'overcast' ? R.clear : R.cloudy)
    }
    if (p.windMax !== null) {
      const r = ramp(s.wind[j], null, null, p.windMax, p.deal.wind ? p.windMax + SOFT.wind : null, SOFT.wind)
      if (r === OUT) mask |= B.wind
      else take(r, wt.wind, R.wind)
    }
    if (p.dry) {
      const r = ramp(s.precip[j], null, null, DRY_IDEAL, p.deal.precip ? DRY_IDEAL + SOFT.precip : null, SOFT.precip)
      if (r === OUT) mask |= B.wet
      else take(r, wt.precip, R.wet)
    }

    if (mask) {
      band[i] = BAND.unb
      sc[i] = 0
      breach[i] = mask
    } else {
      const v = wsum ? (acc / wsum) * 100 : 100
      sc[i] = v
      band[i] = v >= cut ? BAND.comf : BAND.tol
      if (band[i] !== BAND.comf) {
        why[i] = worst
        if (second && secondDef >= SOFT_PAIR * worstDef) why2[i] = second
      }
    }
  }
  return { window: w, years, off, band, score: sc, why, why2, breach, warmW }
}
