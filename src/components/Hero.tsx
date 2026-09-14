import { CO } from '../lib/colors'
import { CUTOFF, EXAMPLE_STATE, PRESETS, presetNote, windowLabel, type Prefs } from '../lib/prefs'
import type { Model } from '../lib/model'
import type { Budget } from '../lib/aggregate'
import type { Units } from '../lib/units'
import { Cap, Head, HatchDefs, Spark } from './ui'
import { useWidth } from '../hooks/useWidth'

export function Hero({ m, p, u, set }: { m: Model; p: Prefs; u: Units; set: (patch: Partial<Prefs>) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const win = windowLabel(p.window)
  const b = m.b

  return (
    <div className="grid-hero">
      <div className="section" style={{ borderBottom: 'none' }} ref={ref}>
        {b ? (
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
        ) : (
          <Unset p={p} m={m} u={u} set={set} />
        )}
      </div>

      <div className="section" style={{ borderBottom: 'none', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {b ? (
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
        ) : (
          <UnsetSide m={m} u={u} />
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

function Unset({ p, m, u, set }: { p: Prefs; m: Model; u: Units; set: (patch: Partial<Prefs>) => void }) {
  return (
    <div className="empty-hero">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <Head>DAY BUDGET · NOT SCORED</Head>
        <span className="sub">no comfort preference stated</span>
      </div>
      <div className="title">This app has no opinion about good weather, so it won't score anything until you say what comfortable means to you.</div>
      <div className="prose" style={{ fontSize: 12.5 }}>
        Drag the green handles in the comfort band, set a dew-point ceiling, or start from a preset. Everything below re-scores live as you drag.
        Until then the page shows the raw climate record for {windowLabel(p.window)} and outdoor days, which use fixed, published activity thresholds instead of taste.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PRESETS.map((pr) => (
          <button key={pr.name} className="btn" onClick={() => set(pr.apply)} data-tip={presetNote(pr, u.t, u.tu)}>{pr.name}</button>
        ))}
        <button className="link-btn" onClick={() => set(EXAMPLE_STATE)} data-tip="Ideal 35–58°F, no floor, 68°F ceiling, seasonal bands with a colder winter band, dew point under 45°F, overcast preferred, walking and snowboarding enabled.">
          SPEC EXAMPLE: COLD-PREFERRING · SEASONAL · OUTDOOR
        </button>
      </div>
      <div style={{ display: 'flex', gap: 26, marginTop: 6 }}>
        <Stat label="OUTDOOR DAYS" color={CO.act} n={m.act.outAny} d="≥1 enabled activity possible"
          tip="Needs no preference: these are physical constraints with published thresholds (see Data & methods)." />
        <Stat label="WALKABLE DAYS" color={CO.act} n={m.act.per.walk.days} d="the floor case"
          tip="Days on which simply being outside is viable — the most permissive activity." />
      </div>
    </div>
  )
}

function UnsetSide({ m, u }: { m: Model; u: Units }) {
  const f = m.facts
  return (
    <div>
      <div style={{ marginBottom: 10 }}><Head small>RAW RECORD · UNSCORED</Head></div>
      <div className="list-row"><span className="k">Mean diurnal swing</span><span className="v">{u.dt(f.swing).replace('+', '')}{u.tu}</span></div>
      <div className="list-row"><span className="k">Clear / partly / overcast days</span><span className="v">{Math.round(f.clear)} · {Math.round(f.partly)} · {Math.round(f.overcast)}</span></div>
      <div className="list-row"><span className="k">Nights above {u.t(60)}{u.tu}</span><span className="v">{Math.round(f.warmNights)} /yr</span></div>
      <div className="list-row"><span className="k">Snow days, city centre</span><span className="v">{Math.round(f.snowDays)} /yr</span></div>
      <div className="list-row"><span className="k">Sunshine hours</span><span className="v">{Math.round(f.sunHours).toLocaleString()} /yr</span></div>
      <div className="prose" style={{ marginTop: 12, fontSize: 10.5 }}>Colours on this page encode fit to your preferences, never temperature. With nothing stated, there is nothing to colour.</div>
    </div>
  )
}
