// The city map's geometry: an equirectangular world cropped to 80°N–60°S, with pan
// and zoom. A view is a centre and a zoom multiple k of the base scale — the one at
// which the whole world just fits the frame — so it survives resizes.
import type { Candidate } from './discover'
import { CO, contColor } from './colors'

export const LAT_TOP = 80,
  LAT_BOT = -60
export const MAX_ZOOM = 16

export interface View {
  lon: number
  lat: number
  k: number
}

export const WORLD: View = { lon: 0, lat: (LAT_TOP + LAT_BOT) / 2, k: 1 }

/** Pixels per degree at zoom 1. */
export const baseScale = (w: number, h: number) => Math.min(w / 360, h / (LAT_TOP - LAT_BOT))

/** Zoom kept in range and the frame kept inside the map, or the map centred where it's smaller than the frame. */
export function clampView(v: View, w: number, h: number): View {
  const k = Math.min(MAX_ZOOM, Math.max(1, v.k))
  const s = baseScale(w, h) * k
  const hw = w / 2 / s,
    hh = h / 2 / s
  const within = (x: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, x)))
  return { k, lon: within(v.lon, -180 + hw, 180 - hw), lat: within(v.lat, LAT_BOT + hh, LAT_TOP - hh) }
}

/** Zoom by f, keeping the place under frame pixel (x, y) where it is. */
export function zoomAt(v: View, f: number, x: number, y: number, w: number, h: number): View {
  const s = baseScale(w, h) * v.k
  const lon = v.lon + (x - w / 2) / s,
    lat = v.lat - (y - h / 2) / s
  const k = Math.min(MAX_ZOOM, Math.max(1, v.k * f))
  const s2 = baseScale(w, h) * k
  return clampView({ k, lon: lon - (x - w / 2) / s2, lat: lat + (y - h / 2) / s2 }, w, h)
}

/** The view framing these points with a margin for labels, zoomed in no further than
 *  maxK — a lone city would otherwise fill the frame with no land around it. */
export function fitView(pts: { lat: number; lon: number }[], w: number, h: number, maxK: number): View {
  if (!pts.length || !w || !h) return WORLD
  const lons = pts.map((p) => p.lon),
    lats = pts.map((p) => p.lat)
  const lon0 = Math.min(...lons),
    lon1 = Math.max(...lons),
    lat0 = Math.min(...lats),
    lat1 = Math.max(...lats)
  const s = Math.min(Math.max(1, w - 140) / (lon1 - lon0), Math.max(1, h - 48) / (lat1 - lat0))
  return clampView({ lon: (lon0 + lon1) / 2, lat: (lat0 + lat1) / 2, k: Math.min(maxK, s / baseScale(w, h)) }, w, h)
}

export interface MapPoint {
  id: string
  lat: number
  lon: number
  r: number
  fill: string
  /** Omitted for context dots, which get no outline and no label. */
  label?: string
  tip: string
  current?: boolean
}

/** A city as Discover and Compare draw it: fill is the comfortable share of your year
 *  (walk-viable, amber, before a preference), radius the outdoor days. */
export function cityPoint({ city, b, act }: Candidate, comfort: boolean, current: string, rank?: number): MapPoint {
  const scored = comfort && b
  const pre = `${rank === undefined ? '' : `#${rank + 1} `}${city.name}`
  return {
    id: city.id,
    lat: city.lat,
    lon: city.lon,
    r: 3 + ((scored ? act.outAny : act.per.walk.days) / 365) * 4.5,
    fill: scored ? contColor((b.counts[0] / 365) * 100) : CO.act,
    label: `${city.name} ${Math.round(scored ? b.counts[0] : act.per.walk.days)}`,
    tip: scored
      ? `${pre}: ${Math.round(b.counts[0])} comfortable · ${Math.round(b.counts[1])} tolerable · ${Math.round(b.counts[2])} unbearable days/yr · ${Math.round(act.outAny)} outdoor days. Click to open.`
      : `${pre}: ${Math.round(act.per.walk.days)} walk-viable days/yr. Click to open.`,
    current: city.id === current,
  }
}
