// Activity presets. Fixed in v1 (not user-editable), and every threshold is
// published verbatim in Data & Methods — the app sets nothing on the user's
// behalf that it doesn't print. Each preset is plain numbers; the day test and
// the published wording are both derived from them, so the two cannot drift apart.
import type { ActivityId } from './prefs'
import { units, type Units } from './units'

export type LossReason = 0 | 1 | 2 | 3 | 4 | 5 // 0 viable · heat · cold · precip · wind/humidity · no snow
export const LOSS_LABEL = ['viable', 'heat', 'cold', 'precip', 'wind / humidity', 'no snow in reach'] as const

export interface DayInputs { hi: number; lo: number; dew: number; precip: number; wind: number; depth: number }

/** Thresholds in °F / inches / mph. null = not a constraint for this activity. */
export interface Limits {
  /** The city's daily high must sit inside [hiMin, hiMax]. */
  hiMin: number | null
  hiMax: number | null
  /** Daily mean dew point must be below this. */
  dewBelow: number | null
  /** Daily precipitation must be below this. */
  precipBelow: number | null
  /** Daily maximum wind must be below this. */
  windBelow: number | null
  /** Snow depth at the reference terrain must reach this. */
  depthMin: number | null
}

export interface Activity extends Limits {
  id: ActivityId
  name: string
  /** Why the preset is shaped the way it is — published beside the numbers. */
  why: string
  /** Every threshold as one line, in °F / in / mph. */
  rules: string
  test: (d: DayInputs) => LossReason
}

/** The first constraint a day fails decides what it is "lost" to, in this order. */
function tester(l: Limits) {
  return (d: DayInputs): LossReason => {
    if (l.depthMin !== null && !(d.depth >= l.depthMin)) return 5
    if (l.hiMax !== null && d.hi > l.hiMax) return 1
    if (l.hiMin !== null && d.hi < l.hiMin) return 2
    if (l.precipBelow !== null && d.precip >= l.precipBelow) return 3
    if ((l.dewBelow !== null && d.dew >= l.dewBelow) || (l.windBelow !== null && d.wind >= l.windBelow)) return 4
    return 0
  }
}

type Fmt = Pick<Units, 't' | 'tu' | 'len' | 'speed' | 'depth'>
export interface RuleParts { temp: string; precip: string; wind: string; other: string }

/** The thresholds split into the Data & Methods columns, in the caller's units. */
export function ruleParts(l: Limits, u: Fmt): RuleParts {
  const temp = l.hiMin !== null && l.hiMax !== null ? `daily high ${u.t(l.hiMin)}–${u.t(l.hiMax)}${u.tu}`
    : l.hiMin !== null ? `daily high ≥ ${u.t(l.hiMin)}${u.tu}`
    : l.hiMax !== null ? `daily high ≤ ${u.t(l.hiMax)}${u.tu}` : '—'
  const other = [
    l.dewBelow !== null ? `dew pt < ${u.t(l.dewBelow)}${u.tu}` : null,
    l.depthMin !== null ? `snow depth ≥ ${u.depth(l.depthMin)} at the reference terrain` : null,
  ].filter(Boolean).join(' · ')
  return {
    temp,
    precip: l.precipBelow !== null ? `< ${u.len(l.precipBelow)}` : '—',
    wind: l.windBelow !== null ? `< ${u.speed(l.windBelow)}` : '—',
    other: other || '—',
  }
}

export function rulesText(l: Limits, u: Fmt): string {
  const r = ruleParts(l, u)
  return [r.temp, r.other, r.precip !== '—' ? `precip ${r.precip}` : null, r.wind !== '—' ? `max wind ${r.wind}` : null]
    .filter((x) => x && x !== '—').join(' · ')
}

export const RIDE_DEPTH_IN = 18

const OPEN: Limits = { hiMin: null, hiMax: null, dewBelow: null, precipBelow: null, windBelow: null, depthMin: null }

function preset(id: ActivityId, name: string, why: string, limits: Partial<Limits>): Activity {
  const l = { ...OPEN, ...limits }
  return { id, name, why, ...l, rules: rulesText(l, units(false)), test: tester(l) }
}

export const ACTIVITIES: Activity[] = [
  preset('walk', 'Walk / be outside', 'The floor case — is being outdoors viable at all. Carries the zero-input rankings.',
    { hiMin: 32, hiMax: 70, dewBelow: 55, precipBelow: 0.4 }),
  preset('run', 'Running / cycling', 'Sustained effort makes heat, so the band sits cooler; dew point is the real limiter.',
    { hiMin: 10, hiMax: 64, dewBelow: 55, precipBelow: 0.2, windBelow: 20 }),
  preset('ride', 'Snowboard / ski', 'Snow on the ground somewhere reachable. Depth is measured at the resolved reference terrain; the temperature is the city’s.',
    { hiMin: 0, depthMin: RIDE_DEPTH_IN }),
]

/** Outdoor season: the longest run of days on which walking is viable in at least
 *  this share of years, after a 7-day centred window. */
export const SEASON_RELIABILITY = 5 / 7
