// The opening state: nothing set, nothing scored — and still useful. Starting points
// carry equal weight whatever weather they describe, and the one ranking shown needs
// no preference at all, because walking is a published physical threshold, not taste.
import { CITIES } from '../lib/data'
import { EXAMPLE_STATE, PRESETS, presetNote, windowLabel, type Prefs, type Window } from '../lib/prefs'
import type { CityRow } from '../lib/model'
import type { Units } from '../lib/units'
import { DaysBar, Head } from './ui'

export function StartingPoints({ u, set, openMethods }: { u: Units; set: (patch: Partial<Prefs>) => void; openMethods: () => void }) {
  const example = presetNote({ name: '', apply: EXAMPLE_STATE }, u.t, u.tu)
  return (
    <div className="section">
      <div className="section-head">
        <Head tip="Ordered alphabetically. The cold and gray options carry the same visual weight as the warm ones — the app has no opinion about which of these is good weather.">STARTING POINTS</Head>
        <span className="sub">
          alphabetical · each overwrites the band · every threshold published in <button className="inline-link" onClick={openMethods}>data &amp; methods</button>
        </span>
      </div>
      <div className="preset-grid">
        {PRESETS.map((pr) => (
          <button key={pr.name} className="preset-card" onClick={() => set(pr.apply)}>
            <span className="name">{pr.name}</span>
            <span className="note">{presetNote(pr, u.t, u.tu)}</span>
          </button>
        ))}
        <button className="preset-card example" onClick={() => set(EXAMPLE_STATE)}
          data-tip="Not a preset: the specification's own test case — a cold-preferring, seasonal, outdoor-active person. If the app reads correctly for them, the warm bias has been designed out.">
          <span className="name">Worked example</span>
          <span className="note">{example} · walk + ride</span>
        </button>
      </div>
    </div>
  )
}

export function OutdoorRanking({ rows, current, w, openCity }: { rows: CityRow[]; current: string; w: Window; openCity: (id: string) => void }) {
  const walk = (r: CityRow) => r.out.act.per.walk.days
  const ranked = [...rows].sort((a, b) => walk(b) - walk(a) || a.city.name.localeCompare(b.city.name))
  const pending = CITIES.length - rows.length
  return (
    <div className="section">
      <div className="section-head">
        <Head tip="Walk-viable days are a physical constraint with a published threshold, not a taste assumption — which is why this ranking is legitimate before any preference is stated.">WHERE COULD YOU BE OUTSIDE MOST DAYS</Head>
        <span className="sub">zero input required · ranked on walk-viable days · {windowLabel(w)}</span>
      </div>
      <div className="rank-grid" style={{ gridTemplateRows: `repeat(${Math.ceil(CITIES.length / 2)}, auto)` }}>
        {ranked.map((r, i) => (
          <button key={r.city.id} className="rank-row" aria-current={r.city.id === current ? 'true' : undefined} onClick={() => openCity(r.city.id)}
            data-tip={`${r.city.name}: walking is viable on ${Math.round(walk(r))} days a year, and at least one enabled activity on ${Math.round(r.out.act.outAny)}. Click to open the city.`}>
            <span className="rk">{String(i + 1).padStart(2, '0')}</span>
            <span className="nm">{r.city.name}, {r.city.code}</span>
            <DaysBar days={walk(r)} width={190} />
            <span className="v">{Math.round(walk(r))}</span>
            <span className="any">walk · {Math.round(r.out.act.outAny)} any</span>
          </button>
        ))}
        {pending > 0 && <span className="cap" style={{ padding: '8px 0' }}>loading {pending} more {pending === 1 ? 'city' : 'cities'}…</span>}
      </div>
    </div>
  )
}
