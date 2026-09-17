// Discover: every city in the curated set ranked on the session state. Two entry
// modes, and a result set that is never empty (spec 4.3). Scores are personal and
// labelled as such; the outdoor ranking uses only published physical thresholds.
import { memo, useMemo } from 'react'
import { CITIES, cityById } from '../lib/data'
import { CO } from '../lib/colors'
import { cityPoint } from '../lib/mapView'
import { windowLabel, type Prefs } from '../lib/prefs'
import { climateOf, type CityRow } from '../lib/model'
import {
  FALLBACK_COMF,
  POP_SPLIT,
  REGIONS,
  SHIFTS,
  SHIFT_LABEL,
  SORTS,
  SORT_LABEL,
  likeBut,
  rank,
  shiftClimate,
  type DiscoverQuery,
  type Ranked,
  type Ranking,
} from '../lib/discover'
import type { Units } from '../lib/units'
import { DaysBar, Seg, SplitBar, StarButton } from './ui'
import { CitySelect } from './CityPicker'
import { WorldMap } from './WorldMap'

const FT = 3.28084
/** Below this R² a trend is shown but not coloured: the fit is mostly year-to-year noise. */
const WEAK_R2 = 0.3

export const Discover = memo(function Discover({
  rows,
  p,
  u,
  q,
  setQ,
  openCity,
  current,
  failed,
  stars,
  toggleStar,
}: {
  rows: CityRow[]
  p: Prefs
  u: Units
  q: DiscoverQuery
  setQ: (patch: Partial<DiscoverQuery>) => void
  openCity: (id: string) => void
  current: string
  failed: Record<string, string>
  stars: string[]
  toggleStar: (id: string) => void
}) {
  const cands = useMemo(() => rows.map((r) => ({ city: r.city, b: r.fit?.b ?? null, act: r.out.act })), [rows])
  const R = useMemo(() => rank(cands, q, p.drive, stars), [cands, q, p.drive, stars])
  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.city.id, r])), [rows])
  const starred = useMemo(() => new Set(stars), [stars])
  const scored = rows.some((r) => r.fit)
  const comfort = R.mode === 'comfort'
  const filtered = q.region !== 'all' || q.pop !== 'any' || q.snow || q.coast !== 'any'
  const loading = CITIES.length - rows.length - Object.keys(failed).length
  const win = windowLabel(p.window)
  const scopeWord = q.scope === 'all' ? '' : `${q.scope} `
  const inScope = { all: CITIES.length, starred: stars.length, unstarred: CITIES.length - stars.length }[q.scope]
  const empty =
    q.scope === 'starred' && !stars.length
      ? 'No starred cities yet. Star one with ☆ under ALL, or on its city page.'
      : q.scope === 'unstarred' && !inScope
        ? 'Every city is starred.'
        : 'Loading the city set…'
  const points = useMemo(() => R.rows.map((x, i) => cityPoint(x.c, comfort, current, i)), [R.rows, comfort, current])

  return (
    <main className="page">
      <div className="view-head">
        <span className="view-title">DISCOVER</span>
        <div className="seg" role="group" aria-label="Ranking">
          <button aria-pressed={comfort} disabled={!scored} onClick={() => setQ({ rank: 'comfort' })}>
            COMFORT RANKING{scored ? '' : ' · NEEDS A PREFERENCE'}
          </button>
          <button aria-pressed={!comfort} onClick={() => setQ({ rank: 'outdoor' })}>
            OUTDOOR RANKING · NO INPUT
          </button>
        </div>
        <Seg
          label="Starred"
          value={q.scope}
          onChange={(v) => setQ({ scope: v })}
          options={[
            { v: 'all', label: 'ALL' },
            { v: 'starred', label: `★ STARRED · ${stars.length}` },
            { v: 'unstarred', label: 'UNSTARRED' },
          ]}
        />
        <span className="sub">
          {R.passing} of {inScope} {scopeWord}cities pass the filters · {win}
          {loading > 0 ? ` · ${loading} still loading` : ''}
        </span>
        <span className="view-note">
          {comfort
            ? 'Ranked against your stated preference. Every figure is personal and labelled as such.'
            : 'Ranked on published physical thresholds only — no stated preference is used, so this view works before you set anything.'}
        </span>
      </div>

      {R.fallback && (
        <div className="banner">
          <span className="tag">FALLBACK</span>
          <span>
            No city reaches {FALLBACK_COMF} comfortable days under these settings. Ranked by fewest unbearable days
            instead — the tool does not return an empty set.
          </span>
        </div>
      )}
      {R.nearMiss && (
        <div className="banner">
          <span className="tag">NEAREST</span>
          <span>
            No {scopeWord}city passes every filter. Showing the {R.rows.length} that miss{' '}
            {R.rows[0]?.misses.length === 1 ? 'only one' : `${R.rows[0]?.misses.length}`}, with what each misses — RESET
            clears the filters.
          </span>
        </div>
      )}

      <div className="filters">
        <span className="cap">FILTERS</span>
        <select className="ctl" value={q.region} onChange={(e) => setQ({ region: e.target.value })} aria-label="Region">
          <option value="all">All regions</option>
          {REGIONS.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          className="ctl"
          value={q.pop}
          onChange={(e) => setQ({ pop: e.target.value as DiscoverQuery['pop'] })}
          aria-label="Population"
        >
          <option value="any">Any population</option>
          <option value="big">≥ {POP_SPLIT / 1000}k</option>
          <option value="small">&lt; {POP_SPLIT / 1000}k</option>
        </select>
        <select
          className="ctl"
          value={q.snow ? 'yes' : 'any'}
          onChange={(e) => setQ({ snow: e.target.value === 'yes' })}
          aria-label="Snow access"
          data-tip="Keeps only cities with reference ski terrain inside the drive limit set in the control bar."
        >
          <option value="any">Any snow access</option>
          <option value="yes">Snow within ≤{p.drive} hr</option>
        </select>
        <select
          className="ctl"
          value={q.coast}
          onChange={(e) => setQ({ coast: e.target.value as DiscoverQuery['coast'] })}
          aria-label="Coast"
        >
          <option value="any">Coastal or inland</option>
          <option value="coastal">Coastal</option>
          <option value="inland">Inland</option>
        </select>
        <button
          className="link-btn"
          disabled={!filtered}
          onClick={() => setQ({ region: 'all', pop: 'any', snow: false, coast: 'any' })}
        >
          RESET
        </button>
        {comfort && (
          <>
            <span className="divider" />
            <Seg
              small
              label="Sort"
              value={R.sort}
              onChange={(v) => setQ({ sort: v as DiscoverQuery['sort'] })}
              options={SORTS.map((s) => ({ v: s.v, label: s.label.toUpperCase() }))}
            />
          </>
        )}
        <span className="sub" style={{ marginLeft: 'auto', color: 'var(--mid)' }}>
          sorted by {SORT_LABEL[R.sort].toLowerCase()}
        </span>
      </div>

      <div className="disc-grid">
        <div className="disc-main">
          <div className="table-scroll">
            <RankTable
              R={R}
              byId={byId}
              u={u}
              current={current}
              openCity={openCity}
              starred={starred}
              toggleStar={toggleStar}
              empty={empty}
            />
          </div>
          <div className="prose" style={{ marginTop: 14, fontSize: 11, color: 'var(--dim)' }}>
            {comfort
              ? 'Scores are personal: they are your settings applied to each city, not a verdict on the city. '
              : ''}
            The curated set is the universe for ranking; any city can still be opened and read on its own page.
          </div>
        </div>
        <div className="disc-side">
          <div>
            <div className="h-sm" style={{ marginBottom: 10 }}>
              Where these are
            </div>
            <WorldMap points={points} onPick={openCity} label="Map of the ranked cities" />
            <div className="cap" style={{ marginTop: 8, whiteSpace: 'normal', lineHeight: 1.5 }}>
              LAT / LON GRID · FILL = {comfort ? 'COMFORTABLE SHARE OF YOUR YEAR' : 'OUTDOOR ENCODING'} · RADIUS ={' '}
              {comfort ? 'OUTDOOR DAYS' : 'WALK-VIABLE DAYS'} · DRAG TO PAN · PINCH OR CTRL-SCROLL TO ZOOM · LAND:
              NATURAL EARTH 1:110M
            </div>
          </div>
          <LikeBut
            rows={rows}
            byId={byId}
            q={q}
            setQ={setQ}
            current={current}
            p={p}
            u={u}
            scored={scored}
            openCity={openCity}
          />
        </div>
      </div>
    </main>
  )
})

function RankTable({
  R,
  byId,
  u,
  current,
  openCity,
  starred,
  toggleStar,
  empty,
}: {
  R: Ranking
  byId: Record<string, CityRow>
  u: Units
  current: string
  openCity: (id: string) => void
  starred: ReadonlySet<string>
  toggleStar: (id: string) => void
  /** What an empty table says: still loading, or nothing in the star scope. */
  empty: string
}) {
  const comfort = R.mode === 'comfort'
  const star = (x: Ranked) => (
    <td className="l" style={{ padding: '0 0 0 4px' }}>
      <StarButton on={starred.has(x.c.city.id)} name={x.c.city.name} onClick={() => toggleStar(x.c.city.id)} />
    </td>
  )
  const name = (x: Ranked) => (
    <button className="city-link" onClick={() => openCity(x.c.city.id)} data-tip={`Open ${x.c.city.name}'s dashboard.`}>
      {x.c.city.id === current && <span className="dot">●</span>}
      {x.c.city.name}, {x.c.city.code}
    </button>
  )
  const snowRef = (id: string) => {
    const t = byId[id]?.out.terrain
    return t ? `${t.name} ${t.driveMin}m` : '—'
  }
  const misses = (x: Ranked) =>
    R.nearMiss && (
      <td className="l" style={{ color: 'var(--warn)' }}>
        {x.misses.join(' · ')}
      </td>
    )
  return (
    <table className="plain rank">
      <thead>
        {comfort ? (
          <tr>
            <th />
            <th className="l">#</th>
            <th className="l">CITY</th>
            <th className="l">REGION</th>
            <th>ELEV</th>
            <th className="l">BAND SPLIT · 365 D</th>
            <th>COMF</th>
            <th>TOL</th>
            <th>UNB</th>
            <th>OUTDOOR</th>
            <th
              data-tip={`Least-squares slope of comfortable days per year across the window — whether this city is getting better or worse for you. Coloured only where R² ≥ ${WEAK_R2}; below that the fit is mostly noise.`}
            >
              TREND D/YR
            </th>
            <th data-tip="How much of the year-to-year variation the trend explains. Low R² = mostly noise.">R²</th>
            <th className="l">TOP SHORTFALL</th>
            <th className="l">SNOW REF</th>
            {R.nearMiss && <th className="l">MISSES</th>}
          </tr>
        ) : (
          <tr>
            <th />
            <th className="l">#</th>
            <th className="l">CITY</th>
            <th className="l">REGION</th>
            <th className="l">WALK-VIABLE · 365 D</th>
            <th>WALK</th>
            <th>RUN</th>
            <th>RIDE</th>
            <th data-tip="Days on which at least one enabled activity is possible.">≥1 ACTIVITY</th>
            <th className="l">SNOW REF</th>
            {R.nearMiss && <th className="l">MISSES</th>}
          </tr>
        )}
      </thead>
      <tbody>
        {R.rows.map((x, i) => {
          const { city, b, act } = x.c
          const rk = (
            <td className="l" style={{ color: 'var(--faint)' }}>
              {String(i + 1).padStart(2, '0')}
            </td>
          )
          return comfort && b ? (
            <tr key={city.id}>
              {star(x)}
              {rk}
              <td className="l strong">{name(x)}</td>
              <td className="l" style={{ color: 'var(--dim)' }}>
                {city.continent}
              </td>
              <td>{u.elev(byId[city.id].s.demElevM * FT)}</td>
              <td className="l">
                <SplitBar b={b} width={200} />
              </td>
              <td style={{ color: CO.comf }}>{Math.round(b.counts[0])}</td>
              <td style={{ color: CO.tol }}>{Math.round(b.counts[1])}</td>
              <td style={{ color: 'var(--unb-text)' }}>{Math.round(b.counts[2])}</td>
              <td style={{ color: CO.act }}>{Math.round(act.outAny)}</td>
              <td
                style={{ color: b.trend.r2 < WEAK_R2 ? 'var(--dim)' : b.trend.slope >= 0 ? CO.comf : CO.warn }}
                data-tip={
                  b.trend.r2 < WEAK_R2
                    ? `R² ${b.trend.r2.toFixed(2)}: a weak fit — mostly year-to-year noise, so the slope is left uncoloured.`
                    : undefined
                }
              >
                {b.trend.slope >= 0 ? '+' : '−'}
                {Math.abs(b.trend.slope).toFixed(2)}
              </td>
              <td style={{ color: 'var(--faint)' }}>{b.trend.r2.toFixed(2)}</td>
              <td className="l">{b.reasons[0]?.label ?? '—'}</td>
              <td className="l" style={{ color: 'var(--dim)' }}>
                {snowRef(city.id)}
              </td>
              {misses(x)}
            </tr>
          ) : (
            <tr key={city.id}>
              {star(x)}
              {rk}
              <td className="l strong">{name(x)}</td>
              <td className="l" style={{ color: 'var(--dim)' }}>
                {city.continent}
              </td>
              <td className="l">
                <DaysBar days={act.per.walk.days} width={200} height={9} />
              </td>
              <td style={{ color: CO.act }}>{Math.round(act.per.walk.days)}</td>
              <td>{Math.round(act.per.run.days)}</td>
              <td>{Math.round(act.per.ride.days)}</td>
              <td className="strong">{Math.round(act.outAny)}</td>
              <td className="l" style={{ color: 'var(--dim)' }}>
                {snowRef(city.id)}
              </td>
              {misses(x)}
            </tr>
          )
        })}
        {!R.rows.length && (
          <tr>
            <td className="l" colSpan={15} style={{ color: 'var(--dim)', padding: '12px 8px' }}>
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

// ---------------- Like [city] but ___ ----------------

function LikeBut({
  rows,
  byId,
  q,
  setQ,
  current,
  p,
  u,
  scored,
  openCity,
}: {
  rows: CityRow[]
  byId: Record<string, CityRow>
  q: DiscoverQuery
  setQ: (patch: Partial<DiscoverQuery>) => void
  current: string
  p: Prefs
  u: Units
  scored: boolean
  openCity: (id: string) => void
}) {
  const climates = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.city.id, climateOf(r.s, p.window, r.out.act.per.ride.days)])),
    [rows, p.window],
  )
  const ref = q.like ?? current
  const res = likeBut(ref, q.but, climates, 4)
  const target = climates[ref] ? shiftClimate(climates[ref], q.but) : null
  const describe = (c: { hi: number; dew: number; cloud: number; rad: number; snow: number }) =>
    `high ${u.t(c.hi)}${u.tu} · dew ${u.t(c.dew)} · cloud ${Math.round(c.cloud)}% · sun ${c.rad.toFixed(1)} MJ · snow ${Math.max(0, Math.round(c.snow))} d`
  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="h-sm">Like</span>
        <CitySelect
          value={ref}
          onChange={(id) => setQ({ like: id })}
          label="Reference city"
          style={{ font: '500 11px/1 var(--sans)' }}
        />
        <span className="h-sm">but</span>
        <Seg
          small
          label="Shift"
          value={q.but}
          onChange={(v) => setQ({ but: v })}
          options={SHIFTS.map((s) => ({ v: s, label: SHIFT_LABEL[s].toUpperCase() }))}
        />
      </div>
      {target && (
        <div className="cap" style={{ marginBottom: 10, whiteSpace: 'normal', lineHeight: 1.5 }}>
          TARGET · {describe(target).toUpperCase()}
        </div>
      )}
      {res.map((x) => {
        const r = byId[x.id],
          c = climates[x.id]
        return (
          <button
            key={x.id}
            className="like-row"
            onClick={() => openCity(x.id)}
            data-tip={`Open ${cityById(x.id)!.name}. Distance ${x.d.toFixed(2)} in climate space.`}
          >
            <span className="nm">
              {r.city.name}, {r.city.code}
            </span>
            <span className="note">{describe(c)}</span>
            <span
              className="fit"
              style={{ color: scored ? CO.comf : CO.act }}
              data-tip={scored ? 'Comfortable days a year for you.' : 'Walk-viable days a year.'}
            >
              {Math.round(scored && r.fit ? r.fit.b.counts[0] : r.out.act.per.walk.days)}
            </span>
            <span className="match">{x.match}%</span>
          </button>
        )
      })}
      {!climates[ref] && <div className="prose">Loading {cityById(ref)?.name}…</div>}
      <div className="prose" style={{ marginTop: 8, fontSize: 10.5, color: 'var(--dim)' }}>
        Match is a distance in climate space — mean high, dew point, cloud cover, solar intensity and snow-sport days in
        reach — with the chosen axis shifted before the search.{' '}
        {scored ? 'The green figure is comfortable days for you.' : 'The amber figure is walk-viable days.'}
      </div>
    </div>
  )
}
