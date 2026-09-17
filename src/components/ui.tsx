import type { ReactNode } from 'react'
import { CO } from '../lib/colors'
import { ols } from '../lib/stats'
import type { Budget } from '../lib/aggregate'

export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  small,
  label,
}: {
  options: readonly T[] | { v: T; label: string }[]
  value: T
  onChange: (v: T) => void
  small?: boolean
  label?: string
}) {
  const opts = (options as (T | { v: T; label: string })[]).map((o) =>
    typeof o === 'object' ? o : { v: o, label: String(o) },
  )
  return (
    <div className={small ? 'seg sm' : 'seg'} role="group" aria-label={label}>
      {opts.map((o) => (
        <button key={String(o.v)} aria-pressed={o.v === value} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Star toggle for a table row. Neutral ink, not a band or activity colour: a star is not a score. */
export function StarButton({ on, name, onClick }: { on: boolean; name: string; onClick: () => void }) {
  return (
    <button
      className={on ? 'star-btn on' : 'star-btn'}
      aria-pressed={on}
      aria-label={`Star ${name}`}
      data-tip={on ? `Unstar ${name}` : `Star ${name}`}
      onClick={onClick}
    >
      {on ? '★' : '☆'}
    </button>
  )
}

/** Small caps label; with a tip it gets the dotted underline and the shared hover tooltip. */
export function Cap({
  children,
  tip,
  color,
  style,
}: {
  children: ReactNode
  tip?: string
  color?: string
  style?: React.CSSProperties
}) {
  return (
    <span className={tip ? 'cap tip' : 'cap'} data-tip={tip} style={{ color, alignSelf: 'flex-start', ...style }}>
      {children}
    </span>
  )
}

export function Head({ children, tip, small }: { children: ReactNode; tip?: string; small?: boolean }) {
  return (
    <span className={`${small ? 'h-sm' : 'h'}${tip ? ' tip' : ''}`} data-tip={tip}>
      {children}
    </span>
  )
}

/** Straight-segment sparkline with the OLS fit dashed over it. */
export function Spark({ ys, w, h, color }: { ys: number[]; w: number; h: number; color: string }) {
  if (ys.length < 2) return <svg width={w} height={h} />
  const mn = Math.min(...ys),
    mx = Math.max(...ys),
    sp = mx - mn || 1
  const x = (i: number) => (i / (ys.length - 1)) * w
  const y = (v: number) => h - 2 - ((v - mn) / sp) * (h - 6)
  const fit = ols(ys)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', flex: 'none' }}>
      <polyline
        points={ys.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
      />
      <line
        x1={0}
        y1={y(fit.intercept)}
        x2={w}
        y2={y(fit.intercept + fit.slope * (ys.length - 1))}
        stroke="#e6e8ec"
        strokeWidth={0.9}
        strokeDasharray="3 2"
      />
    </svg>
  )
}

/** A one-line day budget for tables: the same three bands as the hero bar, unlabelled. */
export function SplitBar({ b, width, height = 9 }: { b: Budget; width: number; height?: number }) {
  const x = (v: number) => (v / 365) * width
  const [c, t, un] = b.counts
  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block', flex: 'none', shapeRendering: 'crispEdges' }}
      data-tip={`${Math.round(c)} comfortable · ${Math.round(t)} tolerable · ${Math.round(un)} unbearable days/yr`}
    >
      <rect width={x(c)} height={height} fill={CO.comf} />
      <rect x={x(c)} width={x(t)} height={height} fill={CO.tol} />
      <rect x={x(c + t)} width={x(un)} height={height} fill={CO.unb} />
    </svg>
  )
}

/** Days per year as a share of 365, on an empty track. Amber = the activity encoding. */
export function DaysBar({
  days,
  width,
  height = 8,
  color = CO.act,
}: {
  days: number
  width: number
  height?: number
  color?: string
}) {
  return (
    <svg width={width} height={height} style={{ display: 'block', flex: 'none', shapeRendering: 'crispEdges' }}>
      <rect width={width} height={height} fill="#1c1f25" />
      <rect width={Math.max(0, Math.min(1, days / 365)) * width} height={height} fill={color} />
    </svg>
  )
}

export function BandLegend({ children }: { children?: ReactNode }) {
  return (
    <div className="legend">
      <span className="item">
        <span className="sw" style={{ background: CO.comf }} />
        COMFORTABLE
      </span>
      <span className="item">
        <span className="sw" style={{ background: CO.tol }} />
        TOLERABLE
      </span>
      <span className="item">
        <span className="sw" style={{ background: CO.unb }} />
        UNBEARABLE
      </span>
      {children}
    </div>
  )
}
