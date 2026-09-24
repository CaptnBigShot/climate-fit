import type { CityMeta } from './data'
import { MN } from './calendar'
import { windowLabel, type Prefs } from './prefs'
import type { View } from './session'
import type { Units } from './units'

export const TABS: { v: View; label: string; tip: string }[] = [
  { v: 'city', label: 'CITY', tip: 'One city in full depth.' },
  {
    v: 'compare',
    label: 'COMPARE',
    tip: 'Two to four cities side by side on these same settings. The set lives in the URL, so a link carries the comparison.',
  },
  {
    v: 'discover',
    label: 'DISCOVER',
    tip: 'Every city in the set ranked against these settings — or, with nothing set, by the days you could be outside.',
  },
  {
    v: 'methods',
    label: 'METHODS',
    tip: 'Data & methods: every source, formula and threshold the app uses on your behalf.',
  },
]

/** The one-line session summary and the seasonal-band note, shared by the desktop bar and the phone's. */
export function barText(p: Prefs, u: Units, city: CityMeta, warmMonths: boolean[] | null) {
  const t = p.temp
  const summary = [
    t ? `${u.t(t.idealMin)}–${u.t(t.idealMax)}${u.tu}` : 'band unset',
    t ? `ceiling ${t.hardMax === null ? '+∞' : u.t(t.hardMax)}` : null,
    p.dew ? `dew pt <${u.t(p.dew.idealMax)}` : null,
    p.strict,
    `${windowLabel(p.window)}`,
    p.sun === 'sun' ? 'in sun' : 'shade',
    p.seasonal ? 'seasonal on' : null,
    `snow ≤${p.drive} hr`,
  ]
    .filter(Boolean)
    .join(' · ')

  const warmNote = warmMonths
    ? (() => {
        const warm = warmMonths.map((w, m) => (w ? MN[m] : null)).filter(Boolean)
        return `${city.name}: warm season ${warm.join(' ')} — derived from its six warmest months in ${windowLabel(p.window)}.`
      })()
    : ''
  return { summary, warmNote }
}
