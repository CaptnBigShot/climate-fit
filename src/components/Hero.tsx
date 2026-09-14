import { CO } from '../lib/colors'
import { CUTOFF, windowLabel, type Prefs } from '../lib/prefs'
import type { Model } from '../lib/model'
import type { Budget } from '../lib/aggregate'
import { Cap, Head, HatchDefs, Spark } from './ui'
import { useWidth } from '../hooks/useWidth'
import { YTD_MIN_DAYS, YTD_YEAR, fetchedDay, ytdBudget, ytdOutdoor, type Ytd } from '../lib/current'
import { doyLabel } from '../lib/calendar'
import type { Scored } from '../lib/scoring'

/** The day budget. Only rendered once a preference exists — the unset page is the opening state. */
export function Hero({ m, p, ytd, ytdSc, ytdError }: {
  m: Model; p: Prefs; ytd: Ytd | null; ytdSc: Scored | null; ytdError: string | null
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const win = windowLabel(p.window)
  const b = m.b

  return (
    <div className="grid-hero">
      <div className="section" style={{ borderBottom: 'none' }} ref={ref}>
        {b && (
          <>
            <div className="section-head">
              <Head tip="Every day of the year sorted into three buckets by your own thresholds, averaged per year across the lookback window. The hatched slice inside unbearable is the days that crossed a line you drew in the control bar.">DAY BUDGET · YOUR FIT</Head>
              <span className="sub">365 days / yr · mean over {win}</span>
            </div>
            {width > 0 && <BudgetBar b={b} width={width} height={40} />}
            <div style={{ display: 'flex', gap: 26, marginTop: 16, flexWrap: 'wrap' }}>
              <Stat label="COMFORTABLE" color={CO.comf} n={b.counts[0]} d={`days/yr · fit ≥ ${CUTOFF[p.strict]}`}
                tip="Days scoring at or above your strictness cutoff — conditions you asked for." />
              <Stat label="TOLERABLE" color={CO.tol} n={b.counts[1]} d="inside hard bounds, under cutoff"
                tip="Days inside every hard bound but below the cutoff. Liveable with a compromise; the panel on the right says which compromise." />
              <Stat label="UNBEARABLE" color="#98a0ad" n={b.counts[2]} d={`${Math.round(b.hard)} crossed a line you drew ▨`}
                tip="Days outside a hard bound or failing a deal-breaker. Written off, regardless of how well the rest of the day scored." />
              <div style={{ borderLeft: '1px solid var(--line)', paddingLeft: 26 }}>
                <Stat label="OUTDOOR DAYS" color={CO.act} n={m.act.outAny} d="≥1 enabled activity possible"
                  tip="Days on which at least one of your enabled activities is possible. Scored separately from comfort — a day can be uncomfortable and still walkable." />
              </div>
            </div>
            <Trend b={b} from={p.window.from} to={p.window.to} />
          </>
        )}
        <YtdBlock m={m} p={p} ytd={ytd} ytdSc={ytdSc} error={ytdError} width={width} />
      </div>

      <div className="section" style={{ borderBottom: 'none', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {b && (
          <>
            <div>
              <div style={{ marginBottom: 10 }}>
                <Head small tip="Of the days that were not comfortable, which single condition was most responsible — the variable with the largest weighted shortfall, or the bound the day crossed.">WHY DAYS FALL SHORT</Head>
              </div>
              <div className="bars">
                {b.reasons.map((r) => (
                  <div className="row" key={r.label}>
                    <span className="lab">{r.label}</span>
                    <span style={{ height: 8, width: Math.max(1, r.pct * 1.3), background: CO.tol }} />
                    <span className="pct">{r.pct}%</span>
                  </div>
                ))}
              </div>
              {b.reasons[0] && (
                <div className="prose" style={{ marginTop: 9, fontSize: 10.5 }}>
                  Of {Math.round(b.nonComf)} non-comfortable days a year, {b.reasons[0].pct}% fell short on {b.reasons[0].label}.
                </div>
              )}
            </div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              <div style={{ marginBottom: 8 }}><Head small tip="Across the tolerable days only, the condition that most often kept them short of comfortable — what you would actually be putting up with.">COMPROMISE PROFILE</Head></div>
              <div className="prose">
                {b.compromise
                  ? <>Across the {Math.round(b.counts[1])} tolerable days you would mostly be putting up with <b>{b.compromise.label}</b> ({b.compromise.pct}% of them) — days inside every hard bound you set but short of the {CUTOFF[p.strict]} cutoff.</>
                  : <>No tolerable days under these settings — every day is either comfortable or written off.</>}
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              <div style={{ marginBottom: 8 }}><Head small tip="For each hard line you drew, how many days loosening it alone would bring back inside your bounds.">DEAL-BREAKER RECLAIM</Head></div>
              {m.reclaim.length ? m.reclaim.map((r) => (
                <div className="prose" key={r.text}>{r.text} reclaims <span className="mono" style={{ color: CO.comf }}>{r.days}</span> days/yr here.</div>
              )) : <div className="prose">No hard bounds set — no single line is writing days off.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, color, n, d, tip }: { label: string; color: string; n: number; d: string; tip: string }) {
  return (
    <div className="stat">
      <Cap tip={tip} color={color}>{label}</Cap>
      <div className="n" style={{ color }}>{Math.round(n)}</div>
      <div className="d">{d}</div>
    </div>
  )
}

function Trend({ b, from, to }: { b: Budget; from: number; to: number }) {
  if (b.perYear.length < 2) return null
  const first = b.perYear[0], last = b.perYear[b.perYear.length - 1]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <Spark ys={b.perYear} w={150} h={34} color={CO.comf} />
      <span className="prose" style={{ fontSize: 12 }}>
        Comfortable days: {first} in {from}, {last} in {to}. Fitted trend {b.trend.slope >= 0 ? '+' : '−'}{Math.abs(b.trend.slope).toFixed(1)} days/yr.{' '}
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--faint)' }}>
          OLS · R² {b.trend.r2.toFixed(2)}{b.trend.r2 < 0.3 ? ' — weak fit, mostly year-to-year noise' : ''}
        </span>
      </span>
    </div>
  )
}

export function BudgetBar({ b, width, height, labels = true, id = 'hatch-bb' }: { b: Budget; width: number; height: number; labels?: boolean; id?: string }) {
  const x = (v: number) => (v / 365) * width
  const [c, t, un] = b.counts
  const cW = x(c), tW = x(t), uW = x(un), hW = x(b.hard)
  const H = height + (labels ? 20 : 0)
  const put = (x0: number, w: number, v: number) =>
    w > 26 ? <text x={x0 + w / 2} y={height / 2 + 4} textAnchor="middle" fill="#0d0f12" style={{ font: "600 12px 'JetBrains Mono', monospace", pointerEvents: 'none' }}>{Math.round(v)}</text> : null
  return (
    <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} style={{ display: 'block', shapeRendering: 'crispEdges' }}>
      <HatchDefs id={id} />
      <rect x={0} width={cW} height={height} fill={CO.comf} data-tip={`Comfortable: ${c.toFixed(1)} days/yr`} />
      <rect x={cW} width={tW} height={height} fill={CO.tol} data-tip={`Tolerable: ${t.toFixed(1)} days/yr`} />
      <rect x={cW + tW} width={uW} height={height} fill={CO.unb} data-tip={`Unbearable: ${un.toFixed(1)} days/yr`} />
      <rect x={cW + tW + uW - hW} width={hW} height={height} fill={`url(#${id})`} stroke="#8b929e" strokeWidth={0.75}
        data-tip={`Crossed a line you drew in the control bar: ${b.hard.toFixed(1)} of the ${un.toFixed(1)} unbearable days/yr`} />
      {put(0, cW, c)}{put(cW, tW, t)}{put(cW + tW, uW - hW, un)}
      {labels && [0, 91, 182, 273, 365].map((d) => (
        <text key={d} x={x(d)} y={height + 15} textAnchor={d === 0 ? 'start' : d === 365 ? 'end' : 'middle'} fill="#5f6672" style={{ font: "400 9.5px 'JetBrains Mono', monospace" }}>{d}</text>
      ))}
    </svg>
  )
}

/** The current partial year, compared like for like: Jan 1 → last observed day,
 *  against the mean of the window's years over exactly the same dates. */
function YtdBlock({ m, p, ytd, ytdSc, error, width }: { m: Model; p: Prefs; ytd: Ytd | null; ytdSc: Scored | null; error: string | null; width: number }) {
  const head = (right: React.ReactNode) => (
    <div className="section-head" style={{ marginBottom: 10 }}>
      <Head small tip={`${YTD_YEAR} is still in progress, so it is never folded into a lookback window. Here it is compared only against the same calendar span — Jan 1 to the last observed day — in each year of your window.`}>{YTD_YEAR} SO FAR</Head>
      {right}
    </div>
  )
  const wrap = (children: React.ReactNode) => <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>{children}</div>
  if (!ytd) return wrap(head(<span className="sub">{error ? `unavailable — ${error}` : 'loading current year…'}</span>))
  const n = ytd.raw.days
  const through = n ? doyLabel(n - 1) : null
  const badge = (
    <span className="sub" style={{ marginLeft: 'auto' }} data-tip={ytd.source === 'live'
      ? 'Fetched live from Open-Meteo today. The most recent days are provisional reanalysis and can be revised slightly.'
      : `Live fetch failed; showing the snapshot saved at build time (${fetchedDay(ytd)}).`}>
      {ytd.source === 'live' ? '● live · recent days provisional' : `snapshot ${fetchedDay(ytd)}`}
    </span>
  )
  if (n < YTD_MIN_DAYS) {
    return wrap(<>{head(<><span className="sub">jan 1 → {through ?? '—'} · {n} days</span>{badge}</>)}<div className="prose">Too few observed days yet for a fair comparison.</div></>)
  }
  const yb = ytdSc && m.sc ? ytdBudget(ytdSc, m.sc, n) : null
  const out = ytdOutdoor(ytd, p.window, p.acts, m.terrain?.id ?? null, n)
  const d = (a: number, b: number) => { const v = Math.round(a - b); return v === 0 ? '±0' : v > 0 ? `+${v}` : `−${-v}` }
  const barW = Math.max(0, width - 170)
  return wrap(
    <>
      {head(<><span className="sub">jan 1 → {through} · {n} days · vs same dates, {windowLabel(p.window)} mean</span>{badge}</>)}
      {yb && barW > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '64px auto 86px', alignItems: 'center', gap: '6px 10px' }}>
          <span className="cap" style={{ color: 'var(--ink)' }}>{YTD_YEAR}</span>
          <MiniBar counts={yb.ytd} hard={yb.hard} n={n} width={barW} id="hatch-ytd" />
          <span className="mono" style={{ fontSize: 11, textAlign: 'right' }}>{yb.ytd.map((v) => Math.round(v)).join(' · ')}</span>
          <span className="cap">TYPICAL</span>
          <MiniBar counts={yb.typical} hard={yb.typicalHard} n={n} width={barW} id="hatch-typ" dim />
          <span className="mono" style={{ fontSize: 11, textAlign: 'right', color: 'var(--dim)' }}>{yb.typical.map((v) => Math.round(v)).join(' · ')}</span>
        </div>
      )}
      <div className="prose" style={{ marginTop: 10 }}>
        {yb && <>Comfortable <b className="mono">{d(yb.ytd[0], yb.typical[0])}</b>, unbearable <b className="mono">{d(yb.ytd[2], yb.typical[2])}</b> days vs a typical year by {through}. </>}
        Outdoor days <b className="mono">{out.ytd}</b> vs typical <span className="mono">{Math.round(out.typical)}</span> ({d(out.ytd, out.typical)}).
      </div>
    </>,
  )
}

function MiniBar({ counts, hard, n, width, id, dim }: { counts: [number, number, number]; hard: number; n: number; width: number; id: string; dim?: boolean }) {
  const x = (v: number) => (v / n) * width
  const [c, t, un] = counts.map(x)
  return (
    <svg width={width} height={12} style={{ display: 'block', shapeRendering: 'crispEdges', opacity: dim ? 0.7 : 1 }}>
      <HatchDefs id={id} />
      <rect width={c} height={12} fill={CO.comf} />
      <rect x={c} width={t} height={12} fill={CO.tol} />
      <rect x={c + t} width={un} height={12} fill={CO.unb} />
      <rect x={c + t + un - x(hard)} width={x(hard)} height={12} fill={`url(#${id})`} />
    </svg>
  )
}
