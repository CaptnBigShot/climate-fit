import { useEffect, useRef } from 'react'

/** While `open`, a mousedown outside `ref` or Escape anywhere calls `close`. */
export function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  const latest = useRef(close)
  useEffect(() => {
    latest.current = close
  })
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) latest.current()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latest.current()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', esc)
    }
  }, [open, ref])
}
