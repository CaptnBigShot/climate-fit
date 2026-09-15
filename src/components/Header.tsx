import { useMemo } from 'react'
import { CITIES, type CityMeta } from '../lib/data'
import { CO } from '../lib/colors'
import { MAX_COMPARE } from '../lib/compare'
import type { MapPoint } from '../lib/mapView'
import type { Model } from '../lib/model'
import type { Prefs } from '../lib/prefs'
import type { Units } from '../lib/units'
import { Cap } from './ui'
import { WorldMap } from './WorldMap'

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
  starred,
  toggleStar,
  exportCsv,
  openCity,
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
  starred: boolean
  toggleStar: () => void
  exportCsv: () => void
  openCity: (id: string) => void
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
          className="btn"
          onClick={toggleStar}
          aria-pressed={starred}
          data-tip="Star this city to find it again under Discover's STARRED view. Stars live in the URL with the rest of the session, so a bookmark keeps them and a link shares them."
        >
          {starred ? '★ Starred' : '☆ Star'}
        </button>
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
      <Locator city={city} openCity={openCity} />
    </div>
  )
}

/** Where the city is, with the rest of the set as faint dots for context. */
function Locator({ city, openCity }: { city: CityMeta; openCity: (id: string) => void }) {
  const points = useMemo<MapPoint[]>(
    () => [
      ...CITIES.filter((c) => c.id !== city.id).map((c) => ({
        id: c.id,
        lat: c.lat,
        lon: c.lon,
        r: 2,
        fill: CO.unb,
        tip: `${c.name}, ${c.code}. Click to open.`,
      })),
      {
        id: city.id,
        lat: city.lat,
        lon: city.lon,
        r: 4.5,
        fill: CO.accent,
        label: city.name,
        tip: city.name,
        current: true,
      },
    ],
    [city],
  )
  return (
    <div className="header-map">
      <WorldMap points={points} onPick={openCity} label={`Map locating ${city.name}`} frame={[city]} height={96} />
    </div>
  )
}
