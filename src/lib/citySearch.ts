import { CITIES, type CityMeta } from './data'

/** Lowercase, accents off, and the punctuation people skip when typing ("St. John's" → "st johns"). */
export const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/[.'’]/g, '')

const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

// Folded once, alphabetical. A few hundred cities scan faster than any index would build.
const INDEX = [...CITIES]
  .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
  .map((c) => {
    const name = fold(c.name)
    return { c, name, nameWords: words(name), hay: words(fold(`${c.name} ${c.code} ${c.region}`)) }
  })

/**
 * Cities where every typed word starts a word of the name, code or region — so "portland me"
 * finds Maine's and "co" finds Colorado and Colombia — or, from three letters, sits anywhere in
 * the name. Ranked: name starts with the first word, then a later word of the name does, then the
 * rest; alphabetical within each.
 */
export function searchCities(query: string, exclude: readonly string[] = []): CityMeta[] {
  const q = words(fold(query))
  const pool = exclude.length ? INDEX.filter((x) => !exclude.includes(x.c.id)) : INDEX
  if (!q.length) return pool.map((x) => x.c)
  const tiers: CityMeta[][] = [[], [], []]
  for (const x of pool) {
    if (!q.every((w) => x.hay.some((h) => h.startsWith(w)) || (w.length >= 3 && x.name.includes(w)))) continue
    tiers[x.name.startsWith(q[0]) ? 0 : x.nameWords.some((h) => h.startsWith(q[0])) ? 1 : 2].push(x.c)
  }
  return tiers.flat()
}
