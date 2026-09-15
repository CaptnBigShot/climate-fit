// Compare: two to four cities on one session state. The app ranks and explains;
// it never names a winner (spec 4.2). Pure functions, like aggregate.ts.
import type { MonthRow } from './aggregate'

export const MAX_COMPARE = 4

/** Add a city to the compare set, or take it out. A full set is left unchanged. */
export function toggleCompare(set: string[], id: string): string[] {
  if (set.includes(id)) return set.filter((x) => x !== id)
  return set.length >= MAX_COMPARE ? set : [...set, id]
}

export type PivotMetric = 'hi' | 'lo' | 'dew' | 'cloud' | 'precip' | 'comf' | 'out'
export interface PivotDef {
  label: string
  kind: 'temp' | 'pct' | 'len' | 'days'
  tol: number
  needsFit?: boolean
}

/** Monthly rollups pivoted city by city. `tol` is in stored units (°F, %, inches, days per
 *  year): months where every city sits within it are what "differences only" hides. */
export const PIVOT: Record<PivotMetric, PivotDef> = {
  hi: { label: 'Avg high', kind: 'temp', tol: 2.5 },
  lo: { label: 'Avg low', kind: 'temp', tol: 2.5 },
  dew: { label: 'Dew point', kind: 'temp', tol: 2.5 },
  cloud: { label: 'Cloud', kind: 'pct', tol: 5 },
  precip: { label: 'Precip', kind: 'len', tol: 0.5 },
  comf: { label: 'Comfortable days', kind: 'days', tol: 3, needsFit: true },
  out: { label: 'Outdoor days', kind: 'days', tol: 3 },
}

export interface PivotRow {
  m: number
  vals: number[]
  max: number
  min: number
  spread: number
  differs: boolean
}

export function pivot(cities: MonthRow[][], metric: PivotMetric): PivotRow[] {
  const tol = PIVOT[metric].tol
  return Array.from({ length: 12 }, (_, m) => {
    const vals = cities.map((rows) => rows[m][metric] ?? NaN)
    const ok = vals.filter((v) => !Number.isNaN(v))
    const max = ok.length ? Math.max(...ok) : NaN,
      min = ok.length ? Math.min(...ok) : NaN
    const spread = ok.length ? max - min : 0
    return { m, vals, max, min, spread, differs: ok.length > 1 && spread >= tol }
  })
}
