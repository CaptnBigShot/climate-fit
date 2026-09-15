// Fixed 365-day year: the data pipeline drops Feb 29, so day-of-year indexes
// line up across every year in the archive.
import type { CitySeries, TerrainSeries } from './data'
import { FIRST_YEAR, windowYears, type Window } from './prefs'
import type { Scored } from './scoring'
export const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTH_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
export const MD = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
export const MONTH_START = MD.reduce<number[]>((acc, _d, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + MD[i - 1])
  return acc
}, [])

const DOY_MONTH = new Uint8Array(365)
for (let m = 0; m < 12; m++) for (let d = 0; d < MD[m]; d++) DOY_MONTH[MONTH_START[m] + d] = m

export const doyMonth = (doy: number) => DOY_MONTH[doy]

export function doyLabel(doy: number): string {
  const m = DOY_MONTH[((doy % 365) + 365) % 365]
  return `${MN[m]} ${doy - MONTH_START[m] + 1}`
}

/** One row of a comfort calendar: a year, where its days live, and how many of them are observed. */
export interface CalRow {
  year: number
  series: CitySeries
  sc: Scored | null
  /** Index of Jan 1 of this row inside `sc`. */
  scBase: number
  /** Index of Jan 1 of this row inside `series`. */
  j0: number
  terrain: TerrainSeries | null
  observed: number
  ytd: boolean
}

/** One row per year of the window. */
export function windowRows(s: CitySeries, sc: Scored | null, w: Window, terrain: TerrainSeries | null): CalRow[] {
  const off = (w.from - FIRST_YEAR) * 365
  return Array.from({ length: windowYears(w) }, (_, y) => ({
    year: w.from + y,
    series: s,
    sc,
    scBase: y * 365,
    j0: off + y * 365,
    terrain,
    observed: 365,
    ytd: false,
  }))
}
