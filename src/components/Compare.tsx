// Compare: two to four cities scored on the one session state. Ranked and explained,
// never auto-picked — more snow against fewer heat days is not a trade the app is
// entitled to settle (spec 4.2). With no preference stated, the same screen compares
// the record as measured and the days you could be outside.
import { memo, useMemo, useRef, useState } from 'react'
import { cityById, type CityMeta, type Manifest } from '../lib/data'
import { MN, windowRows } from '../lib/calendar'
import { CO } from '../lib/colors'
import { facts, monthly, terrainCover } from '../lib/aggregate'
import { MAX_COMPARE, PIVOT, pivot, toggleCompare, type PivotMetric } from '../lib/compare'
import { windowLabel, type Prefs } from '../lib/prefs'
import { hasTerrainWithin, type CityRow } from '../lib/model'
import type { Units } from '../lib/units'
import { BudgetBar } from './Hero'
import { CalendarStrip, MonthAxis, TempLegend, type CalFill, type CalMode } from './ComfortCalendar'
import { BandLegend, Cap, Head, Seg } from './ui'
import { CityList } from './CityPicker'
import { useDismiss } from '../hooks/useDismiss'
import { useWidth } from '../hooks/useWidth'

const FT = 3.28084

export const Compare = memo(function Compare({ ids, rows, p, u, fill, setCmp, openCity, current, manifest, failed }: {
  ids: string[]; rows: CityRow[]; p: Prefs; u: Units; fill: CalFill
  setCmp: (ids: string[]) => void; openCity: (id: string) => void; current: string
  manifest: Manifest | null; failed: Record<string, string>
}) {
  const present = useMemo(() => ids.map((id) => rows.find((r) => r.city.id === id)).filter((r): r is CityRow => !!r), [ids, rows])
  const scored = present.some((r) => r.fit)
  const ordered = useMemo(() => [...present].sort(scored
    ? (a, b) => b.fit!.b.counts[0] - a.fit!.b.counts[0]
    : (a, b) => b.out.act.per.walk.days - a.out.act.per.walk.days), [present, scored])
  const waiting = ids.filter((id) => !present.some((r) => r.city.id === id))
  const win = windowLabel(p.window)
  const comf = useMemo(() => new Map(rows.flatMap((r) => (r.fit ? [[r.city.id, Math.round(r.fit.b.counts[0])] as const] : []))), [rows])
  const note = (c: CityMeta) => (comf.has(c.id) ? `comf ${comf.get(c.id)}` : null)

  return (
    <main className="page">
      <div className="view-head">
        <span className="view-title">COMPARE</span>
        <span className="sub">{ids.length} of {MAX_COMPARE} cities · one session state · {win}</span>
        <div className="chips">
          {ids.map((id) => {
            const c = cityById(id)!, r = present.find((x) => x.city.id === id)
            return (
              <button key={id} className="cmp-chip" onClick={() => setCmp(toggleCompare(ids, id))} aria-label={`Remove ${c.name} from compare`}
                data-tip="Remove this city from the compare set. The set is held in the URL, so the link carries the comparison.">
                {c.name}{r?.fit && <span className="n">{Math.round(r.fit.b.counts[0])}</span>}<span className="x">✕</span>
              </button>
            )
          })}
        </div>
        <AddCity ids={ids} setCmp={setCmp} note={note} />
        <span className="sub view-end">
          {ids.length === 1 ? 'add at least one more city to compare' : scored ? 'ordered by comfortable days · no winner picked' : 'not scored · ordered by walk-viable days'}
        </span>
      </div>

      {!ids.length ? (
        <div className="section" style={{ borderBottom: 'none' }}>
          <div className="empty">
            <div className="title">Nothing to compare yet.</div>
            <div className="prose" style={{ fontSize: 12.5 }}>
              Add two to four cities — here, or with “+ Add to compare” on any city page. Every city is scored on the same settings in the control bar,
              and the set lives in the URL, so sending the link sends the comparison.
            </div>
            <div className="city-inline">
              <CityList autoFocus={false} note={note} onPick={(id) => setCmp(toggleCompare(ids, id))} />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="section">
            <div className="section-head">
              {scored ? (
                <>
                  <Head tip="The same 365-day split for each city, drawn to a shared scale. Where no city is a clean win, this is the object that makes the trade visible.">DAY BUDGETS, SIDE BY SIDE</Head>
                  <span className="sub">shared scale · 365 days = full bar · ordered by comfortable days · no winner picked</span>
                </>
              ) : (
                <>
                  <Head tip="Nothing is scored until you state a preference. Walk-viable days need none: they rest on a published physical threshold, not on taste.">WALK-VIABLE DAYS, SIDE BY SIDE</Head>
                  <span className="sub">no preference stated · shared scale · 365 days = full bar</span>
                </>
              )}
            </div>
            {ordered.map((r) => <BudgetRow key={r.city.id} r={r} p={p} u={u} solar={manifest?.cities[r.city.id]?.solarIdx ?? null} current={current} openCity={openCity} />)}
            {waiting.map((id) => (
              <div key={id} className="cmp-row">
                <div className="who"><span className="nm">{cityById(id)!.name}</span></div>
                <span className="cap">{failed[id] ? `data unavailable — ${failed[id]}` : 'loading daily archive…'}</span>
              </div>
            ))}
            {scored && <BandLegend />}
          </div>

          <div className="cmp-cols">
            {ordered.map((r) => <div className="cmp-col" key={r.city.id}>{r.fit ? <WhyShort r={r} p={p} u={u} /> : <Record r={r} p={p} u={u} />}</div>)}
          </div>

          <Calendars ordered={ordered} p={p} u={u} fill={fill} scored={scored} />
          <Pivot ordered={ordered} p={p} u={u} scored={scored} />
        </>
      )}
    </main>
  )
})

function AddCity({ ids, setCmp, note }: { ids: string[]; setCmp: (ids: string[]) => void; note: (c: CityMeta) => string | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, ref, () => setOpen(false))
  const full = ids.length >= MAX_COMPARE
  return (
    <div className="add-city" ref={ref}>
      <button className="btn primary" disabled={full} aria-expanded={open} onClick={() => setOpen(!open)}>{full ? 'Set full' : '+ Add city'}</button>
      {open && (
        <div className="pop" style={{ left: 0, width: 280 }}>
          <CityList exclude={ids} note={note} onPick={(id) => { setCmp(toggleCompare(ids, id)); setOpen(false) }} />
        </div>
      )}
    </div>
  )
}

function Mini({ label, color, v, sub, tip }: { label: string; color: string; v: number; sub?: string; tip?: string }) {
  return (
    <div className="mini">
      <Cap color={color} tip={tip}>{label}</Cap>
      <div className="n" style={{ color }}>{Math.round(v)}</div>
      {sub && <div className="d">{sub}</div>}
    </div>
  )
}

function BudgetRow({ r, p, u, solar, current, openCity }: { r: CityRow; p: Prefs; u: Units; solar: number | null; current: string; openCity: (id: string) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const b = r.fit?.b, act = r.out.act, t = r.out.terrain
  const snow = t ? `${t.name} · ${t.driveMin} min` : hasTerrainWithin(r.city, p.drive) ? 'loading terrain…' : r.city.terrain.length ? `none within ${p.drive} hr` : 'no terrain on record'
  return (
    <div className="cmp-row">
      <div className="who">
        <button className="city-link" onClick={() => openCity(r.city.id)} data-tip={`Open ${r.city.name}'s dashboard.`}>
          {r.city.id === current && <span className="dot">●</span>}{r.city.name}, {r.city.code}
        </button>
        <div className="meta">{u.elev(r.s.demElevM * FT)} · pop {r.city.pop.toLocaleString()} · solar {solar ?? '—'}/100</div>
        <div className="meta" style={{ color: 'var(--dim)' }}>SNOW · {snow}</div>
      </div>
      <div ref={ref} style={{ minWidth: 0 }}>
        {width > 0 && (b ? <BudgetBar b={b} width={width} height={30} id={`hatch-cmp-${r.city.id}`} /> : <WalkBar days={act.per.walk.days} width={width} />)}
      </div>
      <div className="stats">
        {b ? (
          <>
            <Mini label="COMF" color={CO.comf} v={b.counts[0]} />
            <Mini label="TOL" color={CO.tol} v={b.counts[1]} />
            <Mini label="UNB" color="#98a0ad" v={b.counts[2]} sub={`${Math.round(b.hard)} hard ▨`} tip="Unbearable days a year; the hatched share crossed a line you drew in the control bar." />
          </>
        ) : (
          <>
            <Mini label="WALK" color={CO.act} v={act.per.walk.days} />
            <Mini label="RUN" color={CO.act} v={act.per.run.days} />
          </>
        )}
        <Mini label="OUTDOOR" color={CO.act} v={act.outAny} tip="Days a year on which at least one enabled activity is possible. Scored separately from comfort." />
        <Mini label="RIDE" color={CO.actSnow} v={act.per.ride.days} tip={`Snow-sport days a year: at least ${u.depth(18)} on the ground at the terrain resolved within ${p.drive} hr.`} />
      </div>
    </div>
  )
}

function WalkBar({ days, width }: { days: number; width: number }) {
  const h = 30, x = (v: number) => (v / 365) * width, w = x(days)
  return (
    <svg width={width} height={h + 20} style={{ display: 'block', shapeRendering: 'crispEdges' }}>
      <rect width={width} height={h} fill="#1c1f25" />
      <rect width={w} height={h} fill={CO.act} data-tip={`Walk-viable: ${days.toFixed(1)} days/yr`} />
      {w > 30 && <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fill="#0d0f12" style={{ font: "600 12px 'JetBrains Mono', monospace" }}>{Math.round(days)}</text>}
      {[0, 91, 182, 273, 365].map((d) => (
        <text key={d} x={x(d)} y={h + 15} textAnchor={d === 0 ? 'start' : d === 365 ? 'end' : 'middle'} fill="#5f6672" style={{ font: "400 9.5px 'JetBrains Mono', monospace" }}>{d}</text>
      ))}
    </svg>
  )
}

function Small({ k, v, tip }: { k: string; v: string; tip?: string }) {
  return <div><Cap tip={tip}>{k}</Cap><div className="mono" style={{ font: '500 14px/1.3 var(--mono)', marginTop: 3 }}>{v}</div></div>
}

function WhyShort({ r, p, u }: { r: CityRow; p: Prefs; u: Units }) {
  const b = r.fit!.b, t = r.out.terrain
  return (
    <>
      <div className="h-sm" style={{ marginBottom: 10 }}>{r.city.name} — why days fall short</div>
      <div className="bars">
        {b.reasons.slice(0, 3).map((x) => (
          <div className="row" key={x.label}>
            <span className="lab">{x.label}</span>
            <span className="track"><span style={{ width: `${Math.max(1, x.pct)}%` }} /></span>
            <span className="pct">{x.pct}%</span>
          </div>
        ))}
        {!b.reasons.length && <div className="prose">Every day is comfortable under these settings.</div>}
      </div>
      <div className="prose cmp-sep">
        {b.compromise
          ? <>Across the {Math.round(b.counts[1])} tolerable days you would mostly be putting up with <b>{b.compromise.label}</b> ({b.compromise.pct}% of them).</>
          : <>No tolerable days — every day is either comfortable or written off.</>}
        {b.reasons[0] && <> Most common shortfall overall: <b>{b.reasons[0].label}</b>, on {b.reasons[0].pct}% of its {Math.round(b.nonComf)} non-comfortable days a year.</>}
      </div>
      <div className="cmp-sep" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Small k="BEST STREAK" v={`${b.bestStreak} d`} tip="Longest run of comfortable days anywhere in the window." />
        <Small k="LONGEST GAP" v={`${b.worstGap} d`} tip="Longest run without a single comfortable day." />
        <Small k="WORST MONTH" v={MN[b.worstMonth].toUpperCase()} tip="The month with the smallest share of comfortable days for you." />
        <Small k="SNOW COVER" v={t ? `${Math.round(terrainCover(t.series, p.window, 6))} /yr` : '—'} tip={`Days a year with at least ${u.depth(6)} on the ground at the resolved reference terrain.`} />
      </div>
    </>
  )
}

function Record({ r, p, u }: { r: CityRow; p: Prefs; u: Units }) {
  const f = useMemo(() => facts(r.s, p.window, r.city.lat), [r.s, p.window, r.city.lat])
  const rows: [string, string][] = [
    ['Mean diurnal swing', `${u.dt(f.swing).replace('+', '')}${u.tu}`],
    ['Clear · partly · overcast days', `${Math.round(f.clear)} · ${Math.round(f.partly)} · ${Math.round(f.overcast)}`],
    ['Longest gray-day streak', `${f.grayStreak} d`],
    [`Nights above ${u.t(60)}${u.tu}`, `${Math.round(f.warmNights)} /yr`],
    ['Freeze–thaw cycles', `${Math.round(f.freezeThaw)} /yr`],
    ['Snow days, city centre', `${Math.round(f.snowDays)} /yr`],
    ['Sunshine', `${Math.round(f.sunHours).toLocaleString()} h/yr`],
  ]
  return (
    <>
      <div className="h-sm" style={{ marginBottom: 10 }}>{r.city.name} — the record</div>
      {rows.map(([k, v]) => <div className="list-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>)}
    </>
  )
}

function Calendars({ ordered, p, u, fill, scored }: { ordered: CityRow[]; p: Prefs; u: Units; fill: CalFill; scored: boolean }) {
  const [scoredMode, setScoredMode] = useState<CalMode>('comfort')
  const [unsetMode, setUnsetMode] = useState<CalMode>('temp')
  const mode = scored ? scoredMode : unsetMode
  const rowsBy = useMemo(() => Object.fromEntries(ordered.map((r) => [r.city.id, windowRows(r.s, r.fit?.sc ?? null, p.window, r.out.terrain?.series ?? null)])), [ordered, p.window])
  const title = mode === 'temp' ? 'TEMPERATURE CALENDARS' : mode === 'activity' ? 'ACTIVITY CALENDARS' : 'COMFORT CALENDARS'
  const options = scored
    ? [{ v: 'comfort' as CalMode, label: 'COMFORT' }, { v: 'activity' as CalMode, label: 'ACTIVITY' }, { v: 'temp' as CalMode, label: 'TEMPERATURE' }]
    : [{ v: 'temp' as CalMode, label: 'TEMPERATURE' }, { v: 'activity' as CalMode, label: 'ACTIVITY' }]
  return (
    <div className="section">
      <div className="section-head">
        <Head tip="Stacked on one day-of-year axis, so a seasonal offset between cities reads as a horizontal shift rather than something you have to hold in your head. Hover a cell for that day's conditions.">{title} · SHARED AXIS</Head>
        <span className="sub">one cell = one observed day · {windowLabel(p.window)}{mode === 'temp' ? ' · daily high · one scale for every city' : ''}</span>
        <div className="right">
          {mode === 'temp' && <TempLegend u={u} />}
          <Seg small label="Calendar colouring" value={mode} onChange={scored ? setScoredMode : setUnsetMode} options={options} />
        </div>
      </div>
      {ordered.map((r) => {
        const b = r.fit?.b
        return (
          <div key={r.city.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 5 }}>
              <span style={{ font: '600 11.5px/1 var(--sans)' }}>{r.city.name}</span>
              <span className="sub">
                {b ? `${Math.round(b.counts[0])} comf · ${Math.round(b.counts[1])} tol · ${Math.round(b.counts[2])} unb per year` : `${Math.round(r.out.act.per.walk.days)} walk-viable days per year`}
              </span>
            </div>
            <CalendarStrip rows={rowsBy[r.city.id]} p={p} u={u} mode={mode} fill={fill} />
          </div>
        )
      })}
      <MonthAxis />
      {mode === 'comfort' && <BandLegend />}
      {mode === 'activity' && (
        <div className="legend">
          <span className="item"><span className="sw" style={{ background: CO.act }} />AN ENABLED ACTIVITY IS POSSIBLE</span>
          <span className="item"><span className="sw" style={{ background: CO.actSnow }} />SNOW-SPORT DAY</span>
          <span className="item"><span className="sw" style={{ background: CO.actNone }} />NONE POSSIBLE</span>
        </div>
      )}
      {mode === 'temp' && <div className="legend"><span className="prose" style={{ fontSize: 11, color: 'var(--dim)' }}>Observed temperature, not fit: the ramp is shared by every city and deliberately unlike the comfort colours.</span></div>}
    </div>
  )
}

function Pivot({ ordered, p, u, scored }: { ordered: CityRow[]; p: Prefs; u: Units; scored: boolean }) {
  const [metricSel, setMetric] = useState<PivotMetric>('hi')
  const [diff, setDiff] = useState(false)
  const hardMax = p.temp?.hardMax ?? null
  const months = useMemo(() => ordered.map((r) => monthly(r.s, p.window, hardMax, r.fit?.b ?? null, r.out.act)), [ordered, p.window, hardMax])
  const metric = PIVOT[metricSel].needsFit && !scored ? 'hi' : metricSel
  const def = PIVOT[metric]
  const rows = pivot(months, metric)
  const shown = diff ? rows.filter((r) => r.differs) : rows
  const multi = ordered.length > 1
  const fmt = (v: number) => (def.kind === 'temp' ? u.t(v, 1) : def.kind === 'pct' ? `${Math.round(v)}%` : def.kind === 'len' ? u.len(v, u.metric ? 0 : 2) : v.toFixed(1))
  const spread = (v: number) => (def.kind === 'temp' ? u.dt(v, 1).replace('+', '') : def.kind === 'pct' ? `${Math.round(v)} pts` : def.kind === 'len' ? u.len(v, u.metric ? 0 : 2) : v.toFixed(1))
  const tol = def.kind === 'temp' ? `${spread(def.tol)}${u.tu}` : def.kind === 'days' ? `${def.tol} days` : spread(def.tol)
  const options = (Object.keys(PIVOT) as PivotMetric[]).filter((k) => scored || !PIVOT[k].needsFit).map((k) => ({ v: k, label: PIVOT[k].label.toUpperCase() }))
  return (
    <div className="section" style={{ borderBottom: 'none' }}>
      <div className="section-head">
        <Head tip="Monthly rollups pivoted city by city. Differences-only hides the months where the cities sit within a tolerance of each other, leaving what actually separates them. Counts are days per year in that month.">MONTHLY, PIVOTED</Head>
        <span className="sub">{diff ? `${rows.length - shown.length} months hidden · spread under ${tol}` : `all 12 months · tolerance ${tol}`}</span>
        <div className="right">
          <Seg small label="Pivot measure" value={metric} onChange={setMetric} options={options} />
          <div className="seg sm"><button aria-pressed={diff} onClick={() => setDiff(!diff)}>DIFFERENCES ONLY</button></div>
        </div>
      </div>
      <div className="table-scroll">
        <table className="plain">
          <thead>
            <tr>
              <th className="l">MONTH</th>
              {ordered.map((r) => <th key={r.city.id}>{r.city.name.toUpperCase()}</th>)}
              <th data-tip="Highest minus lowest in the set. Blue where it exceeds the tolerance.">SPREAD IN SET</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.m}>
                <td className="l strong">{MN[row.m]}</td>
                {row.vals.map((v, i) => {
                  const hi = multi && v === row.max, lo = multi && v === row.min
                  return <td key={i} style={{ color: hi ? 'var(--ink)' : lo ? '#767d8a' : 'var(--mid)', fontWeight: hi ? 500 : 400 }}>{Number.isNaN(v) ? '—' : fmt(v)}</td>
                })}
                <td style={{ color: row.differs ? 'var(--accent)' : '#4c5261' }}>{spread(row.spread)}</td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td className="l" colSpan={ordered.length + 2} style={{ color: 'var(--dim)', padding: '10px 8px' }}>No month differs by more than {tol} — on this measure the cities are alike.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="prose" style={{ marginTop: 12, fontSize: 11, color: 'var(--dim)' }}>
        Brightest figure in each row is the highest in the set, dimmest the lowest. No city is named a winner — more snow against fewer heat days is not a comparison the app is entitled to settle.
      </div>
    </div>
  )
}
