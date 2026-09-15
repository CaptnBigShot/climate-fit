// The whole session — city, screen, preferences, compare set and Discover query —
// round-trips through the URL. There are no accounts: a bookmark saves the session
// and a link shares it, comparison included.
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
  view: View
  disc: DiscoverQuery
}

export function decodeSession(q: URLSearchParams): Session {
  const view = q.get('view')
  return {
    city: cityById(q.get('city') ?? '')?.id ?? DEFAULT_CITY,
    prefs: decodePrefs(q),
    cmp: [...new Set((q.get('cmp') ?? '').split(','))].filter((id) => cityById(id)).slice(0, MAX_COMPARE),
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
  encodeDiscover(s.disc, q)
  return q
}

/** The query string, with commas and tildes left readable. */
export const sessionSearch = (s: Session) => encodeSession(s).toString().replace(/%2C/g, ',').replace(/%7E/g, '~')
