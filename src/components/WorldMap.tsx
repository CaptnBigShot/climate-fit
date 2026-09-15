// The city map: Natural Earth land on a lat/lon grid, cities as dots, labels placed
// greedily so they don't collide. Drag to pan; zoom with the buttons, a double-click,
// or a pinch / ctrl-scroll. A plain scroll is left to the page so the map never traps it.
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { loadLand, type Land } from '../lib/data'
import {
  LAT_BOT,
  LAT_TOP,
  MAX_ZOOM,
  WORLD,
  baseScale,
  clampView,
  fitView,
  zoomAt,
  type MapPoint,
  type View,
} from '../lib/mapView'
import { useWidth } from '../hooks/useWidth'

let landNow: Land | null = null
function useLand() {
  const [land, setLand] = useState(landNow)
  useEffect(() => {
    if (land) return
    let live = true
    loadLand()
      .then((l) => {
        landNow = l
        if (live) setLand(l)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [land])
  return land
}

type Box = { x0: number; y0: number; x1: number; y1: number }

export function WorldMap({
  points,
  onPick,
  label,
  frame,
  height,
  frameZoom = 4,
}: {
  points: MapPoint[]
  onPick: (id: string) => void
  label: string
  /** Places the home view frames; omitted, home is the whole world. */
  frame?: { lat: number; lon: number }[]
  /** Frame height in px; omitted, the frame keeps the world's proportions. */
  height?: number
  /** Furthest the home view zooms in to frame its places. */
  frameZoom?: number
}) {
  const land = useLand()
  const [ref, W] = useWidth<HTMLDivElement>()
  const svg = useRef<SVGSVGElement>(null)
  const H = height ?? (W * (LAT_TOP - LAT_BOT)) / 360
  const frameKey = frame?.map((p) => `${p.lat},${p.lon}`).join(' ') ?? ''
  const home = frame && W ? fitView(frame, W, H, frameZoom) : WORLD
  // A pan or zoom holds until the framed places change; then the view goes home again.
  const [moved, setMoved] = useState<{ key: string; v: View } | null>(null)
  const atHome = !moved || moved.key !== frameKey
  const v = clampView(atHome ? home : moved.v, W, H)
  const s = baseScale(W, H) * v.k
  const go = (nv: View) => setMoved({ key: frameKey, v: clampView(nv, W, H) })
  const local = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  const onWheel = useEffectEvent((e: WheelEvent) => {
    // A trackpad pinch arrives as a ctrl + wheel event.
    if (!(e.ctrlKey || e.metaKey) || !svg.current) return
    e.preventDefault()
    const dy = Math.max(-50, Math.min(50, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY))
    go(zoomAt(v, Math.exp(-dy * 0.01), ...local(e), W, H))
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = (e: WheelEvent) => onWheel(e)
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [ref])

  // A press becomes a drag only once it moves, so a click on a city still opens it.
  const drag = useRef<{ x: number; y: number; v: View; on: boolean } | null>(null)
  const dragged = useRef(false)

  const marks = useMemo(() => {
    if (!W) return []
    const sc = baseScale(W, H) * v.k
    const pts = points
      .map((p) => ({ ...p, x: (p.lon - v.lon) * sc + W / 2, y: (v.lat - p.lat) * sc + H / 2 }))
      .filter((p) => p.x > -p.r && p.x < W + p.r && p.y > -p.r && p.y < H + p.r)
    // Greedy label placement in the order given: beside the point, then stacked above it on a leader line.
    const boxes: Box[] = pts
      .filter((q) => q.label)
      .map((q) => ({ x0: q.x - q.r, y0: q.y - q.r, x1: q.x + q.r, y1: q.y + q.r }))
    const hit = (b: Box) =>
      b.x0 < 0 ||
      b.x1 > W ||
      b.y0 < 0 ||
      b.y1 > H ||
      boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)
    return pts.map((q) => {
      if (!q.label) return { ...q, placed: null }
      const text = q.label,
        tw = text.length * 5.5,
        th = 9
      const at = (dx: number, dy: number, anchor: 'start' | 'end') => {
        const x0 = anchor === 'start' ? q.x + dx : q.x + dx - tw
        return { x: q.x + dx, y: q.y + dy, anchor, box: { x0, y0: q.y + dy - th + 1, x1: x0 + tw, y1: q.y + dy + 2 } }
      }
      const tries = [
        at(q.r + 3, 3, 'start'),
        at(-q.r - 3, 3, 'end'),
        at(q.r + 2, -q.r - 2, 'start'),
        at(q.r + 2, q.r + 9, 'start'),
        at(-q.r - 2, -q.r - 2, 'end'),
        at(-q.r - 2, q.r + 9, 'end'),
      ]
      for (let k = 1; k <= 6; k++) tries.push(at(10, -q.r - 4 - 11 * k, 'start'), at(-10, -q.r - 4 - 11 * k, 'end'))
      const pick = tries.find((t) => !hit(t.box)) ?? tries[tries.length - 1]
      boxes.push(pick.box)
      return { ...q, placed: { ...pick, text, leader: Math.abs(pick.y - q.y) > q.r + 10 } }
    })
  }, [points, W, H, v.lon, v.lat, v.k])

  const grid = []
  if (W) {
    // The finest of 5°, 10°, 30° that leaves grid cells at least 36 px across.
    const step = [5, 10, 30].find((d) => d * s >= 36) ?? 30
    const lon0 = v.lon - W / 2 / s,
      lat0 = v.lat - H / 2 / s
    for (let lon = Math.ceil(lon0 / step) * step; lon <= lon0 + W / s; lon += step) {
      const x = (lon - lon0) * s
      grid.push(<line key={`v${lon}`} x1={x} x2={x} y1={0} y2={H} stroke="#23262c" strokeWidth={0.6} />)
    }
    for (let lat = Math.ceil(lat0 / step) * step; lat <= lat0 + H / s; lat += step) {
      const y = H - (lat - lat0) * s
      grid.push(
        <line
          key={`h${lat}`}
          x1={0}
          x2={W}
          y1={y}
          y2={y}
          stroke={lat === 0 ? '#2e333b' : '#23262c'}
          strokeWidth={0.6}
        />,
      )
    }
  }

  return (
    <div ref={ref} className="map">
      {W > 0 && (
        <>
          <svg
            ref={svg}
            width={W}
            height={H}
            className={v.k > 1 ? 'pannable' : undefined}
            style={{ touchAction: v.k > 1 ? 'none' : 'pan-y' }}
            role="img"
            aria-label={label}
            onPointerDown={(e) => {
              dragged.current = false
              if (e.button === 0) drag.current = { x: e.clientX, y: e.clientY, v, on: false }
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d) return
              const dx = e.clientX - d.x,
                dy = e.clientY - d.y
              if (!d.on) {
                if (Math.hypot(dx, dy) < 4) return
                d.on = true
                e.currentTarget.setPointerCapture(e.pointerId)
              }
              go({ ...d.v, lon: d.v.lon - dx / s, lat: d.v.lat + dy / s })
            }}
            onPointerUp={() => {
              dragged.current = !!drag.current?.on
              drag.current = null
            }}
            onPointerCancel={() => {
              drag.current = null
            }}
            onClickCapture={(e) => {
              if (dragged.current) e.stopPropagation()
            }}
            onDoubleClick={(e) => go(zoomAt(v, 2, ...local(e), W, H))}
          >
            {land && (
              <path
                d={land.d}
                fill="#1f2329"
                transform={`translate(${W / 2 - v.lon * s} ${H / 2 + v.lat * s}) scale(${s / land.scale})`}
              />
            )}
            {grid}
            {marks.map(
              (m) =>
                m.placed?.leader && (
                  <line
                    key={`l${m.id}`}
                    x1={m.x}
                    y1={m.y - m.r}
                    x2={m.placed.x}
                    y2={m.placed.y + 2}
                    stroke="#3c4149"
                    strokeWidth={0.8}
                  />
                ),
            )}
            {marks.map((m) => (
              <g key={m.id} onClick={() => onPick(m.id)} style={{ cursor: 'pointer' }} data-tip={m.tip}>
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={m.r}
                  fill={m.fill}
                  stroke={m.current ? '#e6e8ec' : m.label ? '#8b929e' : 'none'}
                  strokeWidth={m.current ? 1.5 : 0.8}
                />
                {m.placed && (
                  <text
                    x={m.placed.x}
                    y={m.placed.y}
                    textAnchor={m.placed.anchor}
                    fill={m.current ? '#e6e8ec' : '#a8aeb9'}
                    style={{ font: "400 9px 'JetBrains Mono', monospace" }}
                  >
                    {m.placed.text}
                  </text>
                )}
              </g>
            ))}
          </svg>
          <div
            className="map-zoom"
            data-tip="Zoom the map. Drag to pan; a double-click, pinch or ctrl-scroll zooms too. ⌂ returns to the starting view."
          >
            <button
              aria-label="Zoom in"
              disabled={v.k >= MAX_ZOOM}
              onClick={() => go(zoomAt(v, 2, W / 2, H / 2, W, H))}
            >
              +
            </button>
            <button aria-label="Zoom out" disabled={v.k <= 1} onClick={() => go(zoomAt(v, 0.5, W / 2, H / 2, W, H))}>
              −
            </button>
            <button aria-label="Reset the map view" disabled={atHome} onClick={() => setMoved(null)}>
              ⌂
            </button>
          </div>
        </>
      )}
    </div>
  )
}
