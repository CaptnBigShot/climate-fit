import { describe, expect, it } from 'vitest'
import { LAT_BOT, LAT_TOP, MAX_ZOOM, WORLD, baseScale, clampView, fitView, zoomAt, type View } from './mapView'

const W = 540,
  H = (W * (LAT_TOP - LAT_BOT)) / 360
const project = (v: View, w: number, h: number, lon: number, lat: number) => {
  const s = baseScale(w, h) * v.k
  return [(lon - v.lon) * s + w / 2, (v.lat - lat) * s + h / 2]
}

describe('map view', () => {
  it('draws the world view exactly as the fixed Discover map did', () => {
    for (const [lon, lat] of [
      [-105, 39.7],
      [174.8, -36.8],
      [-180, LAT_TOP],
      [180, LAT_BOT],
    ]) {
      const [x, y] = project(WORLD, W, H, lon, lat)
      expect(x).toBeCloseTo(((lon + 180) / 360) * W, 9)
      expect(y).toBeCloseTo(((LAT_TOP - lat) / (LAT_TOP - LAT_BOT)) * H, 9)
    }
  })

  it('keeps zoom in range and the frame on the map', () => {
    expect(clampView({ lon: 0, lat: 0, k: 0.2 }, W, H).k).toBe(1)
    expect(clampView({ lon: 0, lat: 0, k: 99 }, W, H).k).toBe(MAX_ZOOM)
    // At zoom 1 the world fills the frame, so there is nowhere to pan.
    expect(clampView({ lon: 120, lat: -40, k: 1 }, W, H)).toEqual(WORLD)
    const v = clampView({ lon: 179, lat: 79, k: 4 }, W, H)
    const [x, y] = project(v, W, H, 180, LAT_TOP)
    expect(x).toBeCloseTo(W, 9)
    expect(y).toBeCloseTo(0, 9)
  })

  it('centres the map in a frame of a different shape', () => {
    // A frame taller than the world: the map fits the width and sits centred vertically.
    const v = clampView({ lon: 50, lat: 50, k: 1 }, 300, 200)
    expect(v.lon).toBe(0)
    expect(v.lat).toBe(WORLD.lat)
  })

  it('zooms about the pointer without moving the place under it', () => {
    const v0: View = { lon: -100, lat: 40, k: 3 }
    const [px, py] = [W * 0.3, H * 0.6]
    const s0 = baseScale(W, H) * v0.k
    const lon = v0.lon + (px - W / 2) / s0,
      lat = v0.lat - (py - H / 2) / s0
    const v1 = zoomAt(v0, 2, px, py, W, H)
    expect(v1.k).toBe(6)
    const [x, y] = project(v1, W, H, lon, lat)
    expect(x).toBeCloseTo(px, 9)
    expect(y).toBeCloseTo(py, 9)
  })

  it('frames a lone city at the zoom cap, centred on it', () => {
    const v = fitView([{ lat: 39.74, lon: -104.99 }], 260, 110, 4)
    expect(v.k).toBe(4)
    expect(v.lon).toBeCloseTo(-104.99, 9)
    expect(v.lat).toBeCloseTo(39.74, 9)
  })

  it('frames a spread-out set with every city inside the margin', () => {
    const pts = [
      { lat: 61.2, lon: -149.9 },
      { lat: 39.7, lon: -105 },
      { lat: 44.9, lon: -93.3 },
      { lat: 46.8, lon: -71.2 },
    ]
    const v = fitView(pts, 356, 200, 4)
    for (const p of pts) {
      const [x, y] = project(v, 356, 200, p.lon, p.lat)
      expect(x).toBeGreaterThanOrEqual(70 - 1e-9)
      expect(x).toBeLessThanOrEqual(356 - 70 + 1e-9)
      expect(y).toBeGreaterThanOrEqual(24 - 1e-9)
      expect(y).toBeLessThanOrEqual(200 - 24 + 1e-9)
    }
  })
})
