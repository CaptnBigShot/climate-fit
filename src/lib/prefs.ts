// Session state. There are no accounts: every preference lives here and is
// mirrored into the URL, so a bookmark saves the session and a link shares it.
import { ARCHIVE } from './data'

export type Strictness = 'lenient' | 'standard' | 'strict'
export type Basis = 'high' | 'low' | 'apparent' | 'both'
export type Weight = 'minor' | 'normal' | 'critical'
export type CloudPref = 'any' | 'clear' | 'overcast'
export type ActivityId = 'walk' | 'run' | 'ride'
export type CounterMetric = 'high' | 'low' | 'dew' | 'cloud' | 'precip' | 'snow' | 'wind'
export type CounterOp = 'ge' | 'le'

/** Four-point ramp. null on a hard bound = open-ended ("colder is never unbearable"). */
export interface TempBand {
  hardMin: number | null
  idealMin: number
  idealMax: number
  hardMax: number | null
}
export interface Window {
  from: number
  to: number
}
export interface CustomCounter {
  m1: CounterMetric
  op1: CounterOp
  v1: number
  m2: CounterMetric | null
  op2: CounterOp
  v2: number
}

export interface Prefs {
  /** null = unset: the dashboard shows raw climate data and scores nothing. */
  temp: TempBand | null
  seasonal: boolean
  /** Cold-season ideal band; the main band becomes the warm-season band when seasonal is on. */
  cold: { idealMin: number; idealMax: number }
  dewMax: number | null
  strict: Strictness
  drive: 1 | 2 | 3
  window: Window
  sun: 'shade' | 'sun'
  metric: boolean
  basis: Basis
  cloud: CloudPref
  windMax: number | null
  dry: boolean
  weights: Record<WeightedVar, Weight>
  deal: Record<DealVar, boolean>
  acts: ActivityId[]
  counters: CustomCounter[]
}
export type WeightedVar = 'temp' | 'dew' | 'cloud' | 'wind' | 'precip'
export type DealVar = 'cloud' | 'wind' | 'precip'

export const LAST_YEAR = ARCHIVE.endYear
export const FIRST_YEAR = ARCHIVE.startYear
export const LOOKBACKS = [3, 5, 7, 10, 15, 20, 30]
export const ALL_ACTS: ActivityId[] = ['walk', 'run', 'ride']
export const CUTOFF: Record<Strictness, number> = { lenient: 75, standard: 85, strict: 95 }
export const WEIGHT_VALUE: Record<Weight, number> = { minor: 0.5, normal: 1, critical: 2 }
/** Temperature slider scale, °F. */
export const T_MIN = -30
export const T_MAX = 110

export const lookbackWindow = (n: number): Window => ({ from: LAST_YEAR - n + 1, to: LAST_YEAR })
export const windowYears = (w: Window) => w.to - w.from + 1
export const windowLabel = (w: Window) => `${w.from}–${w.to}`

export const DEFAULT_PREFS: Prefs = {
  temp: null,
  seasonal: false,
  cold: { idealMin: 20, idealMax: 45 },
  dewMax: null,
  strict: 'standard',
  drive: 2,
  window: lookbackWindow(10),
  sun: 'shade',
  metric: false,
  basis: 'high',
  cloud: 'any',
  windMax: null,
  dry: false,
  weights: { temp: 'normal', dew: 'normal', cloud: 'normal', wind: 'normal', precip: 'normal' },
  deal: { cloud: false, wind: false, precip: false },
  acts: ALL_ACTS,
  counters: [],
}

export interface Preset {
  name: string
  apply: Partial<Prefs>
}

/** Alphabetical, never warm-first. presetNote() prints every value a preset sets —
 *  nothing is set on the user's behalf that isn't shown next to its name. */
export const PRESETS: Preset[] = [
  {
    name: 'Cold & Dry',
    apply: {
      temp: { hardMin: null, idealMin: 20, idealMax: 45, hardMax: 60 },
      seasonal: false,
      dewMax: 35,
      cloud: 'any',
      dry: true,
    },
  },
  {
    name: 'Cool & Overcast',
    apply: {
      temp: { hardMin: 25, idealMin: 45, idealMax: 62, hardMax: 72 },
      seasonal: false,
      dewMax: 50,
      cloud: 'overcast',
      dry: false,
    },
  },
  {
    name: 'Four True Seasons',
    apply: {
      temp: { hardMin: -10, idealMin: 68, idealMax: 84, hardMax: 95 },
      seasonal: true,
      cold: { idealMin: 20, idealMax: 40 },
      dewMax: 62,
      cloud: 'any',
      dry: false,
    },
  },
  {
    name: 'Mild Year-Round',
    apply: {
      temp: { hardMin: 40, idealMin: 60, idealMax: 75, hardMax: 88 },
      seasonal: false,
      dewMax: 58,
      cloud: 'any',
      dry: false,
    },
  },
  {
    name: 'Snow Seeker',
    apply: {
      temp: { hardMin: null, idealMin: 55, idealMax: 75, hardMax: 85 },
      seasonal: true,
      cold: { idealMin: 15, idealMax: 32 },
      dewMax: 55,
      cloud: 'any',
      dry: false,
    },
  },
  {
    name: 'Warm & Dry',
    apply: {
      temp: { hardMin: 55, idealMin: 78, idealMax: 92, hardMax: 105 },
      seasonal: false,
      dewMax: 50,
      cloud: 'clear',
      dry: true,
    },
  },
  {
    name: 'Warm & Humid',
    apply: {
      temp: { hardMin: 60, idealMin: 80, idealMax: 90, hardMax: 98 },
      seasonal: false,
      dewMax: 72,
      cloud: 'any',
      dry: false,
    },
  },
]

/** The spec's reference state: cold-preferring, seasonal, outdoor-active. */
export const EXAMPLE_STATE: Partial<Prefs> = {
  temp: { hardMin: null, idealMin: 35, idealMax: 58, hardMax: 68 },
  seasonal: true,
  cold: { idealMin: 25, idealMax: 48 },
  dewMax: 45,
  cloud: 'overcast',
  drive: 2,
  acts: ['walk', 'ride'],
}

// ---------- URL encoding ----------

const num = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined || s === '' || s === 'inf' || s === '-inf') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}
const openNum = (v: number | null, neg: boolean) => (v === null ? (neg ? '-inf' : 'inf') : String(v))
const WEIGHT_CODE: Record<Weight, string> = { minor: 'm', normal: 'n', critical: 'c' }
const METRICS: CounterMetric[] = ['high', 'low', 'dew', 'cloud', 'precip', 'snow', 'wind']

export function encodePrefs(p: Prefs, q: URLSearchParams) {
  const d = DEFAULT_PREFS
  if (p.temp)
    q.set(
      'b',
      [openNum(p.temp.hardMin, true), p.temp.idealMin, p.temp.idealMax, openNum(p.temp.hardMax, false)].join(','),
    )
  if (p.seasonal) q.set('cb', `${p.cold.idealMin},${p.cold.idealMax}`)
  if (p.dewMax !== null) q.set('dp', String(p.dewMax))
  if (p.strict !== d.strict) q.set('s', p.strict)
  if (p.drive !== d.drive) q.set('snow', String(p.drive))
  const n = windowYears(p.window)
  q.set('w', p.window.to === LAST_YEAR && LOOKBACKS.includes(n) ? `${n}y` : `${p.window.from}-${p.window.to}`)
  if (p.sun !== d.sun) q.set('sun', p.sun)
  if (p.metric) q.set('u', 'metric')
  if (p.basis !== d.basis) q.set('basis', p.basis)
  if (p.cloud !== d.cloud) q.set('cloud', p.cloud)
  if (p.windMax !== null) q.set('wind', String(p.windMax))
  if (p.dry) q.set('dry', '1')
  const wt = (Object.keys(p.weights) as WeightedVar[])
    .filter((k) => p.weights[k] !== 'normal')
    .map((k) => `${k}.${WEIGHT_CODE[p.weights[k]]}`)
  if (wt.length) q.set('wt', wt.join(','))
  const deal = (Object.keys(p.deal) as DealVar[]).filter((k) => p.deal[k])
  if (deal.length) q.set('deal', deal.join(','))
  if (p.acts.length !== ALL_ACTS.length) q.set('act', p.acts.join(',') || 'none')
  if (p.counters.length)
    q.set('ctr', p.counters.map((c) => [c.m1, c.op1, c.v1, c.m2 ?? '', c.op2, c.v2].join('.')).join('~'))
}

export function decodePrefs(q: URLSearchParams): Prefs {
  const p: Prefs = structuredClone(DEFAULT_PREFS)
  const b = q.get('b')?.split(',')
  if (b && b.length === 4) {
    const iMin = num(b[1]),
      iMax = num(b[2])
    if (iMin !== null && iMax !== null && iMin < iMax) {
      p.temp = { hardMin: num(b[0]), idealMin: iMin, idealMax: iMax, hardMax: num(b[3]) }
    }
  }
  const cb = q.get('cb')?.split(',').map(num)
  if (cb && cb.length === 2 && cb[0] !== null && cb[1] !== null) {
    p.seasonal = true
    p.cold = { idealMin: cb[0], idealMax: cb[1] }
  }
  p.dewMax = num(q.get('dp'))
  const s = q.get('s')
  if (s === 'lenient' || s === 'standard' || s === 'strict') p.strict = s
  const snow = Number(q.get('snow'))
  if (snow === 1 || snow === 2 || snow === 3) p.drive = snow
  const w = q.get('w')
  if (w) {
    const years = /^(\d+)y$/.exec(w),
      range = /^(\d{4})-(\d{4})$/.exec(w)
    if (years) p.window = lookbackWindow(Math.min(Math.max(1, +years[1]), LAST_YEAR - FIRST_YEAR + 1))
    else if (range) {
      const from = Math.max(FIRST_YEAR, +range[1]),
        to = Math.min(LAST_YEAR, +range[2])
      if (from <= to) p.window = { from, to }
    }
  }
  if (q.get('sun') === 'sun') p.sun = 'sun'
  p.metric = q.get('u') === 'metric'
  const basis = q.get('basis')
  if (basis === 'low' || basis === 'apparent' || basis === 'both') p.basis = basis
  const cloud = q.get('cloud')
  if (cloud === 'clear' || cloud === 'overcast') p.cloud = cloud
  p.windMax = num(q.get('wind'))
  p.dry = q.get('dry') === '1'
  for (const pair of q.get('wt')?.split(',') ?? []) {
    const [k, c] = pair.split('.')
    const wv = (Object.keys(WEIGHT_CODE) as Weight[]).find((x) => WEIGHT_CODE[x] === c)
    if (k in p.weights && wv) p.weights[k as WeightedVar] = wv
  }
  for (const k of q.get('deal')?.split(',') ?? []) if (k in p.deal) p.deal[k as DealVar] = true
  const act = q.get('act')
  if (act) p.acts = act === 'none' ? [] : ALL_ACTS.filter((a) => act.split(',').includes(a))
  for (const c of q.get('ctr')?.split('~') ?? []) {
    const [m1, op1, v1, m2, op2, v2] = c.split('.')
    const isM = (m: string) => (METRICS as string[]).includes(m)
    const isOp = (o: string) => o === 'ge' || o === 'le'
    if (!isM(m1) || !isOp(op1) || !Number.isFinite(+v1)) continue
    p.counters.push({
      m1: m1 as CounterMetric,
      op1: op1 as CounterOp,
      v1: +v1,
      m2: m2 && isM(m2) ? (m2 as CounterMetric) : null,
      op2: isOp(op2) ? (op2 as CounterOp) : 'ge',
      v2: Number.isFinite(+v2) ? +v2 : 0,
    })
  }
  return p
}

/** Is any comfort preference stated? Until one is, nothing is scored. */
export const hasPreference = (p: Prefs) =>
  p.temp !== null || p.dewMax !== null || p.cloud !== 'any' || p.windMax !== null || p.dry

/** Every value a preset sets, formatted with the caller's unit formatter. */
export function presetNote(pr: Preset, t: (f: number) => string, tu: string): string {
  const a = pr.apply,
    parts: string[] = []
  if (a.temp) {
    parts.push(
      a.seasonal && a.cold
        ? `warm ${t(a.temp.idealMin)}–${t(a.temp.idealMax)}${tu} · cold ${t(a.cold.idealMin)}–${t(a.cold.idealMax)}${tu}`
        : `ideal ${t(a.temp.idealMin)}–${t(a.temp.idealMax)}${tu}`,
    )
    parts.push(a.temp.hardMin === null ? 'no floor' : `floor ${t(a.temp.hardMin)}`)
    parts.push(a.temp.hardMax === null ? 'no ceiling' : `ceiling ${t(a.temp.hardMax)}`)
  }
  if (a.dewMax != null) parts.push(`dew pt <${t(a.dewMax)}`)
  if (a.cloud && a.cloud !== 'any') parts.push(a.cloud)
  if (a.dry) parts.push('prefer dry')
  return parts.join(' · ')
}
