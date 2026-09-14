import { useState } from 'react'
import type { CitySeries, CityMeta } from '../lib/data'
import { ARCHIVE, CITIES, TERRAIN } from '../lib/data'
import { ACTIVITIES, RIDE_DEPTH_IN, SEASON_RELIABILITY } from '../lib/activities'
import { CLOUD_CLEAR_IDEAL, CLOUD_OVERCAST_IDEAL, DEW_HARD_GAP, DRY_IDEAL, SEASON_BLEND_DAYS, SOFT, SUN_F_PER_MJ } from '../lib/scoring'
import { CUTOFF, windowLabel, windowYears, type Prefs } from '../lib/prefs'
import type { Model } from '../lib/model'
import type { Units } from '../lib/units'
import { downloadDailyCsv } from '../lib/csv'

const M_TO_FT = 3.28084

export function Methods({ city, s, m, p, u }: { city: CityMeta; s: CitySeries; m: Model; p: Prefs; u: Units }) {
  const [open, setOpen] = useState(false)
  const gridFt = s.gridElevM * M_TO_FT, demFt = s.demElevM * M_TO_FT
  const delta = gridFt - demFt
  const significant = Math.abs(delta) > 300
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
        <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => setOpen(!open)}>{open ? 'COLLAPSE ▴' : 'EXPAND ▾'}</button>
      </div>
      {open && (
        <div className="methods">
          <div className="cols">
            {[
              ['Source', 'Open-Meteo Historical Weather API (ERA5 reanalysis; ERA5-Land for terrain snow depth)'],
              ['Archive', `${ARCHIVE.startYear}–${ARCHIVE.endYear}, daily; Feb 29 dropped so every year has 365 columns`],
              ['Spatial resolution', `~25 km ERA5 grid cell centred ${s.gridLat.toFixed(2)}, ${s.gridLon.toFixed(2)}; ~9 km ERA5-Land for terrain`],
              ['Elevation handling', 'Open-Meteo downscales temperature from grid-cell height to the 90 m terrain height of the coordinate'],
              ['Active window', `${windowLabel(p.window)} (${(windowYears(p.window) * 365).toLocaleString()} days)`],
              ['Aggregation', 'Every day scored individually, then counted; per-year means. Never scored from monthly means'],
              ['Observed', 'Daily high/low, dew point (mean), cloud cover (mean), precipitation, snowfall, max wind, shortwave radiation, sunshine duration, snow depth (terrain)'],
              ['Derived', 'Relative humidity (Magnus), apparent temperature, in-sun temperature, seasons, all counts, trends and indices'],
              ['Humidity basis', 'Dew point, not relative humidity'],
              ['Apparent temperature', 'NWS heat index (Rothfusz) at ≥80°F; NWS wind chill at ≤50°F and ≥3 mph; otherwise air temperature. Daily high with daily mean dew point and daily max wind'],
              ['In-sun temperature', `Daily high + ${SUN_F_PER_MJ}°F per MJ/m² of daily shortwave radiation — a simple radiant-load approximation, not a full UTCI calculation`],
              ['Trend fit', 'Ordinary least squares on annual values; R² always shown next to the slope'],
            ].map(([k, v]) => <Row key={k} k={k} v={v} />)}
          </div>

          <div>
            <div className="cap" style={{ marginBottom: 6 }}>SCORING — EVERY CONSTANT THE APP USES</div>
            <table>
              <tbody>
                <tr><td>Day score</td><td className="v">Σ weightᵢ × rampᵢ ÷ Σ weightᵢ × 100 over active variables. Weights: Minor 0.5 · Normal 1 · Critical 2</td></tr>
                <tr><td>Bands</td><td className="v">Unbearable if any hard bound or deal-breaker is crossed (checked first, not overridable by score); else Comfortable if score ≥ cutoff (Lenient {CUTOFF.lenient} · Standard {CUTOFF.standard} · Strict {CUTOFF.strict}); else Tolerable</td></tr>
                <tr><td>Hatched unbearable</td><td className="v">Crossed a line drawn in the control bar: temperature floor or ceiling, or the dew-point hard limit. Solid unbearable: a deal-breaker set in More controls</td></tr>
                <tr><td>Open-ended bounds</td><td className="v">An open hard bound never disqualifies; the score fades linearly to 0 over a soft span beyond the ideal edge: temperature {SOFT.temp}°F · dew point {SOFT.dew}°F · cloud {SOFT.cloud} pts · wind {SOFT.wind} mph · precip {SOFT.precip}"</td></tr>
                <tr><td>Dew point</td><td className="v">Control sets the ideal ceiling; hard limit = ceiling + {DEW_HARD_GAP}°F</td></tr>
                <tr><td>Sky</td><td className="v">Prefer overcast: ideal ≥ {CLOUD_OVERCAST_IDEAL}% daily mean cloud · Prefer clear: ideal ≤ {CLOUD_CLEAR_IDEAL}%. Deal-breaker at the soft-span end</td></tr>
                <tr><td>Precipitation</td><td className="v">Prefer dry: ideal ≤ {DRY_IDEAL}"; deal-breaker at {DRY_IDEAL + SOFT.precip}"</td></tr>
                <tr><td>Seasons</td><td className="v">Per city and window: six warmest months by mean temperature = warm season, six coolest = cold. Bands blend linearly over {SEASON_BLEND_DAYS} days at each boundary. {city.name}: warm {m.warmMonths.map((w, i) => (w ? i + 1 : 0)).filter(Boolean).join(', ')}</td></tr>
                <tr><td>Failure attribution</td><td className="v">For each non-comfortable day, the variable with the largest weighted deficit (or the bound crossed)</td></tr>
              </tbody>
            </table>
          </div>

          <div>
            <div className="cap" style={{ marginBottom: 6 }}>ACTIVITY PRESETS — FIXED IN V1, FULL THRESHOLDS</div>
            <table>
              <thead><tr><th>ACTIVITY</th><th>A DAY COUNTS WHEN</th></tr></thead>
              <tbody>
                {ACTIVITIES.map((a) => <tr key={a.id}><td>{a.name}</td><td className="v">{a.rules}</td></tr>)}
                <tr><td>Outdoor season</td><td className="v">Longest run of days where walking is viable in ≥ {Math.round(SEASON_RELIABILITY * 100)}% of years (7-day centred window)</td></tr>
              </tbody>
            </table>
          </div>

          <div>
            <div className="cap" style={{ marginBottom: 6 }}>SNOW TERRAIN REFERENCES · {city.name.toUpperCase()}</div>
            {city.terrain.length ? (
              <table>
                <thead><tr><th>TERRAIN</th><th>DRIVE</th><th>REFERENCE ELEVATION</th><th>DAYS ≥ {RIDE_DEPTH_IN}" SNOW, {windowLabel(p.window)}</th><th>USED AT ≤{p.drive} HR</th></tr></thead>
                <tbody>
                  {city.terrain.map(([id, min]) => (
                    <tr key={id}>
                      <td>{TERRAIN[id].name}</td><td className="v">{min} min</td><td className="v">{u.elev(TERRAIN[id].elevFt)}</td>
                      <td className="v">{m.terrain?.id === id ? Math.round(m.terrain.rideDays) : min <= p.drive * 60 ? '—' : 'outside limit'}</td>
                      <td className="v">{m.terrain?.id === id ? '●' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="prose">No significant ski terrain within 3 hours.</div>}
          </div>

          <div>
            <div className="cap" style={{ marginBottom: 6 }}>KNOWN LIMITATIONS</div>
            <ul className="prose" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Reanalysis is a model of the atmosphere constrained by observations, not a weather station; coastal and mountain cities are approximated by the grid cell.</li>
              <li>Drive times and terrain reference elevations are hand-entered approximations.</li>
              <li>Wind is the daily maximum of hourly mean wind, not gusts. Cloud cover and dew point are daily means.</li>
              <li>Snow-sport days use snow depth at the terrain, but temperature from the city.</li>
              <li>Solar intensity and four-season indices are normalised across the {CITIES.length} catalogue cities, over the last 10 years of the archive.</li>
            </ul>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => downloadDailyCsv(city, s, p, u)}>Download daily data (CSV)</button>
            <span className="prose" style={{ alignSelf: 'center' }}>Every day in {windowLabel(p.window)}, in {u.metric ? 'metric' : 'US'} units, with your band and score per day.</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="list-row">
      <span className="k">{k}</span>
      <span className="v" style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.35, maxWidth: '62%' }}>{v}</span>
    </div>
  )
}
