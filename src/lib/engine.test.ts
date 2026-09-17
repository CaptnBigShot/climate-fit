import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SERIES_KEYS, type CityFile, type CitySeries, type HourlyFile, type TerrainFile } from './data'
import { apparent, ramp, score, seasonWeights, causeKind, causeLabel, B, BAND, BREACH, REASONS } from './scoring'

/** REASONS index for the soft 'too warm' shortfall. */
const R_WARM = 1
import { budget, activities } from './aggregate'
import { AQI_LEVELS, AQ_FORMAT, aqStats, type AqSeries } from './aq'
import {
  DEFAULT_PREFS,
  DEW_HARD_GAP,
  EXAMPLE_STATE,
  FIRST_YEAR,
  PRESETS,
  decodePrefs,
  encodePrefs,
  lookbackWindow,
  type Prefs,
} from './prefs'

const json = <T>(path: string) =>
  JSON.parse(readFileSync(new URL(`../../public/data/${path}`, import.meta.url), 'utf8')) as T
function loadTacoma(): CitySeries {
  const raw = json<CityFile>('cities/tacoma.json')
  const out: Record<string, unknown> = { ...raw }
  for (const k of SERIES_KEYS) out[k] = Float32Array.from(raw[k], (v) => (v === null ? NaN : v))
  return out as unknown as CitySeries
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
  it('a dew-point link from before the ceiling was exposed keeps its old meaning', () => {
    // Those links carried one number and meant "hard limit DEW_HARD_GAP above it".
    expect(decodePrefs(new URLSearchParams('dp=45')).dew).toEqual({ idealMax: 45, hardMax: 45 + DEW_HARD_GAP })
    for (const dew of [{ idealMax: 45, hardMax: 53 }, { idealMax: 60, hardMax: null }, null]) {
      const q = new URLSearchParams()
      encodePrefs({ ...structuredClone(DEFAULT_PREFS), dew } as Prefs, q)
      expect(decodePrefs(q).dew).toEqual(dew)
    }
  })

  it('every preset still places the ceiling where the fixed gap used to', () => {
    for (const pre of [{ apply: EXAMPLE_STATE }, ...PRESETS]) {
      const p = { ...structuredClone(DEFAULT_PREFS), ...pre.apply } as Prefs
      if (p.dew) expect(p.dew.hardMax).toBe(p.dew.idealMax + DEW_HARD_GAP)
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
    expect(b.perYear).toHaveLength(10)
  })

  it('stricter cutoff never adds comfortable days; breaches are always unbearable', () => {
    const lenient = budget(score(s, { ...example, strict: 'lenient' }, w)!)
    const strict = budget(score(s, { ...example, strict: 'strict' }, w)!)
    expect(strict.counts[0]).toBeLessThanOrEqual(lenient.counts[0])
    const sc = score(s, example, w)!
    for (let i = 0; i < sc.band.length; i++) if (sc.breach[i]) expect(sc.band[i]).toBe(BAND.unb)
  })

  it('records every bound a written-off day crossed, not just the first', () => {
    // Forced so Tacoma's warm days trip the ceiling and the dew limit together.
    const p: Prefs = {
      ...example,
      seasonal: false,
      temp: { ...example.temp!, hardMax: 65 },
      dew: { idealMax: 40, hardMax: 48 },
    }
    const sc = score(s, p, w)!
    let both = 0
    for (let i = 0; i < sc.band.length; i++) {
      expect(!!sc.breach[i]).toBe(sc.band[i] === BAND.unb)
      // A breach and a soft shortfall are mutually exclusive: each day has one cause space.
      if (sc.breach[i]) expect(sc.why[i]).toBe(0)
      if (sc.breach[i] & B.hot && sc.breach[i] & B.humid) both++
    }
    expect(both).toBeGreaterThan(0)
    expect(causeLabel(BREACH | B.hot | B.humid)).toBe('too hot & humid · deal-breaker')
    expect(causeLabel(BREACH | B.hot)).toBe('too hot · deal-breaker')
    expect(causeKind(BREACH | B.hot)).toBe('deal')
    expect(causeKind(BREACH | B.wind)).toBe('deal')
    expect(causeKind(R_WARM)).toBe('soft')
    // Combinations rank as their own cause, so dry heat never absorbs humid heat.
    const labels = budget(sc).reasons.map((r) => r.label)
    expect(labels).toContain('too hot & humid · deal-breaker')
  })

  it('no soft label can ever read the same as a written-off one', () => {
    const bits = Object.values(B)
    const hard = new Set<string>()
    // Every reachable combination of breach flags, against every soft shortfall.
    for (let m = 1; m < 1 << bits.length; m++) {
      let mask = 0
      bits.forEach((b, k) => (m & (1 << k) ? (mask |= b) : 0))
      hard.add(causeLabel(BREACH | mask))
    }
    for (let r = 1; r < REASONS.length; r++) expect(hard.has(causeLabel(r))).toBe(false)
    // Humid heat reads exactly like crossing the temperature and dew-point limits separately:
    // the same weather earns the same label, whichever control caught it.
    expect(causeLabel(BREACH | B.humidHeat)).toBe(causeLabel(BREACH | B.hot | B.humid))
    expect(causeLabel(BREACH | B.humidHeat | B.humid)).toBe(causeLabel(BREACH | B.humidHeat))
  })

  it('blames humidity or wind, not the air, when only the feels-like reading breaks a bound', () => {
    // Four blocks of a synthetic year, each breaching for a knowable reason. Real cities dry
    // enough to test against (Tacoma) barely produce a muggy day, so the cases are built.
    const seg = (d: number) =>
      d < 100
        ? { hi: 85, dew: 78, wind: 5 } // humid heat: air passes 90, heat index does not
        : d < 200
          ? { hi: 95, dew: 50, wind: 5 } // dry heat: the air itself is over
          : d < 300
            ? { hi: 20, dew: 10, wind: 25 } // wind chill: air passes 10, chill does not
            : { hi: 0, dew: -5, wind: 2 } // genuine cold: no wind to blame
    const syn = {
      id: 'syn',
      startYear: FIRST_YEAR,
      years: 1,
      demElevM: 0,
      gridElevM: 0,
      gridLat: 0,
      gridLon: 0,
      high: Float32Array.from({ length: 365 }, (_, d) => seg(d).hi),
      low: Float32Array.from({ length: 365 }, (_, d) => seg(d).hi - 15),
      dew: Float32Array.from({ length: 365 }, (_, d) => seg(d).dew),
      wind: Float32Array.from({ length: 365 }, (_, d) => seg(d).wind),
      cloud: new Float32Array(365),
      precip: new Float32Array(365),
      snow: new Float32Array(365),
      rad: new Float32Array(365),
      sun: new Float32Array(365),
    } as unknown as CitySeries
    const p: Prefs = {
      ...example,
      seasonal: false,
      sun: 'shade',
      temp: { hardMin: 10, idealMin: 40, idealMax: 70, hardMax: 90 },
      dew: null,
      cloud: 'any',
      windMax: null,
      dry: false,
    }
    const win = { from: FIRST_YEAR, to: FIRST_YEAR }
    const feel = score(syn, { ...p, basis: 'apparent' }, win)!
    const air = score(syn, { ...p, basis: 'high' }, win)!
    const at = (d: number) => causeLabel(BREACH | feel.breach[d])
    expect(at(50)).toBe('too hot & humid · deal-breaker')
    expect(at(150)).toBe('too hot · deal-breaker')
    expect(at(250)).toBe('too cold & windy · deal-breaker')
    expect(at(350)).toBe('too cold · deal-breaker')
    // The humid day and the windy day are only written off because of the feels-like basis.
    expect(air.breach[50]).toBe(0)
    expect(air.breach[250]).toBe(0)
    // Attribution is exclusive, and never fires on a plain-air basis.
    for (let i = 0; i < 365; i++) {
      expect(feel.breach[i] & B.humidHeat && feel.breach[i] & B.hot).toBeFalsy()
      expect(feel.breach[i] & B.windChill && feel.breach[i] & B.cold).toBeFalsy()
      expect(air.breach[i] & (B.humidHeat | B.windChill)).toBe(0)
    }
  })

  it('an open dew ceiling writes nothing off and fades over the soft span instead', () => {
    const base: Prefs = {
      ...example,
      seasonal: false,
      temp: { hardMin: null, idealMin: 20, idealMax: 90, hardMax: null },
    }
    const shut = score(s, { ...base, dew: { idealMax: 40, hardMax: 48 } }, w)!
    const open = score(s, { ...base, dew: { idealMax: 40, hardMax: null } }, w)!
    let shutUnb = 0,
      openUnb = 0,
      faded = 0
    for (let i = 0; i < shut.band.length; i++) {
      if (shut.band[i] === BAND.unb) shutUnb++
      if (open.band[i] === BAND.unb) openUnb++
      // Open never writes off, but still costs the day points.
      if (open.score[i] < 100) faded++
    }
    expect(shutUnb).toBeGreaterThan(0)
    expect(openUnb).toBe(0)
    expect(faded).toBeGreaterThan(0)
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
    for (let k = 0; k < 10; k++) {
      budget(score(s, example, w30)!)
      activities(s, w30, example.acts, null)
    }
    expect((performance.now() - t0) / 10).toBeLessThan(40)
  })
})

describe('secondary features', async () => {
  const { spans, bestSpans, worstSpan, extremes, crossing, sensitivity, typicalDay, monthYearMatrix, isMosquitoDay } =
    await import('./extras')
  const s = loadTacoma()
  const w = lookbackWindow(10)
  const sc = score(s, example, w)!

  it('best spans do not overlap and beat the worst span', () => {
    const all = spans(sc, 14)
    const best = bestSpans(all, 3),
      worst = worstSpan(all)
    expect(best).toHaveLength(3)
    for (const a of best)
      for (const b of best)
        if (a !== b)
          expect(Math.min(Math.abs(a.start - b.start), 365 - Math.abs(a.start - b.start))).toBeGreaterThanOrEqual(14)
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
    const raw = json<HourlyFile>('hourly/tacoma.json')
    const h = { ...raw, temp: new Int16Array(Buffer.from(raw.temp10, 'base64').buffer.slice(0)), live: false }
    const prof = typicalDay(h, 6, w)
    expect(prof.days).toBe(31 * 10)
    for (let hr = 0; hr < 24; hr++) expect(prof.p10[hr]).toBeLessThanOrEqual(prof.p90[hr])
    // July afternoons are warmer than July pre-dawn in Tacoma.
    expect(prof.p50[15]).toBeGreaterThan(prof.p50[5] + 10)
  })

  it('air-quality stats count the worst pollutant per day and clip the window to the record', () => {
    const aq: AqSeries = {
      v: AQ_FORMAT,
      id: 't',
      source: 'epa',
      start: '2020-01-01',
      end: '2020-01-04',
      aqi: { o3: [40, 120, null, 60], pm25: [60, 30, 160, null] },
    }
    const st = aqStats(aq, { from: 2020, to: 2020 })!
    const yr = 4 / 365.25
    expect(st.from).toBe('2020-01-01')
    expect(st.to).toBe('2020-01-04')
    const row = (k: string) => st.rows.find((r) => r.key === k)!
    // Day AQI = worst pollutant: 60, 120, 160, 60.
    expect(row('any').perYear.map((v) => v * yr)).toEqual([4, 2, 1].map((n): unknown => expect.closeTo(n)))
    expect(row('o3').perYear.map((v) => v * yr)).toEqual([2, 1, 0].map((n): unknown => expect.closeTo(n)))
    expect(row('o3').coverage).toBe(0.75)
    expect(st.worst).toEqual({ date: '2020-01-03', aqi: 160, by: 'pm25' })
    expect(st.months.o3[0] * yr).toBeCloseTo(1)
    expect(st.months.pm25[0] * yr).toBeCloseTo(1)
    expect(aqStats(aq, { from: 2021, to: 2022 })).toBeNull()
  })

  it('air-quality file for a US city comes from EPA monitors and is internally consistent', () => {
    const aq = json<AqSeries>('aq/tacoma.json')
    expect(aq.v).toBe(AQ_FORMAT)
    expect(aq.source).toBe('epa')
    const st = aqStats(aq, w)!
    expect(st.years).toBeCloseTo(10, 1)
    const any = st.rows[0]
    for (const r of st.rows) {
      AQI_LEVELS.forEach((_, k) => {
        expect(any.perYear[k]).toBeGreaterThanOrEqual(r.perYear[k])
        if (k) expect(r.perYear[k]).toBeLessThanOrEqual(r.perYear[k - 1])
      })
    }
    const monthly = [...st.months.o3, ...st.months.pm25, ...st.months.other].reduce((a, b) => a + b, 0)
    expect(monthly).toBeCloseTo(any.perYear[1], 6)
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
        : {
            utc_offset_seconds: offsetSec,
            daily: {
              time,
              temperature_2m_max: rows.map((r) => r.high),
              temperature_2m_min: rows.map((r) => (r.high === null ? null : r.high - 10)),
              dew_point_2m_mean: rows.map(() => 40),
              cloud_cover_mean: rows.map(() => 50),
              precipitation_sum: rows.map(() => 0),
              snowfall_sum: rows.map(() => 0),
              wind_speed_10m_max: rows.map(() => 5),
              shortwave_radiation_sum: rows.map(() => 10),
              sunshine_duration: rows.map(() => 3600),
            },
          }
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch
  const days = (from: string, n: number, high: (i: number) => number | null = () => 60) =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10),
      high: high(i),
    }))

  it("stops at the city's local yesterday, not UTC's", async () => {
    // 04:00 UTC on Sep 14 is still Sep 13 in UTC−7: Sep 13 must not count.
    const now = new Date('2026-09-14T04:00:00Z')
    const r = await fetchYtdRaw({
      year: 2026,
      lat: 0,
      lon: 0,
      terrain: [],
      now,
      fetchImpl: fake(days('2026-01-01', 257), -7 * 3600),
    })
    expect(r.through).toBe('2026-09-12')
    expect(r.days).toBe(255)
    expect(r.daily.high[255]).toBeNull()
  })

  it('ends the observed run at the first gap', async () => {
    const r = await fetchYtdRaw({
      year: 2026,
      lat: 0,
      lon: 0,
      terrain: [],
      now: new Date('2026-03-01T12:00:00Z'),
      fetchImpl: fake(
        days('2026-01-01', 59, (i) => (i === 40 ? null : 50)),
        0,
      ),
    })
    expect(r.days).toBe(40)
    expect(r.daily.high[45]).toBeNull()
  })

  it('drops Feb 29 in a leap year so day-of-year lines up with the archive', async () => {
    const r = await fetchYtdRaw({
      year: 2028,
      lat: 0,
      lon: 0,
      terrain: [],
      now: new Date('2028-03-10T12:00:00Z'),
      fetchImpl: fake(
        days('2028-01-01', 69, (i) => i),
        0,
      ),
    })
    // Mar 1 is day 59 in a 365-day year; in 2028 it is the 61st calendar day (index 60).
    expect(r.daily.high[59]).toBe(60)
    expect(r.days).toBe(68)
  })

  it('carries lagging terrain snow depth forward a few days, then stops', async () => {
    const { extend, DEPTH_CARRY_DAYS } = await import('./current')
    const depth = [...Array<number>(30).fill(0.508), ...Array<null>(30).fill(null)] // metres, as the API returns; 0.508 m = 20"
    const raw = await fetchYtdRaw({
      year: 2026,
      lat: 0,
      lon: 0,
      terrain: [{ id: 'crystal', lat: 0, lon: 0, elevFt: 5000 }],
      now: new Date('2026-03-02T12:00:00Z'),
      fetchImpl: fake(days('2026-01-01', 60), 0, depth),
    })
    const tj = json<TerrainFile>('terrain/crystal.json')
    const terr = { ...tj, depth: Float32Array.from(tj.depth, (v) => (v === null ? NaN : v)) }
    const y = extend(loadTacoma(), { crystal: terr }, raw, 'live')
    const base = terr.years * 365
    expect(y.tx.crystal.depth[base + 29 + DEPTH_CARRY_DAYS]).toBe(20)
    expect(Number.isNaN(y.tx.crystal.depth[base + 29 + DEPTH_CARRY_DAYS + 1])).toBe(true)
  })

  it('compares like for like: the same Jan 1 → n span in every window year', async () => {
    const { ytdBudget } = await import('./current')
    const s = loadTacoma(),
      w = lookbackWindow(10)
    const wsc = score(s, example, w)!
    // Treat the window's last year as if it were the partial year: its own share must match exactly.
    const last = { ...wsc, years: 1, band: wsc.band.subarray(9 * 365) }
    const yb = ytdBudget(last, wsc, 120)
    expect(yb.ytd[0] + yb.ytd[1] + yb.ytd[2]).toBe(120)
    expect(yb.typical[0] + yb.typical[1] + yb.typical[2]).toBeCloseTo(120)
  })
})
