// Every place a city is chosen: a search box over a capped, scrolling list. Type to
// filter, arrows to move, Enter to pick. A few hundred rows render whole — cheaper
// and simpler than virtualising — and the filter is a scan over pre-folded keys.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CITIES, cityById, type CityMeta } from '../lib/data'
import { searchCities } from '../lib/citySearch'
import { useDismiss } from '../hooks/useDismiss'

const country = (c: CityMeta) => c.region.split(' · ').pop()

export function CityList({ onPick, current, exclude, note, autoFocus = true }: {
  onPick: (id: string) => void
  current?: string
  exclude?: readonly string[]
  /** Right-hand note per row; null falls back to the country. */
  note?: (c: CityMeta) => string | null
  autoFocus?: boolean
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => searchCities(query, exclude), [query, exclude])
  const [active, setActive] = useState(() => Math.max(0, matches.findIndex((c) => c.id === current)))
  const at = Math.min(active, matches.length - 1)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()

  // Keep the highlighted row in view by scrolling the list only — scrollIntoView would drag the page too.
  // On open it's centred, so the current city shows with its neighbours either side.
  const opened = useRef(false)
  useEffect(() => {
    const box = list.current, el = box?.children[at] as HTMLElement | undefined
    if (!box || !el) return
    if (!opened.current) { opened.current = true; box.scrollTop = el.offsetTop - (box.clientHeight - el.offsetHeight) / 2 }
    else if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight
  }, [at, matches])

  const onKey = (e: React.KeyboardEvent) => {
    const n = matches.length
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
      e.preventDefault()
      setActive((at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
    } else if (e.key === 'Enter' && matches[at]) {
      e.preventDefault()
      onPick(matches[at].id)
    }
  }

  return (
    <div className="city-list">
      <input className="city-search" autoFocus={autoFocus} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0) }} onKeyDown={onKey}
        placeholder={`Search ${CITIES.length - (exclude?.length ?? 0)} cities…`} spellCheck={false} autoComplete="off"
        role="combobox" aria-label="Search cities" aria-autocomplete="list" aria-expanded aria-controls={`${id}-list`}
        aria-activedescendant={matches[at] ? `${id}-${matches[at].id}` : undefined} />
      <div className="city-opts" role="listbox" id={`${id}-list`} ref={list}>
        {matches.map((c, i) => (
          <button key={c.id} id={`${id}-${c.id}`} role="option" aria-selected={i === at} tabIndex={-1}
            className={`pop-item city-opt${c.id === current ? ' cur' : ''}${i === at ? ' on' : ''}`}
            onMouseMove={() => i !== at && setActive(i)} onClick={() => onPick(c.id)}>
            <span className="name">{c.name}, {c.code}</span>
            <span className="note">{note?.(c) ?? country(c)}</span>
          </button>
        ))}
      </div>
      {!matches.length && <div className="city-none">No city matches “{query.trim()}”.</div>}
    </div>
  )
}

/** A select-sized button that opens the searchable list, for a city picked inline in a toolbar. */
export function CitySelect({ value, onChange, label, align = 'left', style }: {
  value: string; onChange: (id: string) => void; label: string; align?: 'left' | 'right'; style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useDismiss(open, root, () => setOpen(false))
  const c = cityById(value)
  return (
    <div className="city-select" ref={root}>
      <button ref={btn} className="ctl" style={style} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${c?.name ?? value}`} onClick={() => setOpen(!open)}>
        {c ? `${c.name}, ${c.code}` : value}<span className="caret">▾</span>
      </button>
      {open && (
        <div className="pop" style={{ [align]: 0, width: 280 }}>
          <CityList current={value} onPick={(id) => { onChange(id); setOpen(false); btn.current?.focus() }} />
        </div>
      )}
    </div>
  )
}
