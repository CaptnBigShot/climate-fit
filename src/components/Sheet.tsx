// A bottom sheet for phones: what the desktop shows in a popover or a menu opens here instead.
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Sheet({
  open,
  title,
  onClose,
  children,
  tall,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Nearly full height, for long content such as settings or a searchable list. */
  tall?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const latest = useRef(onClose)
  useEffect(() => {
    latest.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const back = document.activeElement as HTMLElement | null
    box.current?.focus()
    // The page behind a sheet stays put: no scrolling it by accident through the scrim.
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latest.current()
    }
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = overflow
      back?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div
      className="m-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={box}
        className={tall ? 'm-sheet tall' : 'm-sheet'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="m-grabber" aria-hidden="true" />
        <div className="m-sheet-head">
          <span className="h">{title}</span>
          <button className="btn m-done" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="m-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
