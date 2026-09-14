import { useEffect, useState } from 'react'

/** One shared tooltip for every element carrying a data-tip attribute. */
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  useEffect(() => {
    let current: Element | null = null
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') ?? null
      if (el === current) return
      current = el
      // A control whose menu is open doesn't also need its tooltip covering the menu.
      const text = el?.getAttribute('aria-expanded') === 'true' ? null : el?.getAttribute('data-tip')
      if (!el || !text) { setTip(null); return }
      const r = el.getBoundingClientRect()
      const x = Math.max(10, Math.min(r.left, window.innerWidth - 334))
      const below = r.bottom + 10
      setTip({ text, x, y: below + 150 > window.innerHeight ? Math.max(10, r.top - 150) : below })
    }
    const hide = () => { current = null; setTip(null) }
    document.addEventListener('mouseover', over, true)
    document.addEventListener('mousedown', hide, true)
    window.addEventListener('scroll', hide, { passive: true })
    return () => {
      document.removeEventListener('mouseover', over, true)
      document.removeEventListener('mousedown', hide, true)
      window.removeEventListener('scroll', hide)
    }
  }, [])
  if (!tip) return null
  return <div className="floating" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>
}
