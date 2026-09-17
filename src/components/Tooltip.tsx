import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Gap between the tooltip and its anchor, and the least it may sit from a viewport edge. */
const GAP = 10

/** One shared tooltip for every element carrying a data-tip attribute. */
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; top: number; bottom: number } | null>(null)
  const [y, setY] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current: Element | null = null
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') ?? null
      if (el === current) return
      current = el
      // A control whose menu is open doesn't also need its tooltip covering the menu.
      const text = el?.getAttribute('aria-expanded') === 'true' ? null : el?.getAttribute('data-tip')
      if (!el || !text) {
        setTip(null)
        return
      }
      const r = el.getBoundingClientRect()
      const x = Math.max(GAP, Math.min(r.left, window.innerWidth - 334))
      setTip({ text, x, top: r.top, bottom: r.bottom })
      setY(r.bottom + GAP)
    }
    const hide = () => {
      current = null
      setTip(null)
    }
    document.addEventListener('mouseover', over, true)
    document.addEventListener('mousedown', hide, true)
    window.addEventListener('scroll', hide, { passive: true })
    return () => {
      document.removeEventListener('mouseover', over, true)
      document.removeEventListener('mousedown', hide, true)
      window.removeEventListener('scroll', hide)
    }
  }, [])

  // Place against the measured height rather than a guess: tooltips vary from one line to a
  // dozen, and a fixed estimate either wasted room or ran a long one off the bottom. Runs
  // before paint, so the box is never seen in the provisional position.
  useLayoutEffect(() => {
    const el = ref.current
    if (!tip || !el) return
    const h = el.offsetHeight
    const below = tip.bottom + GAP
    const fits = below + h <= window.innerHeight - GAP
    setY(Math.max(GAP, Math.min(fits ? below : tip.top - GAP - h, window.innerHeight - h - GAP)))
  }, [tip])

  if (!tip) return null
  return (
    <div ref={ref} className="floating" style={{ left: tip.x, top: y }}>
      {tip.text}
    </div>
  )
}
