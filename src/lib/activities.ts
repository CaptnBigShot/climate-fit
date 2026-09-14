// Activity presets. Fixed in v1 (not user-editable), and every threshold is
// published verbatim in Data & Methods — the app sets nothing on the user's
// behalf that it doesn't print.
import type { ActivityId } from './prefs'

export type LossReason = 0 | 1 | 2 | 3 | 4 | 5 // 0 viable · heat · cold · precip · wind/humidity · no snow
export const LOSS_LABEL = ['viable', 'heat', 'cold', 'precip', 'wind / humidity', 'no snow in reach'] as const

export interface DayInputs { hi: number; lo: number; dew: number; precip: number; wind: number; depth: number }

export interface Activity {
  id: ActivityId
  name: string
  rules: string
  test: (d: DayInputs) => LossReason
}

const range = (v: number, lo: number, hi: number): LossReason => (v > hi ? 1 : v < lo ? 2 : 0)

export const RIDE_DEPTH_IN = 18

export const ACTIVITIES: Activity[] = [
  { id: 'walk', name: 'Walk / be outside', rules: 'daily high 32–84°F · precip < 0.40"',
    test: (d) => range(d.hi, 32, 84) || (d.precip >= 0.4 ? 3 : 0) },
  { id: 'hike', name: 'Hike / trail', rules: 'daily high 28–76°F · precip < 0.30" · max wind < 22 mph',
    test: (d) => range(d.hi, 28, 76) || (d.precip >= 0.3 ? 3 : d.wind >= 22 ? 4 : 0) },
  { id: 'run', name: 'Running / cycling', rules: 'daily high 20–68°F · dew pt < 60°F · precip < 0.20" · max wind < 20 mph',
    test: (d) => range(d.hi, 20, 68) || (d.precip >= 0.2 ? 3 : d.dew >= 60 || d.wind >= 20 ? 4 : 0) },
  { id: 'ride', name: 'Snowboard / ski', rules: `snow depth ≥ ${RIDE_DEPTH_IN}" at the reference terrain · city high ≥ 0°F`,
    test: (d) => (!(d.depth >= RIDE_DEPTH_IN) ? 5 : d.hi < 0 ? 2 : 0) },
  { id: 'patio', name: 'Sitting outside', rules: 'daily high 55–82°F · precip < 0.01" · max wind < 14 mph',
    test: (d) => range(d.hi, 55, 82) || (d.precip >= 0.01 ? 3 : d.wind >= 14 ? 4 : 0) },
  { id: 'garden', name: 'Yard & garden', rules: 'daily low > 32°F · daily high < 90°F · precip < 0.35"',
    test: (d) => (d.lo <= 32 ? 2 : d.hi >= 90 ? 1 : d.precip >= 0.35 ? 3 : 0) },
]

/** Outdoor season: the longest run of days on which walking is viable in at least
 *  this share of years, after a 7-day centred window. */
export const SEASON_RELIABILITY = 5 / 7
