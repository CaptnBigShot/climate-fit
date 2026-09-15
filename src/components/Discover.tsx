// Discover: every city in the curated set ranked on the session state. Two entry
// modes, and a result set that is never empty (spec 4.3). Scores are personal and
// labelled as such; the outdoor ranking uses only published physical thresholds.
import { memo, useEffect, useMemo, useState } from 'react'
import { CITIES, cityById, loadLand } from '../lib/data'
import { CO, contColor } from '../lib/colors'
import { windowLabel, type Prefs } from '../lib/prefs'
import { climateOf, type CityRow } from '../lib/model'
import { FALLBACK_COMF, POP_SPLIT, REGIONS, SHIFTS, SHIFT_LABEL, SORTS, SORT_LABEL, likeBut, rank, shiftClimate, type DiscoverQuery, type Ranked, type Ranking } from '../lib/discover'
import type { Units } from '../lib/units'
import { DaysBar, Seg, SplitBar } from './ui'
import { CitySelect } from './CityPicker'
import { useWidth } from '../hooks/useWidth'

const FT = 3.28084
/** Below this R² a trend is shown but not coloured: the fit is mostly year-to-year noise. */
const WEAK_R2 = 0.3

export const Discover = memo(function Discover({ rows, p, u, q, setQ, openCity, current, failed }: {
  rows: CityRow[]; p: Prefs; u: Units; q: DiscoverQuery; setQ: (patch: Partial<DiscoverQuery>) => void
  openCity: (id: string) => void; current: string; failed: Record<string, string>
}) {
  const cands = useMemo(() => rows.map((r) => ({ city: r.city, b: r.fit?.b ?? null, act: r.out.act })), [rows])
  const R = useMemo(() => rank(cands, q, p.drive), [cands, q, p.drive])
  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.city.id, r])), [rows])
  const scored = rows.some((r) => r.fit)
  const comfort = R.mode === 'comfort'
  const filtered = q.region !== 'all' || q.pop !== 'any' || q.snow || q.coast !== 'any'
  const loading = CITIES.length - rows.length - Object.keys(failed).length
  const win = windowLabel(p.window)

  return (
    <main className="page">
      <div className="view-head">
        <span className="view-title">DISCOVER</span>
        <div className="seg" role="group" aria-label="Ranking">
          <button aria-pressed={comfort} disabled={!scored} onClick={() => setQ({ rank: 'comfort' })}>COMFORT RANKING{scored ? '' : ' · NEEDS A PREFERENCE'}</button>
          <button aria-pressed={!comfort} onClick={() => setQ({ rank: 'outdoor' })}>OUTDOOR RANKING · NO INPUT</button>
        </div>
        <span className="sub">{R.passing} of {CITIES.length} cities pass the filters · {win}{loading > 0 ? ` · ${loading} still loading` : ''}</span>
        <span className="view-note">
          {comfort
            ? 'Ranked against your stated preference. Every figure is personal and labelled as such.'
            : 'Ranked on published physical thresholds only — no stated preference is used, so this view works before you set anything.'}
        </span>
      </div>

      {R.fallback && (
        <div className="banner">
          <span className="tag">FALLBACK</span>
          <span>No city reaches {FALLBACK_COMF} comfortable days under these settings. Ranked by fewest unbearable days instead — the tool does not return an empty set.</span>
        </div>
      )}
      {R.nearMiss && (
        <div className="banner">
          <span className="tag">NEAREST</span>
          <span>No city passes every filter. Showing the {R.rows.length} that miss {R.rows[0]?.misses.length === 1 ? 'only one' : `${R.rows[0]?.misses.length}`}, with what each misses — RESET clears the filters.</span>
        </div>
      )}

      <div className="filters">
        <span className="cap">FILTERS</span>
        <select className="ctl" value={q.region} onChange={(e) => setQ({ region: e.target.value })} aria-label="Region">
          <option value="all">All regions</option>
          {REGIONS.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
        </select>
        <select className="ctl" value={q.pop} onChange={(e) => setQ({ pop: e.target.value as DiscoverQuery['pop'] })} aria-label="Population">
          <option value="any">Any population</option>
          <option value="big">≥ {POP_SPLIT / 1000}k</option>
          <option value="small">&lt; {POP_SPLIT / 1000}k</option>
        </select>
        <select className="ctl" value={q.snow ? 'yes' : 'any'} onChange={(e) => setQ({ snow: e.target.value === 'yes' })} aria-label="Snow access"
          data-tip="Keeps only cities with reference ski terrain inside the drive limit set in the control bar.">
          <option value="any">Any snow access</option>
          <option value="yes">Snow within ≤{p.drive} hr</option>
        </select>
        <select className="ctl" value={q.coast} onChange={(e) => setQ({ coast: e.target.value as DiscoverQuery['coast'] })} aria-label="Coast">
          <option value="any">Coastal or inland</option>
          <option value="coastal">Coastal</option>
          <option value="inland">Inland</option>
        </select>
        <button className="link-btn" disabled={!filtered} onClick={() => setQ({ region: 'all', pop: 'any', snow: false, coast: 'any' })}>RESET</button>
        {comfort && (
          <>
            <span className="divider" />
            <Seg small label="Sort" value={R.sort} onChange={(v) => setQ({ sort: v as DiscoverQuery['sort'] })} options={SORTS.map((s) => ({ v: s.v, label: s.label.toUpperCase() }))} />
          </>
        )}
        <span className="sub" style={{ marginLeft: 'auto', color: 'var(--mid)' }}>sorted by {SORT_LABEL[R.sort].toLowerCase()}</span>
      </div>

      <div className="disc-grid">
        <div className="disc-main">
          <div className="table-scroll">
            <RankTable R={R} byId={byId} u={u} current={current} openCity={openCity} />
          </div>
          <div className="prose" style={{ marginTop: 14, fontSize: 11, color: 'var(--dim)' }}>
            {comfort ? 'Scores are personal: they are your settings applied to each city, not a verdict on the city. ' : ''}
            The curated set is the universe for ranking; any city can still be opened and read on its own page.
          </div>
        </div>
        <div className="disc-side">
          <div>
            <div className="h-sm" style={{ marginBottom: 10 }}>Where these are</div>
            <WorldMap R={R} byId={byId} comfort={comfort} current={current} openCity={openCity} />
            <div className="cap" style={{ marginTop: 8, whiteSpace: 'normal', lineHeight: 1.5 }}>
              LAT / LON GRID · FILL = {comfort ? 'COMFORTABLE SHARE OF YOUR YEAR' : 'OUTDOOR ENCODING'} · RADIUS = {comfort ? 'OUTDOOR DAYS' : 'WALK-VIABLE DAYS'} · LAND: NATURAL EARTH 1:110M
            </div>
          </div>
          <LikeBut rows={rows} byId={byId} q={q} setQ={setQ} current={current} p={p} u={u} scored={scored} openCity={openCity} />
        </div>
      </div>
    </main>
  )
})

function RankTable({ R, byId, u, current, openCity }: { R: Ranking; byId: Record<string, CityRow>; u: Units; current: string; openCity: (id: string) => void }) {
  const comfort = R.mode === 'comfort'
  const name = (x: Ranked) => <>{x.c.city.id === current && <span className="dot">●</span>}{x.c.city.name}, {x.c.city.code}</>
  const snowRef = (id: string) => {
    const t = byId[id]?.out.terrain
    return t ? `${t.name} ${t.driveMin}m` : '—'
  }
  const open = (id: string) => <button className="link-btn" style={{ padding: '4px 6px' }} onClick={() => openCity(id)}>OPEN →</button>
  const misses = (x: Ranked) => R.nearMiss && <td className="l" style={{ color: 'var(--warn)' }}>{x.misses.join(' · ')}</td>
  return (
    <table className="plain rank">
      <thead>
        {comfort ? (
          <tr>
            <th className="l">#</th><th className="l">CITY</th><th className="l">REGION</th><th>ELEV</th><th className="l">BAND SPLIT · 365 D</th>
            <th>COMF</th><th>TOL</th><th>UNB</th><th>OUTDOOR</th>
            <th data-tip={`Least-squares slope of comfortable days per year across the window — whether this city is getting better or worse for you. Coloured only where R² ≥ ${WEAK_R2}; below that the fit is mostly noise.`}>TREND D/YR</th>
            <th data-tip="How much of the year-to-year variation the trend explains. Low R² = mostly noise.">R²</th>
            <th className="l">TOP SHORTFALL</th><th className="l">SNOW REF</th>{R.nearMiss && <th className="l">MISSES</th>}<th />
          </tr>
        ) : (
          <tr>
            <th className="l">#</th><th className="l">CITY</th><th className="l">REGION</th><th className="l">WALK-VIABLE · 365 D</th>
            <th>WALK</th><th>RUN</th><th>RIDE</th><th data-tip="Days on which at least one enabled activity is possible.">≥1 ACTIVITY</th>
            <th className="l">SNOW REF</th>{R.nearMiss && <th className="l">MISSES</th>}<th />
          </tr>
        )}
      </thead>
      <tbody>
        {R.rows.map((x, i) => {
          const { city, b, act } = x.c
          const rk = <td className="l" style={{ color: 'var(--faint)' }}>{String(i + 1).padStart(2, '0')}</td>
          return comfort && b ? (
            <tr key={city.id}>
              {rk}<td className="l strong">{name(x)}</td><td className="l" style={{ color: 'var(--dim)' }}>{city.continent}</td>
              <td>{u.elev(byId[city.id].s.demElevM * FT)}</td>
              <td className="l"><SplitBar b={b} width={200} id={`hatch-dr-${city.id}`} /></td>
              <td style={{ color: CO.comf }}>{Math.round(b.counts[0])}</td>
              <td style={{ color: CO.tol }}>{Math.round(b.counts[1])}</td>
              <td style={{ color: 'var(--unb-text)' }}>{Math.round(b.counts[2])}</td>
              <td style={{ color: CO.act }}>{Math.round(act.outAny)}</td>
              <td style={{ color: b.trend.r2 < WEAK_R2 ? 'var(--dim)' : b.trend.slope >= 0 ? CO.comf : CO.warn }}
                data-tip={b.trend.r2 < WEAK_R2 ? `R² ${b.trend.r2.toFixed(2)}: a weak fit — mostly year-to-year noise, so the slope is left uncoloured.` : undefined}>
                {b.trend.slope >= 0 ? '+' : '−'}{Math.abs(b.trend.slope).toFixed(2)}
              </td>
              <td style={{ color: 'var(--faint)' }}>{b.trend.r2.toFixed(2)}</td>
              <td className="l">{b.reasons[0]?.label ?? '—'}</td>
              <td className="l" style={{ color: 'var(--dim)' }}>{snowRef(city.id)}</td>
              {misses(x)}
              <td>{open(city.id)}</td>
            </tr>
          ) : (
            <tr key={city.id}>
              {rk}<td className="l strong">{name(x)}</td><td className="l" style={{ color: 'var(--dim)' }}>{city.continent}</td>
              <td className="l"><DaysBar days={act.per.walk.days} width={200} height={9} /></td>
              <td style={{ color: CO.act }}>{Math.round(act.per.walk.days)}</td>
              <td>{Math.round(act.per.run.days)}</td>
              <td>{Math.round(act.per.ride.days)}</td>
              <td className="strong">{Math.round(act.outAny)}</td>
              <td className="l" style={{ color: 'var(--dim)' }}>{snowRef(city.id)}</td>
              {misses(x)}
              <td>{open(city.id)}</td>
            </tr>
          )
        })}
        {!R.rows.length && <tr><td className="l" colSpan={15} style={{ color: 'var(--dim)', padding: '12px 8px' }}>Loading the city set…</td></tr>}
      </tbody>
    </table>
  )
}

// ---------------- Map ----------------

const LAT_TOP = 80, LAT_BOT = -60

function WorldMap({ R, byId, comfort, current, openCity }: { R: Ranking; byId: Record<string, CityRow>; comfort: boolean; current: string; openCity: (id: string) => void }) {
  const [land, setLand] = useState<{ scale: number; d: string } | null>(null)
  useEffect(() => { let live = true; loadLand().then((l) => live && setLand(l)).catch(() => undefined); return () => { live = false } }, [])
  const [ref, W] = useWidth<HTMLDivElement>()
  const H = (W * (LAT_TOP - LAT_BOT)) / 360
  const px = (lon: number) => ((lon + 180) / 360) * W
  const py = (lat: number) => ((LAT_TOP - lat) / (LAT_TOP - LAT_BOT)) * H

  const marks = useMemo(() => {
    if (!W) return []
    const pts = R.rows.map((x, i) => {
      const { city, b, act } = x.c
      const value = comfort && b ? b.counts[0] : act.per.walk.days
      const r = 3 + ((comfort ? act.outAny : act.per.walk.days) / 365) * 4.5
      return { id: city.id, name: city.name, x: px(city.lon), y: py(city.lat), r, value, rank: i, fill: comfort && b ? contColor((b.counts[0] / 365) * 100) : CO.act }
    })
    // Greedy label placement in rank order: try beside the point, then stack above it on a leader line.
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = pts.map((q) => ({ x0: q.x - q.r, y0: q.y - q.r, x1: q.x + q.r, y1: q.y + q.r }))
    const hit = (b: { x0: number; y0: number; x1: number; y1: number }) => b.x0 < 0 || b.x1 > W || b.y0 < 0 || b.y1 > H || boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)
    return pts.map((q) => {
      const text = `${q.name} ${Math.round(q.value)}`, tw = text.length * 5.5, th = 9
      const at = (dx: number, dy: number, anchor: 'start' | 'end') => {
        const x0 = anchor === 'start' ? q.x + dx : q.x + dx - tw
        return { x: q.x + dx, y: q.y + dy, anchor, box: { x0, y0: q.y + dy - th + 1, x1: x0 + tw, y1: q.y + dy + 2 } }
      }
      const tries = [at(q.r + 3, 3, 'start'), at(-q.r - 3, 3, 'end'), at(q.r + 2, -q.r - 2, 'start'), at(q.r + 2, q.r + 9, 'start'), at(-q.r - 2, -q.r - 2, 'end'), at(-q.r - 2, q.r + 9, 'end')]
      for (let k = 1; k <= 6; k++) tries.push(at(10, -q.r - 4 - 11 * k, 'start'), at(-10, -q.r - 4 - 11 * k, 'end'))
      const pick = tries.find((t) => !hit(t.box)) ?? tries[tries.length - 1]
      boxes.push(pick.box)
      const leader = Math.abs(pick.y - q.y) > q.r + 10
      return { ...q, label: { ...pick, text, leader } }
    })
  }, [R.rows, comfort, W, H]) // eslint-disable-line react-hooks/exhaustive-deps

  const grid = []
  if (W) {
    for (let lon = -180; lon <= 180; lon += 30) grid.push(<line key={`v${lon}`} x1={px(lon)} x2={px(lon)} y1={0} y2={H} stroke="#23262c" strokeWidth={0.6} />)
    for (let lat = -60; lat <= 80; lat += 30) grid.push(<line key={`h${lat}`} x1={0} x2={W} y1={py(lat)} y2={py(lat)} stroke={lat === 0 ? '#2e333b' : '#23262c'} strokeWidth={0.6} />)
  }
  return (
    <div ref={ref}>
      {W > 0 && (
        <svg width={W} height={H} style={{ display: 'block', background: '#121418', border: '1px solid var(--line)' }} role="img" aria-label="Map of the ranked cities">
          {land && <path d={land.d} fill="#1f2329" transform={`translate(${W / 2} ${(LAT_TOP * W) / 360}) scale(${W / 360 / land.scale})`} />}
          {grid}
          {marks.map((m) => m.label.leader && <line key={`l${m.id}`} x1={m.x} y1={m.y - m.r} x2={m.label.x} y2={m.label.y + 2} stroke="#3c4149" strokeWidth={0.8} />)}
          {marks.map((m) => {
            const row = byId[m.id], b = row?.fit?.b
            const tip = b && comfort
              ? `#${m.rank + 1} ${m.name}: ${Math.round(b.counts[0])} comfortable · ${Math.round(b.counts[1])} tolerable · ${Math.round(b.counts[2])} unbearable days/yr · ${Math.round(row.out.act.outAny)} outdoor days. Click to open.`
              : `#${m.rank + 1} ${m.name}: ${Math.round(row?.out.act.per.walk.days ?? 0)} walk-viable days/yr. Click to open.`
            return (
              <g key={m.id} onClick={() => openCity(m.id)} style={{ cursor: 'pointer' }} data-tip={tip}>
                <circle cx={m.x} cy={m.y} r={m.r} fill={m.fill} stroke={m.id === current ? '#e6e8ec' : '#8b929e'} strokeWidth={m.id === current ? 1.5 : 0.8} />
                <text x={m.label.x} y={m.label.y} textAnchor={m.label.anchor} fill="#a8aeb9" style={{ font: "400 9px 'JetBrains Mono', monospace" }}>{m.label.text}</text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

// ---------------- Like [city] but ___ ----------------

function LikeBut({ rows, byId, q, setQ, current, p, u, scored, openCity }: {
  rows: CityRow[]; byId: Record<string, CityRow>; q: DiscoverQuery; setQ: (patch: Partial<DiscoverQuery>) => void
  current: string; p: Prefs; u: Units; scored: boolean; openCity: (id: string) => void
}) {
  const climates = useMemo(() => Object.fromEntries(rows.map((r) => [r.city.id, climateOf(r.s, p.window, r.out.act.per.ride.days)])), [rows, p.window])
  const ref = q.like ?? current
  const res = likeBut(ref, q.but, climates, 4)
  const target = climates[ref] ? shiftClimate(climates[ref], q.but) : null
  const describe = (c: { hi: number; dew: number; cloud: number; rad: number; snow: number }) =>
    `high ${u.t(c.hi)}${u.tu} · dew ${u.t(c.dew)} · cloud ${Math.round(c.cloud)}% · sun ${c.rad.toFixed(1)} MJ · snow ${Math.max(0, Math.round(c.snow))} d`
  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="h-sm">Like</span>
        <CitySelect value={ref} onChange={(id) => setQ({ like: id })} label="Reference city" style={{ font: '500 11px/1 var(--sans)' }} />
        <span className="h-sm">but</span>
        <Seg small label="Shift" value={q.but} onChange={(v) => setQ({ but: v })} options={SHIFTS.map((s) => ({ v: s, label: SHIFT_LABEL[s].toUpperCase() }))} />
      </div>
      {target && <div className="cap" style={{ marginBottom: 10, whiteSpace: 'normal', lineHeight: 1.5 }}>TARGET · {describe(target).toUpperCase()}</div>}
      {res.map((x) => {
        const r = byId[x.id], c = climates[x.id]
        return (
          <button key={x.id} className="like-row" onClick={() => openCity(x.id)} data-tip={`Open ${cityById(x.id)!.name}. Distance ${x.d.toFixed(2)} in climate space.`}>
            <span className="nm">{r.city.name}, {r.city.code}</span>
            <span className="note">{describe(c)}</span>
            <span className="fit" style={{ color: scored ? CO.comf : CO.act }} data-tip={scored ? 'Comfortable days a year for you.' : 'Walk-viable days a year.'}>
              {Math.round(scored && r.fit ? r.fit.b.counts[0] : r.out.act.per.walk.days)}
            </span>
            <span className="match">{x.match}%</span>
          </button>
        )
      })}
      {!climates[ref] && <div className="prose">Loading {cityById(ref)?.name}…</div>}
      <div className="prose" style={{ marginTop: 8, fontSize: 10.5, color: 'var(--dim)' }}>
        Match is a distance in climate space — mean high, dew point, cloud cover, solar intensity and snow-sport days in reach — with the chosen axis shifted before the search. {scored ? 'The green figure is comfortable days for you.' : 'The amber figure is walk-viable days.'}
      </div>
    </div>
  )
}
