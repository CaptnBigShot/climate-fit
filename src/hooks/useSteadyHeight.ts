import { useEffect, useLayoutEffect, useRef } from 'react'

/** The margin that tops a bar of height `h` back up to its expanded height `full`. */
const slack = (full: number, h: number) => `${Math.max(0, full - h)}px`

/** The height the bar takes unconstrained: its rows (which never shrink, see .bar > *) plus borders. */
const naturalHeight = (el: HTMLElement) =>
  Array.from(el.children).reduce((h, c) => h + c.getBoundingClientRect().height, el.offsetHeight - el.clientHeight)

/**
 * Keep a sticky bar's footprint in the page at its expanded height, so collapsing it never pulls the
 * content up under the reader: collapsed, the height it gives up becomes a bottom margin. The height
 * change itself animates, anchored to the bar's bottom edge so its last row stays put.
 */
export function useSteadyHeight<T extends HTMLElement>(collapsed: boolean): React.RefObject<T | null> {
  const root = useRef<T>(null)
  const fullH = useRef(0) // the expanded bar's height — the room it holds in the page either way
  const shownH = useRef(0) // its last laid-out height, which is where a new animation starts from

  // Fonts loading, the window resizing or a row appearing all change the height without a collapse.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (el.getAnimations().length) return
      const h = el.getBoundingClientRect().height
      shownH.current = h
      if (!el.classList.contains('collapsed')) fullH.current = h
      el.style.marginBottom = slack(fullH.current, h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const hold = (h: number) => {
      el.style.height = `${h}px`
      el.style.marginBottom = slack(fullH.current, h)
    }
    // Hold the old height before anything reads layout. Any layout that sees the content move — even
    // one never painted — lets the browser's scroll anchoring shift the scroll position to match,
    // which near the top drops it under the collapse threshold and the bar flickers back open.
    if (shownH.current) hold(shownH.current)
    // Mid-animation, start from the height on screen (a running animation overrides the hold).
    const running = el.getAnimations()
    const from = running.length ? el.getBoundingClientRect().height : shownH.current
    if (running.length) hold(from)
    running.forEach((a) => a.cancel())
    const to = naturalHeight(el)
    if (!collapsed) fullH.current = to
    shownH.current = to
    el.style.height = ''
    el.style.marginBottom = slack(fullH.current, to)
    if (!from || Math.abs(from - to) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Height and margin move together, so their sum — the bar's footprint — holds on every frame.
    el.animate(
      [
        { height: `${from}px`, marginBottom: slack(fullH.current, from) },
        { height: `${to}px`, marginBottom: slack(fullH.current, to) },
      ],
      { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    )
  }, [collapsed])
  return root
}
