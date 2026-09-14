// Spec section 5 panels: best time to visit, typical day, what would have to change,
// annotated extremes, air quality (separate tier), mosquito proxy.
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { loadAq, loadHourly, type AqSeries, type CityMeta, type CitySeries, type HourlySeries } from '../lib/data'
import { MN, MONTH_FULL, MONTH_START, doyLabel } from '../lib/calendar'
import { CO } from '../lib/colors'
import type { Budget } from '../lib/aggregate'
import {
  AQI_SENSITIVE, AQI_UNHEALTHY, MOSQUITO_DEW_F, MOSQUITO_LOW_F, PM25_SMOKE, SHIFTS,
  aqStats, bestSpans, crossing, extremes, mosquito, sensitivity, spans, sunTimes, typicalDay, warmingTrend, worstSpan, yearAt,
  type DateSpan,
} from '../lib/extras'
import { windowLabel, type Prefs } from '../lib/prefs'
import { idealFor, type Scored } from '../lib/scoring'
import { signed, type Units } from '../lib/units'
import { Head, Seg, Spark } from './ui'
import { useWidth } from '../hooks/useWidth'

const pct = (v: number) => `${Math.round(v * 100)}%`
const spanLabel = (sp: DateSpan) => `${doyLabel(sp.start)} – ${doyLabel((sp.start + sp.len - 1) % 365)}`

function NeedsPreference({ what }: { what: string }) {
  return <div className="prose">Set a comfort preference in the control bar to {what}.</div>
}

// ---------------- 5.1 / 5.2 ----------------

export function BestTimePanel({ sc, p }: { sc: Scored | null; p: Prefs }) {
  const [len, setLen] = useState(14)
  const r = useMemo(() => {
    if (!sc) return null
    const all = spans(sc, len)
    return { best: bestSpans(all, 3), worst: worstSpan(all) }
  }, [sc, len])
  return (
    <div className="section" style={{ borderBottom: 'none' }}>
      <div className="section-head">
        <Head tip="For travel rather than relocation: the date ranges where your comfortable days have clustered, across every year in the window — and the stretch to avoid.">BEST TIME TO VISIT</Head>
        <div className="right"><Seg small value={len} onChange={setLen} options={[{ v: 7, label: '1 WK' }, { v: 14, label: '2 WK' }, { v: 30, label: '30 D' }]} /></div>
      </div>
      {!r ? <NeedsPreference what="rank date ranges" /> : (
        <>
          <div className="sub" style={{ marginBottom: 8 }}>share of comfortable days in each span · {windowLabel(p.window)}</div>
          {r.best.map((sp, i) => <SpanRow key={sp.start} rank={`${i + 1}`} sp={sp} />)}
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 12 }}>
            <div style={{ marginBottom: 8 }}><Head small tip="The span with the most unbearable days — the stretch of the year you would most want to be elsewhere.">WORST {len === 30 ? '30 DAYS' : len === 7 ? 'WEEK' : 'TWO WEEKS'} OF THE YEAR</Head></div>
            <SpanRow rank="✕" sp={r.worst} worst />
          </div>
        </>
      )}
    </div>
  )
}

function SpanRow({ rank, sp, worst }: { rank: string; sp: DateSpan; worst?: boolean }) {
  const tol = Math.max(0, 1 - sp.comf - sp.unb)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--row)' }}>
      <span className="mono" style={{ width: 14, color: worst ? CO.warn : 'var(--faint)', fontSize: 11 }}>{rank}</span>
      <span className="mono" style={{ width: 130, fontSize: 12, color: 'var(--ink)' }}>{spanLabel(sp)}</span>
      <span style={{ display: 'flex', height: 8, flex: 1, background: 'var(--row)' }} data-tip={`Comfortable ${pct(sp.comf)} · tolerable ${pct(tol)} · unbearable ${pct(sp.unb)} of days in this span · mean fit ${Math.round(sp.score)}`}>
        <span style={{ width: pct(sp.comf), background: CO.comf }} /><span style={{ width: pct(tol), background: CO.tol }} /><span style={{ width: pct(sp.unb), background: CO.unb }} />
      </span>
      <span className="mono" style={{ width: 44, textAlign: 'right', fontSize: 11, color: worst ? 'var(--unb-text)' : CO.comf }}>{pct(worst ? sp.unb : sp.comf)}</span>
    </div>
  )
}

// ---------------- 5.5 ----------------

export function TypicalDayPanel({ city, p, u, sc, defaultMonth }: { city: CityMeta; p: Prefs; u: Units; sc: Scored | null; defaultMonth: number }) {
  const [h, setH] = useState<{ id: string; s: HourlySeries } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [month, setMonth] = useState<number | null>(null)
  const [ref, width] = useWidth<HTMLDivElement>()
  const m = month ?? defaultMonth
  useEffect(() => {
    let live = true
    loadHourly(city.id).then((s) => live && setH({ id: city.id, s })).catch((e: Error) => live && setErr(e.message))
    return () => { live = false }
  }, [city.id])
  const hs = h?.id === city.id ? h.s : null
  const prof = useMemo(() => (hs ? typicalDay(hs, m, p.window) : null), [hs, m, p.window])
  const sun = hs ? sunTimes(city.lat, city.lon, hs.timezone, m) : null

  const W = width, H = 190, L = 34, R = 8, B = 20, T = 8
  let chart = null
  if (prof && prof.years && W) {
    const band = p.temp && sc ? idealFor(p, sc.warmW[MONTH_START[m] + 14]) : null
    let lo = Math.min(...prof.p10), hi = Math.max(...prof.p90)
    if (band) { lo = Math.min(lo, band[0] - 2); hi = Math.max(hi, band[1] + 2) }
    lo = Math.floor(lo / 10) * 10; hi = Math.ceil(hi / 10) * 10
    const x = (hr: number) => L + (hr / 24) * (W - L - R)
    const y = (v: number) => H - B - ((v - lo) / (hi - lo)) * (H - B - T)
    const step = (a: number[]) => a.flatMap((v, hr) => [`${x(hr)},${y(v)}`, `${x(hr + 1)},${y(v)}`])
    const ribbon = (a: number[], b: number[]) => [...step(a), ...step(b).reverse()].join(' ')
    const ticks = []
    for (let v = lo; v <= hi; v += 10) ticks.push(v)
    chart = (
      <svg width={W} height={H} style={{ display: 'block' }}>
        {sun && <rect x={x(Math.max(0, sun.rise))} width={x(Math.min(24, sun.set)) - x(Math.max(0, sun.rise))} y={T} height={H - B - T} fill="#e6e8ec" fillOpacity={0.04} />}
        {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={CO.grid} /><text x={L - 5} y={y(v) + 3} textAnchor="end" fill={CO.faint} style={{ font: "400 9px 'JetBrains Mono', monospace" }}>{u.t(v)}</text></g>)}
        {band && <rect x={L} width={W - L - R} y={y(band[1])} height={y(band[0]) - y(band[1])} fill={CO.comf} fillOpacity={0.12} />}
        <polygon points={ribbon(prof.p90, prof.p10)} fill="#7f93b8" fillOpacity={0.3} />
        <polygon points={ribbon(prof.p75, prof.p25)} fill="#9fb4d8" fillOpacity={0.45} />
        <polyline points={step(prof.p50).join(' ')} fill="none" stroke="#dbe2ee" strokeWidth={1.2} />
        {sun && [['DAWN', sun.rise], ['DUSK', sun.set]].map(([lab, t]) => (Number(t) > 0 && Number(t) < 24 ? (
          <g key={lab as string}>
            <line x1={x(Number(t))} x2={x(Number(t))} y1={T} y2={H - B} stroke="#e6e8ec" strokeOpacity={0.35} strokeDasharray="2 3" />
            <text x={x(Number(t)) + 3} y={T + 9} fill="#8b929e" style={{ font: "400 9px 'JetBrains Mono', monospace" }}>{lab}</text>
          </g>
        ) : null))}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((hr) => <text key={hr} x={x(hr) + 2} y={H - 6} fill={CO.faint} style={{ font: "400 9px 'JetBrains Mono', monospace" }}>{String(hr).padStart(2, '0')}:00</text>)}
      </svg>
    )
  }
  const at = (t: number) => prof && prof.p50.length ? prof.p50[Math.min(23, Math.max(0, Math.floor(t)))] : NaN
  const warmest = prof?.p50.length ? prof.p50.indexOf(Math.max(...prof.p50)) : 0

  return (
    <div className="section" style={{ borderBottom: 'none' }} ref={ref}>
      <div className="section-head">
        <Head tip="Hour-by-hour temperature for a typical day in the chosen month, local clock time. Bands are the 10th–90th and 25th–75th percentile across every day of that month; the line is the median. Shaded: sunrise to sunset. Exposes the day–night swing that daily figures flatten.">TYPICAL DAY</Head>
        <div className="right">
          <select value={m} onChange={(e) => setMonth(+e.target.value)} style={{ background: 'var(--btn)', color: 'var(--ink)', border: '1px solid var(--line-2)', font: '400 10.5px/1 var(--mono)', padding: '3px 4px' }}>
            {MONTH_FULL.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </div>
      </div>
      <div className="sub" style={{ marginBottom: 8 }}>
        hourly tier · {prof?.years ? `${prof.years[0]}–${prof.years[1]} · ${prof.days} days` : hs ? `${hs.startYear}–${hs.startYear + hs.years - 1} only — outside this window` : 'loading'} · {hs?.timezone ?? ''}
      </div>
      {err && <div className="prose">Hourly data unavailable: {err}</div>}
      {chart}
      {prof?.years && sun && (
        <div style={{ display: 'flex', gap: 22, marginTop: 10 }}>
          {[['DAWN', at(sun.rise)], ['AFTERNOON PEAK', prof.p50[warmest]], ['DUSK', at(sun.set)], ['MEDIAN SWING', Math.max(...prof.p50) - Math.min(...prof.p50)]].map(([k, v], i) => (
            <div key={k as string}><div className="cap">{k}</div><div className="mono" style={{ fontSize: 14, marginTop: 3 }}>{i === 3 ? u.dt(v as number).replace('+', '') : u.t(v as number)}{u.tu}</div></div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------- 5.7 ----------------

const TARGETS = [50, 100, 150, 200]

export function WhatWouldChangePanel({ s, p, u, b }: { s: CitySeries; p: Prefs; u: Units; b: Budget | null }) {
  const [target, setTarget] = useState(100)
  const dp = useDeferredValue(p) // several full re-scores; let the rest of the page update first while dragging
  const scored = b !== null
  const sens = useMemo(() => (scored ? sensitivity(s, dp, dp.window) : null), [s, dp, scored])
  const trend = useMemo(() => warmingTrend(s), [s])
  const [ref, width] = useWidth<HTMLDivElement>()
  if (!b || !sens) {
    return <div className="section" style={{ borderBottom: 'none' }} ref={ref}><div style={{ marginBottom: 12 }}><Head>WHAT WOULD HAVE TO CHANGE</Head></div><NeedsPreference what="see how warming would move your day budget" /></div>
  }
  const cross = crossing(sens, target)
  const now = sens.find((x) => x.shift === 0)!
  const perDecade = trend.slope * 10
  const yr = cross !== null && cross > 0 ? yearAt(cross, trend.slope) : null
  const W = width, H = 120, max = 365
  const bw = W ? (W - 20) / SHIFTS.length : 0
  return (
    <div className="section" style={{ borderBottom: 'none' }} ref={ref}>
      <div className="section-head">
        <Head tip="Inverse query: warm every day's high, low and dew point by the same amount and re-score with your current settings. Shows how much warming this city can absorb before it stops fitting you — and, at its own measured trend, roughly when. Straight-line extrapolation; real warming is not uniform across seasons.">WHAT WOULD HAVE TO CHANGE</Head>
        <div className="right"><span className="cap">BELOW</span><Seg small value={target} onChange={setTarget} options={TARGETS.map((t) => ({ v: t, label: String(t) }))} /></div>
      </div>
      <div className="prose" style={{ marginBottom: 10 }}>
        {now.comf < target
          ? <>Already below {target} comfortable days ({Math.round(now.comf)} today).</>
          : cross === null
            ? <>Even {u.dt(SHIFTS[SHIFTS.length - 1], 0)}{u.tu} of warming keeps this city above {target} comfortable days for you.</>
            : <>Comfortable days fall below <b className="mono">{target}</b> after about <b className="mono">{u.dt(cross)}{u.tu}</b> of warming.{' '}
                {yr ? <>At the {trend.from}–{trend.to} trend of <b className="mono">{u.dt(perDecade, 2)}{u.tu}/decade</b> (R² {trend.r2.toFixed(2)}), that is around <b className="mono">{yr}</b>.</> : <>This city shows no warming trend over {trend.from}–{trend.to}.</>}</>}
      </div>
      {W > 0 && (
        <svg width={W} height={H + 18} style={{ display: 'block' }}>
          <line x1={10} x2={W - 10} y1={H - (target / max) * H} y2={H - (target / max) * H} stroke={CO.warn} strokeDasharray="3 3" strokeOpacity={0.7} />
          {sens.map((x, i) => {
            const cH = (x.comf / max) * H, uH = (x.unb / max) * H
            return (
              <g key={x.shift} data-tip={`${u.dt(x.shift, 0)}${u.tu}: ${Math.round(x.comf)} comfortable, ${Math.round(x.unb)} unbearable days/yr`}>
                <rect x={10 + i * bw + 2} y={H - cH} width={bw / 2 - 3} height={cH} fill={CO.comf} opacity={x.shift === 0 ? 1 : 0.75} />
                <rect x={10 + i * bw + bw / 2} y={H - uH} width={bw / 2 - 3} height={uH} fill={CO.unb} />
                <text x={10 + i * bw + bw / 2} y={H + 13} textAnchor="middle" fill={x.shift === 0 ? 'var(--ink)' : CO.faint} style={{ font: "400 9px 'JetBrains Mono', monospace" }}>{x.shift === 0 ? 'NOW' : u.dt(x.shift, 0)}</text>
              </g>
            )
          })}
        </svg>
      )}
      <div className="legend" style={{ marginTop: 6 }}>
        <span className="item"><span className="sw" style={{ background: CO.comf, width: 12 }} />COMFORTABLE</span>
        <span className="item"><span className="sw" style={{ background: CO.unb, width: 12 }} />UNBEARABLE</span>
        <span className="item"><span className="sw" style={{ background: CO.warn, height: 1, width: 14 }} />{target}-DAY LINE</span>
      </div>
    </div>
  )
}

// ---------------- 5.6 ----------------

export function ExtremesPanel({ s, p, u }: { s: CitySeries; p: Prefs; u: Units }) {
  const ex = useMemo(() => extremes(s, p.window), [s, p.window])
  const fmt = (e: (typeof ex)[number]) => (e.kind === 'temp' ? `${u.t(e.value)}${u.tu}` : e.kind === 'delta' ? `${u.dt(e.value, 0).replace('+', '')}${u.tu}` : e.kind === 'len' ? u.len(e.value, u.metric ? 0 : 2) : u.speed(e.value))
  const date = (i: number) => `${doyLabel(i % 365)}, ${p.window.from + Math.floor(i / 365)}`
  return (
    <div className="section" style={{ borderBottom: 'none' }}>
      <div style={{ marginBottom: 12 }}><Head tip="The single most extreme day of each kind inside the window, with its date, so the records are concrete events rather than statistics.">ANNOTATED EXTREMES</Head></div>
      <div className="sub" style={{ marginBottom: 8 }}>single days · {windowLabel(p.window)}</div>
      {ex.map((e) => (
        <div className="list-row" key={e.label}>
          <span className="k">{e.label}</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>{date(e.index)}</span>
          <span className="v" style={{ width: 78 }}>{fmt(e)}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------- 5.3 ----------------

export function AirQualityPanel({ city }: { city: CityMeta }) {
  const [aq, setAq] = useState<AqSeries | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    loadAq(city.id).then((a) => live && setAq(a)).catch((e: Error) => live && setErr(e.message))
    return () => { live = false }
  }, [city.id])
  const st = useMemo(() => (aq && aq.id === city.id ? aqStats(aq) : null), [aq, city.id])
  const maxM = st ? Math.max(1, ...st.months) : 1
  return (
    <div className="section" style={{ borderBottom: 'none' }}>
      <div style={{ marginBottom: 12 }}><Head tip="Air quality comes from a different model (CAMS) with a much shorter archive than the weather data, so it is shown as its own tier with its own dates. The lookback window does not apply here.">AIR QUALITY · SMOKE</Head></div>
      {err && <div className="prose">Air-quality data unavailable: {err}</div>}
      {st && (
        <>
          <div className="sub" style={{ marginBottom: 10, color: 'var(--warn)' }}>
            separate data tier · {st.domain.replace('_', ' ')} · {st.from} → {st.to} ({st.years.toFixed(1)} yr) · lookback does not apply
          </div>
          <div className="list-row" data-tip={`Days whose highest hourly US AQI exceeded ${AQI_SENSITIVE} ("unhealthy for sensitive groups").`}><span className="k">Days AQI &gt; {AQI_SENSITIVE}</span><span className="v">{st.sensitive.toFixed(1)} /yr</span></div>
          <div className="list-row" data-tip={`Days whose highest hourly US AQI exceeded ${AQI_UNHEALTHY} ("unhealthy" for everyone).`}><span className="k">Days AQI &gt; {AQI_UNHEALTHY}</span><span className="v">{st.unhealthy.toFixed(1)} /yr</span></div>
          <div className="list-row" data-tip={`Smoke-day proxy: daily mean PM2.5 above ${PM25_SMOKE} µg/m³, the EPA 24-hour level for sensitive groups. Wildfire smoke is the usual cause in the western US, but not the only one.`}><span className="k">Smoke-level PM2.5 days (proxy)</span><span className="v">{st.smoke.toFixed(1)} /yr</span></div>
          {st.worst && <div className="list-row"><span className="k">Worst day</span><span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>{st.worst.date}</span><span className="v">AQI {st.worst.aqi}</span></div>}
          <div className="cap" style={{ margin: '14px 0 6px' }}>DAYS AQI &gt; {AQI_SENSITIVE} BY MONTH · PER YEAR</div>
          <svg width="100%" height={46} viewBox="0 0 240 46" preserveAspectRatio="none" style={{ display: 'block' }}>
            {st.months.map((v, i) => <rect key={i} x={i * 20 + 2} y={36 - (v / maxM) * 34} width={16} height={(v / maxM) * 34} fill="#8a9ab3" data-tip={`${MN[i]}: ${v.toFixed(1)} days/yr`} />)}
          </svg>
          <div style={{ display: 'flex' }}>{MN.map((n) => <span key={n} className="cap" style={{ flex: 1, textAlign: 'center', fontSize: 8.5 }}>{n[0]}</span>)}</div>
          <div className="prose" style={{ marginTop: 10, fontSize: 10.5 }}>
            {st.years < 5 ? `Only ${st.years.toFixed(1)} years of record — one bad fire season moves these numbers a lot. ` : ''}
            Reanalysis at ~40 km (global) or ~10 km (Europe); local smoke plumes can be missed or smeared.
          </div>
        </>
      )}
    </div>
  )
}

// ---------------- 5.4 ----------------

export function MosquitoPanel({ s, p, u }: { s: CitySeries; p: Prefs; u: Units }) {
  const mq = useMemo(() => mosquito(s, p.window), [s, p.window])
  const maxM = Math.max(1, ...mq.months)
  const peak = mq.months.indexOf(Math.max(...mq.months))
  return (
    <div className="section" style={{ borderBottom: 'none' }}>
      <div style={{ marginBottom: 12 }}><Head tip={`A rough proxy, not an observation: days whose overnight low stays at or above ${MOSQUITO_LOW_F}°F and whose mean dew point is at or above ${MOSQUITO_DEW_F}°F — warm and humid enough for mosquitoes to be active through the day. Says nothing about species, standing water or local control programmes.`}>MOSQUITO-FAVOURABLE DAYS</Head></div>
      <div className="sub" style={{ marginBottom: 10, color: 'var(--warn)' }}>rough proxy — not an observation · low ≥ {u.t(MOSQUITO_LOW_F)}{u.tu} and dew pt ≥ {u.t(MOSQUITO_DEW_F)}{u.tu}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="stat"><div className="n" style={{ color: 'var(--ink)', fontSize: 26 }}>{Math.round(mq.avg)}</div><div className="d">days/yr · {windowLabel(p.window)}</div></div>
        <Spark ys={mq.perYear} w={120} h={30} color="#8a9ab3" />
        <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>{signed(mq.fit.slope, 2)} /yr · R² {mq.fit.r2.toFixed(2)}</span>
      </div>
      <div className="cap" style={{ margin: '14px 0 6px' }}>BY MONTH · DAYS PER YEAR{mq.avg >= 1 ? ` · PEAK ${MN[peak].toUpperCase()}` : ''}</div>
      <svg width="100%" height={46} viewBox="0 0 240 46" preserveAspectRatio="none" style={{ display: 'block' }}>
        {mq.months.map((v, i) => <rect key={i} x={i * 20 + 2} y={36 - (v / maxM) * 34} width={16} height={(v / maxM) * 34} fill="#8a9ab3" data-tip={`${MN[i]}: ${v.toFixed(1)} days/yr`} />)}
      </svg>
      <div style={{ display: 'flex' }}>{MN.map((n) => <span key={n} className="cap" style={{ flex: 1, textAlign: 'center', fontSize: 8.5 }}>{n[0]}</span>)}</div>
    </div>
  )
}
