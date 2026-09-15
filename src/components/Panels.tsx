import { useMemo, useState } from 'react'
import type { CitySeries } from '../lib/data'
import { MN, MONTH_FULL, doyLabel } from '../lib/calendar'
import { BAND_COLOR, CO, LOSS_COLOR } from '../lib/colors'
import { ACTIVITIES, LOSS_LABEL, SEASON_RELIABILITY } from '../lib/activities'
import {
  budget,
  counter,
  monthMeanHigh,
  monthMeanLow,
  perYear,
  terrainCover,
  type DayPred,
  type MonthRow,
} from '../lib/aggregate'
import { score } from '../lib/scoring'
import {
  windowLabel,
  type ActivityId,
  type CounterMetric,
  type CounterOp,
  type CustomCounter,
  type Prefs,
  type Window,
} from '../lib/prefs'
import type { Model } from '../lib/model'
import { signed, type Units } from '../lib/units'
import { Head, Seg, Spark } from './ui'
import { isMosquitoDay, monthYearMatrix } from '../lib/extras'
import { YTD_MIN_DAYS, YTD_YEAR, ytdCount, type Ytd } from '../lib/current'

// ---------------- Outdoor days ----------------

export function OutdoorPanel({ m, p, set, u }: { m: Model; p: Prefs; set: (patch: Partial<Prefs>) => void; u: Units }) {
  const season = m.act.season
  const toggle = (id: ActivityId) =>
    set({ acts: p.acts.includes(id) ? p.acts.filter((a) => a !== id) : [...p.acts, id] })
  const lostTotal = m.act.lost.reduce((a, b) => a + b, 0)
  return (
    <div className="section" style={{ borderBottom: 'none' }}>
      <div style={{ marginBottom: 12 }}>
        <Head tip="For each activity, how many days a year the weather allows it, and what takes the rest away. One day can count for several activities. Thresholds are fixed presets, published in Data & methods. Tick an activity to include it in OUTDOOR DAYS.">
          OUTDOOR DAYS · DAYS LOST
        </Head>
      </div>
      {ACTIVITIES.map((a) => {
        const r = m.act.per[a.id],
          on = p.acts.includes(a.id)
        const noTerrain = a.id === 'ride' && !m.terrain
        return (
          <div
            key={a.id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9, opacity: on ? 1 : 0.45 }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: 140,
                flex: 'none',
                cursor: 'pointer',
                font: '400 11px/1.2 var(--sans)',
                color: 'var(--mid)',
              }}
              data-tip={a.rules}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(a.id)}
                style={{ accentColor: CO.act, margin: 0 }}
              />
              {a.name}
            </label>
            <span
              className="mono"
              style={{ fontWeight: 500, fontSize: 12, color: CO.act, width: 34, textAlign: 'right' }}
            >
              {Math.round(r.days)}
            </span>
            <span
              style={{ display: 'flex', height: 10, flex: 1, background: '#1c1f25' }}
              data-tip={
                noTerrain
                  ? `No reference terrain within ${p.drive} hr.`
                  : r.lost.map((v, i) => `${LOSS_LABEL[i]} ${Math.round(v)}`).join(' · ')
              }
            >
              {r.lost.map((v, i) => (
                <span key={i} style={{ width: `${(v / 365) * 100}%`, background: LOSS_COLOR[i], display: 'block' }} />
              ))}
            </span>
          </div>
        )
      })}
      <div className="legend" style={{ gap: 14, paddingTop: 10, borderTop: '1px solid var(--line)', marginTop: 12 }}>
        {[0, 1, 2, 3, 5].map((i) => (
          <span className="item" key={i} style={{ fontSize: 9.5 }}>
            <span className="sw" style={{ width: 14, height: 8, background: LOSS_COLOR[i] }} />
            {i === 3 ? 'PRECIP / WIND' : LOSS_LABEL[i].toUpperCase()}
          </span>
        ))}
      </div>
      <div className="prose" style={{ marginTop: 12, fontSize: 11 }}>
        {lostTotal > 0 && (
          <>
            No enabled activity was possible on <b className="mono">{Math.round(lostTotal)}</b> days/yr:{' '}
            {m.act.lost
              .map((v, i) => (v >= 1 ? `${Math.round(v)} to ${LOSS_LABEL[i]}` : null))
              .filter(Boolean)
              .join(', ')}
            .{' '}
          </>
        )}
        Outdoor season (walking viable in ≥{Math.round(SEASON_RELIABILITY * 7)} of 7 days):{' '}
        {season === 'year-round' ? (
          <b className="mono">year-round</b>
        ) : season ? (
          <>
            <b className="mono">{season.reliable}</b> reliable days of the year; longest run{' '}
            <b className="mono">
              {doyLabel(season.start)} → {doyLabel(season.end)}
            </b>
          </>
        ) : (
          <b className="mono">no reliable stretch</b>
        )}
        .{' '}
        {m.terrain ? (
          <>
            Snow metrics resolve at <b>{m.terrain.name}</b>, {m.terrain.driveMin} min drive, {u.elev(m.terrain.elevFt)}{' '}
            — not at city centre.
          </>
        ) : (
          <>No reference ski terrain within {p.drive} hr.</>
        )}
      </div>
    </div>
  )
}

// ---------------- Monthly table ----------------

type SortKey = keyof Pick<
  MonthRow,
  'm' | 'hi' | 'lo' | 'rhi' | 'rlo' | 'swing' | 'dew' | 'cloud' | 'precip' | 'snow' | 'sun' | 'over' | 'comf' | 'out'
>

export function MonthlyTable({ m, p, u }: { m: Model; p: Prefs; u: Units }) {
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'm', desc: false })
  const rows = [...m.months].sort((a, b) => {
    const av = (a[sort.k] ?? -Infinity) as number,
      bv = (b[sort.k] ?? -Infinity) as number
    return sort.desc ? bv - av : av - bv
  })
  const hardMax = p.temp?.hardMax ?? null
  const cols: { k: SortKey; label: string; tip?: string }[] = [
    { k: 'hi', label: 'AVG HI' },
    { k: 'lo', label: 'AVG LO' },
    { k: 'rhi', label: 'REC HI' },
    { k: 'rlo', label: 'REC LO' },
    { k: 'swing', label: 'SWING', tip: 'Mean diurnal swing: daily high minus daily low.' },
    { k: 'dew', label: 'DEW PT' },
    { k: 'cloud', label: 'CLOUD' },
    { k: 'precip', label: 'PRECIP' },
    { k: 'snow', label: 'SNOW' },
    { k: 'sun', label: 'SUN H/DAY', tip: 'Mean sunshine hours per day (ERA5 sunshine duration).' },
    ...(hardMax !== null ? [{ k: 'over' as SortKey, label: `DAYS >${u.t(hardMax)}°` }] : []),
    ...(m.b ? [{ k: 'comf' as SortKey, label: 'COMF' }] : []),
    { k: 'out', label: 'OUTDOOR' },
  ]
  const click = (k: SortKey) => setSort((s) => ({ k, desc: s.k === k ? !s.desc : k !== 'm' }))
  const arrow = (k: SortKey) => (sort.k === k ? (sort.desc ? ' ▾' : ' ▴') : '')
  return (
    <div className="section">
      <div className="section-head">
        <Head tip="The conventional monthly rollup, kept deliberately separate from the daily figures above — these are averages and hide the extremes. Click a column to sort.">
          MONTHLY DETAIL
        </Head>
        <span className="sub">
          monthly rollup — aggregated, not daily resolution · {windowLabel(p.window)} · counts are days per year
        </span>
      </div>
      <div className="table-scroll">
        <table className="monthly">
          <thead>
            <tr>
              <th className={`l${sort.k === 'm' ? ' sorted' : ''}`} onClick={() => click('m')}>
                MONTH{arrow('m')}
              </th>
              {cols.map((c) => (
                <th key={c.k} className={sort.k === c.k ? 'sorted' : ''} onClick={() => click(c.k)} data-tip={c.tip}>
                  {c.label}
                  {arrow(c.k)}
                </th>
              ))}
              {m.b && <th className="l">BAND SPLIT</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.m}>
                <td className="l strong">{MN[r.m]}</td>
                <td className="strong">{u.t(r.hi, 1)}</td>
                <td className="strong">{u.t(r.lo, 1)}</td>
                <td>{u.t(r.rhi)}</td>
                <td>{u.t(r.rlo)}</td>
                <td>{u.dt(r.swing).replace('+', '')}</td>
                <td className="strong">{u.t(r.dew, 1)}</td>
                <td>{Math.round(r.cloud)}%</td>
                <td>{u.len(r.precip)}</td>
                <td>{u.len(r.snow, 1)}</td>
                <td>{r.sun.toFixed(1)}</td>
                {hardMax !== null && <td style={{ color: CO.warn }}>{r.over!.toFixed(1)}</td>}
                {m.b && <td style={{ color: CO.comf }}>{r.comf!.toFixed(1)}</td>}
                <td style={{ color: CO.act }}>{r.out.toFixed(1)}</td>
                {m.b && r.split && (
                  <td className="l">
                    <svg width={180} height={9} style={{ display: 'block', shapeRendering: 'crispEdges' }}>
                      {(() => {
                        const tt = r.split.c + r.split.t + r.split.u || 1
                        const w = [r.split.c, r.split.t, r.split.u].map((v) => (v / tt) * 180)
                        return [
                          <rect key={0} width={w[0]} height={9} fill={BAND_COLOR[0]} />,
                          <rect key={1} x={w[0]} width={w[1]} height={9} fill={BAND_COLOR[1]} />,
                          <rect key={2} x={w[0] + w[1]} width={w[2]} height={9} fill={BAND_COLOR[2]} />,
                        ]
                      })()}
                    </svg>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------- Threshold counters ----------------

const METRIC_LABEL: Record<CounterMetric, string> = {
  high: 'daily high',
  low: 'daily low',
  dew: 'dew point',
  cloud: 'cloud cover %',
  precip: 'precip',
  snow: 'snowfall',
  wind: 'max wind',
}
const isTemp = (m: CounterMetric) => m === 'high' || m === 'low' || m === 'dew'
const isLen = (m: CounterMetric) => m === 'precip' || m === 'snow'

function metricPred(m: CounterMetric, op: CounterOp, v: number): DayPred {
  return (s, j) => {
    const x = s[m][j]
    return op === 'ge' ? x >= v : x <= v
  }
}

export function ThresholdCounters({
  s,
  p,
  set,
  u,
  ytd,
}: {
  s: CitySeries
  p: Prefs
  set: (patch: Partial<Prefs>) => void
  u: Units
  ytd: Ytd | null
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [draft, setDraft] = useState<{
    m1: CounterMetric
    op1: CounterOp
    v1: string
    m2: CounterMetric | ''
    op2: CounterOp
    v2: string
  }>({ m1: 'high', op1: 'ge', v1: u.t(80), m2: 'dew', op2: 'ge', v2: u.t(55) })
  const disp = (m: CounterMetric, v: number) =>
    isTemp(m) ? `${u.t(v)}${u.tu}` : isLen(m) ? u.len(v, 1) : m === 'wind' ? u.speed(v) : `${v}%`
  const toInternal = (m: CounterMetric, v: number) =>
    isTemp(m) ? u.toF(v) : isLen(m) && u.metric ? v / 25.4 : m === 'wind' && u.metric ? v / 1.609 : v
  const presets: { label: string; pred: DayPred }[] = [
    { label: `Freeze days (low ≤ ${u.t(32)}${u.tu})`, pred: (x, j) => x.low[j] <= 32 },
    { label: `Hard freeze (low ≤ ${u.t(20)}${u.tu})`, pred: (x, j) => x.low[j] <= 20 },
    { label: `Days ≥ ${u.t(90)}${u.tu}`, pred: (x, j) => x.high[j] >= 90 },
    { label: `Days ≥ ${u.t(100)}${u.tu}`, pred: (x, j) => x.high[j] >= 100 },
    { label: `Tropical nights (low ≥ ${u.t(70)}${u.tu})`, pred: (x, j) => x.low[j] >= 70 },
    { label: `Snow days (≥ ${u.len(0.1, 1)})`, pred: (x, j) => x.snow[j] >= 0.1 },
    { label: 'Dry days (no precip)', pred: (x, j) => x.precip[j] < 0.005 },
    { label: 'Overcast days (cloud ≥ 80%)', pred: (x, j) => x.cloud[j] >= 80 },
    { label: 'Clear days (cloud ≤ 20%)', pred: (x, j) => x.cloud[j] <= 20 },
    { label: `Humid days (dew pt ≥ ${u.t(55)}${u.tu})`, pred: (x, j) => x.dew[j] >= 55 },
    { label: `Muggy days (dew pt ≥ ${u.t(65)}${u.tu})`, pred: (x, j) => x.dew[j] >= 65 },
    { label: 'Mosquito-favourable (proxy)', pred: isMosquitoDay },
  ]
  const custom = p.counters.map((c, ci) => ({
    label: `${METRIC_LABEL[c.m1]} ${c.op1 === 'ge' ? '≥' : '≤'} ${disp(c.m1, c.v1)}${c.m2 ? ` & ${METRIC_LABEL[c.m2]} ${c.op2 === 'ge' ? '≥' : '≤'} ${disp(c.m2, c.v2)}` : ''}`,
    pred: ((x: CitySeries, j: number) =>
      metricPred(c.m1, c.op1, c.v1)(x, j) && (!c.m2 || metricPred(c.m2, c.op2, c.v2)(x, j))) as DayPred,
    remove: () => set({ counters: p.counters.filter((_, k) => k !== ci) }),
  }))
  const add = () => {
    const v1 = parseFloat(draft.v1),
      v2 = parseFloat(draft.v2)
    if (!Number.isFinite(v1)) return
    const round = (v: number) => Math.round(v * 100) / 100
    const c: CustomCounter = {
      m1: draft.m1,
      op1: draft.op1,
      v1: round(toInternal(draft.m1, v1)),
      m2: draft.m2 || null,
      op2: draft.op2,
      v2: draft.m2 && Number.isFinite(v2) ? round(toInternal(draft.m2, v2)) : 0,
    }
    set({ counters: [...p.counters, c] })
  }
  const sel = (v: string, on: (v: string) => void, opts: [string, string][]) => (
    <select value={v} onChange={(e) => on(e.target.value)}>
      {opts.map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </select>
  )
  const metricOpts = Object.entries(METRIC_LABEL) as [string, string][]
  const opOpts: [string, string][] = [
    ['ge', '≥'],
    ['le', '≤'],
  ]

  return (
    <div className="section" style={{ borderBottom: 'none' }}>
      <Head tip="Plain day counts per year, with the per-year trend fitted by least squares and its R². Build your own with the row below — it lives in the URL like everything else.">
        THRESHOLD COUNTERS
      </Head>
      <div className="builder">
        <span>DAYS WHERE</span>
        {sel(draft.m1, (v) => setDraft({ ...draft, m1: v as CounterMetric }), metricOpts)}
        {sel(draft.op1, (v) => setDraft({ ...draft, op1: v as CounterOp }), opOpts)}
        <input value={draft.v1} onChange={(e) => setDraft({ ...draft, v1: e.target.value })} inputMode="decimal" />
        <span>AND</span>
        {sel(draft.m2, (v) => setDraft({ ...draft, m2: v as CounterMetric | '' }), [['', '—'], ...metricOpts])}
        {draft.m2 && sel(draft.op2, (v) => setDraft({ ...draft, op2: v as CounterOp }), opOpts)}
        {draft.m2 && (
          <input value={draft.v2} onChange={(e) => setDraft({ ...draft, v2: e.target.value })} inputMode="decimal" />
        )}
        <button className="link-btn" style={{ padding: '3px 6px' }} onClick={add}>
          + ADD
        </button>
      </div>
      {ytd && ytd.raw.days >= YTD_MIN_DAYS && (
        <div className="counter" style={{ marginBottom: 4 }}>
          <span className="lab" />
          <span style={{ width: 96 }} />
          <span className="cap" style={{ width: 54, textAlign: 'right' }}>
            MEAN
          </span>
          <span className="cap" style={{ width: 92, textAlign: 'right' }}>
            TREND
          </span>
          <span
            className="cap"
            style={{ width: 64, textAlign: 'right' }}
            data-tip={`${YTD_YEAR} so far vs a typical year by the same date.`}
          >
            {YTD_YEAR} / TYP
          </span>
        </div>
      )}
      {[...custom, ...presets].map((c) => (
        <CounterRow
          key={c.label}
          s={s}
          w={p.window}
          {...c}
          ytd={ytd && ytd.raw.days >= YTD_MIN_DAYS ? ytd : null}
          custom={'remove' in c}
          selected={picked === c.label}
          onSelect={() => setPicked(picked === c.label ? null : c.label)}
        />
      ))}
      {(() => {
        const c = [...custom, ...presets].find((x) => x.label === picked)
        return c ? (
          <Matrix s={s} w={p.window} label={c.label} pred={c.pred} />
        ) : (
          <div className="prose" style={{ marginTop: 10, fontSize: 10.5 }}>
            Click a counter to see it as a month × year matrix.
          </div>
        )
      })()}
    </div>
  )
}

function CounterRow({
  s,
  w,
  label,
  pred,
  remove,
  custom,
  selected,
  onSelect,
  ytd,
}: {
  s: CitySeries
  w: Window
  label: string
  pred: DayPred
  remove?: () => void
  custom: boolean
  selected: boolean
  onSelect: () => void
  ytd: Ytd | null
}) {
  const yc = useMemo(() => (ytd ? ytdCount(ytd, w, pred, ytd.raw.days) : null), [ytd, w, label]) // eslint-disable-line react-hooks/exhaustive-deps
  const c = useMemo(() => counter(s, w, pred), [s, w, label]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="counter">
      <button
        className="lab"
        onClick={onSelect}
        aria-pressed={selected}
        style={{
          color: selected ? 'var(--ink)' : custom ? CO.accent : undefined,
          background: 'transparent',
          border: 'none',
          padding: 0,
          textAlign: 'left',
          cursor: 'pointer',
          textDecoration: selected ? 'underline' : 'none',
        }}
      >
        {label}
      </button>
      <Spark ys={c.perYear} w={96} h={20} color={custom ? CO.tol : CO.accent} />
      <span className="avg">{c.avg.toFixed(1)}/yr</span>
      <span
        className="fit"
        data-tip="OLS slope in days per year, and how much of the year-to-year variation the trend explains (R²)."
      >
        {signed(c.fit.slope, 2)} R² {c.fit.r2.toFixed(2)}
      </span>
      {yc && (
        <span
          className="mono"
          style={{ fontSize: 10, width: 64, textAlign: 'right', color: 'var(--mid)', whiteSpace: 'nowrap' }}
          data-tip={`${YTD_YEAR} so far: ${yc.ytd} days. The window's mean over the same dates (Jan 1 → last observed day) is ${yc.typical.toFixed(1)}.`}
        >
          <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{yc.ytd}</b> / {Math.round(yc.typical)}
        </span>
      )}
      {remove && (
        <button className="x-btn" onClick={remove} aria-label="Remove counter">
          ✕
        </button>
      )}
    </div>
  )
}

// ---------------- Climate drift ----------------

const BASELINES: Window[] = [
  { from: 1991, to: 2020 },
  { from: 1996, to: 2005 },
  { from: 2006, to: 2015 },
]

export function ClimateDrift({ s, m, p, u }: { s: CitySeries; m: Model; p: Prefs; u: Units }) {
  const [bi, setBi] = useState(0)
  const base = BASELINES[bi]
  const rows = useMemo(() => {
    const w = p.window,
      wm = m.facts.warmestMonth,
      cm = m.facts.coldestMonth
    const d = (a: number, b: number) => a - b
    const out: { label: string; delta: string; color: string; tip?: string }[] = []
    const tColor = (v: number) => (v > 0 ? '#ffb38a' : v < 0 ? '#8ac4ff' : 'var(--ink)')
    const dh = d(monthMeanHigh(s, w, wm), monthMeanHigh(s, base, wm))
    out.push({
      label: `${MONTH_FULL[wm]} mean high (warmest month)`,
      delta: `${u.dt(dh)}${u.tu}`,
      color: tColor(dh),
      tip: 'Temperature change. Warm/cool tint shows direction of temperature only — not whether it is better or worse.',
    })
    const dl = d(monthMeanLow(s, w, cm), monthMeanLow(s, base, cm))
    out.push({ label: `${MONTH_FULL[cm]} mean low (coldest month)`, delta: `${u.dt(dl)}${u.tu}`, color: tColor(dl) })
    if (m.b && p.temp) {
      const bs = score(s, p, base)
      if (bs) {
        const bb = budget(bs)
        const dc = m.b.counts[0] - bb.counts[0],
          du = m.b.counts[2] - bb.counts[2]
        out.push({
          label: 'Comfortable days (your fit)',
          delta: `${signed(dc)} /yr`,
          color: dc >= 0 ? CO.comf : CO.warn,
          tip: 'Scored with your current preferences in both windows. Coloured by your fit.',
        })
        out.push({
          label: 'Unbearable days (your fit)',
          delta: `${signed(du)} /yr`,
          color: du <= 0 ? CO.comf : CO.warn,
        })
      }
    }
    const count = (label: string, pred: DayPred) => {
      const v = perYear(s, w, pred) - perYear(s, base, pred)
      out.push({ label, delta: `${signed(v)} /yr`, color: 'var(--ink)' })
    }
    count(`Freeze days (low ≤ ${u.t(32)}${u.tu})`, (x, j) => x.low[j] <= 32)
    count(`Nights above ${u.t(60)}${u.tu}`, (x, j) => x.low[j] > 60)
    count('Snow days, city centre', (x, j) => x.snow[j] >= 0.1)
    count('Overcast days (cloud ≥ 80%)', (x, j) => x.cloud[j] >= 80)
    if (m.terrain) {
      const t = m.terrain.series
      const v = terrainCover(t, w, 6) - terrainCover(t, base, 6)
      out.push({
        label: `Snow cover ≥ ${u.depth(6)} at ${m.terrain.name}`,
        delta: `${signed(v)} /yr`,
        color: 'var(--ink)',
      })
    }
    return out
  }, [s, m, p, u, base])
  return (
    <div className="section" style={{ borderBottom: 'none' }}>
      <div style={{ marginBottom: 12 }}>
        <Head tip="The active window against an earlier baseline in the same record, so you can see which way this city is moving. Deltas are stated numerically; count changes carry no good/bad colouring.">
          CLIMATE DRIFT
        </Head>
      </div>
      <div className="sub" style={{ marginBottom: 10 }}>
        {windowLabel(p.window)} vs {windowLabel(base)} baseline
      </div>
      {rows.map((r) => (
        <div className="list-row" key={r.label} data-tip={r.tip}>
          <span className="k">{r.label}</span>
          <span className="v" style={{ color: r.color }}>
            {r.delta}
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        <span className="prose" style={{ fontSize: 10.5 }}>
          Baseline
        </span>
        <Seg
          small
          value={bi}
          onChange={setBi}
          options={BASELINES.map((b, i) => ({ v: i, label: i === 0 ? `${windowLabel(b)} normal` : windowLabel(b) }))}
        />
      </div>
    </div>
  )
}

// ---------------- Seasonality / sky & light ----------------

export function FactsPanel({
  m,
  u,
  w,
  solarIdx,
  seasonsIdx,
}: {
  m: Model
  u: Units
  w: Window
  solarIdx: number | null
  seasonsIdx: number | null
}) {
  const f = m.facts,
    b = m.b
  const rows: [string, string, string?][] = [
    ['Mean diurnal swing', `${u.dt(f.swing).replace('+', '')}${u.tu}`, 'Mean of daily high minus daily low.'],
    [
      'Last spring / first fall freeze',
      f.lastFreeze !== null ? `${doyLabel(f.lastFreeze)} / ${doyLabel(f.firstFreeze!)}` : 'none in most years',
      'Median dates of the last and first daily low ≤ 32°F around the warmest month.',
    ],
    ['Frost-free season', f.frostFree !== null ? `${f.frostFree} d` : '—'],
    [
      'Freeze–thaw cycles',
      `${Math.round(f.freezeThaw)} /yr`,
      'Days with a low at or below freezing and a high above it.',
    ],
    [
      'Clear / partly / overcast days',
      `${Math.round(f.clear)} · ${Math.round(f.partly)} · ${Math.round(f.overcast)}`,
      'Daily mean cloud ≤ 20% / between / ≥ 80%.',
    ],
    [
      'Longest gray-day streak',
      `${f.grayStreak} d`,
      'Longest run of days with mean cloud ≥ 80% anywhere in the window.',
    ],
    ['Sunshine', `${Math.round(f.sunHours).toLocaleString()} h/yr`],
    ['Daylight, shortest – longest day', `${f.daylight[0].toFixed(1)} – ${f.daylight[1].toFixed(1)} h`],
    ['Snow days, city centre', `${Math.round(f.snowDays)} /yr`],
    ...(m.terrain
      ? [
          [
            `Snow cover ≥ ${u.depth(6)} at ${m.terrain.name}`,
            `${Math.round(terrainCover(m.terrain.series, w, 6))} /yr`,
          ] as [string, string],
        ]
      : []),
    ...(b
      ? [
          ['Longest comfortable streak', `${b.bestStreak} d`] as [string, string],
          ['Longest unbearable streak', `${b.unbStreak} d`] as [string, string],
          ['Longest run without a comfortable day', `${b.worstGap} d`] as [string, string],
          ['Best / worst month for you', `${MN[b.bestMonth]} / ${MN[b.worstMonth]}`] as [string, string],
        ]
      : []),
    [
      'Solar intensity index',
      solarIdx !== null ? `${solarIdx} / 100` : '—',
      'Mean daily shortwave radiation, normalised 0–100 across the city set. Context only — never scored.',
    ],
    [
      'Four-season distinctness',
      seasonsIdx !== null ? `${seasonsIdx} / 100` : '—',
      'Standard deviation of monthly mean temperature, normalised 0–100 across the city set. High = sharply different seasons.',
    ],
  ]
  return (
    <div className="section" style={{ borderBottom: 'none' }}>
      <div style={{ marginBottom: 12 }}>
        <Head tip="Facts temperature alone will not tell you: how gray it is, how sharp the seasons are, how much snow is reachable.">
          SEASONALITY · SKY &amp; LIGHT
        </Head>
      </div>
      {rows.map(([k, v, tip]) => (
        <div className="list-row" key={k} data-tip={tip}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  )
}

/** Month × year matrix for one counter — where drift stops being a trend line and becomes visible. */
function Matrix({ s, w, label, pred }: { s: CitySeries; w: Window; label: string; pred: DayPred }) {
  const m = useMemo(() => monthYearMatrix(s, w, pred), [s, w, label]) // eslint-disable-line react-hooks/exhaustive-deps
  const max = Math.max(1, ...m.flat())
  return (
    <div style={{ marginTop: 14 }}>
      <div className="cap" style={{ marginBottom: 6 }}>
        {label.toUpperCase()} · DAYS PER MONTH
      </div>
      <div
        style={{ display: 'grid', gridTemplateColumns: `34px repeat(12, 1fr)`, gap: 1, font: '400 9px/1 var(--mono)' }}
      >
        <span />
        {MN.map((n) => (
          <span key={n} style={{ color: 'var(--faint)', textAlign: 'center', paddingBottom: 3 }}>
            {n[0]}
          </span>
        ))}
        {m.map((row, y) => [
          <span key={`y${y}`} style={{ color: 'var(--faint)', alignSelf: 'center' }}>
            {w.from + y}
          </span>,
          ...row.map((v, k) => (
            <span
              key={`${y}-${k}`}
              data-tip={`${MN[k]} ${w.from + y}: ${v} days`}
              style={{
                height: 14,
                background: v ? `rgba(124,196,255,${0.12 + 0.78 * (v / max)})` : 'var(--row)',
                color: v / max > 0.55 ? 'var(--bg)' : 'var(--mid)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 8.5,
              }}
            >
              {v || ''}
            </span>
          )),
        ])}
      </div>
    </div>
  )
}
