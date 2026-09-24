import { useSyncExternalStore } from 'react'

/** Phone widths. Must match the `max-width` of the phone block at the end of styles.css. */
const QUERY = '(max-width: 760px)'

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const snapshot = () => window.matchMedia(QUERY).matches

/** True on phone-width screens, where the app swaps its control bar for the phone layout. */
export function useMobile(): boolean {
  return useSyncExternalStore(subscribe, snapshot)
}
