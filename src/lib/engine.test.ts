import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SERIES_KEYS, type CitySeries } from './data'
import { apparent, ramp, score, seasonWeights, BAND } from './scoring'
import { budget, activities } from './aggregate'
import { DEFAULT_PREFS, EXAMPLE_STATE, PRESETS, decodePrefs, encodePrefs, lookbackWindow, type Prefs } from './prefs'

function loadTacoma(): CitySeries {
  const raw = JSON.parse(readFileSync(new URL('../../public/data/cities/tacoma.json', import.meta.url), 'utf8'))
  for (const k of SERIES_KEYS) raw[k] = Float32Array.from(raw[k], (v: number | null) => (v === null ? NaN : v))
  return raw
}
const example: Prefs = { ...structuredClone(DEFAULT_PREFS), ...structuredClone(EXAMPLE_STATE) }

describe('ramp', () => {
  it('is 1 inside ideal, linear to the hard bound, OUT beyond', () => {
    expect(ramp(50, 20, 35, 58, 68, 30)).toBe(1)
    expect(ramp(63, 20, 35, 58, 68, 30)).toBeCloseTo(0.5)
    expect(ramp(69, 20, 35, 58, 68, 30)).toBe(-1)
    expect(ramp(10, 20, 35, 58, 68, 30)).toBe(-1)
  })
  it('never disqualifies on an open bound, but fades over the soft span', () => {
    expect(ramp(20, null, 35, 58, 68, 30)).toBeCloseTo(0.5)
    expect(ramp(-40, null, 35, 58, 68, 30)).toBe(0)
  })
})

describe('apparent temperature', () => {
  it('matches NWS heat index and wind chill reference values', () => {
    // 90°F with ~70°F dew point (RH ≈ 52%) → heat index ≈ 97°F
    expect(apparent(90, 70, 5)).toBeGreaterThan(95)
    expect(apparent(90, 70, 5)).toBeLessThan(100)
    // 20°F at 15 mph → wind chill ≈ 6°F
    expect(apparent(20, 10, 15)).toBeCloseTo(6.2, 0)
    expect(apparent(65, 50, 10)).toBe(65)
  })
})

describe('URL state', () => {
  it('round-trips every preset and the example state', () => {
    for (const p of [example, ...PRESETS.map((x) => ({ ...structuredClone(DEFAULT_PREFS), ...x.apply }))]) {
      const q = new URLSearchParams()
      encodePrefs(p as Prefs, q)
      expect(decodePrefs(q)).toEqual(p)
    }
  })
  it('opens unset: no band, no dew point, nothing scored', () => {
    expect(decodePrefs(new URLSearchParams()).temp).toBeNull()
  })
  it('presets are alphabetical', () => {
    const names = PRESETS.map((p) => p.name)
    expect(names).toEqual([...names].sort())
  })
})

describe('scoring real data', () => {
  const s = loadTacoma()
  const w = lookbackWindow(10)

  it('scores nothing in the unset state', () => {
    expect(score(s, DEFAULT_PREFS, w)).toBeNull()
  })

  it('splits all 365 days per year into three bands', () => {
    const sc = score(s, example, w)!
    const b = budget(sc)
    expect(b.counts[0] + b.counts[1] + b.counts[2]).toBeCloseTo(365)
    expect(b.hard).toBeLessThanOrEqual(b.counts[2] + 1e-9)
    expect(b.perYear).toHaveLength(10)
  })

  it('stricter cutoff never adds comfortable days; hard bound breaches are always unbearable', () => {
    const lenient = budget(score(s, { ...example, strict: 'lenient' }, w)!)
    const strict = budget(score(s, { ...example, strict: 'strict' }, w)!)
    expect(strict.counts[0]).toBeLessThanOrEqual(lenient.counts[0])
    const sc = score(s, example, w)!
    for (let i = 0; i < sc.band.length; i++) if (sc.hard[i]) expect(sc.band[i]).toBe(BAND.unb)
  })

  it('derives Tacoma warm season as the six warmest months (roughly May–Oct)', () => {
    const { warmMonths } = seasonWeights(s, w)
    expect(warmMonths.filter(Boolean)).toHaveLength(6)
    expect(warmMonths[6]).toBe(true) // July
    expect(warmMonths[0]).toBe(false) // January
  })

  it('re-scores a 30-year window well under the 100 ms budget', () => {
    const w30 = lookbackWindow(30)
    const t0 = performance.now()
    for (let k = 0; k < 10; k++) { budget(score(s, example, w30)!); activities(s, w30, example.acts, null) }
    expect((performance.now() - t0) / 10).toBeLessThan(40)
  })
})

describe('secondary features', async () => {
  const { spans, bestSpans, worstSpan, extremes, crossing, sensitivity, typicalDay, aqStats, monthYearMatrix, isMosquitoDay } = await import('./extras')
  const s = loadTacoma()
  const w = lookbackWindow(10)
  const sc = score(s, example, w)!

  it('best spans do not overlap and beat the worst span', () => {
    const all = spans(sc, 14)
    const best = bestSpans(all, 3), worst = worstSpan(all)
    expect(best).toHaveLength(3)
    for (const a of best) for (const b of best) if (a !== b) expect(Math.min(Math.abs(a.start - b.start), 365 - Math.abs(a.start - b.start))).toBeGreaterThanOrEqual(14)
    expect(best[0].comf).toBeGreaterThan(worst.comf)
    expect(worst.unb).toBeGreaterThanOrEqual(Math.max(...all.map((x) => x.unb)))
  })

  it('extremes are real days in the window', () => {
    const hot = extremes(s, w)[0]
    const off = (w.from - s.startYear) * 365
    expect(s.high[off + hot.index]).toBe(hot.value)
    for (let i = 0; i < 3650; i++) expect(s.high[off + i]).toBeLessThanOrEqual(hot.value)
  })

  it('warming never adds comfortable days for a cold-preferring profile, and the crossing is consistent', () => {
    const sens = sensitivity(s, example, w)
    const pos = sens.filter((x) => x.shift >= 0)
    for (let i = 1; i < pos.length; i++) expect(pos[i].comf).toBeLessThanOrEqual(pos[i - 1].comf + 1)
    const c = crossing(sens, 100)
    expect(c).not.toBeNull()
    expect(c!).toBeGreaterThan(0)
  })

  it('typical day profile is ordered and uses the hourly tier', () => {
    const raw = JSON.parse(readFileSync(new URL('../../public/data/hourly/tacoma.json', import.meta.url), 'utf8'))
    const h = { ...raw, temp: new Int16Array(Buffer.from(raw.temp10, 'base64').buffer.slice(0)) }
    const prof = typicalDay(h, 6, w)
    expect(prof.days).toBe(31 * 10)
    for (let hr = 0; hr < 24; hr++) expect(prof.p10[hr]).toBeLessThanOrEqual(prof.p90[hr])
    // July afternoons are warmer than July pre-dawn in Tacoma.
    expect(prof.p50[15]).toBeGreaterThan(prof.p50[5] + 10)
  })

  it('air-quality stats cover the separate tier', () => {
    const aq = JSON.parse(readFileSync(new URL('../../public/data/aq/tacoma.json', import.meta.url), 'utf8'))
    const st = aqStats(aq)
    expect(st.from).toBe('2022-08-03')
    expect(st.worst!.aqi).toBeGreaterThan(150)
  })

  it('month × year matrix sums to the counter total', () => {
    const m = monthYearMatrix(s, w, isMosquitoDay)
    expect(m).toHaveLength(10)
    let total = 0
    for (let i = 0; i < 3650; i++) if (isMosquitoDay(s, (w.from - s.startYear) * 365 + i)) total++
    expect(m.flat().reduce((a, b) => a + b, 0)).toBe(total)
  })
})

describe('current partial year', async () => {
  const { fetchYtdRaw } = await import('./ytd')
  // Fake Open-Meteo: daily rows from start to end, with the values chosen by the test.
  const fake = (rows: { date: string; high: number | null }[], offsetSec: number, depth?: (number | null)[]) =>
    (async (url: string) => {
      const isTerrain = url.includes('era5_land')
      const time = rows.map((r) => r.date)
      const body = isTerrain
        ? [{ utc_offset_seconds: offsetSec, daily: { time, snow_depth_max: depth ?? time.map(() => 1) } }]
        : { utc_offset_seconds: offsetSec, daily: {
            time, temperature_2m_max: rows.map((r) => r.high), temperature_2m_min: rows.map((r) => (r.high === null ? null : r.high - 10)),
            dew_point_2m_mean: rows.map(() => 40), cloud_cover_mean: rows.map(() => 50), precipitation_sum: rows.map(() => 0),
            snowfall_sum: rows.map(() => 0), wind_speed_10m_max: rows.map(() => 5), shortwave_radiation_sum: rows.map(() => 10), sunshine_duration: rows.map(() => 3600),
          } }
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch
  const days = (from: string, n: number, high: (i: number) => number | null = () => 60) =>
    Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10), high: high(i) }))

  it("stops at the city's local yesterday, not UTC's", async () => {
    // 04:00 UTC on Sep 14 is still Sep 13 in UTC−7: Sep 13 must not count.
    const now = new Date('2026-09-14T04:00:00Z')
    const r = await fetchYtdRaw({ year: 2026, lat: 0, lon: 0, terrain: [], now, fetchImpl: fake(days('2026-01-01', 257), -7 * 3600) })
    expect(r.through).toBe('2026-09-12')
    expect(r.days).toBe(255)
    expect(r.daily.high[255]).toBeNull()
  })

  it('ends the observed run at the first gap', async () => {
    const r = await fetchYtdRaw({ year: 2026, lat: 0, lon: 0, terrain: [], now: new Date('2026-03-01T12:00:00Z'),
      fetchImpl: fake(days('2026-01-01', 59, (i) => (i === 40 ? null : 50)), 0) })
    expect(r.days).toBe(40)
    expect(r.daily.high[45]).toBeNull()
  })

  it('drops Feb 29 in a leap year so day-of-year lines up with the archive', async () => {
    const r = await fetchYtdRaw({ year: 2028, lat: 0, lon: 0, terrain: [], now: new Date('2028-03-10T12:00:00Z'),
      fetchImpl: fake(days('2028-01-01', 69, (i) => i), 0) })
    // Mar 1 is day 59 in a 365-day year; in 2028 it is the 61st calendar day (index 60).
    expect(r.daily.high[59]).toBe(60)
    expect(r.days).toBe(68)
  })

  it('carries lagging terrain snow depth forward a few days, then stops', async () => {
    const { extend, DEPTH_CARRY_DAYS } = await import('./current')
    const depth = [...Array(30).fill(0.508), ...Array(30).fill(null)] // metres, as the API returns; 0.508 m = 20"
    const raw = await fetchYtdRaw({ year: 2026, lat: 0, lon: 0, terrain: [{ id: 'crystal', lat: 0, lon: 0, elevFt: 5000 }], now: new Date('2026-03-02T12:00:00Z'),
      fetchImpl: fake(days('2026-01-01', 60), 0, depth) })
    const tj = JSON.parse(readFileSync(new URL('../../public/data/terrain/crystal.json', import.meta.url), 'utf8'))
    const terr = { ...tj, depth: Float32Array.from(tj.depth, (v: number | null) => (v === null ? NaN : v)) }
    const y = extend(loadTacoma(), { crystal: terr }, raw, 'live')
    const base = terr.years * 365
    expect(y.tx.crystal.depth[base + 29 + DEPTH_CARRY_DAYS]).toBe(20)
    expect(Number.isNaN(y.tx.crystal.depth[base + 29 + DEPTH_CARRY_DAYS + 1])).toBe(true)
  })

  it('compares like for like: the same Jan 1 → n span in every window year', async () => {
    const { ytdBudget } = await import('./current')
    const s = loadTacoma(), w = lookbackWindow(10)
    const wsc = score(s, example, w)!
    // Treat the window's last year as if it were the partial year: its own share must match exactly.
    const last = { ...wsc, years: 1, band: wsc.band.subarray(9 * 365), hard: wsc.hard.subarray(9 * 365) }
    const yb = ytdBudget(last, wsc, 120)
    expect(yb.ytd[0] + yb.ytd[1] + yb.ytd[2]).toBe(120)
    expect(yb.typical[0] + yb.typical[1] + yb.typical[2]).toBeCloseTo(120)
  })
})
