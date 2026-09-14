// One pass from (series, prefs) to everything the dashboard renders. Called on
// every control-bar change; all of it is synchronous and client-side.
import type { CitySeries, CityMeta, TerrainSeries } from './data'
import { FIRST_YEAR, windowYears, type ActivityId, type Window } from './prefs'
import { TERRAIN } from './data'
import { activities, budget, facts, monthly, resolveTerrain, type ActivityAgg, type Budget, type Facts, type MonthRow, type TerrainChoice } from './aggregate'
import { score, seasonWeights, DEW_HARD_GAP, type Scored } from './scoring'
import type { Prefs } from './prefs'

export interface Reclaim { text: string; days: number }

export type ResolvedTerrain = TerrainChoice & { name: string; elevFt: number; series: TerrainSeries }

export interface Model {
  sc: Scored | null
  b: Budget | null
  warmMonths: boolean[]
  terrain: ResolvedTerrain | null
  act: ActivityAgg
  months: MonthRow[]
  facts: Facts
  reclaim: Reclaim[]
}

export const RECLAIM_STEP = 4

/** Spec 6.12: at a drive-time stop, the loaded reference with the most snow days over the window. */
export function terrainAt(city: CityMeta, terrains: Record<string, TerrainSeries>, drive: number, w: Window): ResolvedTerrain | null {
  const cands = city.terrain
    .filter(([id, min]) => min <= drive * 60 && terrains[id])
    .map(([id, min]) => ({ id, driveMin: min, series: terrains[id] }))
  const choice = resolveTerrain(cands, w)
  return choice ? { ...choice, name: TERRAIN[choice.id].name, elevFt: TERRAIN[choice.id].elevFt, series: terrains[choice.id] } : null
}

/** Terrain inside the drive limit according to the catalogue — known before any snow data loads. */
export const hasTerrainWithin = (city: CityMeta, drive: number) => city.terrain.some(([, min]) => min <= drive * 60)

// ---------- Per-city summaries for Compare, Discover and the opening state ----------
// Comfort needs a stated preference; outdoor days use fixed thresholds. They depend on
// different parts of the session, so they are computed (and memoised) separately.

export interface Fit { sc: Scored; b: Budget }
export interface Outdoor { terrain: ResolvedTerrain | null; act: ActivityAgg }
/** One loaded city, summarised on the current session state. */
export interface CityRow { city: CityMeta; s: CitySeries; fit: Fit | null; out: Outdoor }

export function fitOf(s: CitySeries, p: Prefs): Fit | null {
  const sc = score(s, p, p.window)
  return sc ? { sc, b: budget(sc) } : null
}

export function outdoorOf(city: CityMeta, s: CitySeries, terrains: Record<string, TerrainSeries>, w: Window, acts: ActivityId[], drive: number): Outdoor {
  const terrain = terrainAt(city, terrains, drive, w)
  return { terrain, act: activities(s, w, acts, terrain?.series ?? null) }
}

/** Raw climate over the window — the axes of Discover's "like [city] but ___" search. */
export interface Climate {
  /** Mean daily high, °F. */
  hi: number
  /** Mean dew point, °F. */
  dew: number
  /** Mean cloud cover, %. */
  cloud: number
  /** Mean daily shortwave radiation, MJ/m². */
  rad: number
  /** Snow-sport days a year at the terrain resolved inside the drive limit. */
  snow: number
}

export function climateOf(s: CitySeries, w: Window, rideDays: number): Climate {
  const off = (w.from - FIRST_YEAR) * 365, N = windowYears(w) * 365
  let hi = 0, dew = 0, cloud = 0, rad = 0, n = 0
  for (let i = 0; i < N; i++) {
    const j = off + i
    if (Number.isNaN(s.high[j])) continue
    hi += s.high[j]; dew += s.dew[j]; cloud += s.cloud[j]; rad += s.rad[j] || 0; n++
  }
  return { hi: hi / n, dew: dew / n, cloud: cloud / n, rad: rad / n, snow: rideDays }
}

export function buildModel(city: CityMeta, s: CitySeries, terrains: Record<string, TerrainSeries>, p: Prefs, fmtT: (f: number) => string, tu: string): Model {
  const w = p.window
  const sc = score(s, p, w)
  const b = sc ? budget(sc) : null
  const { warmMonths } = seasonWeights(s, w)

  const terrain = terrainAt(city, terrains, p.drive, w)
  const act = activities(s, w, p.acts, terrain?.series ?? null)
  const hardMax = p.temp?.hardMax ?? null

  // Deal-breaker reclaim: for each hard line, what loosening it by a few degrees buys back.
  const reclaim: Reclaim[] = []
  if (b && p.temp) {
    const kept = b.counts[0] + b.counts[1]
    const gain = (patch: Partial<Prefs>) => {
      const b2 = budget(score(s, { ...p, ...patch }, w)!)
      return Math.round(b2.counts[0] + b2.counts[1] - kept)
    }
    const t = p.temp
    if (t.hardMax !== null) {
      reclaim.push({ text: `Raising your ${fmtT(t.hardMax)}${tu} ceiling to ${fmtT(t.hardMax + RECLAIM_STEP)}${tu}`, days: gain({ temp: { ...t, hardMax: t.hardMax + RECLAIM_STEP } }) })
    }
    if (t.hardMin !== null) {
      reclaim.push({ text: `Lowering your ${fmtT(t.hardMin)}${tu} floor to ${fmtT(t.hardMin - RECLAIM_STEP)}${tu}`, days: gain({ temp: { ...t, hardMin: t.hardMin - RECLAIM_STEP } }) })
    }
    if (p.dewMax !== null) {
      reclaim.push({ text: `Raising your dew-point limit from ${fmtT(p.dewMax + DEW_HARD_GAP)}${tu} to ${fmtT(p.dewMax + DEW_HARD_GAP + RECLAIM_STEP)}${tu}`, days: gain({ dewMax: p.dewMax + RECLAIM_STEP }) })
    }
  }

  return {
    sc, b, warmMonths, terrain, act,
    months: monthly(s, w, hardMax, b, act),
    facts: facts(s, w, city.lat),
    reclaim,
  }
}
