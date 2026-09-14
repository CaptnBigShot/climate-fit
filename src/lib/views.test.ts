import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CITIES, SERIES_KEYS, cityById, type CitySeries, type TerrainSeries } from './data'
import { ACTIVITIES, ruleParts, type DayInputs } from './activities'
import { activities } from './aggregate'
import { DEFAULT_PREFS, EXAMPLE_STATE, lookbackWindow, type Prefs } from './prefs'
import { units } from './units'
import { climateOf, fitOf, outdoorOf } from './model'
import { DEFAULT_DISCOVER, FALLBACK_COMF, REGIONS, climateDistance, decodeDiscover, encodeDiscover, likeBut, matchPct, rank, shiftClimate, type Candidate, type DiscoverQuery } from './discover'
import { MAX_COMPARE, PIVOT, pivot, toggleCompare } from './compare'
import { decodeSession, encodeSession, sessionSearch, type Session } from './session'

const json = (path: string) => JSON.parse(readFileSync(new URL(`../../public/data/${path}`, import.meta.url), 'utf8'))
const f32 = (xs: (number | null)[]) => Float32Array.from(xs, (v) => (v === null ? NaN : v))
function loadSeries(id: string): CitySeries {
  const raw = json(`cities/${id}.json`)
  for (const k of SERIES_KEYS) raw[k] = f32(raw[k])
  return raw
}
const loadTerrain = (id: string): TerrainSeries => { const t = json(`terrain/${id}.json`); return { ...t, depth: f32(t.depth) } }

const series = Object.fromEntries(CITIES.map((c) => [c.id, loadSeries(c.id)]))
const terrains: Record<string, TerrainSeries> = {}
for (const c of CITIES) for (const [id] of c.terrain) terrains[id] ??= loadTerrain(id)
const example: Prefs = { ...structuredClone(DEFAULT_PREFS), ...structuredClone(EXAMPLE_STATE) }
const w = lookbackWindow(10)

function candidates(p: Prefs): Candidate[] {
  return CITIES.map((city) => ({ city, b: fitOf(series[city.id], p)?.b ?? null, act: outdoorOf(city, series[city.id], terrains, p.window, p.acts, p.drive).act }))
}

describe('activity presets', () => {
  // The hand-written tests these presets replaced. The derived tests must agree on every day.
  const range = (v: number, lo: number, hi: number) => (v > hi ? 1 : v < lo ? 2 : 0)
  const legacy: Record<string, (d: DayInputs) => number> = {
    walk: (d) => range(d.hi, 32, 70) || (d.precip >= 0.4 ? 3 : d.dew >= 55 ? 4 : 0),
    run: (d) => range(d.hi, 10, 64) || (d.precip >= 0.2 ? 3 : d.dew >= 55 || d.wind >= 20 ? 4 : 0),
    ride: (d) => (!(d.depth >= 18) ? 5 : d.hi < 0 ? 2 : 0),
  }

  it('give the same loss reason as the hand-written tests on every real day', () => {
    for (const id of ['tacoma', 'denver', 'miami', 'reykjavik']) {
      const s = series[id], t = terrains[cityById(id)!.terrain[0]?.[0] ?? ''] ?? null
      for (let j = 0; j < s.high.length; j++) {
        const d = { hi: s.high[j], lo: s.low[j], dew: s.dew[j], precip: s.precip[j], wind: s.wind[j], depth: t ? t.depth[j] : NaN }
        for (const a of ACTIVITIES) expect(a.test(d)).toBe(legacy[a.id](d))
      }
    }
  })

  it('handle missing values the way the hand-written tests did', () => {
    const nan = { hi: NaN, lo: NaN, dew: NaN, precip: NaN, wind: NaN, depth: NaN }
    for (const a of ACTIVITIES) expect(a.test(nan)).toBe(legacy[a.id](nan))
  })

  it('publish their thresholds from the same numbers, in either unit system', () => {
    const walk = ACTIVITIES.find((a) => a.id === 'walk')!
    expect(walk.rules).toBe('daily high 32–70°F · dew pt < 55°F · precip < 0.40"')
    const m = ruleParts(walk, units(true))
    expect(m.temp).toBe('daily high 0–21°C')
    expect(m.precip).toBe('< 10 mm')
  })
})

describe('discover', () => {
  const cands = candidates(example)

  it('ranks on walk-viable days when nothing is set, whatever mode was asked for', () => {
    const r = rank(candidates(DEFAULT_PREFS), DEFAULT_DISCOVER, 2)
    expect(r.mode).toBe('outdoor')
    expect(r.sort).toBe('walk')
    const walks = r.rows.map((x) => x.c.act.per.walk.days)
    expect(walks).toEqual([...walks].sort((a, b) => b - a))
  })

  it('falls back to fewest unbearable when no city reaches the comfortable-day floor', () => {
    const strict: Prefs = { ...example, strict: 'strict', temp: { hardMin: null, idealMin: 20, idealMax: 24, hardMax: 30 } }
    const r = rank(candidates(strict), DEFAULT_DISCOVER, 2)
    expect(Math.max(...r.rows.map((x) => x.c.b!.counts[0]))).toBeLessThan(FALLBACK_COMF)
    expect(r.fallback).toBe(true)
    expect(r.sort).toBe('unb')
    const unb = r.rows.map((x) => x.c.b!.counts[2])
    expect(unb).toEqual([...unb].sort((a, b) => a - b))
  })

  it('honours an explicitly chosen sort even when comfortable days are scarce', () => {
    const r = rank(cands, { ...DEFAULT_DISCOVER, sort: 'outdoor' }, 2)
    expect(r.fallback).toBe(false)
    const out = r.rows.map((x) => x.c.act.outAny)
    expect(out).toEqual([...out].sort((a, b) => b - a))
  })

  it('never returns an empty set: with no city passing, it shows the nearest misses and names them', () => {
    const oceania = REGIONS.find((x) => x.name === 'Oceania')!.slug
    const q: DiscoverQuery = { ...DEFAULT_DISCOVER, region: oceania, snow: true }
    const r = rank(cands, q, 3)
    expect(r.passing).toBe(0)
    expect(r.nearMiss).toBe(true)
    expect(r.rows.length).toBeGreaterThan(0)
    for (const row of r.rows) expect(row.misses).toHaveLength(1)
  })

  it('filters on the catalogue: coastal, population and snow within the drive limit', () => {
    const r = rank(cands, { ...DEFAULT_DISCOVER, coast: 'inland', pop: 'big', snow: true }, 1)
    expect(r.rows.map((x) => x.c.city.id).sort()).toEqual(['calgary', 'denver'])
  })

  it('like [city] but ___ excludes the reference and moves the target the chosen way', () => {
    const climates = Object.fromEntries(CITIES.map((c) => [c.id, climateOf(series[c.id], w, 0)]))
    const res = likeBut('tacoma', 'warmer', climates, 4)
    expect(res.map((x) => x.id)).not.toContain('tacoma')
    expect(res).toHaveLength(4)
    const target = shiftClimate(climates.tacoma, 'warmer')
    expect(target.hi).toBeCloseTo(climates.tacoma.hi + 12)
    for (let i = 1; i < res.length; i++) expect(res[i].d).toBeGreaterThanOrEqual(res[i - 1].d)
    expect(climateDistance(target, target)).toBe(0)
    expect(matchPct(0)).toBe(100)
    // Its nearest neighbours in climate space are its Puget Sound neighbours.
    expect(likeBut('tacoma', 'cooler', { ...climates, tacoma: { ...climates.tacoma, hi: climates.tacoma.hi + 12 } }, 2).map((x) => x.id).sort()).toEqual(['bellingham', 'lynnwood'])
  })

  it('round-trips its query through the URL', () => {
    const q: DiscoverQuery = { rank: 'outdoor', sort: 'trend', region: REGIONS[0].slug, pop: 'small', snow: true, coast: 'coastal', like: 'denver', but: 'drier' }
    const u = new URLSearchParams()
    encodeDiscover(q, u)
    expect(decodeDiscover(u)).toEqual(q)
    const empty = new URLSearchParams()
    encodeDiscover(DEFAULT_DISCOVER, empty)
    expect(empty.toString()).toBe('')
    expect(decodeDiscover(new URLSearchParams('rank=bogus&like=atlantis&reg=mars'))).toEqual(DEFAULT_DISCOVER)
  })
})

describe('compare', () => {
  it('holds at most four cities and toggles membership', () => {
    let set: string[] = []
    for (const c of CITIES) set = toggleCompare(set, c.id)
    expect(set).toHaveLength(MAX_COMPARE)
    expect(toggleCompare(set, set[0])).toHaveLength(MAX_COMPARE - 1)
  })

  it('pivots monthly rollups and hides only months inside the tolerance', async () => {
    const { monthly } = await import('./aggregate')
    const months = ['tacoma', 'lynnwood', 'phoenix'].map((id) => {
      const s = series[id]
      const fit = fitOf(s, example)
      return monthly(s, w, null, fit!.b, activities(s, w, example.acts, null))
    })
    const rows = pivot(months, 'hi')
    expect(rows).toHaveLength(12)
    for (const r of rows) {
      expect(r.spread).toBeCloseTo(r.max - r.min)
      expect(r.differs).toBe(r.spread >= PIVOT.hi.tol)
    }
    // Phoenix against Puget Sound: every month differs on mean high.
    expect(rows.every((r) => r.differs)).toBe(true)
    // Tacoma against Lynnwood alone: neighbours, within tolerance most of the year.
    expect(pivot(months.slice(0, 2), 'hi').filter((r) => r.differs).length).toBeLessThan(6)
  })
})

describe('session URL', () => {
  it('round-trips screen, compare set and discover query alongside the preferences', () => {
    const s: Session = { city: 'denver', prefs: example, cmp: ['tacoma', 'prague'], view: 'compare', disc: { ...DEFAULT_DISCOVER, rank: 'outdoor', like: 'miami' } }
    expect(decodeSession(new URLSearchParams(sessionSearch(s)))).toEqual(s)
  })

  it('drops unknown and duplicate compare cities and caps the set at four', () => {
    const s = decodeSession(new URLSearchParams('cmp=tacoma,tacoma,atlantis,denver,miami,prague,phoenix&view=nowhere'))
    expect(s.cmp).toEqual(['tacoma', 'denver', 'miami', 'prague'])
    expect(s.view).toBe('city')
  })

  it('leaves the city view implicit', () => {
    const s = decodeSession(new URLSearchParams(''))
    expect(encodeSession(s).has('view')).toBe(false)
  })
})
