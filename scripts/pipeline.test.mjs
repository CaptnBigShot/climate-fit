// The data pipeline's pure parts: what a request costs, the catalogue's file layout and
// queue promotion, and the Köppen classes used to label the draft queue.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { archiveRequests, weight } from './open-meteo.mjs'
import { CATALOG_FILE, format, promote } from './catalog-file.mjs'
import { koppen } from './koppen.mjs'
import { DAILY_VARS } from '../src/lib/ytd.ts'

describe('weight', () => {
  it('follows the examples on the Open-Meteo pricing page', () => {
    expect(weight({ latitude: 1, hourly: Array(15).fill('x').join(','), start_date: '2025-01-01', end_date: '2025-01-14' })).toBeCloseTo(1.5)
    expect(weight({ latitude: 1, hourly: Array(15).fill('x').join(','), start_date: '2025-01-01', end_date: '2025-01-28' })).toBeCloseTo(3)
    expect(weight({ latitude: 1, daily: 'temperature_2m_max', start_date: '2025-01-01', end_date: '2025-01-03' })).toBe(1)
  })

  it('prices the archive requests fetch-data makes', () => {
    const req = archiveRequests({ startYear: 1991, endYear: 2025 })
    const city = { lat: 47.25, lon: -122.44 }
    // 12,784 days (leap days included) of 9 variables: the README's "roughly 900".
    expect(weight(req.daily(city, DAILY_VARS.map((v) => v[0])))).toBeCloseTo(12784 / 14)
    expect(weight(req.grid(city))).toBe(1)
    expect(weight(req.hourly(city))).toBeCloseTo(3653 / 14)
    expect(weight(req.terrain({ lat: 47.4, lon: -121.4, elevFt: 3400 }))).toBeCloseTo(12784 / 14)
  })

  it('counts every location of a multi-location request', () => {
    expect(weight({ latitude: '1,2,3', daily: 'snow_depth_max', start_date: '2026-01-01', end_date: '2026-01-28' })).toBeCloseTo(6)
  })
})

describe('catalogue file', () => {
  const text = readFileSync(CATALOG_FILE, 'utf8')

  it('writes catalog.json back exactly as it is kept by hand', () => {
    expect(format(JSON.parse(text))).toBe(text)
  })

  it('promotes a queued city with the terrain it needs', () => {
    const catalog = JSON.parse(text)
    const queue = {
      generated: { on: '2026-09-14' },
      terrain: { hood: { name: 'Mt Hood Meadows', lat: 45.33, lon: -121.66, elevFt: 6200 }, bachelor: { name: 'Mt Bachelor', lat: 44, lon: -121.68, elevFt: 7400 } },
      cities: [
        { id: 'portland', name: 'Portland', code: 'OR', region: 'Oregon · United States', lat: 45.52, lon: -122.68, pop: 652503, coastal: false, continent: 'North America', terrain: [['hood', 95], ['crystal', 180]], note: 'Csb' },
        { id: 'bend', name: 'Bend', code: 'OR', region: 'Oregon · United States', lat: 44.06, lon: -121.31, pop: 100421, coastal: false, continent: 'North America', terrain: [['bachelor', 35]], note: 'Csb' },
      ],
    }
    promote(catalog, queue, 'portland')
    const added = catalog.cities.at(-1)
    expect(added.id).toBe('portland')
    expect(added).not.toHaveProperty('note')
    expect(catalog.terrain.hood.name).toBe('Mt Hood Meadows')
    expect(queue.cities.map((c) => c.id)).toEqual(['bend'])
    // hood moved to the catalogue; bachelor still waits with bend.
    expect(Object.keys(queue.terrain)).toEqual(['bachelor'])
    expect(() => promote(catalog, queue, 'portland')).toThrow()
    // The queue's review note survives formatting on its own line.
    expect(format(queue)).toContain('\n      "note": "Csb"\n')
    expect(JSON.parse(format(queue))).toEqual(queue)
  })
})

describe('koppen', () => {
  const flat = (v) => Array(12).fill(v)
  // Northern-hemisphere seasonal cycle between a winter low and a summer high.
  const cycle = (lo, hi) => Array.from({ length: 12 }, (_, m) => lo + ((hi - lo) * (1 - Math.cos(((m - 0.5) * Math.PI) / 6))) / 2)
  const flip = (xs) => [...xs.slice(6), ...xs.slice(0, 6)]

  it('classifies the main climate types', () => {
    expect(koppen(flat(27), flat(200))).toBe('Af')
    expect(koppen(flat(25), [20, 10, 30, 80, 150, 200, 250, 250, 200, 120, 40, 10])).toBe('Aw')
    expect(koppen(cycle(12, 34), flat(3))).toBe('BWh')
    expect(koppen(cycle(-2, 24), flat(25))).toBe('BSk')
    expect(koppen(cycle(5, 17), flat(80))).toBe('Cfb')
    expect(koppen(cycle(7, 18), [150, 120, 100, 60, 40, 20, 15, 20, 40, 90, 150, 170])).toBe('Csb')
    expect(koppen(cycle(-10, 20), flat(60))).toBe('Dfb')
    expect(koppen(cycle(-10, 24), flat(60))).toBe('Dfa')
    expect(koppen(cycle(-20, 15), flat(40))).toBe('Dfc')
    expect(koppen(cycle(-25, 6), flat(20))).toBe('ET')
  })

  it('works the same in the southern hemisphere', () => {
    const t = cycle(7, 18), p = [150, 120, 100, 60, 40, 20, 15, 20, 40, 90, 150, 170]
    expect(koppen(flip(t), flip(p))).toBe(koppen(t, p))
  })
})

describe('hourly tier', () => {
  /** An Open-Meteo-shaped hourly response for 2016–2025, local clock, with a few quirks. */
  function response() {
    const time = [], temperature_2m = []
    for (let t = Date.UTC(2016, 0, 1); t < Date.UTC(2026, 0, 1); t += 3600_000) {
      const iso = new Date(t).toISOString().slice(0, 16)
      // A spring-forward day skips 02:00; the fall-back day repeats 01:00.
      if (iso === '2020-03-08T02:00') continue
      time.push(iso); temperature_2m.push(iso.slice(11, 13) === '12' ? 60.25 : 40)
      if (iso === '2020-11-01T01:00') { time.push(iso); temperature_2m.push(99) }
    }
    return { timezone: 'America/Denver', hourly: { time, temperature_2m } }
  }

  it('fills a fixed 365 × 24 grid: no Feb 29, DST gaps carried, repeats ignored', async () => {
    const { buildHourly, HOURLY_YEARS } = await import('../src/lib/hourly.ts')
    const t = buildHourly(response(), 2025)
    expect(t.startYear).toBe(2016)
    expect(t.temp.length).toBe(HOURLY_YEARS * 365 * 24)
    expect(t.temp[12]).toBe(603) // tenths of °F, rounded
    expect([...t.temp].every((v) => v === 400 || v === 603)).toBe(true) // the 99 repeat never lands
  })
})
