import { useMemo, useState } from 'react'
import type { CitySeries } from '../lib/data'
import { MN, MONTH_START, doyLabel } from '../lib/calendar'
import { CO } from '../lib/colors'
import { FIRST_YEAR, windowYears, type Prefs } from '../lib/prefs'
import { idealFor, seasonWeights } from '../lib/scoring'
import { quantileSorted } from '../lib/stats'
import type { Units } from '../lib/units'
import { Head, Seg } from './ui'
import { useWidth } from '../hooks/useWidth'

type Mode = 'dist' | 'every' | 'year'
const H = 260, PAD_L = 40, PAD_R = 8, PAD_B = 22, PAD_T = 14

export function TempDistribution({ s, p, u }: { s: CitySeries; p: Prefs; u: Units }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [mode, setMode] = useState<Mode>('dist')
  const [which, setWhich] = useState<'high' | 'low'>('high')
  const years = windowYears(p.window)
  const [yearSel, setYear] = useState<number | null>(null)
  const year = yearSel !== null && yearSel >= p.window.from && yearSel <= p.window.to ? yearSel : p.window.to
  const off = (p.window.from - FIRST_YEAR) * 365
  const src = which === 'high' ? s.high : s.low

  // Per-day-of-year distribution across the window's years.
  const stats = useMemo(() => {
    const q = { p10: new Float32Array(365), p25: new Float32Array(365), p50: new Float32Array(365), p75: new Float32Array(365), p90: new Float32Array(365), min: new Float32Array(365), max: new Float32Array(365) }
    const col = new Float32Array(years)
    for (let d = 0; d < 365; d++) {
      for (let y = 0; y < years; y++) col[y] = src[off + y * 365 + d]
      col.sort()
      q.p10[d] = quantileSorted(col, 0.1); q.p25[d] = quantileSorted(col, 0.25); q.p50[d] = quantileSorted(col, 0.5)
      q.p75[d] = quantileSorted(col, 0.75); q.p90[d] = quantileSorted(col, 0.9); q.min[d] = col[0]; q.max[d] = col[years - 1]
    }
    return q
  }, [src, off, years])

  const warmW = useMemo(() => seasonWeights(s, p.window).warmW, [s, p.window])

  if (!width) return <div ref={ref} style={{ height: H }} />
  const W = width
  const t = p.temp
  // Y domain never clips: records always fit, and so do the user's own lines.
  let lo = Math.min(...stats.min), hi = Math.max(...stats.max)
  if (t) { lo = Math.min(lo, t.idealMin - 4, p.seasonal ? p.cold.idealMin - 4 : Infinity); hi = Math.max(hi, t.idealMax + 4, t.hardMax !== null ? t.hardMax + 4 : -Infinity) }
  lo = Math.floor(lo / 10) * 10; hi = Math.ceil(hi / 10) * 10
  const x = (d: number) => PAD_L + (d / 365) * (W - PAD_L - PAD_R)
  const yv = (v: number) => H - PAD_B - ((v - lo) / (hi - lo)) * (H - PAD_B - PAD_T)
  // Step path: each day is a flat segment across its own column — no interpolation between days.
  const stepPts = (a: ArrayLike<number>) => {
    const pts: string[] = []
    for (let d = 0; d < 365; d++) pts.push(`${x(d).toFixed(1)},${yv(a[d]).toFixed(1)}`, `${x(d + 1).toFixed(1)},${yv(a[d]).toFixed(1)}`)
    return pts
  }
  const ribbon = (a: ArrayLike<number>, b: ArrayLike<number>) => [...stepPts(a), ...stepPts(b).reverse()].join(' ')

  let overlay = null
  if (t) {
    const top: number[] = [], bot: number[] = []
    for (let d = 0; d < 365; d++) { const [a, b] = idealFor(p, warmW[d]); bot.push(a); top.push(b) }
    overlay = <polygon points={ribbon(top, bot)} fill={CO.comf} fillOpacity={0.13} />
  }

  const ticks = []
  for (let v = lo; v <= hi; v += 10) ticks.push(v)

  let raw = null
  if (mode === 'every') {
    let dpath = ''
    for (let y = 0; y < years; y++) for (let d = 0; d < 365; d++) {
      const v = src[off + y * 365 + d]
      dpath += `M${(x(d) + 0.3).toFixed(1)} ${yv(v).toFixed(1)}h1.2v1.2h-1.2z`
    }
    raw = <path d={dpath} fill="#9aa9c4" fillOpacity={0.5} />
  }
  // Annotate the window's record (hottest high, or coldest low) with its date.
  let ri = 0
  for (let i = 1; i < years * 365; i++) if (which === 'high' ? src[off + i] > src[off + ri] : src[off + i] < src[off + ri]) ri = i
  const rv = src[off + ri], rd = ri % 365, rx = x(rd + 0.5), ry = yv(rv)
  const recLabel = `${which === 'high' ? 'RECORD HIGH' : 'RECORD LOW'} ${u.t(rv)}${u.tu} · ${doyLabel(rd)}, ${p.window.from + Math.floor(ri / 365)}`
  const recMark = (
    <g>
      <circle cx={rx} cy={ry} r={3.5} fill="none" stroke="#ffd18a" strokeWidth={1.2} />
      <text x={rx + (rd > 250 ? -7 : 7)} y={ry + (which === 'high' ? -6 : 13)} textAnchor={rd > 250 ? 'end' : 'start'} fill="#ffd18a" style={{ font: "500 9.5px 'JetBrains Mono', monospace" }}>{recLabel}</text>
    </g>
  )
  const yearLine = mode === 'year'
    ? <polyline points={stepPts(src.subarray(off + (year - p.window.from) * 365, off + (year - p.window.from + 1) * 365)).join(' ')} fill="none" stroke="#ffd18a" strokeWidth={1.2} />
    : null

  return (
    <div ref={ref}>
      <div className="section-head">
        <Head tip="Daily temperature through the year. Dark envelope: record range. Inner bands: 10th–90th and 25th–75th percentiles. Pale line: median. Green shading: your ideal band (stepping between seasonal bands when seasonal mode is on). Air temperature as observed, before any in-sun adjustment.">TEMPERATURE DISTRIBUTION</Head>
        <span className="sub">daily {which} · p10/p25/p50/p75/p90 + record envelope · step segments, no smoothing</span>
        <div className="right">
          <Seg small value={which} onChange={setWhich} options={[{ v: 'high', label: 'HIGH' }, { v: 'low', label: 'LOW' }]} />
          <Seg small value={mode} onChange={setMode} options={[{ v: 'dist', label: 'DISTRIBUTION' }, { v: 'every', label: 'EVERY DAY' }, { v: 'year', label: 'SINGLE YEAR' }]} />
          {mode === 'year' && (
            <select className="mono" value={year} onChange={(e) => setYear(+e.target.value)}
              style={{ background: 'var(--btn)', color: 'var(--ink)', border: '1px solid var(--line-2)', font: "400 10.5px/1 var(--mono)", padding: '3px 4px' }}>
              {Array.from({ length: years }, (_, i) => p.window.from + i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </div>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yv(v)} y2={yv(v)} stroke={CO.grid} />
            <text x={PAD_L - 6} y={yv(v) + 3} textAnchor="end" fill={CO.faint} style={{ font: "400 9px 'JetBrains Mono', monospace" }}>{u.t(v)}</text>
          </g>
        ))}
        {overlay}
        {mode === 'every' ? raw : (
          <>
            <polygon points={ribbon(stats.max, stats.min)} fill="#6c7a90" fillOpacity={0.16} />
            <polygon points={ribbon(stats.p90, stats.p10)} fill="#7f93b8" fillOpacity={0.3} />
            <polygon points={ribbon(stats.p75, stats.p25)} fill="#9fb4d8" fillOpacity={0.45} />
            <polyline points={stepPts(stats.p50).join(' ')} fill="none" stroke="#dbe2ee" strokeWidth={1.1} />
          </>
        )}
        {yearLine}
        {recMark}
        {t && t.hardMax !== null && (
          <g>
            <line x1={PAD_L} x2={W - PAD_R} y1={yv(t.hardMax)} y2={yv(t.hardMax)} stroke={CO.warn} strokeDasharray="4 3" />
            <text x={W - PAD_R - 2} y={yv(t.hardMax) - 5} textAnchor="end" fill={CO.warn} style={{ font: "500 9.5px 'JetBrains Mono', monospace" }}>HARD CEILING {u.t(t.hardMax)}{u.tu}</text>
          </g>
        )}
        {t && t.hardMin !== null && t.hardMin > lo && (
          <g>
            <line x1={PAD_L} x2={W - PAD_R} y1={yv(t.hardMin)} y2={yv(t.hardMin)} stroke={CO.accent} strokeDasharray="4 3" />
            <text x={W - PAD_R - 2} y={yv(t.hardMin) + 12} textAnchor="end" fill={CO.accent} style={{ font: "500 9.5px 'JetBrains Mono', monospace" }}>HARD FLOOR {u.t(t.hardMin)}{u.tu}</text>
          </g>
        )}
        {MN.map((m, k) => (
          <text key={m} x={x(MONTH_START[k]) + 2} y={H - 6} fill={CO.faint} style={{ font: "400 9px 'JetBrains Mono', monospace" }}>{m.toUpperCase()}</text>
        ))}
      </svg>
      {mode === 'year' && <div className="legend"><span className="item"><span className="sw" style={{ background: '#ffd18a', height: 2 }} />{year} DAILY {which.toUpperCase()} OVER THE {p.window.from}–{p.window.to} DISTRIBUTION</span></div>}
    </div>
  )
}
