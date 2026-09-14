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
