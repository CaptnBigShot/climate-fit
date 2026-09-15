import type { CityMeta } from '../lib/data'
import { MAX_COMPARE } from '../lib/compare'
import type { Model } from '../lib/model'
import type { Prefs } from '../lib/prefs'
import type { Units } from '../lib/units'
import { Cap } from './ui'

export function Header({
  city,
  m,
  p,
  u,
  elevFt,
  solarIdx,
  inCompare,
  compareCount,
  toggleCompare,
  exportCsv,
}: {
  city: CityMeta
  m: Model
  p: Prefs
  u: Units
  elevFt: number
  solarIdx: number | null
  inCompare: boolean
  compareCount: number
  toggleCompare: () => void
  exportCsv: () => void
}) {
  const full = !inCompare && compareCount >= MAX_COMPARE
  return (
    <div className="header">
      <div>
        <div className="city-name">{city.name}</div>
        <div className="city-region">
          {city.region} · {Math.abs(city.lat).toFixed(2)}°{city.lat >= 0 ? 'N' : 'S'} {Math.abs(city.lon).toFixed(2)}°
          {city.lon >= 0 ? 'E' : 'W'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 26, paddingBottom: 3, flexWrap: 'wrap' }}>
        <div className="kv">
          <Cap tip="Elevation of the city-centre coordinate from a 90 m terrain model. Temperatures are downscaled to this height.">
            ELEVATION
          </Cap>
          <div className="v">{u.elev(elevFt)}</div>
        </div>
        <div className="kv">
          <Cap>POPULATION</Cap>
          <div className="v">{city.pop.toLocaleString()}</div>
        </div>
        <div className="kv">
          <Cap tip="The reference ski terrain used for snow-sport metrics: among the terrain inside your drive limit, the one with the most snow days over the window.">
            SNOW TERRAIN ≤{p.drive} HR
          </Cap>
          <div className="v">
            {m.terrain ? (
              <>
                {m.terrain.name}{' '}
                <small>
                  · {m.terrain.driveMin} min · {u.elev(m.terrain.elevFt)}
                </small>
              </>
            ) : (
              <small>none in reach</small>
            )}
          </div>
        </div>
        <div className="kv">
          <Cap tip="Mean daily shortwave radiation, normalised 0–100 across the city set. High-altitude, high-irradiance cities are flagged here; it is context, not part of the score.">
            SOLAR INTENSITY IDX
          </Cap>
          <div className="v">
            {solarIdx ?? '—'} <small>/ 100</small>
          </div>
        </div>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button
          className={`btn${inCompare ? ' on' : ''}`}
          onClick={toggleCompare}
          disabled={full}
          data-tip={
            full
              ? `Compare holds up to ${MAX_COMPARE} cities. Remove one on the Compare screen first.`
              : 'Add this city to the compare set. The set lives in the URL, so sharing the link shares the comparison — there are no accounts.'
          }
        >
          {inCompare
            ? `✓ In compare (${compareCount})`
            : full
              ? `Compare full (${compareCount})`
              : `+ Add to compare${compareCount ? ` (${compareCount})` : ''}`}
        </button>
        <button
          className="btn"
          onClick={exportCsv}
          data-tip="Download the monthly table as CSV, in the units currently shown."
        >
          Export CSV
        </button>
      </div>
    </div>
  )
}
