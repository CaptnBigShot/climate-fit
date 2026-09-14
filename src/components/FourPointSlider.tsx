import { useRef } from 'react'
import { CO } from '../lib/colors'
import { T_MAX, T_MIN, type TempBand } from '../lib/prefs'
import { SOFT } from '../lib/scoring'

type Handle = 'hardMin' | 'idealMin' | 'idealMax' | 'hardMax'

/** Four-point ramp slider: hard floor · ideal min · ideal max · hard ceiling.
 *  Drag a hard handle off either end of the track to make that bound open (±∞).
 *  With value null (unset) both ideal handles rest at the track ends; dragging
 *  either one states a preference — the app never proposes a starting band. */
export function FourPointSlider({ value, onChange, hardEditable = true, label, fixedHard }: {
  value: TempBand | null
  onChange: (b: TempBand) => void
  hardEditable?: boolean
  label: string
  /** Hard bounds shown as ticks but not draggable (seasonal cold band shares the main bounds). */
  fixedHard?: { hardMin: number | null; hardMax: number | null }
}) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<Handle | null>(null)
  const span = T_MAX - T_MIN
  const pct = (v: number) => ((Math.max(T_MIN, Math.min(T_MAX, v)) - T_MIN) / span) * 100
  const b: TempBand = value ?? { hardMin: null, idealMin: T_MIN, idealMax: T_MAX, hardMax: null }
  const hMin = fixedHard ? fixedHard.hardMin : b.hardMin
  const hMax = fixedHard ? fixedHard.hardMax : b.hardMax

  const valueAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.round(T_MIN + ((clientX - r.left) / r.width) * span)
  }

  const apply = (h: Handle, raw: number) => {
    const n: TempBand = { ...b }
    const v = Math.max(T_MIN, Math.min(T_MAX, raw))
    if (h === 'idealMin') {
      n.idealMin = Math.min(v, n.idealMax - 2)
      if (n.hardMin !== null) n.hardMin = Math.min(n.hardMin, n.idealMin - 1)
    } else if (h === 'idealMax') {
      n.idealMax = Math.max(v, n.idealMin + 2)
      if (n.hardMax !== null) n.hardMax = Math.max(n.hardMax, n.idealMax + 1)
    } else if (h === 'hardMin') {
      n.hardMin = raw <= T_MIN ? null : Math.min(v, n.idealMin - 1)
    } else {
      n.hardMax = raw >= T_MAX ? null : Math.max(v, n.idealMax + 1)
    }
    onChange(n)
  }

  const nearest = (v: number): Handle => {
    const cands: [Handle, number][] = [['idealMin', b.idealMin], ['idealMax', b.idealMax]]
    if (hardEditable && value) {
      if (b.hardMin !== null) cands.push(['hardMin', b.hardMin])
      if (b.hardMax !== null) cands.push(['hardMax', b.hardMax])
    }
    return cands.sort((x, y) => Math.abs(x[1] - v) - Math.abs(y[1] - v))[0][0]
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const target = (e.target as HTMLElement).dataset.handle as Handle | undefined
    const v = valueAt(e.clientX)
    drag.current = target ?? nearest(v)
    try { ref.current!.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    if (!target) apply(drag.current, v)
  }
  const onPointerMove = (e: React.PointerEvent) => { if (drag.current) apply(drag.current, valueAt(e.clientX)) }
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId)
  }

  const onKey = (h: Handle) => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 1
    const cur = b[h] ?? (h === 'hardMin' ? T_MIN : T_MAX)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { apply(h, cur - step); e.preventDefault() }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { apply(h, cur + step); e.preventDefault() }
  }

  const handle = (h: Handle, v: number, cls: string, name: string) => (
    <button
      key={h} data-handle={h} className={`fp-h ${cls}`} style={{ left: `${pct(v)}%` }}
      role="slider" aria-label={`${label} ${name}`} aria-valuemin={T_MIN} aria-valuemax={T_MAX} aria-valuenow={v}
      onKeyDown={onKey(h)}
    />
  )

  const segs = []
  if (value) {
    segs.push(<div key="i" className="fp-seg" style={{ left: `${pct(b.idealMin)}%`, width: `${pct(b.idealMax) - pct(b.idealMin)}%`, background: CO.comf }} />)
    const hiEnd = hMax ?? b.idealMax + SOFT.temp
    segs.push(<div key="rh" className="fp-seg" style={{ left: `${pct(b.idealMax)}%`, width: `${pct(hiEnd) - pct(b.idealMax)}%`,
      background: `linear-gradient(90deg, ${CO.comf}, ${hMax === null ? 'transparent' : CO.unb})` }} />)
    const loEnd = hMin ?? b.idealMin - SOFT.temp
    segs.push(<div key="rl" className="fp-seg" style={{ left: `${pct(loEnd)}%`, width: `${pct(b.idealMin) - pct(loEnd)}%`,
      background: `linear-gradient(90deg, ${hMin === null ? 'transparent' : CO.unb}, ${CO.comf})` }} />)
    if (fixedHard) {
      if (hMax !== null) segs.push(<div key="tx" className="fp-seg" style={{ left: `${pct(hMax)}%`, width: 1, top: 2, height: 14, background: CO.warn }} />)
      if (hMin !== null) segs.push(<div key="tn" className="fp-seg" style={{ left: `${pct(hMin)}%`, width: 1, top: 2, height: 14, background: CO.accent }} />)
    }
  }

  return (
    <div ref={ref} className={value ? 'fp' : 'fp unset'} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="fp-track" />
      {segs}
      {value && hardEditable && b.hardMin !== null && handle('hardMin', b.hardMin, 'hard-min', 'hard floor')}
      {value && hardEditable && b.hardMax !== null && handle('hardMax', b.hardMax, 'hard-max', 'hard ceiling')}
      {handle('idealMin', b.idealMin, value ? 'ideal' : 'ghost', 'ideal minimum')}
      {handle('idealMax', b.idealMax, value ? 'ideal' : 'ghost', 'ideal maximum')}
    </div>
  )
}
