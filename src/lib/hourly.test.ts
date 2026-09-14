import { afterEach, describe, expect, it, vi } from 'vitest'
import { CITIES, loadHourly } from './data'
import { HOURLY_YEARS } from './hourly'

afterEach(() => vi.unstubAllGlobals())

describe('loadHourly', () => {
  it('fetches a city with no hourly file live from Open-Meteo', async () => {
    const [withFile, without] = CITIES
    const days = HOURLY_YEARS * 365
    const time: string[] = []
    for (let t = Date.UTC(2016, 0, 1); time.length < days * 24; t += 3600_000) {
      const iso = new Date(t).toISOString().slice(0, 16)
      if (!iso.startsWith('2016-02-29') && !iso.startsWith('2020-02-29') && !iso.startsWith('2024-02-29')) time.push(iso)
    }
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url))
      if (String(url).endsWith('manifest.json')) return Response.json({ refYears: 10, cities: {}, terrain: [], hourly: [withFile.id] })
      return Response.json({ timezone: 'UTC', hourly: { time, temperature_2m: time.map(() => 50) } })
    })
    const h = await loadHourly(without.id)
    expect(h.live).toBe(true)
    expect(h.temp.length).toBe(days * 24)
    expect(urls.some((u) => u.startsWith('https://archive-api.open-meteo.com/') && u.includes(`latitude=${without.lat}`))).toBe(true)
  })
})
