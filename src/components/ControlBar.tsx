import { useEffect, useRef, useState } from 'react'
import type { CityMeta } from '../lib/data'
import { MN } from '../lib/calendar'
import {
  CUTOFF,
  EXAMPLE_STATE,
  presetNote,
  FIRST_YEAR,
  LAST_YEAR,
  LOOKBACKS,
  PRESETS,
  T_MAX,
  T_MIN,
  D_MAX,
  D_MIN,
  DEW_HARD_GAP,
  hasPreference,
  windowLabel,
  windowYears,
  type Prefs,
  type Weight,
} from '../lib/prefs'
import { SOFT } from '../lib/scoring'
import type { View } from '../lib/session'
import type { Units } from '../lib/units'
import { useDismiss } from '../hooks/useDismiss'
import { useSteadyHeight } from '../hooks/useSteadyHeight'
import { CityList } from './CityPicker'
import { FourPointSlider } from './FourPointSlider'
import { Cap, Seg } from './ui'

type Menu = 'city' | 'presets' | 'more' | 'window' | null

export interface BarProps {
  prefs: Prefs
  set: (patch: Partial<Prefs>) => void
  reset: () => void
  city: CityMeta
  setCity: (id: string) => void
  u: Units
  warmMonths: boolean[] | null
  calFill: 'banded' | 'continuous'
  setCalFill: (v: 'banded' | 'continuous') => void
  comfByCity: Record<string, number | null>
  view: View
  setView: (v: View) => void
  cmpCount: number
}

const WEIGHTS: { v: Weight; label: string }[] = [
  { v: 'minor', label: 'Minor' },
  { v: 'normal', label: 'Normal' },
  { v: 'critical', label: 'Critical' },
]

const TABS: { v: View; label: string; tip: string }[] = [
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

/** Screen tabs. Every screen reads the one session state in this bar. */
function Tabs({ view, setView, cmpCount }: { view: View; setView: (v: View) => void; cmpCount: number }) {
  return (
    <nav className="tabs" aria-label="Screens">
      {TABS.map((t) => (
        <button
          key={t.v}
          className="tab"
          aria-current={view === t.v ? 'page' : undefined}
          onClick={() => setView(t.v)}
          data-tip={t.tip}
        >
          {t.label}
          {t.v === 'compare' && <span className={cmpCount ? 'n' : 'n zero'}>{cmpCount}</span>}
        </button>
      ))}
    </nav>
  )
}

export function ControlBar(props: BarProps) {
  const { prefs: p, set, u, city } = props
  const [menu, setMenu] = useState<Menu>(null)
  const [collapsed, setCollapsed] = useState(false)
  const pinned = useRef(false)
  const lastY = useRef(0)
  const root = useSteadyHeight<HTMLDivElement>(collapsed)

  // Collapse to a summary line once the page scrolls; tapping it re-expands until the next scroll away.
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      if (y < 60) {
        pinned.current = false
        setCollapsed(false)
      } else if (!pinned.current) setCollapsed(true)
      else if (Math.abs(y - lastY.current) > 400) {
        pinned.current = false
        setCollapsed(true)
        setMenu(null)
      }
      if (!pinned.current) lastY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useDismiss(menu !== null, root, () => setMenu(null))

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        pinned.current = true
        setCollapsed(false)
        setMenu('city')
      }
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [])

  const toggle = (m: Menu) => setMenu((cur) => (cur === m ? null : m))
  const t = p.temp
  const dew = p.dew
  const n = windowYears(p.window)
  const isPreset = p.window.to === LAST_YEAR && LOOKBACKS.includes(n)

  const bandReadout = t
    ? `${t.hardMin === null ? '−∞' : u.t(t.hardMin)} · ${u.t(t.idealMin)} – ${u.t(t.idealMax)} · ${t.hardMax === null ? '+∞' : u.t(t.hardMax)}`
    : 'unset — no band stated'
  const dewReadout = dew
    ? `< ${u.t(dew.idealMax)} · ${dew.hardMax === null ? '+∞' : u.t(dew.hardMax)}`
    : 'unset — not scored'
  const expand = () => {
    pinned.current = true
    lastY.current = window.scrollY
    setCollapsed(false)
  }

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

  const warmNote = props.warmMonths
    ? (() => {
        const warm = props.warmMonths.map((w, m) => (w ? MN[m] : null)).filter(Boolean)
        return `${city.name}: warm season ${warm.join(' ')} — derived from its six warmest months in ${windowLabel(p.window)}.`
      })()
    : ''

  if (collapsed) {
    return (
      <div className="bar collapsed" ref={root}>
        <div className="summary">
          <span className={hasPreference(p) ? 'brand-mark' : 'brand-mark off'} />
          <span className="brand" style={{ fontSize: 10.5 }}>
            {city.name.toUpperCase()}
          </span>
          <Tabs view={props.view} setView={props.setView} cmpCount={props.cmpCount} />
          <button className="summary-btn" onClick={expand} aria-label="Expand the control bar">
            <span className="summary-text">{summary}</span>
            <span className="cap" style={{ marginLeft: 'auto', color: 'var(--accent)' }}>
              EDIT ▾
            </span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bar" ref={root}>
      <div className="bar-row">
        <div className="bar-cell row">
          <span
            className={hasPreference(p) ? 'brand-mark' : 'brand-mark off'}
            data-tip={hasPreference(p) ? undefined : 'Grey until you state a preference: nothing is being scored yet.'}
          />
          <span className="brand">CLIMATE FIT</span>
        </div>

        <div className="bar-cell row" style={{ minWidth: 190 }}>
          <button
            className="city-btn"
            aria-expanded={menu === 'city'}
            onClick={() => toggle('city')}
            data-tip="Switch city. ⌘K opens the same picker from anywhere."
          >
            <span className="cap">CITY</span>
            <span style={{ font: '600 13px/1 var(--sans)', whiteSpace: 'nowrap' }}>
              {city.name}, {city.code}
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>
              ⌘K
            </span>
          </button>
          {menu === 'city' && (
            <div className="pop" style={{ left: 8, width: 280 }}>
              <CityList
                current={city.id}
                onPick={(id) => {
                  props.setCity(id)
                  setMenu(null)
                }}
                note={(c) => (props.comfByCity[c.id] != null ? `comf ${props.comfByCity[c.id]}` : null)}
              />
            </div>
          )}
        </div>

        <div className="bar-cell" style={{ width: 372 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Cap tip="Your ideal temperature range (green handles) plus hard bounds (the thin floor and ceiling handles), outside which a day is written off. Between ideal and a hard bound a day degrades linearly — that is the tolerable ramp. Drag a hard handle off either end of the track to make that side open-ended. Scale −30 to 110°F.">
              COMFORT BAND · {u.tu}
              {p.seasonal ? ' · WARM SEASON' : ''}
            </Cap>
            <span className={t ? 'readout' : 'readout unset'}>{bandReadout}</span>
          </div>
          <FourPointSlider label="Comfort band" value={t} onChange={(b) => set({ temp: b })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className={`chip${t && t.hardMin === null ? ' open' : ''}`}
              disabled={!t}
              onClick={() =>
                t && set({ temp: { ...t, hardMin: t.hardMin === null ? Math.max(T_MIN, t.idealMin - 15) : null } })
              }
              data-tip="No hard floor: cold alone never writes a day off. Days below your ideal minimum still lose points on a soft ramp, so they land in TOLERABLE rather than COMFORTABLE — they just never become UNBEARABLE. Click to set a real floor."
            >
              {!t || t.hardMin === null ? '−∞ FLOOR' : `FLOOR ${u.t(t.hardMin)}°`}
            </button>
            <span className="cap" style={{ flex: 1, textAlign: 'center' }}>
              {t ? 'DRAG · OFF-TRACK = OPEN' : 'NOT SCORED UNTIL SET'}
            </span>
            <button
              className={`chip${t && t.hardMax === null ? ' open' : ''}`}
              disabled={!t}
              onClick={() =>
                t && set({ temp: { ...t, hardMax: t.hardMax === null ? Math.min(T_MAX, t.idealMax + 10) : null } })
              }
              data-tip="No hard ceiling: heat alone never writes a day off, though days above your ideal maximum still lose points on a soft ramp. Click to set a real ceiling."
            >
              {!t || t.hardMax === null ? '+∞ CEILING' : `CEILING ${u.t(t.hardMax)}°`}
            </button>
          </div>
        </div>

        <div className="bar-cell" style={{ width: 268 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Cap
              tip={`Humidity, measured as dew point rather than relative humidity. The green handle is the top of your ideal range; the thin ceiling handle is where a day is written off. Between them a day degrades linearly. Drag the ceiling off the right end to make it open-ended — humidity alone then never writes a day off, it only fades the score over ${SOFT.dew}°F. Dry air is never penalised. Roughly: under 55°F feels dry, 60–65°F sticky, above 70°F oppressive. Scale ${D_MIN} to ${D_MAX}°F.`}
            >
              DEW POINT · {u.tu}
            </Cap>
            <span className={dew ? 'readout' : 'readout unset'}>{dewReadout}</span>
          </div>
          <FourPointSlider
            label="Dew point"
            side="max"
            domain={[D_MIN, D_MAX]}
            soft={SOFT.dew}
            value={dew ? { hardMin: null, idealMin: D_MIN, idealMax: dew.idealMax, hardMax: dew.hardMax } : null}
            // First drag from unset seeds the ceiling where it always used to sit, so turning
            // the control on still writes the same days off; from there it is the user's to move.
            onChange={(b) =>
              set({
                dew: {
                  idealMax: b.idealMax,
                  hardMax: dew ? b.hardMax : Math.min(D_MAX, b.idealMax + DEW_HARD_GAP),
                },
              })
            }
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="cap" style={{ flex: 1 }}>
              {dew ? 'DRAG · OFF-TRACK = OPEN' : 'NOT SCORED UNTIL SET'}
            </span>
            {dew && (
              <button
                className={`chip${dew.hardMax === null ? ' open' : ''}`}
                onClick={() =>
                  set({
                    dew: {
                      ...dew,
                      hardMax: dew.hardMax === null ? Math.min(D_MAX, dew.idealMax + DEW_HARD_GAP) : null,
                    },
                  })
                }
                data-tip="No hard ceiling: humidity alone never writes a day off, though days above your ideal edge still lose points on a soft ramp. Click to set a real ceiling."
              >
                {dew.hardMax === null ? '+∞ CEILING' : `CEILING ${u.t(dew.hardMax)}°`}
              </button>
            )}
            {dew && (
              <button className="x-btn" onClick={() => set({ dew: null })} data-tip="Stop scoring dew point.">
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="bar-cell">
          <Cap tip="Where the line between COMFORTABLE and TOLERABLE sits on the 0–100 fit score: Lenient 75, Standard 85, Strict 95. It moves the cutoff only — your hard bounds do not change.">
            STRICTNESS
          </Cap>
          <Seg
            label="Strictness"
            value={p.strict}
            onChange={(v) => set({ strict: v })}
            options={[
              { v: 'lenient', label: 'Lenient' },
              { v: 'standard', label: 'Standard' },
              { v: 'strict', label: 'Strict' },
            ]}
          />
        </div>

        <div className="bar-cell">
          <Cap tip="How far you will drive for snow. Snow metrics are measured at the best real terrain inside that limit, never at city centre where it may rarely snow.">
            SNOW DRIVE
          </Cap>
          <Seg
            label="Snow drive"
            value={p.drive}
            onChange={(v) => set({ drive: v })}
            options={[
              { v: 1, label: '≤1h' },
              { v: 2, label: '≤2h' },
              { v: 3, label: '≤3h' },
            ]}
          />
        </div>

        <div className="bar-cell">
          <Cap tip="How many years of daily weather to score. 3–5 years reflects the climate as it is now; 20–30 years is steadier but averages in an earlier climate. Every figure on this page is the mean per year over this window.">
            LOOKBACK · {windowLabel(p.window)}
          </Cap>
          <div style={{ display: 'flex', gap: 2 }}>
            <Seg
              label="Lookback years"
              value={isPreset ? n : -1}
              onChange={(v) => set({ window: { from: LAST_YEAR - v + 1, to: LAST_YEAR } })}
              options={LOOKBACKS}
            />
            <div className="seg">
              <button aria-pressed={!isPreset} onClick={() => toggle('window')} data-tip="Custom start–end years.">
                ⋯
              </button>
            </div>
          </div>
          {menu === 'window' && (
            <div className="pop" style={{ right: 0, width: 230, padding: 12, gap: 10 }}>
              <span className="cap">
                CUSTOM WINDOW · {FIRST_YEAR}–{LAST_YEAR} AVAILABLE
              </span>
              <div className="builder" style={{ margin: 0 }}>
                <select
                  value={p.window.from}
                  onChange={(e) =>
                    set({ window: { from: +e.target.value, to: Math.max(+e.target.value, p.window.to) } })
                  }
                >
                  {yearsList().map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <span>TO</span>
                <select
                  value={p.window.to}
                  onChange={(e) =>
                    set({ window: { from: Math.min(p.window.from, +e.target.value), to: +e.target.value } })
                  }
                >
                  {yearsList().map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="bar-cell">
          <Cap tip="Which temperature drives the score. SHADE uses reported air temperature. IN SUN adds a solar-radiation term, so clear, high-irradiance days read warmer than the thermometer — 90°F and sunny in Denver is not 90°F and sunny in Atlanta.">
            BASIS
          </Cap>
          <Seg
            label="Sun or shade"
            value={p.sun}
            onChange={(v) => set({ sun: v })}
            options={[
              { v: 'shade', label: 'Shade' },
              { v: 'sun', label: 'In sun' },
            ]}
          />
        </div>
      </div>
      <div className="bar-row2">
        <Tabs view={props.view} setView={props.setView} cmpCount={props.cmpCount} />
        <span
          className="summary-text"
          data-tip="The whole session in one line — the bar collapses to this on scroll. It all lives in the URL: bookmark the page to save the session, send the link to share it."
        >
          {summary}
        </span>
        <div className="bar-end">
          <div data-tip="Switch the whole page between °F / inches and °C / millimetres.">
            <Seg
              label="Units"
              value={p.metric ? 'm' : 'i'}
              onChange={(v) => set({ metric: v === 'm' })}
              options={[
                { v: 'i', label: '°F/in' },
                { v: 'm', label: '°C/mm' },
              ]}
            />
          </div>
          <button
            className="btn"
            aria-expanded={menu === 'presets'}
            onClick={() => toggle('presets')}
            data-tip="Starting profiles, alphabetical. Each overwrites the band, dew point and sky preference; every value it sets is printed under its name."
          >
            Presets ▾
          </button>
          <button
            className="btn primary"
            aria-expanded={menu === 'more'}
            onClick={() => toggle('more')}
            data-tip="Seasonal bands, scoring basis, sky, wind, rain, weights and deal-breakers."
          >
            More controls ▾
          </button>

          {menu === 'presets' && (
            <div className="pop" style={{ right: 0, width: 340 }}>
              <span className="cap" style={{ padding: '6px 8px 4px' }}>
                STARTING POINTS · OVERWRITES THE BAND
              </span>
              {PRESETS.map((pr) => (
                <button
                  key={pr.name}
                  className="pop-item"
                  onClick={() => {
                    set(pr.apply)
                    setMenu(null)
                  }}
                >
                  <span className="name">{pr.name}</span>
                  <span className="note">{presetNote(pr, u.t, u.tu)}</span>
                </button>
              ))}
            </div>
          )}

          {menu === 'more' && (
            <div className="pop more">
              <div className="more-row">
                <div className="line">
                  <button
                    className={`toggle${p.seasonal ? ' on' : ''}`}
                    aria-pressed={p.seasonal}
                    aria-label="Seasonal bands"
                    onClick={() =>
                      set({
                        seasonal: !p.seasonal,
                        ...(t && !p.seasonal
                          ? {
                              cold: {
                                idealMin: Math.max(T_MIN, t.idealMin - 10),
                                idealMax: Math.max(T_MIN + 2, t.idealMax - 10),
                              },
                            }
                          : {}),
                      })
                    }
                  >
                    <span />
                  </button>
                  <span style={{ font: '400 11.5px/1.3 var(--sans)' }}>
                    Seasonal bands — {p.seasonal ? 'on: separate cold-season band' : 'off: one band all year'}
                  </span>
                </div>
                {p.seasonal && (
                  <>
                    <div className="line" style={{ justifyContent: 'space-between' }}>
                      <span className="cap">COLD-SEASON IDEAL · {u.tu}</span>
                      <span className="readout">
                        {u.t(p.cold.idealMin)} – {u.t(p.cold.idealMax)}
                      </span>
                    </div>
                    <FourPointSlider
                      label="Cold-season band"
                      hardEditable={false}
                      fixedHard={t ? { hardMin: t.hardMin, hardMax: t.hardMax } : undefined}
                      value={{ hardMin: null, idealMin: p.cold.idealMin, idealMax: p.cold.idealMax, hardMax: null }}
                      onChange={(b) => set({ cold: { idealMin: b.idealMin, idealMax: b.idealMax } })}
                    />
                    <span className="note">
                      Temperature only; hard bounds are shared with the main band. {warmNote} The two bands blend across
                      each season boundary.
                    </span>
                  </>
                )}
              </div>

              <div className="more-row">
                <Cap tip="Which daily temperature the band is compared against. Overnight lows matter for sleep and are routinely ignored elsewhere. BOTH requires the high and the low to qualify.">
                  SCORING BASIS
                </Cap>
                <Seg
                  label="Scoring basis"
                  value={p.basis}
                  onChange={(v) => set({ basis: v })}
                  options={[
                    { v: 'high', label: 'Daily high' },
                    { v: 'low', label: 'Daily low' },
                    { v: 'apparent', label: 'Apparent' },
                    { v: 'both', label: 'High & low' },
                  ]}
                />
              </div>

              <VarRow
                label="SKY"
                tip="Cloud cover preference. Prefer overcast: ideal ≥ 60% daily mean cloud. Prefer clear: ideal ≤ 40%. Scores fade over 40 points beyond ideal."
              >
                <Seg
                  small
                  label="Sky"
                  value={p.cloud}
                  onChange={(v) => set({ cloud: v })}
                  options={[
                    { v: 'any', label: 'Any' },
                    { v: 'clear', label: 'Prefer clear' },
                    { v: 'overcast', label: 'Prefer overcast' },
                  ]}
                />
                {p.cloud !== 'any' && <Extras k="cloud" p={p} set={set} />}
              </VarRow>

              <VarRow
                label={`WIND CEILING${p.windMax !== null ? ` · ${u.speed(p.windMax)}` : ' · OFF'}`}
                tip="Daily maximum sustained wind (not gusts). Above the ceiling the score fades over 15 mph."
              >
                <input
                  type="range"
                  min={6}
                  max={40}
                  step={1}
                  value={p.windMax ?? 40}
                  className={p.windMax === null ? 'unset' : ''}
                  style={{ width: 160 }}
                  onChange={(e) => set({ windMax: +e.target.value })}
                  aria-label="Wind ceiling"
                />
                {p.windMax !== null && (
                  <>
                    <button className="x-btn" onClick={() => set({ windMax: null })}>
                      ✕
                    </button>
                    <Extras k="wind" p={p} set={set} />
                  </>
                )}
              </VarRow>

              <VarRow
                label="PRECIPITATION"
                tip={'Prefer dry: ideal ≤ 0.02" in the day; the score fades to zero at 0.5".'}
              >
                <Seg
                  small
                  label="Precipitation"
                  value={p.dry ? 'dry' : 'any'}
                  onChange={(v) => set({ dry: v === 'dry' })}
                  options={[
                    { v: 'any', label: 'Any' },
                    { v: 'dry', label: 'Prefer dry' },
                  ]}
                />
                {p.dry && <Extras k="precip" p={p} set={set} />}
              </VarRow>

              <div className="more-row">
                <Cap tip="How much each variable counts in the 0–100 fit score. Weights normalise across whichever variables are active.">
                  WEIGHTS · TEMPERATURE / DEW POINT
                </Cap>
                <div className="line">
                  <span className="cap" style={{ width: 34 }}>
                    TEMP
                  </span>
                  <Seg
                    small
                    value={p.weights.temp}
                    onChange={(v) => set({ weights: { ...p.weights, temp: v } })}
                    options={WEIGHTS}
                  />
                </div>
                <div className="line">
                  <span className="cap" style={{ width: 34 }}>
                    DEW
                  </span>
                  <Seg
                    small
                    value={p.weights.dew}
                    onChange={(v) => set({ weights: { ...p.weights, dew: v } })}
                    options={WEIGHTS}
                  />
                </div>
              </div>

              <div className="more-row">
                <Cap>CALENDAR ENCODING</Cap>
                <Seg
                  small
                  value={props.calFill}
                  onChange={props.setCalFill}
                  options={[
                    { v: 'banded', label: 'BANDED' },
                    { v: 'continuous', label: 'CONTINUOUS' },
                  ]}
                />
              </div>

              <div className="more-row" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div className="line">
                  <button
                    className="link-btn"
                    onClick={() => {
                      props.reset()
                      setMenu(null)
                    }}
                  >
                    CLEAR ALL PREFERENCES
                  </button>
                  <button
                    className="link-btn"
                    onClick={() => {
                      set(EXAMPLE_STATE)
                      setMenu(null)
                    }}
                  >
                    LOAD SPEC EXAMPLE STATE
                  </button>
                </div>
                <span className="note">
                  Cutoff now ≥ {CUTOFF[p.strict]} · window {windowLabel(p.window)} ({windowYears(p.window)} yr).
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      {!hasPreference(p) && (
        <div className="bar-prompt">
          <span className="lead">
            State a comfort band, or{' '}
            <button className="inline-link" onClick={() => setMenu('presets')}>
              pick a starting point
            </button>
            , and every day in the record is scored against it.
          </span>
          <span className="rest">Until then the app shows the record as measured and ranks nothing by taste.</span>
          <span className="cap" style={{ marginLeft: 'auto' }}>
            NO ACCOUNT · NO SAVED SETTINGS · STATE LIVES IN THE URL
          </span>
        </div>
      )}
    </div>
  )
}

const yearsList = () => Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i)

function VarRow({ label, tip, children }: { label: string; tip: string; children: React.ReactNode }) {
  return (
    <div className="more-row">
      <Cap tip={tip}>{label}</Cap>
      <div className="line">{children}</div>
    </div>
  )
}

function Extras({ k, p, set }: { k: 'cloud' | 'wind' | 'precip'; p: Prefs; set: (patch: Partial<Prefs>) => void }) {
  return (
    <>
      <Seg
        small
        label="Weight"
        value={p.weights[k]}
        onChange={(v) => set({ weights: { ...p.weights, [k]: v } })}
        options={WEIGHTS}
      />
      <button
        className={`chip${p.deal[k] ? ' open' : ''}`}
        onClick={() => set({ deal: { ...p.deal, [k]: !p.deal[k] } })}
        data-tip="Deal-breaker: where this variable's score would reach zero, the day is written off as UNBEARABLE instead, tagged with this reason."
      >
        {p.deal[k] ? '✓ DEAL-BREAKER' : 'DEAL-BREAKER'}
      </button>
    </>
  )
}
