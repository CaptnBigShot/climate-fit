// One pass from (series, prefs) to everything the dashboard renders. Called on
// every control-bar change; all of it is synchronous and client-side.
import type { CitySeries, CityMeta, TerrainSeries } from './data'
import { TERRAIN } from './data'
import { activities, budget, facts, monthly, resolveTerrain, type ActivityAgg, type Budget, type Facts, type MonthRow, type TerrainChoice } from './aggregate'
import { score, seasonWeights, DEW_HARD_GAP, type Scored } from './scoring'
import type { Prefs } from './prefs'

export interface Reclaim { text: string; days: number }

export interface Model {
  sc: Scored | null
  b: Budget | null
  warmMonths: boolean[]
  terrain: (TerrainChoice & { name: string; elevFt: number; series: TerrainSeries }) | null
  act: ActivityAgg
  months: MonthRow[]
  facts: Facts
  reclaim: Reclaim[]
}

export const RECLAIM_STEP = 4

export function buildModel(city: CityMeta, s: CitySeries, terrains: Record<string, TerrainSeries>, p: Prefs, fmtT: (f: number) => string, tu: string): Model {
  const w = p.window
  const sc = score(s, p, w)
  const b = sc ? budget(sc) : null
  const { warmMonths } = seasonWeights(s, w)

  const cands = city.terrain
    .filter(([id, min]) => min <= p.drive * 60 && terrains[id])
    .map(([id, min]) => ({ id, driveMin: min, series: terrains[id] }))
  const choice = resolveTerrain(cands, w)
  const terrain = choice ? { ...choice, name: TERRAIN[choice.id].name, elevFt: TERRAIN[choice.id].elevFt, series: terrains[choice.id] } : null

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
