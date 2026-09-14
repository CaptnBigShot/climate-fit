import catalog from '../data/catalog.json'

export interface CityMeta {
  id: string; name: string; code: string; region: string
  lat: number; lon: number; pop: number; coastal: boolean
  /** [terrain id, drive minutes] */
  terrain: [string, number][]
}
export interface TerrainMeta { name: string; lat: number; lon: number; elevFt: number }

export const CITIES = catalog.cities as CityMeta[]
export const TERRAIN = catalog.terrain as Record<string, TerrainMeta>
export const ARCHIVE = catalog.archive
export const cityById = (id: string) => CITIES.find((c) => c.id === id)

/** Daily series in °F / inches / mph / MJ·m⁻² / hours, 365 days per year, NaN where missing. */
export interface CitySeries {
  id: string
  startYear: number
  years: number
  demElevM: number
  gridElevM: number
  gridLat: number
  gridLon: number
  high: Float32Array
  low: Float32Array
  dew: Float32Array
  cloud: Float32Array
  precip: Float32Array
  snow: Float32Array
  wind: Float32Array
  rad: Float32Array
  sun: Float32Array
}
export const SERIES_KEYS = ['high', 'low', 'dew', 'cloud', 'precip', 'snow', 'wind', 'rad', 'sun'] as const
export type SeriesKey = (typeof SERIES_KEYS)[number]

export interface TerrainSeries { id: string; startYear: number; years: number; depth: Float32Array }

export interface Manifest {
  refYears: number
  cities: Record<string, { solarIdx: number; seasonsIdx: number; meanRadMJ: number; seasonStdF: number; demElevM: number; gridElevM: number }>
  terrain: string[]
}

const toF32 = (xs: (number | null)[]) => Float32Array.from(xs, (v) => (v === null ? NaN : v))
const base = import.meta.env.BASE_URL

const cityCache = new Map<string, Promise<CitySeries>>()
const terrainCache = new Map<string, Promise<TerrainSeries>>()
let manifestP: Promise<Manifest> | null = null

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}data/${path}`)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json() as Promise<T>
}

export function loadManifest(): Promise<Manifest> {
  manifestP ??= getJson<Manifest>('manifest.json')
  return manifestP
}

export function loadCity(id: string): Promise<CitySeries> {
  let p = cityCache.get(id)
  if (!p) {
    p = getJson<Record<string, unknown>>(`cities/${id}.json`).then((raw) => {
      const out = { ...raw } as Record<string, unknown>
      for (const k of SERIES_KEYS) out[k] = toF32(raw[k] as (number | null)[])
      return out as unknown as CitySeries
    })
    p.catch(() => cityCache.delete(id))
    cityCache.set(id, p)
  }
  return p
}

export function loadTerrain(id: string): Promise<TerrainSeries> {
  let p = terrainCache.get(id)
  if (!p) {
    p = getJson<{ id: string; startYear: number; years: number; depth: (number | null)[] }>(`terrain/${id}.json`)
      .then((raw) => ({ ...raw, depth: toF32(raw.depth) }))
    p.catch(() => terrainCache.delete(id))
    terrainCache.set(id, p)
  }
  return p
}
