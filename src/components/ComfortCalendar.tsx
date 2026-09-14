import { useEffect, useMemo, useRef, useState } from 'react'
import type { CitySeries, TerrainSeries } from '../lib/data'
import { MN, MONTH_START, doyLabel } from '../lib/calendar'
import { BAND_COLOR, CO, contColor } from '../lib/colors'
import { ACTIVITIES, LOSS_LABEL } from '../lib/activities'
import { BAND, REASONS, dayTemp, type Scored } from '../lib/scoring'
import { FIRST_YEAR, windowLabel, windowYears, type Prefs } from '../lib/prefs'
import type { Units } from '../lib/units'
import { BandLegend, Head, Seg } from './ui'
import { useWidth } from '../hooks/useWidth'

const LEFT = 40, ROW = 13, GAP = 2.5, ISO_ROW = 34, AXIS = 18

function hatchPattern(ctx: CanvasRenderingContext2D, dpr: number): CanvasPattern | string {
  const c = document.createElement('canvas'), s = Math.round(5 * dpr)
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.fillStyle = CO.hardBase; g.fillRect(0, 0, s, s)
  g.strokeStyle = CO.hardStripe; g.lineWidth = 1.4 * dpr
  g.beginPath()
  for (const o of [-s, 0, s]) { g.moveTo(o, s); g.lineTo(o + s, 0) }
  g.stroke()
  return ctx.createPattern(c, 'repeat') ?? CO.hardBase
}

export function ComfortCalendar({ s, sc, p, terrain, u, fill, setFill }: {
  s: CitySeries; sc: Scored | null; p: Prefs; terrain: TerrainSeries | null; u: Units
  fill: 'banded' | 'continuous'; setFill: (v: 'banded' | 'continuous') => void
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [modeSel, setMode] = useState<'comfort' | 'activity'>('comfort')
  const [isolate, setIsolate] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; i: number } | null>(null)
  const mode = sc ? modeSel : 'activity'
  const years = windowYears(p.window)
  const iso = isolate !== null && isolate < years ? isolate : null
  const rows = iso === null ? years : 1
  const rowH = iso === null ? ROW : ISO_ROW
  const H = rows * (rowH + GAP) + AXIS
  const off = (p.window.from - FIRST_YEAR) * 365
  const tOff = terrain ? (p.window.from - terrain.startYear) * 365 : 0
  const enabled = useMemo(() => ACTIVITIES.filter((a) => p.acts.includes(a.id)), [p.acts])

  // Activity colour per day: snow-sport day, other enabled activity viable, or none.
  const actFill = useMemo(() => {
    if (mode !== 'activity') return null
    const out = new Uint8Array(years * 365)
    for (let i = 0; i < out.length; i++) {
      const j = off + i
      const d = { hi: s.high[j], lo: s.low[j], dew: s.dew[j], precip: s.precip[j], wind: s.wind[j], depth: terrain ? terrain.depth[tOff + i] : NaN }
      let v = 0
      for (const a of enabled) if (a.test(d) === 0) { v = a.id === 'ride' ? 2 : Math.max(v, 1); if (v === 2) break }
      out[i] = v
    }
    return out
  }, [mode, years, off, tOff, s, terrain, enabled])

  useEffect(() => {
    const cv = canvas.current
    if (!cv || !width) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(width * dpr); cv.height = Math.round(H * dpr)
    cv.style.width = `${width}px`; cv.style.height = `${H}px`
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, H)
    const cw = (width - LEFT) / 365
    const hatch = hatchPattern(ctx, dpr)
    const cellW = Math.max(0.8, cw - 0.25)
    for (let r = 0; r < rows; r++) {
      const y = iso === null ? r : iso
      const top = r * (rowH + GAP)
      for (let d = 0; d < 365; d++) {
        const i = y * 365 + d
        let f: string | CanvasPattern
        if (mode === 'activity') f = actFill![i] === 2 ? CO.actSnow : actFill![i] === 1 ? CO.act : CO.actNone
        else if (sc!.band[i] === BAND.unb) f = sc!.hard[i] ? hatch : fill === 'continuous' ? '#2a2e36' : CO.unb
        else f = fill === 'continuous' ? contColor(sc!.score[i]) : BAND_COLOR[sc!.band[i]]
        ctx.fillStyle = f
        ctx.fillRect(LEFT + d * cw, top, cellW, rowH)
      }
      // Continuous mode: draw the band edges (the user's own thresholds) as contour ticks.
      if (mode === 'comfort' && fill === 'continuous') {
        ctx.fillStyle = 'rgba(230,232,236,.55)'
        for (let d = 1; d < 365; d++) {
          const i = y * 365 + d
          if (sc!.band[i] !== sc!.band[i - 1]) ctx.fillRect(LEFT + d * cw - 0.5, top, 1, rowH)
        }
      }
      ctx.fillStyle = iso === null ? '#7cc4ff' : '#e6e8ec'
      ctx.font = "400 9px 'JetBrains Mono', monospace"
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
      ctx.fillText(String(p.window.from + y), LEFT - 7, top + rowH / 2)
    }
    ctx.fillStyle = '#5f6672'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    if (mode === 'comfort' && fill === 'continuous') ctx.fillText(`FIT 0 → 100 · CONTOURS AT BAND EDGES`, LEFT, H - 5)
    else MN.forEach((m, k) => ctx.fillText(m.toUpperCase(), LEFT + MONTH_START[k] * cw + 2, H - 5))
    if (hover && hover.i >= 0) {
      const r = iso === null ? Math.floor(hover.i / 365) : 0
      const d = hover.i % 365
      ctx.strokeStyle = '#e6e8ec'; ctx.lineWidth = 1
      ctx.strokeRect(LEFT + d * cw - 0.5, r * (rowH + GAP) - 0.5, cellW + 1, rowH + 1)
    }
  }, [width, H, rows, rowH, iso, mode, fill, sc, actFill, p.window.from, hover])

  const locate = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    const x = e.clientX - r.left, y = e.clientY - r.top
    const row = Math.floor(y / (rowH + GAP))
    if (row < 0 || row >= rows || y - row * (rowH + GAP) > rowH) return { row: -1, d: -1, gutter: false }
    if (x < LEFT) return { row, d: -1, gutter: true }
    return { row, d: Math.min(364, Math.floor(((x - LEFT) / (width - LEFT)) * 365)), gutter: false }
  }
  const onMove = (e: React.MouseEvent) => {
    const { row, d, gutter } = locate(e)
    canvas.current!.style.cursor = gutter ? 'pointer' : 'crosshair'
    if (row < 0 || d < 0) { setHover(null); return }
    const y = iso === null ? row : iso
    setHover({ x: e.clientX, y: e.clientY, i: y * 365 + d })
  }
  const onClick = (e: React.MouseEvent) => {
    const { row, gutter } = locate(e)
    if (!gutter || row < 0) return
    setIsolate(iso === null ? row : null)
  }

  return (
    <div className="section">
      <div className="section-head">
        <Head tip="One cell per observed day, no averaging — rows are years, columns are days of the year. This is where you see whether the good days cluster or scatter, and whether the pattern is drifting. Click a year label to isolate it.">COMFORT CALENDAR</Head>
        <span className="sub">one cell = one observed day · no aggregation · {windowLabel(p.window)}</span>
        {iso !== null && <button className="link-btn" style={{ background: 'var(--accent)', color: 'var(--bg)' }} onClick={() => setIsolate(null)}>{p.window.from + iso} ISOLATED · CLEAR ✕</button>}
        <div className="right">
          {mode === 'comfort' && <Seg small value={fill} onChange={setFill} options={[{ v: 'banded', label: 'BANDED' }, { v: 'continuous', label: 'CONTINUOUS' }]} />}
          <Seg small value={mode} onChange={(v) => sc && setMode(v)} options={[{ v: 'comfort', label: sc ? 'COMFORT' : 'COMFORT · UNSET' }, { v: 'activity', label: 'ACTIVITY' }]} />
        </div>
      </div>
      <div ref={wrapRef}>
        <canvas ref={canvas} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick} style={{ display: 'block' }} />
      </div>
      {mode === 'comfort' ? (
        <BandLegend>
          <span className="cap" style={{ marginLeft: 'auto' }}>HOVER A CELL FOR FULL CONDITIONS · CLICK A YEAR TO ISOLATE</span>
        </BandLegend>
      ) : (
        <div className="legend">
          <span className="item"><span className="sw" style={{ background: CO.act }} />AN ENABLED ACTIVITY IS POSSIBLE</span>
          <span className="item"><span className="sw" style={{ background: CO.actSnow }} />SNOW-SPORT DAY</span>
          <span className="item"><span className="sw" style={{ background: CO.actNone }} />NONE POSSIBLE</span>
          <span className="cap" style={{ marginLeft: 'auto' }}>{sc ? 'ACTIVITY ENCODING · SEPARATE FROM COMFORT' : 'SET A PREFERENCE TO COLOUR BY COMFORT'}</span>
        </div>
      )}
      {hover && <DayTip s={s} sc={sc} p={p} u={u} i={hover.i} x={hover.x} y={hover.y} terrain={terrain} tOff={tOff} off={off} mode={mode} />}
    </div>
  )
}

function DayTip({ s, sc, p, u, i, x, y, terrain, tOff, off, mode }: {
  s: CitySeries; sc: Scored | null; p: Prefs; u: Units; i: number; x: number; y: number
  terrain: TerrainSeries | null; tOff: number; off: number; mode: 'comfort' | 'activity'
}) {
  const j = off + i, year = p.window.from + Math.floor(i / 365)
  const depth = terrain ? terrain.depth[tOff + i] : NaN
  const d = { hi: s.high[j], lo: s.low[j], dew: s.dew[j], precip: s.precip[j], wind: s.wind[j], depth }
  const basisT = dayTemp(s, j, p)
  const left = Math.min(x + 14, window.innerWidth - 334), top = y + 16 + 230 > window.innerHeight ? y - 240 : y + 16
  return (
    <div className="floating" style={{ left, top }}>
      <div style={{ font: '600 12px/1.3 var(--sans)', marginBottom: 6 }}>{doyLabel(i % 365)}, {year}</div>
      <div className="mono" style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 14px', color: 'var(--mid)' }}>
        <span>High / low</span><span style={{ color: 'var(--ink)' }}>{u.t(d.hi)} / {u.t(d.lo)}{u.tu}</span>
        {(p.sun === 'sun' || p.basis === 'apparent') && <><span>Scored temp</span><span style={{ color: 'var(--ink)' }}>{u.t(basisT)}{u.tu}</span></>}
        <span>Dew point</span><span style={{ color: 'var(--ink)' }}>{u.t(d.dew)}{u.tu}</span>
        <span>Cloud cover</span><span style={{ color: 'var(--ink)' }}>{Math.round(s.cloud[j])}%</span>
        <span>Precip / snow</span><span style={{ color: 'var(--ink)' }}>{u.len(d.precip)} / {u.len(s.snow[j], 1)}</span>
        <span>Max wind</span><span style={{ color: 'var(--ink)' }}>{u.speed(d.wind)}</span>
        <span>Sunshine</span><span style={{ color: 'var(--ink)' }}>{s.sun[j].toFixed(1)} h</span>
        {terrain && <><span>Terrain snow</span><span style={{ color: 'var(--ink)' }}>{Number.isNaN(depth) ? '—' : u.depth(depth)}</span></>}
      </div>
      {mode === 'comfort' && sc && (
        <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid #3a414c' }}>
          <span style={{ color: BAND_COLOR[sc.band[i]] === CO.unb ? '#98a0ad' : BAND_COLOR[sc.band[i]], fontWeight: 600 }}>
            {['Comfortable', 'Tolerable', 'Unbearable'][sc.band[i]]}
          </span>
          {sc.band[i] !== BAND.unb && <span className="mono"> · fit {Math.round(sc.score[i])}</span>}
          {sc.why[i] > 0 && <span> · {REASONS[sc.why[i]]}</span>}
        </div>
      )}
      {mode === 'activity' && (
        <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid #3a414c', display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 14px' }}>
          {ACTIVITIES.filter((a) => p.acts.includes(a.id)).map((a) => {
            const r = a.test(d)
            return [<span key={a.id}>{a.name}</span>, <span key={a.id + 'r'} className="mono" style={{ color: r ? 'var(--dim)' : CO.act }}>{r ? `✕ ${LOSS_LABEL[r]}` : '✓'}</span>]
          })}
        </div>
      )}
    </div>
  )
}
