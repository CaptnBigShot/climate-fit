import { useEffect, useMemo, useRef, useState } from 'react'
import type { CitySeries, TerrainSeries } from '../lib/data'
import { MN, MONTH_START, doyLabel } from '../lib/calendar'
import { BAND_COLOR, CO, contColor } from '../lib/colors'
import { ACTIVITIES, LOSS_LABEL } from '../lib/activities'
import { BAND, REASONS, dayTemp, type Scored } from '../lib/scoring'
import { FIRST_YEAR, windowLabel, windowYears, type Prefs } from '../lib/prefs'
import { YTD_YEAR, type Ytd } from '../lib/current'
import type { Units } from '../lib/units'
import { BandLegend, Head, Seg } from './ui'
import { useWidth } from '../hooks/useWidth'

const LEFT = 40, ROW = 13, GAP = 2.5, ISO_ROW = 34, AXIS = 18, YTD_SEP = 7

/** One calendar row: a year, where its days live, and how many of them are observed. */
interface Row {
  year: number
  series: CitySeries
  sc: Scored | null
  /** Index of Jan 1 of this row inside `sc`. */
  scBase: number
  /** Index of Jan 1 of this row inside `series`. */
  j0: number
  terrain: TerrainSeries | null
  observed: number
  ytd: boolean
}

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

export function ComfortCalendar({ s, sc, p, terrain, u, fill, setFill, ytd, ytdSc, terrainId }: {
  s: CitySeries; sc: Scored | null; p: Prefs; terrain: TerrainSeries | null; u: Units
  fill: 'banded' | 'continuous'; setFill: (v: 'banded' | 'continuous') => void
  ytd: Ytd | null; ytdSc: Scored | null; terrainId: string | null
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [modeSel, setMode] = useState<'comfort' | 'activity'>('comfort')
  const [isolate, setIsolate] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; r: number; d: number } | null>(null)
  const mode = sc ? modeSel : 'activity'
  const years = windowYears(p.window)
  const off = (p.window.from - FIRST_YEAR) * 365

  const allRows = useMemo<Row[]>(() => {
    const rows: Row[] = Array.from({ length: years }, (_, y) => ({
      year: p.window.from + y, series: s, sc, scBase: y * 365, j0: off + y * 365,
      terrain, observed: 365, ytd: false,
    }))
    if (ytd && ytd.raw.days > 0) {
      rows.push({
        year: YTD_YEAR, series: ytd.sx, sc: ytdSc, scBase: 0, j0: (YTD_YEAR - FIRST_YEAR) * 365,
        terrain: terrainId ? ytd.tx[terrainId] ?? null : null, observed: ytd.raw.days, ytd: true,
      })
    }
    return rows
  }, [years, p.window.from, s, sc, off, terrain, ytd, ytdSc, terrainId])

  const iso = isolate !== null && isolate < allRows.length ? isolate : null
  const rows = iso === null ? allRows : [allRows[iso]]
  const rowH = iso === null ? ROW : ISO_ROW
  const hasYtdRow = rows.some((r) => r.ytd) && rows.length > 1
  const rowTop = (k: number) => k * (rowH + GAP) + (hasYtdRow && rows[k].ytd ? YTD_SEP : 0)
  const H = rows.length * (rowH + GAP) + (hasYtdRow ? YTD_SEP : 0) + AXIS
  const enabled = useMemo(() => ACTIVITIES.filter((a) => p.acts.includes(a.id)), [p.acts])

  // Activity encoding per cell: 2 snow-sport day, 1 another enabled activity viable, 0 none.
  const actOf = (row: Row, d: number) => {
    const j = row.j0 + d, t = row.terrain
    const inp = { hi: row.series.high[j], lo: row.series.low[j], dew: row.series.dew[j], precip: row.series.precip[j], wind: row.series.wind[j],
      depth: t ? t.depth[j - (t.startYear - FIRST_YEAR) * 365] : NaN }
    let v = 0
    for (const a of enabled) if (a.test(inp) === 0) { if (a.id === 'ride') return 2; v = 1 }
    return v
  }

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
    rows.forEach((row, k) => {
      const top = rowTop(k)
      for (let d = 0; d < row.observed; d++) {
        const i = row.scBase + d
        let f: string | CanvasPattern
        if (mode === 'activity') { const a = actOf(row, d); f = a === 2 ? CO.actSnow : a === 1 ? CO.act : CO.actNone }
        else if (!row.sc) f = CO.unscored
        else if (row.sc.band[i] === BAND.unb) f = row.sc.hard[i] ? hatch : fill === 'continuous' ? '#2a2e36' : CO.unb
        else f = fill === 'continuous' ? contColor(row.sc.score[i]) : BAND_COLOR[row.sc.band[i]]
        ctx.fillStyle = f
        ctx.fillRect(LEFT + d * cw, top, cellW, rowH)
      }
      if (row.observed < 365) {
        // Not yet observed: an outline, never a colour — nothing is inferred for days that haven't happened.
        ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 1
        ctx.strokeRect(LEFT + row.observed * cw + 0.5, top + 0.5, (365 - row.observed) * cw - 1, rowH - 1)
        ctx.fillStyle = '#e6e8ec'
        ctx.fillRect(LEFT + row.observed * cw, top - 2, 1, rowH + 4)
        ctx.fillStyle = '#8b929e'; ctx.font = "400 9px 'JetBrains Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
        ctx.fillText(`THROUGH ${doyLabel(row.observed - 1).toUpperCase()} · NOT YET OBSERVED`, LEFT + row.observed * cw + 6, top + rowH / 2 + 0.5)
      }
      if (mode === 'comfort' && fill === 'continuous' && row.sc) {
        ctx.fillStyle = 'rgba(230,232,236,.55)'
        for (let d = 1; d < row.observed; d++) {
          const i = row.scBase + d
          if (row.sc.band[i] !== row.sc.band[i - 1]) ctx.fillRect(LEFT + d * cw - 0.5, top, 1, rowH)
        }
      }
      ctx.fillStyle = row.ytd ? '#e6e8ec' : iso === null ? '#7cc4ff' : '#e6e8ec'
      ctx.font = `${row.ytd ? 600 : 400} 9px 'JetBrains Mono', monospace`
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
      ctx.fillText(String(row.year), LEFT - 7, top + rowH / 2)
    })
    if (hasYtdRow) {
      const k = rows.findIndex((r) => r.ytd)
      ctx.fillStyle = '#2b2f36'
      ctx.fillRect(LEFT, rowTop(k) - YTD_SEP / 2 - 1, width - LEFT, 1)
    }
    ctx.fillStyle = '#5f6672'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = "400 9px 'JetBrains Mono', monospace"
    if (mode === 'comfort' && fill === 'continuous') ctx.fillText('FIT 0 → 100 · CONTOURS AT BAND EDGES', LEFT, H - 5)
    else MN.forEach((m, k) => ctx.fillText(m.toUpperCase(), LEFT + MONTH_START[k] * cw + 2, H - 5))
    if (hover) {
      ctx.strokeStyle = '#e6e8ec'; ctx.lineWidth = 1
      ctx.strokeRect(LEFT + hover.d * cw - 0.5, rowTop(hover.r) - 0.5, cellW + 1, rowH + 1)
    }
  }, [width, H, rows, rowH, iso, mode, fill, hover, hasYtdRow]) // eslint-disable-line react-hooks/exhaustive-deps

  const locate = (e: React.MouseEvent) => {
    const rect = canvas.current!.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    const r = rows.findIndex((_, k) => y >= rowTop(k) && y <= rowTop(k) + rowH)
    if (r < 0) return { r: -1, d: -1, gutter: false }
    if (x < LEFT) return { r, d: -1, gutter: true }
    return { r, d: Math.min(364, Math.floor(((x - LEFT) / (width - LEFT)) * 365)), gutter: false }
  }
  const onMove = (e: React.MouseEvent) => {
    const { r, d, gutter } = locate(e)
    canvas.current!.style.cursor = gutter ? 'pointer' : 'crosshair'
    if (r < 0 || d < 0 || d >= rows[r].observed) { setHover(null); return }
    setHover({ x: e.clientX, y: e.clientY, r, d })
  }
  const onClick = (e: React.MouseEvent) => {
    const { r, gutter } = locate(e)
    if (!gutter || r < 0) return
    setIsolate(iso === null ? r : null)
  }
  const ytdRow = allRows.find((r) => r.ytd)

  return (
    <div className="section">
      <div className="section-head">
        <Head tip={`One cell per observed day, no averaging — rows are years, columns are days of the year. This is where you see whether the good days cluster or scatter, and whether the pattern is drifting. The ${YTD_YEAR} row below the line is the year so far: it is shown, never averaged into the window. Click a year label to isolate it.`}>COMFORT CALENDAR</Head>
        <span className="sub">one cell = one observed day · no aggregation · {windowLabel(p.window)}{ytdRow ? ` + ${YTD_YEAR} so far` : ''}</span>
        {iso !== null && <button className="link-btn" style={{ background: 'var(--accent)', color: 'var(--bg)' }} onClick={() => setIsolate(null)}>{allRows[iso].year} ISOLATED · CLEAR ✕</button>}
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
          {ytdRow && <span className="item"><span className="sw" style={{ border: '1px solid #3c4149' }} />NOT YET OBSERVED</span>}
          <span className="cap" style={{ marginLeft: 'auto' }}>HOVER A CELL FOR FULL CONDITIONS · CLICK A YEAR TO ISOLATE</span>
        </BandLegend>
      ) : (
        <div className="legend">
          <span className="item"><span className="sw" style={{ background: CO.act }} />AN ENABLED ACTIVITY IS POSSIBLE</span>
          <span className="item"><span className="sw" style={{ background: CO.actSnow }} />SNOW-SPORT DAY</span>
          <span className="item"><span className="sw" style={{ background: CO.actNone }} />NONE POSSIBLE</span>
          {ytdRow && <span className="item"><span className="sw" style={{ border: '1px solid #3c4149' }} />NOT YET OBSERVED</span>}
          <span className="cap" style={{ marginLeft: 'auto' }}>{sc ? 'ACTIVITY ENCODING · SEPARATE FROM COMFORT' : 'SET A PREFERENCE TO COLOUR BY COMFORT'}</span>
        </div>
      )}
      {hover && rows[hover.r] && <DayTip row={rows[hover.r]} d={hover.d} p={p} u={u} x={hover.x} y={hover.y} mode={mode} />}
    </div>
  )
}

function DayTip({ row, d, p, u, x, y, mode }: { row: Row; d: number; p: Prefs; u: Units; x: number; y: number; mode: 'comfort' | 'activity' }) {
  const s = row.series, sc = row.sc, j = row.j0 + d, i = row.scBase + d
  const t = row.terrain
  const depth = t ? t.depth[j - (t.startYear - FIRST_YEAR) * 365] : NaN
  const inp = { hi: s.high[j], lo: s.low[j], dew: s.dew[j], precip: s.precip[j], wind: s.wind[j], depth }
  const basisT = dayTemp(s, j, p)
  const left = Math.min(x + 14, window.innerWidth - 334), top = y + 16 + 230 > window.innerHeight ? y - 240 : y + 16
  const recent = row.ytd && row.observed - d <= 5
  return (
    <div className="floating" style={{ left, top }}>
      <div style={{ font: '600 12px/1.3 var(--sans)', marginBottom: 6 }}>
        {doyLabel(d)}, {row.year}{recent && <span className="mono" style={{ color: 'var(--dim)', fontWeight: 400 }}> · provisional</span>}
      </div>
      <div className="mono" style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 14px', color: 'var(--mid)' }}>
        <span>High / low</span><span style={{ color: 'var(--ink)' }}>{u.t(inp.hi)} / {u.t(inp.lo)}{u.tu}</span>
        {(p.sun === 'sun' || p.basis === 'apparent') && <><span>Scored temp</span><span style={{ color: 'var(--ink)' }}>{u.t(basisT)}{u.tu}</span></>}
        <span>Dew point</span><span style={{ color: 'var(--ink)' }}>{u.t(inp.dew)}{u.tu}</span>
        <span>Cloud cover</span><span style={{ color: 'var(--ink)' }}>{Math.round(s.cloud[j])}%</span>
        <span>Precip / snow</span><span style={{ color: 'var(--ink)' }}>{u.len(inp.precip)} / {u.len(s.snow[j], 1)}</span>
        <span>Max wind</span><span style={{ color: 'var(--ink)' }}>{u.speed(inp.wind)}</span>
        <span>Sunshine</span><span style={{ color: 'var(--ink)' }}>{Number.isNaN(s.sun[j]) ? '—' : `${s.sun[j].toFixed(1)} h`}</span>
        {t && <><span>Terrain snow</span><span style={{ color: 'var(--ink)' }}>{Number.isNaN(depth) ? '—' : u.depth(depth)}</span></>}
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
            const r = a.test(inp)
            return [<span key={a.id}>{a.name}</span>, <span key={a.id + 'r'} className="mono" style={{ color: r ? 'var(--dim)' : CO.act }}>{r ? `✕ ${LOSS_LABEL[r]}` : '✓'}</span>]
          })}
        </div>
      )}
    </div>
  )
}
