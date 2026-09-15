import { useEffect, useMemo, useRef, useState } from 'react'
import type { CitySeries, TerrainSeries } from '../lib/data'
import { MN, MONTH_START, doyLabel, windowRows, type CalRow } from '../lib/calendar'
import { BAND_COLOR, CO, TEMP_DOMAIN, contColor, tempColor } from '../lib/colors'
import { ACTIVITIES, LOSS_LABEL, type Activity } from '../lib/activities'
import { BAND, REASONS, dayTemp, type Scored } from '../lib/scoring'
import { FIRST_YEAR, windowLabel, type Prefs } from '../lib/prefs'
import { YTD_YEAR, type Ytd } from '../lib/current'
import type { Units } from '../lib/units'
import { BandLegend, Head, Seg } from './ui'
import { useWidth } from '../hooks/useWidth'

const LEFT = 40, ROW = 13, GAP = 2.5, ISO_ROW = 34, AXIS = 18, YTD_SEP = 7

export type CalMode = 'comfort' | 'activity' | 'temp'
export type CalFill = 'banded' | 'continuous'

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

const dayInputs = (row: CalRow, d: number) => {
  const j = row.j0 + d, t = row.terrain
  return { hi: row.series.high[j], lo: row.series.low[j], dew: row.series.dew[j], precip: row.series.precip[j], wind: row.series.wind[j],
    depth: t ? t.depth[j - (t.startYear - FIRST_YEAR) * 365] : NaN }
}

/** Activity encoding per cell: 2 snow-sport day, 1 another enabled activity viable, 0 none. */
function actCode(row: CalRow, d: number, enabled: Activity[]) {
  const inp = dayInputs(row, d)
  let v = 0
  for (const a of enabled) if (a.test(inp) === 0) { if (a.id === 'ride') return 2; v = 1 }
  return v
}

function cellFill(row: CalRow, d: number, mode: CalMode, fill: CalFill, enabled: Activity[], hatch: CanvasPattern | string) {
  if (mode === 'temp') { const v = row.series.high[row.j0 + d]; return Number.isNaN(v) ? CO.unscored : tempColor(v) }
  if (mode === 'activity') { const a = actCode(row, d, enabled); return a === 2 ? CO.actSnow : a === 1 ? CO.act : CO.actNone }
  const i = row.scBase + d
  if (!row.sc) return CO.unscored
  if (row.sc.band[i] === BAND.unb) return row.sc.hard[i] ? hatch : fill === 'continuous' ? '#2a2e36' : CO.unb
  return fill === 'continuous' ? contColor(row.sc.score[i]) : BAND_COLOR[row.sc.band[i]]
}

interface PaintSpec {
  width: number
  rows: CalRow[]
  top: (k: number) => number
  rowH: number
  mode: CalMode
  fill: CalFill
  enabled: Activity[]
  /** Year label for row k, or null to leave the gutter empty. */
  label: (row: CalRow, k: number) => { color: string; bold?: boolean } | null
  hover: { r: number; d: number } | null
}

/** Cells, not-yet-observed outlines, band-edge contours, year labels and the hover outline. */
function paint(ctx: CanvasRenderingContext2D, dpr: number, o: PaintSpec) {
  const cw = (o.width - LEFT) / 365
  const hatch = hatchPattern(ctx, dpr)
  const cellW = Math.max(0.8, cw - 0.25)
  o.rows.forEach((row, k) => {
    const top = o.top(k)
    for (let d = 0; d < row.observed; d++) {
      ctx.fillStyle = cellFill(row, d, o.mode, o.fill, o.enabled, hatch)
      ctx.fillRect(LEFT + d * cw, top, cellW, o.rowH)
    }
    if (row.observed < 365) {
      // Not yet observed: an outline, never a colour — nothing is inferred for days that haven't happened.
      ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 1
      ctx.strokeRect(LEFT + row.observed * cw + 0.5, top + 0.5, (365 - row.observed) * cw - 1, o.rowH - 1)
      ctx.fillStyle = '#e6e8ec'
      ctx.fillRect(LEFT + row.observed * cw, top - 2, 1, o.rowH + 4)
      ctx.fillStyle = '#8b929e'; ctx.font = "400 9px 'JetBrains Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillText(`THROUGH ${doyLabel(row.observed - 1).toUpperCase()} · NOT YET OBSERVED`, LEFT + row.observed * cw + 6, top + o.rowH / 2 + 0.5)
    }
    if (o.mode === 'comfort' && o.fill === 'continuous' && row.sc) {
      ctx.fillStyle = 'rgba(230,232,236,.55)'
      for (let d = 1; d < row.observed; d++) {
        const i = row.scBase + d
        if (row.sc.band[i] !== row.sc.band[i - 1]) ctx.fillRect(LEFT + d * cw - 0.5, top, 1, o.rowH)
      }
    }
    const lab = o.label(row, k)
    if (lab) {
      ctx.fillStyle = lab.color
      ctx.font = `${lab.bold ? 600 : 400} 9px 'JetBrains Mono', monospace`
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
      ctx.fillText(String(row.year), LEFT - 7, top + o.rowH / 2)
    }
  })
  if (o.hover) {
    ctx.strokeStyle = '#e6e8ec'; ctx.lineWidth = 1
    ctx.strokeRect(LEFT + o.hover.d * cw - 0.5, o.top(o.hover.r) - 0.5, cellW + 1, o.rowH + 1)
  }
}

function sizeCanvas(cv: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1
  cv.width = Math.round(width * dpr); cv.height = Math.round(height * dpr)
  cv.style.width = `${width}px`; cv.style.height = `${height}px`
  const ctx = cv.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return { ctx, dpr }
}

export function ComfortCalendar({ s, sc, p, terrain, u, fill, setFill, ytd, ytdSc, terrainId, cityName }: {
  s: CitySeries; sc: Scored | null; p: Prefs; terrain: TerrainSeries | null; u: Units
  fill: CalFill; setFill: (v: CalFill) => void
  ytd: Ytd | null; ytdSc: Scored | null; terrainId: string | null; cityName: string
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  // Nothing to colour by comfort until a preference exists: the record is shown as measured instead.
  // Separate choices, so stating a preference always opens on the comfort colouring.
  const [scoredMode, setScoredMode] = useState<CalMode>('comfort')
  const [unsetMode, setUnsetMode] = useState<CalMode>('temp')
  const mode = sc ? scoredMode : unsetMode
  const setMode = sc ? setScoredMode : setUnsetMode
  const [isolate, setIsolate] = useState<number | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; r: number; d: number } | null>(null)

  const allRows = useMemo<CalRow[]>(() => {
    const rows = windowRows(s, sc, p.window, terrain)
    if (ytd && ytd.raw.days > 0) {
      rows.push({
        year: YTD_YEAR, series: ytd.sx, sc: ytdSc, scBase: 0, j0: (YTD_YEAR - FIRST_YEAR) * 365,
        terrain: terrainId ? ytd.tx[terrainId] ?? null : null, observed: ytd.raw.days, ytd: true,
      })
    }
    return rows
  }, [s, sc, p.window, terrain, ytd, ytdSc, terrainId])

  const iso = isolate !== null && isolate < allRows.length ? isolate : null
  const rows = iso === null ? allRows : [allRows[iso]]
  const rowH = iso === null ? ROW : ISO_ROW
  const hasYtdRow = rows.some((r) => r.ytd) && rows.length > 1
  const rowTop = (k: number) => k * (rowH + GAP) + (hasYtdRow && rows[k].ytd ? YTD_SEP : 0)
  const H = rows.length * (rowH + GAP) + (hasYtdRow ? YTD_SEP : 0) + AXIS
  const enabled = useMemo(() => ACTIVITIES.filter((a) => p.acts.includes(a.id)), [p.acts])

  useEffect(() => {
    const cv = canvas.current
    if (!cv || !width) return
    const { ctx, dpr } = sizeCanvas(cv, width, H)
    paint(ctx, dpr, {
      width, rows, top: rowTop, rowH, mode, fill, enabled, hover,
      label: (row) => ({ color: row.ytd || iso !== null ? '#e6e8ec' : '#7cc4ff', bold: row.ytd }),
    })
    const cw = (width - LEFT) / 365
    if (hasYtdRow) {
      const k = rows.findIndex((r) => r.ytd)
      ctx.fillStyle = '#2b2f36'
      ctx.fillRect(LEFT, rowTop(k) - YTD_SEP / 2 - 1, width - LEFT, 1)
    }
    ctx.fillStyle = '#5f6672'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = "400 9px 'JetBrains Mono', monospace"
    if (mode === 'comfort' && fill === 'continuous') ctx.fillText('FIT 0 → 100 · CONTOURS AT BAND EDGES', LEFT, H - 5)
    else MN.forEach((m, k) => ctx.fillText(m.toUpperCase(), LEFT + MONTH_START[k] * cw + 2, H - 5))
  }, [width, H, rows, rowH, iso, mode, fill, hover, hasYtdRow, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const win = `${windowLabel(p.window)}${ytdRow ? ` + ${YTD_YEAR} so far` : ''}`
  const modes = sc
    ? [{ v: 'comfort' as CalMode, label: 'COMFORT' }, { v: 'activity' as CalMode, label: 'ACTIVITY' }, { v: 'temp' as CalMode, label: 'TEMPERATURE' }]
    : [{ v: 'temp' as CalMode, label: 'TEMPERATURE' }, { v: 'activity' as CalMode, label: 'ACTIVITY' }]
  const notYet = ytdRow && <span className="item"><span className="sw" style={{ border: '1px solid #3c4149' }} />NOT YET OBSERVED</span>

  return (
    <div className="section">
      <div className="section-head">
        {mode === 'temp' ? (
          <>
            <Head tip="Every observed day coloured by its daily high on one fixed temperature scale, the same for every city. This is the record as measured: no preference is involved, so no colour here means good or bad.">{cityName} AS MEASURED</Head>
            <span className="sub">daily high · one cell = one observed day · temperature ramp, not a comfort ramp · {win}</span>
          </>
        ) : (
          <>
            <Head tip={`One cell per observed day, no averaging — rows are years, columns are days of the year. This is where you see whether the good days cluster or scatter, and whether the pattern is drifting. The ${YTD_YEAR} row below the line is the year so far: it is shown, never averaged into the window. Click a year label to isolate it.`}>{mode === 'activity' ? 'ACTIVITY CALENDAR' : 'COMFORT CALENDAR'}</Head>
            <span className="sub">one cell = one observed day · no aggregation · {win}</span>
          </>
        )}
        {iso !== null && <button className="link-btn" style={{ background: 'var(--accent)', color: 'var(--bg)' }} onClick={() => setIsolate(null)}>{allRows[iso].year} ISOLATED · CLEAR ✕</button>}
        <div className="right">
          {mode === 'temp' && <TempLegend u={u} />}
          {mode === 'comfort' && <Seg small value={fill} onChange={setFill} options={[{ v: 'banded', label: 'BANDED' }, { v: 'continuous', label: 'CONTINUOUS' }]} />}
          <Seg small label="Calendar colouring" value={mode} onChange={setMode} options={modes} />
        </div>
      </div>
      <div ref={wrapRef}>
        <canvas ref={canvas} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick} style={{ display: 'block' }} />
      </div>
      {mode === 'comfort' && (
        <BandLegend>
          {notYet}
          <span className="cap" style={{ marginLeft: 'auto' }}>HOVER A CELL FOR FULL CONDITIONS · CLICK A YEAR TO ISOLATE</span>
        </BandLegend>
      )}
      {mode === 'activity' && (
        <div className="legend">
          <span className="item"><span className="sw" style={{ background: CO.act }} />AN ENABLED ACTIVITY IS POSSIBLE</span>
          <span className="item"><span className="sw" style={{ background: CO.actSnow }} />SNOW-SPORT DAY</span>
          <span className="item"><span className="sw" style={{ background: CO.actNone }} />NONE POSSIBLE</span>
          {notYet}
          <span className="cap" style={{ marginLeft: 'auto' }}>ACTIVITY ENCODING · SEPARATE FROM COMFORT</span>
        </div>
      )}
      {mode === 'temp' && (
        <div className="legend">
          <span className="prose" style={{ fontSize: 11, color: 'var(--dim)' }}>
            No cell here means good or bad. Banding applies only to the derived comfort score, never to observed data, and this ramp is deliberately unlike the comfort one so the two can never be confused.
          </span>
          {notYet}
        </div>
      )}
      {hover && rows[hover.r] && <DayTip row={rows[hover.r]} d={hover.d} p={p} u={u} x={hover.x} y={hover.y} mode={mode} />}
    </div>
  )
}

/** A compact calendar for one city — Compare stacks several on a shared day-of-year axis. */
export function CalendarStrip({ rows, p, u, mode, fill }: { rows: CalRow[]; p: Prefs; u: Units; mode: CalMode; fill: CalFill }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; r: number; d: number } | null>(null)
  // Keep every city's block about the same height whatever the window length.
  const gap = rows.length > 12 ? 1 : 2
  const rowH = Math.max(2, Math.min(11, Math.floor(130 / rows.length) - gap))
  // Thin rows need headroom so the first and last year labels aren't clipped.
  const pad = rowH < 9 ? 4 : 0
  const top = (k: number) => pad + k * (rowH + gap)
  const H = rows.length * (rowH + gap) + 2 * pad
  const enabled = useMemo(() => ACTIVITIES.filter((a) => p.acts.includes(a.id)), [p.acts])

  useEffect(() => {
    const cv = canvas.current
    if (!cv || !width) return
    const { ctx, dpr } = sizeCanvas(cv, width, H)
    paint(ctx, dpr, {
      width, rows, top, rowH, mode, fill, enabled, hover,
      label: (row, k) => (rowH >= 8 || k === 0 || k === rows.length - 1 || row.year % 5 === 0 ? { color: '#5f6672' } : null),
    })
  }, [width, H, rows, rowH, mode, fill, hover, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (e: React.MouseEvent) => {
    const rect = canvas.current!.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    const r = Math.floor((y - pad) / (rowH + gap))
    if (x < LEFT || y < pad || r < 0 || r >= rows.length) { setHover(null); return }
    setHover({ x: e.clientX, y: e.clientY, r, d: Math.min(364, Math.floor(((x - LEFT) / (width - LEFT)) * 365)) })
  }
  return (
    <div ref={wrapRef}>
      <canvas ref={canvas} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block', cursor: 'crosshair' }} />
      {hover && rows[hover.r] && <DayTip row={rows[hover.r]} d={hover.d} p={p} u={u} x={hover.x} y={hover.y} mode={mode} />}
    </div>
  )
}

/** The month axis under a stack of CalendarStrips, aligned to their cells. */
export function MonthAxis() {
  const [ref, width] = useWidth<HTMLDivElement>()
  const cw = (width - LEFT) / 365
  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={14} style={{ display: 'block' }}>
          {MN.map((m, k) => <text key={m} x={LEFT + MONTH_START[k] * cw + 2} y={10} fill="#5f6672" style={{ font: "400 9px 'JetBrains Mono', monospace" }}>{m.toUpperCase()}</text>)}
        </svg>
      )}
    </div>
  )
}

/** Key for the raw temperature ramp, labelled as temperature in the current units. */
export function TempLegend({ u }: { u: Units }) {
  const W = 250, N = 50, [lo, hi] = TEMP_DOMAIN
  const ticks = [10, 40, 70, 100]
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
      <span className="cap" style={{ paddingBottom: 12 }}>TEMPERATURE {u.tu}</span>
      <svg width={W} height={23} style={{ display: 'block' }} aria-label={`Temperature scale ${u.t(lo)} to ${u.t(hi)}${u.tu}`}>
        {Array.from({ length: N }, (_, i) => <rect key={i} x={i * (W / N)} width={W / N + 0.6} height={9} fill={tempColor(lo + ((hi - lo) * i) / (N - 1))} />)}
        {ticks.map((v) => (
          <text key={v} x={((v - lo) / (hi - lo)) * W} y={21} textAnchor={v === lo ? 'start' : v === hi ? 'end' : 'middle'} fill="#5f6672" style={{ font: "400 9px 'JetBrains Mono', monospace" }}>{u.t(v)}°</text>
        ))}
      </svg>
    </div>
  )
}

function DayTip({ row, d, p, u, x, y, mode }: { row: CalRow; d: number; p: Prefs; u: Units; x: number; y: number; mode: CalMode }) {
  const s = row.series, sc = row.sc, j = row.j0 + d, i = row.scBase + d
  const inp = dayInputs(row, d)
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
        {mode === 'comfort' && (p.sun === 'sun' || p.basis === 'apparent') && <><span>Scored temp</span><span style={{ color: 'var(--ink)' }}>{u.t(basisT)}{u.tu}</span></>}
        <span>Dew point</span><span style={{ color: 'var(--ink)' }}>{u.t(inp.dew)}{u.tu}</span>
        <span>Cloud cover</span><span style={{ color: 'var(--ink)' }}>{Math.round(s.cloud[j])}%</span>
        <span>Precip / snow</span><span style={{ color: 'var(--ink)' }}>{u.len(inp.precip)} / {u.len(s.snow[j], 1)}</span>
        <span>Max wind</span><span style={{ color: 'var(--ink)' }}>{u.speed(inp.wind)}</span>
        <span>Sunshine</span><span style={{ color: 'var(--ink)' }}>{Number.isNaN(s.sun[j]) ? '—' : `${s.sun[j].toFixed(1)} h`}</span>
        {row.terrain && <><span>Terrain snow</span><span style={{ color: 'var(--ink)' }}>{Number.isNaN(inp.depth) ? '—' : u.depth(inp.depth)}</span></>}
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
