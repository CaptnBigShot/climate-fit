// Discover: rank the curated set against the session state. Two entry modes —
// comfort (needs a stated preference) and outdoor (fixed, published activity
// thresholds, so it works before anything is set) — and a result set that is
// never empty (spec 4.3). Pure functions, like aggregate.ts.
import { CITIES, cityById, type CityMeta } from './data'
import type { ActivityAgg, Budget } from './aggregate'
import { hasTerrainWithin, type Climate } from './model'

export type Rank = 'comfort' | 'outdoor'
export type SortKey = 'comf' | 'comftol' | 'unb' | 'outdoor' | 'trend'
export type Shift = 'cooler' | 'warmer' | 'drier' | 'cloudier' | 'sunnier' | 'snowier'
export type PopFilter = 'any' | 'big' | 'small'
export type CoastFilter = 'any' | 'coastal' | 'inland'
export type StarScope = 'all' | 'starred' | 'unstarred'

export interface DiscoverQuery {
  rank: Rank
  sort: SortKey
  /** Which cities are ranked at all, by star. Applied before the filters, never counted as a miss. */
  scope: StarScope
  /** 'all' or a continent slug. */
  region: string
  pop: PopFilter
  /** Keep only cities with reference ski terrain inside the drive limit. */
  snow: boolean
  coast: CoastFilter
  /** Reference city for "like [city] but ___"; null = the city currently open. */
  like: string | null
  but: Shift
}

export const DEFAULT_DISCOVER: DiscoverQuery = {
  rank: 'comfort',
  sort: 'comf',
  scope: 'all',
  region: 'all',
  pop: 'any',
  snow: false,
  coast: 'any',
  like: null,
  but: 'snowier',
}

export const SORTS: { v: SortKey; label: string }[] = [
  { v: 'comf', label: 'Comfortable days' },
  { v: 'comftol', label: 'Comf + tolerable' },
  { v: 'unb', label: 'Fewest unbearable' },
  { v: 'outdoor', label: 'Outdoor days' },
  { v: 'trend', label: 'Improving trend' },
]
export const SORT_LABEL: Record<SortKey | 'walk', string> = {
  ...(Object.fromEntries(SORTS.map((s) => [s.v, s.label])) as Record<SortKey, string>),
  walk: 'Walk-viable days',
}

/** Population split for the size filter. */
export const POP_SPLIT = 500_000
/** When no city reaches this many comfortable days, the comfortable-days sort stops
 *  discriminating between real options and Discover ranks by fewest unbearable instead. */
export const FALLBACK_COMF = 100

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
export const REGIONS = [...new Set(CITIES.map((c) => c.continent))].sort().map((name) => ({ slug: slug(name), name }))
const regionName = (sl: string) => REGIONS.find((r) => r.slug === sl)?.name ?? sl

export interface Candidate {
  city: CityMeta
  b: Budget | null
  act: ActivityAgg
}
export interface Ranked {
  c: Candidate
  misses: string[]
}
export interface Ranking {
  rows: Ranked[]
  mode: Rank
  /** The ordering actually applied ('walk' in outdoor mode). */
  sort: SortKey | 'walk'
  /** The comfortable-days sort was swapped for fewest unbearable. */
  fallback: boolean
  /** No city passed every filter; the rows are the nearest misses. */
  nearMiss: boolean
  passing: number
}

/** Names of the filters a city fails. */
export function filterMisses(city: CityMeta, q: DiscoverQuery, drive: number): string[] {
  const out: string[] = []
  if (q.region !== 'all' && slug(city.continent) !== q.region) out.push(regionName(q.region))
  if (q.pop === 'big' && city.pop < POP_SPLIT) out.push('population ≥ 500k')
  if (q.pop === 'small' && city.pop >= POP_SPLIT) out.push('population < 500k')
  if (q.snow && !hasTerrainWithin(city, drive)) out.push(`snow within ${drive} hr`)
  if (q.coast === 'coastal' && !city.coastal) out.push('coastal')
  if (q.coast === 'inland' && city.coastal) out.push('inland')
  return out
}

const KEY: Record<SortKey | 'walk', (c: Candidate) => number> = {
  comf: (c) => c.b?.counts[0] ?? -Infinity,
  comftol: (c) => (c.b ? c.b.counts[0] + c.b.counts[1] : -Infinity),
  unb: (c) => (c.b ? -c.b.counts[2] : -Infinity),
  outdoor: (c) => c.act.outAny,
  trend: (c) => c.b?.trend.slope ?? -Infinity,
  walk: (c) => c.act.per.walk.days,
}

export const inScope = (id: string, scope: StarScope, stars: ReadonlySet<string>) =>
  scope === 'all' || stars.has(id) === (scope === 'starred')

export function rank(cands: Candidate[], q: DiscoverQuery, drive: number, stars: readonly string[] = []): Ranking {
  const mode: Rank = q.rank === 'comfort' && cands.some((c) => c.b) ? 'comfort' : 'outdoor'
  const starred = new Set(stars)
  const all = cands
    .filter((c) => inScope(c.city.id, q.scope, starred))
    .map((c) => ({ c, misses: filterMisses(c.city, q, drive) }))
  const passing = all.filter((r) => !r.misses.length)
  // Never empty: if nothing passes every filter, show the cities that miss the fewest, and say which.
  // The nearest misses come from inside the star scope; an empty scope stays empty.
  const nearMiss = !passing.length && all.length > 0
  const least = nearMiss ? Math.min(...all.map((r) => r.misses.length)) : 0
  const rows = nearMiss ? all.filter((r) => r.misses.length === least) : passing
  let sort: SortKey | 'walk' = mode === 'outdoor' ? 'walk' : q.sort
  let fallback = false
  if (
    mode === 'comfort' &&
    q.sort === 'comf' &&
    rows.length &&
    Math.max(...rows.map((r) => KEY.comf(r.c))) < FALLBACK_COMF
  ) {
    sort = 'unb'
    fallback = true
  }
  const key = KEY[sort]
  return {
    rows: [...rows].sort((a, b) => key(b.c) - key(a.c) || a.c.city.name.localeCompare(b.c.city.name)),
    mode,
    sort,
    fallback,
    nearMiss,
    passing: passing.length,
  }
}

// ---------- "Like [city] but ___" ----------

/** One unit of distance along each axis. Published in Data & Methods. */
export const CLIMATE_SCALE: Climate = { hi: 16, dew: 13, cloud: 20, rad: 4, snow: 60 }
export const SHIFT_BY: Record<Shift, Partial<Climate>> = {
  cooler: { hi: -12 },
  warmer: { hi: 12 },
  drier: { dew: -11 },
  cloudier: { cloud: 16, rad: -3 },
  sunnier: { cloud: -16, rad: 3 },
  snowier: { snow: 60, hi: -6 },
}
export const SHIFT_LABEL: Record<Shift, string> = {
  cooler: 'cooler',
  warmer: 'warmer',
  drier: 'drier',
  cloudier: 'less sunny',
  sunnier: 'sunnier',
  snowier: 'snowier',
}
export const SHIFTS = Object.keys(SHIFT_BY) as Shift[]
const AXES = Object.keys(CLIMATE_SCALE) as (keyof Climate)[]

export function shiftClimate(c: Climate, s: Shift): Climate {
  const out = { ...c }
  for (const k of AXES) out[k] += SHIFT_BY[s][k] ?? 0
  return out
}

/** Sum over axes of |difference| in units of that axis' scale. */
export const climateDistance = (a: Climate, b: Climate) =>
  AXES.reduce((acc, k) => acc + Math.abs(a[k] - b[k]) / CLIMATE_SCALE[k], 0)

/** 100 at distance 0, falling 20 points per unit of distance. */
export const matchPct = (d: number) => Math.max(0, Math.round(100 - 20 * d))

export function likeBut(
  ref: string,
  but: Shift,
  climates: Record<string, Climate>,
  n = 4,
): { id: string; d: number; match: number }[] {
  const base = climates[ref]
  if (!base) return []
  const target = shiftClimate(base, but)
  return Object.entries(climates)
    .filter(([id]) => id !== ref)
    .map(([id, c]) => ({ id, d: climateDistance(c, target) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((r) => ({ ...r, match: matchPct(r.d) }))
}

// ---------- URL ----------

const oneOf = <T extends string>(v: string | null, ok: readonly T[]): T | null =>
  v !== null && (ok as readonly string[]).includes(v) ? (v as T) : null

export function encodeDiscover(d: DiscoverQuery, q: URLSearchParams) {
  const z = DEFAULT_DISCOVER
  if (d.rank !== z.rank) q.set('rank', d.rank)
  if (d.sort !== z.sort) q.set('sort', d.sort)
  if (d.scope !== z.scope) q.set('scope', d.scope)
  if (d.region !== z.region) q.set('reg', d.region)
  if (d.pop !== z.pop) q.set('pop', d.pop)
  if (d.snow) q.set('snowf', '1')
  if (d.coast !== z.coast) q.set('coast', d.coast)
  if (d.like) q.set('like', d.like)
  if (d.but !== z.but) q.set('but', d.but)
}

export function decodeDiscover(q: URLSearchParams): DiscoverQuery {
  const z = DEFAULT_DISCOVER
  return {
    rank: oneOf(q.get('rank'), ['comfort', 'outdoor'] as const) ?? z.rank,
    sort:
      oneOf(
        q.get('sort'),
        SORTS.map((s) => s.v),
      ) ?? z.sort,
    scope: oneOf(q.get('scope'), ['starred', 'unstarred'] as const) ?? z.scope,
    region:
      oneOf(
        q.get('reg'),
        REGIONS.map((r) => r.slug),
      ) ?? z.region,
    pop: oneOf(q.get('pop'), ['big', 'small'] as const) ?? z.pop,
    snow: q.get('snowf') === '1',
    coast: oneOf(q.get('coast'), ['coastal', 'inland'] as const) ?? z.coast,
    like: cityById(q.get('like') ?? '')?.id ?? null,
    but: oneOf(q.get('but'), SHIFTS) ?? z.but,
  }
}
