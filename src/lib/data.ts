import catalog from '../data/catalog.json'
import type { AqSeries } from './aq'
import { fetchHourly, type HourlyTier } from './hourly'

export interface CityMeta {
  id: string
  name: string
  code: string
  region: string
  lat: number
  lon: number
  pop: number
  coastal: boolean
  continent: string
  /** [terrain id, drive minutes] */
  terrain: [string, number][]
}
export interface TerrainMeta {
  name: string
  lat: number
  lon: number
  elevFt: number
}

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

export interface TerrainSeries {
  id: string
  startYear: number
  years: number
  depth: Float32Array
}

/** On-disk shapes under public/data/: series are JSON arrays with null for missing. */
export type CityFile = Omit<CitySeries, SeriesKey> & Record<SeriesKey, (number | null)[]>
export type TerrainFile = Omit<TerrainSeries, 'depth'> & { depth: (number | null)[] }
export interface HourlyFile {
  id: string
  startYear: number
  years: number
  timezone: string
  temp10: string
}

export interface Manifest {
  refYears: number
  cities: Record<
    string,
    { solarIdx: number; seasonsIdx: number; meanRadMJ: number; seasonStdF: number; demElevM: number; gridElevM: number }
  >
  terrain: string[]
  /** Cities with a pre-fetched hourly file; the rest are fetched live (loadHourly). */
  hourly?: string[]
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
    p = getJson<CityFile>(`cities/${id}.json`).then((raw) => {
      const out: Record<string, unknown> = { ...raw }
      for (const k of SERIES_KEYS) out[k] = toF32(raw[k])
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
    p = getJson<TerrainFile>(`terrain/${id}.json`).then((raw) => ({ ...raw, depth: toF32(raw.depth) }))
    p.catch(() => terrainCache.delete(id))
    terrainCache.set(id, p)
  }
  return p
}

// ---------- Separate, shorter data tiers (loaded on demand) ----------

/** Hourly temperature, local time, 365 × 24 per year, tenths of °F. `live`: fetched from
 *  Open-Meteo in this browser (and cached there), because the city has no file. */
export interface HourlySeries {
  id: string
  startYear: number
  years: number
  timezone: string
  temp: Int16Array
  live: boolean
}

const hourlyCache = new Map<string, Promise<HourlySeries>>()
const aqCache = new Map<string, Promise<AqSeries>>()

export function loadHourly(id: string): Promise<HourlySeries> {
  let p = hourlyCache.get(id)
  if (!p) {
    p = loadManifest().then((mf) => (mf.hourly?.includes(id) ? hourlyFile(id) : hourlyLive(id)))
    p.catch(() => hourlyCache.delete(id))
    hourlyCache.set(id, p)
  }
  return p
}

async function hourlyFile(id: string): Promise<HourlySeries> {
  const raw = await getJson<HourlyFile>(`hourly/${id}.json`)
  const bin = atob(raw.temp10),
    bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return {
    id: raw.id,
    startYear: raw.startYear,
    years: raw.years,
    timezone: raw.timezone,
    temp: new Int16Array(bytes.buffer),
    live: false,
  }
}

/** New cities have no hourly file: fetch the decade from Open-Meteo the first time the panel
 *  opens (~261 free-tier calls) and keep it in Cache Storage, keyed by the archive's last year
 *  so a new archive year fetches afresh. Without Cache Storage (non-secure origin) it still works, uncached. */
async function hourlyLive(id: string): Promise<HourlySeries> {
  const city = cityById(id)
  if (!city) throw new Error(`${id}: not in the catalogue`)
  const store = await globalThis.caches?.open('climate-fit-hourly').catch(() => undefined)
  const key = store && new URL(`${base}hourly-live/${id}-${ARCHIVE.endYear}`, location.origin).href
  const hit = key ? await store.match(key) : undefined
  if (hit) {
    const meta = JSON.parse(hit.headers.get('x-hourly') ?? '{}') as Omit<HourlyTier, 'temp'>
    return { id, ...meta, temp: new Int16Array(await hit.arrayBuffer()), live: true }
  }
  const tier = await fetchHourly({ lat: city.lat, lon: city.lon, endYear: ARCHIVE.endYear })
  const meta = { startYear: tier.startYear, years: tier.years, timezone: tier.timezone }
  if (key)
    await store
      .put(key, new Response(tier.temp.slice().buffer, { headers: { 'x-hourly': JSON.stringify(meta) } }))
      .catch(() => undefined)
  return { id, ...tier, live: true }
}

/** Discover's basemap: Natural Earth land as one SVG path, in 1/scale degree (x = lon, y = −lat). */
export interface Land {
  scale: number
  d: string
}
let landP: Promise<Land> | null = null
export function loadLand(): Promise<Land> {
  landP ??= getJson<Land>('land.json')
  landP.catch(() => {
    landP = null
  })
  return landP
}

export function loadAq(id: string): Promise<AqSeries> {
  let p = aqCache.get(id)
  if (!p) {
    p = getJson<AqSeries>(`aq/${id}.json`)
    p.catch(() => aqCache.delete(id))
    aqCache.set(id, p)
  }
  return p
}
