// Data & Methods. Someone deciding where to live is entitled to see the seams: every
// source, every derivation and every threshold the app sets on the user's behalf.
// The full screen covers the whole city set; the strip at the foot of a city page
// covers that city and links here.
import { memo, useMemo, useState } from 'react'
import { ARCHIVE, CITIES, TERRAIN, type CityMeta, type CitySeries, type Manifest, type TerrainSeries } from '../lib/data'
import { ACTIVITIES, RIDE_DEPTH_IN, SEASON_RELIABILITY, ruleParts } from '../lib/activities'
import { CLOUD_CLEAR_IDEAL, CLOUD_OVERCAST_IDEAL, DEW_HARD_GAP, DRY_IDEAL, SEASON_BLEND_DAYS, SOFT, SUN_F_PER_MJ, seasonWeights } from '../lib/scoring'
import { CUTOFF, windowLabel, windowYears, type Prefs } from '../lib/prefs'
import { terrainAt, type Model } from '../lib/model'
import { MN } from '../lib/calendar'
import type { Units } from '../lib/units'
import { downloadDailyCsv } from '../lib/csv'
import { DEPTH_CARRY_DAYS, YTD_MIN_DAYS, YTD_YEAR, fetchedDay, type Ytd } from '../lib/current'
import { MOSQUITO_DEW_F, MOSQUITO_LOW_F, SHIFTS } from '../lib/extras'
import { AQI_LEVELS, EPA_OUTLIER_AQI, EPA_RADIUS_KM, EPA_START_YEAR, POLLUTANTS } from '../lib/aq'
import { CLIMATE_SCALE } from '../lib/discover'
import { MAX_COMPARE, PIVOT } from '../lib/compare'
import { Head } from './ui'

const M_TO_FT = 3.28084
/** Grid-cell vs city elevation difference worth flagging, ft. */
const GRID_FLAG_FT = 300

const gridDelta = (demElevM: number, gridElevM: number) => (gridElevM - demElevM) * M_TO_FT
const gridFlag = (deltaFt: number) => Math.abs(deltaFt) > GRID_FLAG_FT

function ytdText(ytd: Ytd | null, ytdError: string | null) {
  return ytd
    ? `${ytd.source === 'live' ? 'Fetched live today' : `Build-time snapshot from ${fetchedDay(ytd)} (live fetch failed)`}; observed Jan 1 → ${ytd.raw.through ?? '—'} (${ytd.raw.days} days), ending at the city's local yesterday. Never folded into a lookback window: compared only with the same Jan 1 → date span of each window year (withheld below ${YTD_MIN_DAYS} days). Recent days are provisional. Terrain snow depth lags a few days and is carried forward up to ${DEPTH_CARRY_DAYS} days`
    : ytdError ? `Unavailable — ${ytdError}` : 'Loading…'
}

// ---------------- Full screen ----------------

export const MethodsPage = memo(function MethodsPage({ city, series, terrains, manifest, p, u, ytd, ytdError }: {
  city: CityMeta; series: Record<string, CitySeries>; terrains: Record<string, TerrainSeries>; manifest: Manifest | null
  p: Prefs; u: Units; ytd: Ytd | null; ytdError: string | null
}) {
  const w = p.window
  const [exportId, setExportId] = useState(city.id)
  const exportCity = CITIES.find((c) => c.id === exportId) ?? city
  const exportSeries = series[exportCity.id]

  const grid = CITIES.map((c) => {
    const mc = manifest?.cities[c.id]
    return { c, mc, delta: mc ? gridDelta(mc.demElevM, mc.gridElevM) : null, s: series[c.id] }
  })
  const flagged = grid.filter((g) => g.delta !== null && gridFlag(g.delta)).length

  const seasons = useMemo(() => CITIES.map((c) => ({ c, warm: series[c.id] ? seasonWeights(series[c.id], w).warmMonths : null })), [series, w])
  const terrainRows = useMemo(() => CITIES.map((c) => ({
    c, stops: ([1, 2, 3] as const).map((d) => ({ d, inReach: c.terrain.some(([, min]) => min <= d * 60), t: terrainAt(c, terrains, d, w) })),
  })), [terrains, w])

  const t = (f: number) => `${u.t(f)}${u.tu}`
  const derived: [string, 'Observed' | 'Derived' | 'Modelled' | 'Observed · modelled', string][] = [
    ['Daily high / low', 'Observed', 'ERA5 2 m temperature, daily maximum and minimum, downscaled by Open-Meteo from the grid cell to the city\'s terrain height'],
    ['Dew point', 'Observed', 'Daily mean 2 m dew point, taken directly from the source'],
    ['Cloud cover', 'Observed', 'Daily mean total cloud cover, %'],
    ['Precipitation · snowfall', 'Observed', 'Daily sums from the reanalysis'],
    ['Wind', 'Observed', 'Daily maximum of the hourly mean 10 m wind — not gusts'],
    ['Shortwave · sunshine', 'Observed', 'Daily shortwave radiation sum (MJ/m²) and sunshine duration'],
    ['Terrain snow depth', 'Observed', 'ERA5-Land daily snow depth at each reference terrain coordinate — not at the city'],
    ['Relative humidity', 'Derived', 'Magnus formula from temperature and dew point'],
    ['Apparent temperature', 'Derived', `NWS heat index (Rothfusz) at ≥ ${t(80)}; NWS wind chill at ≤ ${t(50)} with wind ≥ ${u.speed(3)}; otherwise air temperature. Daily high with daily mean dew point and daily max wind`],
    ['In-sun temperature', 'Derived', `Daily high + ${u.dt(SUN_F_PER_MJ, 2).replace('+', '')}${u.tu} per MJ/m² of daily shortwave — a simple radiant-load approximation, not a full UTCI calculation`],
    ['Comfort score', 'Derived', 'Σ weightᵢ × rampᵢ ÷ Σ weightᵢ × 100 over the variables you have set. A ramp is 1 inside ideal and falls linearly to 0 at the hard bound'],
    ['Band', 'Derived', `Any hard bound or deal-breaker crossed → unbearable, checked first and not overridable by score. Else score ≥ cutoff (${CUTOFF.lenient} / ${CUTOFF.standard} / ${CUTOFF.strict}) → comfortable. Else tolerable`],
    ['Season', 'Derived', `Per city, per window: the six warmest months by mean temperature are warm season, the six coolest cold. The two bands blend linearly over ${SEASON_BLEND_DAYS} days at each boundary`],
    ['Failure attribution', 'Derived', 'For each non-comfortable day, the variable with the largest weighted deficit, or the bound the day crossed. The compromise profile is the same count over tolerable days only'],
    ['Trend slope', 'Derived', 'Ordinary least squares on annual values across the window. R² is always shown beside it'],
    ['Diurnal swing', 'Derived', 'Mean of daily high − daily low'],
    ['Solar intensity index', 'Derived', `Mean daily shortwave over the last ${manifest?.refYears ?? 10} archive years, normalised 0–100 across the city set. Context only, never scored`],
    ['Four-season distinctness', 'Derived', 'Standard deviation of monthly mean temperature, normalised 0–100 across the city set'],
    ['Terrain resolution', 'Derived', `At each drive stop, the reference in reach with the most days of ≥ ${u.depth(RIDE_DEPTH_IN)} snow on the ground over the window`],
    ['Outdoor season', 'Derived', `Longest run of days on which walking is viable in ≥ ${Math.round(SEASON_RELIABILITY * 100)}% of years, after a 7-day centred window`],
    ['Climate-space match', 'Derived', `Discover's "like [city] but ___": Σ |difference| ÷ scale over mean high (${u.dt(CLIMATE_SCALE.hi, 0).replace('+', '')}${u.tu}), dew point (${u.dt(CLIMATE_SCALE.dew, 0).replace('+', '')}${u.tu}), cloud (${CLIMATE_SCALE.cloud} pts), shortwave (${CLIMATE_SCALE.rad} MJ/m²) and snow-sport days in reach (${CLIMATE_SCALE.snow}), with the chosen axis shifted first. Match = 100 − 20 × distance`],
    ['Best time to visit', 'Derived', 'Share of comfortable days in every 7-, 14- or 30-day span of the year across the window; the top three that do not overlap. Worst span = most unbearable days'],
    ['What would have to change', 'Derived', `Re-scores the window with highs, lows and dew point all shifted by ${u.dt(SHIFTS[0], 0)}…${u.dt(SHIFTS[SHIFTS.length - 1], 0)}${u.tu}; crossing interpolated linearly; year = ${ARCHIVE.endYear} + warming ÷ OLS slope of annual mean temperature over the whole archive`],
    ['Mosquito proxy', 'Modelled', `Daily low ≥ ${t(MOSQUITO_LOW_F)} and mean dew point ≥ ${t(MOSQUITO_DEW_F)} — a rough proxy, not an observation`],
    ['Air quality', 'Observed · modelled', `US AQI per pollutant (${POLLUTANTS.map((x) => x.label).join(', ')}); a day's AQI is its worst pollutant, counted above ${AQI_LEVELS.map((l) => l.at).join(' / ')}. EPA monitors within ${EPA_RADIUS_KM} km for US cities — ozone takes the day's highest monitor, skipping a lone reading more than ${EPA_OUTLIER_AQI} points above every other; the rest take the nearest. Elsewhere the CAMS model`],
  ]

  const source: [string, string][] = [
    ['Source', 'Open-Meteo Historical Weather API (/v1/archive) · ERA5 reanalysis; ERA5-Land for terrain snow depth'],
    ['Native resolution', 'Hourly on a ~25 km grid (ERA5-Land ~9 km), aggregated to daily'],
    ['Record in this build', `${ARCHIVE.startYear}–${ARCHIVE.endYear}, whole years; Feb 29 dropped so every year has 365 columns. ERA5 itself reaches back to 1940`],
    ['Active window', `${windowLabel(w)} · ${(windowYears(w) * 365).toLocaleString()} days per city`],
    ['Scoring', 'In your browser, every day scored individually and then counted — never from monthly means'],
    ['Humidity basis', 'Dew point, not relative humidity'],
    [`${YTD_YEAR}, partial`, `Live from Open-Meteo in the browser, a build-time snapshot if that fails. ${city.name}: ${ytdText(ytd, ytdError)}`],
    ['Hourly tier', 'Hourly temperature for the last 10 archive years, local clock time — the typical-day panel only'],
    ['Air-quality tier', `Separate and shorter: EPA AirData monitors for US cities from ${EPA_START_YEAR}; the CAMS model elsewhere (Europe from 2013, global from Aug 2022). The lookback window is clipped to it`],
    ['Cities ranked', `${CITIES.length} seed metros, chosen across climate space rather than by size · a few hundred at launch. Any coordinate can still be viewed; the curated set is only the universe for ranking`],
    ['Compare', `Up to ${MAX_COMPARE} cities. Differences-only hides months within ${u.dt(PIVOT.hi.tol, 1).replace('+', '')}${u.tu} (temperature), ${PIVOT.cloud.tol} pts (cloud), ${u.len(PIVOT.precip.tol, 1)} (precip) or ${PIVOT.comf.tol} days (counts)`],
    ['Map', 'Natural Earth 1:110m land, public domain, on a plain longitude / latitude grid'],
  ]

  const limits = [
    'ERA5 is a ~25 km reanalysis: a model of the atmosphere constrained by observations, not a weather station. In complex terrain and on coasts the grid cell approximates the city rather than measuring it.',
    `Grid-cell elevation differs from city elevation by more than ${u.elev(GRID_FLAG_FT)} in ${flagged} of the ${CITIES.length} cities. Temperature is downscaled to the city's terrain height, and the deltas are published above rather than corrected silently.`,
    'Wind is the daily maximum of the hourly mean, not gusts. Cloud cover and dew point are daily means.',
    'Snow-sport days use snow depth at one reference point per terrain — not across a resort network — and temperature from the city. Drive times and reference elevations are hand-entered approximations. Three fixed drive stops are precomputed; a continuous slider is deferred to v2.',
    'Activity thresholds are fixed in v1. Fixed does not mean hidden — the full table is above.',
    'Season boundaries are derived from the active window, so changing the lookback can move which months count as warm.',
    `${YTD_YEAR} is partial and its most recent days are provisional. It is shown beside the window and compared like for like, never averaged in.`,
    'Air quality is a shorter, separately labelled tier. The CAMS model smears local smoke plumes, so its counts tend to run low next to monitors.',
    `The solar intensity and four-season indices are normalised across these ${CITIES.length} cities, so they will move as cities are added.`,
    'Relative humidity, snowfall and daylight are shown but not yet scorable.',
  ]

  return (
    <main className="page">
      <div className="view-head">
        <span className="view-title">DATA &amp; METHODS</span>
        <span className="sub">someone deciding where to live is entitled to see the seams</span>
        <div className="view-end">
          <span className="cap">DAILY DATA · {windowLabel(w)}</span>
          <select className="ctl" value={exportCity.id} onChange={(e) => setExportId(e.target.value)} aria-label="City to export">
            {CITIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn primary" disabled={!exportSeries} onClick={() => exportSeries && downloadDailyCsv(exportCity, exportSeries, p, u)}
            data-tip={`Every day in ${windowLabel(w)} for ${exportCity.name}, in ${u.metric ? 'metric' : 'US'} units, with your band, score and shortfall reason per day.`}>
            {exportSeries ? 'Export daily CSV' : 'Loading…'}
          </button>
        </div>
      </div>

      <div className="section">
        <div className="kv-grid">
          {source.map(([k, v]) => <div className="kv-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>)}
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <Head tip="A reanalysis cell is an area, not a point. Where the cell sits hundreds of feet off the real city, raw temperatures read biased — so the delta is published instead of quietly corrected.">GRID CELL vs CITY ELEVATION</Head>
          <span className="sub" style={{ color: flagged ? 'var(--warn)' : undefined }}>{flagged} of {CITIES.length} cities sit more than {u.elev(GRID_FLAG_FT)} from their grid cell</span>
        </div>
        <div className="table-scroll">
          <table className="plain">
            <thead><tr><th className="l">CITY</th><th>CITY ELEV</th><th>GRID CELL</th><th>DELTA</th><th className="l">CELL CENTRE</th><th className="l">FLAG</th></tr></thead>
            <tbody>
              {grid.map(({ c, mc, delta, s }) => {
                const warn = delta !== null && gridFlag(delta)
                return (
                  <tr key={c.id}>
                    <td className="l strong">{c.name}, {c.code}</td>
                    <td>{mc ? u.elev(mc.demElevM * M_TO_FT) : '—'}</td>
                    <td>{mc ? u.elev(mc.gridElevM * M_TO_FT) : '—'}</td>
                    <td style={{ color: warn ? 'var(--warn)' : 'var(--faint)' }}>{delta === null ? '—' : `${delta >= 0 ? '+' : '−'}${u.elev(Math.abs(delta))}`}</td>
                    <td className="l">{s ? `${s.gridLat.toFixed(2)}, ${s.gridLon.toFixed(2)}` : '—'}</td>
                    <td className="l" style={{ color: warn ? 'var(--warn)' : 'var(--faint)' }}>
                      {delta === null ? '—' : warn ? `▲ raw cell would read ${delta > 0 ? 'cool' : 'warm'} · downscaled` : '✓ within tolerance'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <Head>OBSERVED vs DERIVED</Head>
          <span className="sub">what was measured, what was computed from it, and how</span>
        </div>
        <table className="plain">
          <thead><tr><th className="l">METRIC</th><th className="l">BASIS</th><th className="l">HOW IT IS COMPUTED</th></tr></thead>
          <tbody>
            {derived.map(([m, b, f]) => (
              <tr key={m}>
                <td className="l strong">{m}</td>
                <td className="l" style={{ color: b === 'Observed' ? 'var(--mid)' : b === 'Modelled' ? 'var(--warn)' : 'var(--dim)' }}>{b}</td>
                <td className="l prose-cell">{f}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section">
        <div className="section-head">
          <Head tip="The comfort model has almost no hidden constants. These are all of them.">SCORING · EVERY CONSTANT</Head>
          <span className="sub">applied to whatever you set in the control bar</span>
        </div>
        <table className="plain">
          <tbody>
            {[
              ['Weights', 'Minor 0.5 · Normal 1 · Critical 2, normalised across the variables you have set'],
              ['Strictness cutoff', `Lenient ≥ ${CUTOFF.lenient} · Standard ≥ ${CUTOFF.standard} · Strict ≥ ${CUTOFF.strict} on the 0–100 fit score`],
              ['Hatched unbearable', 'Crossed a line drawn in the control bar: the temperature floor or ceiling, or the dew-point hard limit. Solid unbearable: a deal-breaker set in More controls'],
              ['Open-ended bounds', `An open bound never writes a day off; the score fades to 0 over a soft span past the ideal edge — temperature ${u.dt(SOFT.temp, 0).replace('+', '')}${u.tu}, dew point ${u.dt(SOFT.dew, 0).replace('+', '')}${u.tu}, cloud ${SOFT.cloud} pts, wind ${u.speed(SOFT.wind)}, precip ${u.len(SOFT.precip, 1)}`],
              ['Dew point', `The control sets the top of your ideal range; the hard limit sits ${u.dt(DEW_HARD_GAP, 0).replace('+', '')}${u.tu} above it`],
              ['Sky', `Prefer overcast: ideal ≥ ${CLOUD_OVERCAST_IDEAL}% daily mean cloud. Prefer clear: ideal ≤ ${CLOUD_CLEAR_IDEAL}%. A deal-breaker sits at the end of the soft span`],
              ['Precipitation', `Prefer dry: ideal ≤ ${u.len(DRY_IDEAL, 2)}; a deal-breaker at ${u.len(DRY_IDEAL + SOFT.precip, 2)}`],
              ['Discover fallback', 'When no city reaches 100 comfortable days, the comfortable-days ranking switches to fewest unbearable days and says so. When no city passes every filter, the cities missing the fewest filters are shown, with what they miss'],
            ].map(([k, v]) => <tr key={k}><td className="l strong" style={{ width: 190 }}>{k}</td><td className="l prose-cell">{v}</td></tr>)}
          </tbody>
        </table>
      </div>

      <div className="section">
        <div className="section-head">
          <Head tip="Activity thresholds are fixed in v1 rather than editable — an app built to strip out unexamined assumptions cannot quietly introduce new ones, so they are stated here in full.">ACTIVITY THRESHOLDS · FIXED IN V1</Head>
          <span className="sub">every threshold the app sets on your behalf · a day counts when it meets all of them</span>
        </div>
        <div className="table-scroll">
          <table className="plain">
            <thead><tr><th className="l">ACTIVITY</th><th className="l">TEMPERATURE</th><th className="l">PRECIPITATION</th><th className="l">MAX WIND</th><th className="l">OTHER</th><th className="l">WHY</th></tr></thead>
            <tbody>
              {ACTIVITIES.map((a) => {
                const r = ruleParts(a, u)
                return (
                  <tr key={a.id}>
                    <td className="l strong">{a.name}</td><td className="l">{r.temp}</td><td className="l">{r.precip}</td><td className="l">{r.wind}</td><td className="l">{r.other}</td>
                    <td className="l prose-cell" style={{ color: 'var(--dim)' }}>{a.why}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="prose" style={{ marginTop: 10, fontSize: 11 }}>
          A day lost to an activity is attributed to the first threshold it fails, in the order heat, cold, precipitation, then wind or humidity; snow sports first need snow in reach.
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <Head tip="Snow metrics are measured at real terrain within a drive-time limit, never at city centre. Each stop resolves to the reference in reach with the most snow days over the window.">TERRAIN REFERENCES PER CITY</Head>
          <span className="sub">resolved at the current ≤{p.drive} hr setting · days/yr with ≥ {u.depth(RIDE_DEPTH_IN)} on the ground · {windowLabel(w)}</span>
        </div>
        <div className="table-scroll">
          <table className="plain">
            <thead>
              <tr>
                <th className="l">CITY</th><th className="l">REFERENCES ON RECORD</th>
                {[1, 2, 3].map((d) => <th key={d} className="l" style={{ color: d === p.drive ? 'var(--accent)' : undefined }}>≤{d} HR{d === p.drive ? ' · CURRENT' : ''}</th>)}
              </tr>
            </thead>
            <tbody>
              {terrainRows.map(({ c, stops }) => (
                <tr key={c.id}>
                  <td className="l strong">{c.name}</td>
                  <td className="l" style={{ color: 'var(--dim)' }}>
                    {c.terrain.length ? c.terrain.map(([id, min]) => `${TERRAIN[id].name} ${min}m`).join(' · ') : 'none within 3 hr'}
                  </td>
                  {stops.map(({ d, inReach, t: tr }) => (
                    <td key={d} className="l" style={{ color: d === p.drive ? (tr ? 'var(--comf)' : 'var(--faint)') : tr ? 'var(--mid)' : 'var(--faint)' }}
                      data-tip={tr ? `${tr.name}: ${tr.driveMin} min drive, reference at ${u.elev(tr.elevFt)}, ${Math.round(tr.rideDays)} days a year with ≥ ${u.depth(RIDE_DEPTH_IN)} of snow over ${windowLabel(w)}.` : undefined}>
                      {tr ? `${tr.name} · ${Math.round(tr.rideDays)} d` : inReach ? 'loading…' : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <Head tip="Warm and cold seasons are never picked by the user: each city's six warmest months are its warm season, over the active window. Hemisphere-agnostic — Wellington's warm season is the northern winter.">SEASON BOUNDARIES · DERIVED PER CITY</Head>
          <span className="sub">six warmest months = warm season · {windowLabel(w)}</span>
        </div>
        <div className="season-grid">
          <span />
          {MN.map((m) => <span key={m} className="cap" style={{ textAlign: 'center' }}>{m[0]}</span>)}
          {seasons.map(({ c, warm }) => [
            <span key={c.id} className="nm">{c.name}</span>,
            ...MN.map((m, i) => (
              <span key={c.id + m} className={warm ? (warm[i] ? 'mo warm' : 'mo') : 'mo pending'} data-tip={warm ? `${c.name}, ${m}: ${warm[i] ? 'warm' : 'cold'} season` : undefined} />
            )),
          ])}
        </div>
        <div className="legend">
          <span className="item"><span className="sw" style={{ background: '#8b929e' }} />WARM SEASON</span>
          <span className="item"><span className="sw" style={{ background: '#2b2f36' }} />COLD SEASON</span>
          <span className="cap" style={{ marginLeft: 'auto' }}>BANDS BLEND OVER {SEASON_BLEND_DAYS} DAYS AT EACH BOUNDARY</span>
        </div>
      </div>

      <div className="section" style={{ borderBottom: 'none' }}>
        <div style={{ marginBottom: 10 }}><Head>KNOWN LIMITATIONS</Head></div>
        {limits.map((l) => (
          <div className="limit" key={l}><span className="dash">—</span><span>{l}</span></div>
        ))}
      </div>
    </main>
  )
})

// ---------------- City-page strip ----------------

export function MethodsStrip({ city, s, m, p, u, ytd, ytdError, openMethods }: {
  city: CityMeta; s: CitySeries; m: Model; p: Prefs; u: Units; ytd: Ytd | null; ytdError: string | null; openMethods: () => void
}) {
  const [open, setOpen] = useState(false)
  const gridFt = s.gridElevM * M_TO_FT, demFt = s.demElevM * M_TO_FT
  const delta = gridFt - demFt
  const significant = gridFlag(delta)
  const rows: [string, string][] = [
    ['Source', 'Open-Meteo Historical Weather API (ERA5 reanalysis; ERA5-Land for terrain snow depth)'],
    ['Grid cell', `~25 km ERA5 cell centred ${s.gridLat.toFixed(2)}, ${s.gridLon.toFixed(2)} at ${u.elev(gridFt)}; temperature downscaled to the city's ${u.elev(demFt)}`],
    ['Active window', `${windowLabel(p.window)} (${(windowYears(p.window) * 365).toLocaleString()} days)`],
    ['Aggregation', 'Every day scored individually, then counted; per-year means. Never scored from monthly means'],
    ['Temperature basis', `${p.sun === 'sun' ? `In sun: daily high + ${u.dt(SUN_F_PER_MJ, 2).replace('+', '')}${u.tu} per MJ/m² of shortwave` : 'Shade: reported air temperature'} · scored on the ${{ high: 'daily high', low: 'daily low', apparent: 'apparent temperature', both: 'high and low' }[p.basis]}`],
    ['Seasons', `${city.name}: warm season ${m.warmMonths.map((wm, i) => (wm ? MN[i] : null)).filter(Boolean).join(' ')} — its six warmest months in ${windowLabel(p.window)}`],
    ['Snow reference', m.terrain ? `${m.terrain.name}, ${m.terrain.driveMin} min, ${u.elev(m.terrain.elevFt)} · ${Math.round(m.terrain.rideDays)} days/yr with ≥ ${u.depth(RIDE_DEPTH_IN)}` : `No reference terrain within ${p.drive} hr`],
    [`${YTD_YEAR} (current year)`, ytdText(ytd, ytdError)],
  ]
  return (
    <div style={{ borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 22px', background: 'var(--bar-2)', flexWrap: 'wrap' }}>
        <span style={{ font: '500 11px/1 var(--sans)', whiteSpace: 'nowrap' }}>Data &amp; methods</span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--dim)' }}>
          ERA5 REANALYSIS VIA OPEN-METEO · GRID CELL {u.elev(gridFt).toUpperCase()} VS CITY {u.elev(demFt).toUpperCase()} · Δ {u.elev(Math.abs(delta)).toUpperCase()}
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: significant ? 'var(--warn)' : 'var(--dim)' }}>
          {significant ? `▲ DELTA SIGNIFICANT — RAW GRID TEMPERATURES WOULD READ ${delta > 0 ? 'COOL' : 'WARM'}; DOWNSCALED TO CITY ELEVATION` : '✓ DELTA WITHIN TOLERANCE'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'COLLAPSE ▴' : 'EXPAND ▾'}</button>
          <button className="link-btn" onClick={openMethods}>ALL DATA &amp; METHODS →</button>
        </div>
      </div>
      {open && (
        <div className="methods">
          <div className="kv-grid">
            {rows.map(([k, v]) => <div className="kv-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>)}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" onClick={() => downloadDailyCsv(city, s, p, u)}>Download daily data (CSV)</button>
            <span className="prose">Every day in {windowLabel(p.window)}, in {u.metric ? 'metric' : 'US'} units, with your band and score per day. Thresholds, formulas and every other city's seams are on the Data &amp; Methods screen.</span>
          </div>
        </div>
      )}
    </div>
  )
}
