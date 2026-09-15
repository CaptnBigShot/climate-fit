// The whole session — city, screen, preferences, compare set, starred cities and
// Discover query — round-trips through the URL. There are no accounts: a bookmark
// saves the session and a link shares it, comparison and stars included.
import { cityById } from './data'
import { decodePrefs, encodePrefs, type Prefs } from './prefs'
import { decodeDiscover, encodeDiscover, type DiscoverQuery } from './discover'
import { MAX_COMPARE } from './compare'

export type View = 'city' | 'compare' | 'discover' | 'methods'
export const VIEWS: View[] = ['city', 'compare', 'discover', 'methods']
export const DEFAULT_CITY = 'tacoma'

export interface Session {
  city: string
  prefs: Prefs
  cmp: string[]
  /** Starred cities, in the order they were starred. Uncapped. */
  stars: string[]
  view: View
  disc: DiscoverQuery
}

/** Star a city, or unstar it. */
export const toggleStar = (stars: string[], id: string): string[] =>
  stars.includes(id) ? stars.filter((x) => x !== id) : [...stars, id]

/** Comma-separated city ids: unknown ones and repeats dropped. */
const cityList = (s: string | null) => [...new Set((s ?? '').split(','))].filter((id) => cityById(id))

export function decodeSession(q: URLSearchParams): Session {
  const view = q.get('view')
  return {
    city: cityById(q.get('city') ?? '')?.id ?? DEFAULT_CITY,
    prefs: decodePrefs(q),
    cmp: cityList(q.get('cmp')).slice(0, MAX_COMPARE),
    stars: cityList(q.get('star')),
    view: VIEWS.includes(view as View) ? (view as View) : 'city',
    disc: decodeDiscover(q),
  }
}

export function encodeSession(s: Session): URLSearchParams {
  const q = new URLSearchParams()
  if (s.view !== 'city') q.set('view', s.view)
  q.set('city', s.city)
  encodePrefs(s.prefs, q)
  if (s.cmp.length) q.set('cmp', s.cmp.join(','))
  if (s.stars.length) q.set('star', s.stars.join(','))
  encodeDiscover(s.disc, q)
  return q
}

/** The query string, with commas and tildes left readable. */
export const sessionSearch = (s: Session) => encodeSession(s).toString().replace(/%2C/g, ',').replace(/%7E/g, '~')
