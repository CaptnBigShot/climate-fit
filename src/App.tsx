import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  CITIES,
  cityById,
  loadCity,
  loadManifest,
  loadTerrain,
  type CitySeries,
  type Manifest,
  type TerrainSeries,
} from './lib/data'
import { DEFAULT_PREFS, type Prefs } from './lib/prefs'
import { seasonWeights } from './lib/scoring'
import { buildModel, fitOf, outdoorOf, type CityRow, type Fit, type Outdoor } from './lib/model'
import { units } from './lib/units'
import { decodeSession, sessionSearch, type Session, type View } from './lib/session'
import { toggleCompare } from './lib/compare'
import type { DiscoverQuery } from './lib/discover'
import { ControlBar } from './components/ControlBar'
import { CityView } from './components/CityView'
import { Compare } from './components/Compare'
import { Discover } from './components/Discover'
import { MethodsPage } from './components/Methods'
import { Tooltip } from './components/Tooltip'
import { extend, loadYtdRaw, scoreYtd } from './lib/current'
import type { YtdRaw } from './lib/ytd'

const readUrl = () => decodeSession(new URLSearchParams(window.location.search))

export default function App() {
  const [session, setSession] = useState<Session>(readUrl)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [series, setSeries] = useState<Record<string, CitySeries>>({})
  const [terrains, setTerrains] = useState<Record<string, TerrainSeries>>({})
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [calFill, setCalFill] = useState<'banded' | 'continuous'>('banded')

  // URL is the persistence layer. Throttled: browsers rate-limit replaceState, and a drag fires dozens of changes a second.
  // Moving to another screen or city adds a history entry, so Back works; everything else replaces the current one.
  const urlTimer = useRef<number | undefined>(undefined)
  const shown = useRef({ view: session.view, city: session.city })
  useEffect(() => {
    window.clearTimeout(urlTimer.current)
    urlTimer.current = window.setTimeout(() => {
      const url = `${window.location.pathname}?${sessionSearch(session)}`
      if (url === window.location.pathname + window.location.search) return
      const moved = shown.current.view !== session.view || shown.current.city !== session.city
      shown.current = { view: session.view, city: session.city }
      if (moved) window.history.pushState(null, '', url)
      else window.history.replaceState(null, '', url)
    }, 200)
  }, [session])
  useEffect(() => {
    const onPop = () => {
      const s = readUrl()
      shown.current = { view: s.view, city: s.city }
      setSession(s)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // A new screen starts at its top.
  const firstView = useRef(true)
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false
      return
    }
    window.scrollTo(0, 0)
  }, [session.view])

  const cityMeta = cityById(session.city)!
  useEffect(() => {
    let live = true
    Promise.all([
      loadManifest(),
      loadCity(cityMeta.id),
      Promise.all(cityMeta.terrain.map(([id]) => loadTerrain(id).catch(() => null))),
    ])
      .then(([mf, cs, ts]) => {
        if (!live) return
        setManifest(mf)
        setSeries((prev) => ({ ...prev, [cs.id]: cs }))
        setTerrains((prev) => {
          const n = { ...prev }
          ts.forEach((t) => {
            if (t) n[t.id] = t
          })
          return n
        })
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [cityMeta])

  // Every other city: straight away on a screen that ranks or compares them, otherwise once the
  // first city is on screen — so switching is instant and the city picker can show each count.
  const firstLoaded = Object.keys(series).length > 0
  const needAll = session.view !== 'city'
  useEffect(() => {
    if (!firstLoaded && !needAll) return
    const run = () => {
      for (const c of CITIES) {
        loadCity(c.id)
          .then((cs) => setSeries((prev) => (prev[cs.id] ? prev : { ...prev, [cs.id]: cs })))
          .catch((e: Error) => setFailed((prev) => ({ ...prev, [c.id]: e.message })))
        for (const [tid] of c.terrain)
          loadTerrain(tid)
            .then((t) => setTerrains((prev) => (prev[t.id] ? prev : { ...prev, [t.id]: t })))
            .catch(() => undefined)
      }
    }
    if (needAll) run()
    else (window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300)))(run)
  }, [firstLoaded, needAll])

  // Current partial year: fetched after the city is on screen; the dashboard never waits for it.
  const [ytdRaw, setYtdRaw] = useState<{ id: string; raw: YtdRaw; source: 'live' | 'snapshot' } | null>(null)
  const [ytdError, setYtdError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    loadYtdRaw(cityMeta)
      .then((r) => live && setYtdRaw({ id: cityMeta.id, ...r }))
      .catch((e: Error) => live && setYtdError(e.message))
    return () => {
      live = false
    }
  }, [cityMeta])

  const p = session.prefs
  const u = useMemo(() => units(p.metric), [p.metric])
  const set = useCallback((patch: Partial<Prefs>) => setSession((s) => ({ ...s, prefs: { ...s.prefs, ...patch } })), [])
  const reset = useCallback(
    () =>
      setSession((s) => ({
        ...s,
        prefs: { ...structuredClone(DEFAULT_PREFS), metric: s.prefs.metric, window: s.prefs.window },
      })),
    [],
  )
  const setView = useCallback((view: View) => setSession((s) => ({ ...s, view })), [])
  const openCity = useCallback((id: string) => {
    setError(null)
    setYtdError(null)
    setSession((s) => ({ ...s, city: id, view: 'city' }))
  }, [])
  const openMethods = useCallback(() => setView('methods'), [setView])
  const setCmp = useCallback((cmp: string[]) => setSession((s) => ({ ...s, cmp })), [])
  const setDisc = useCallback(
    (patch: Partial<DiscoverQuery>) => setSession((s) => ({ ...s, disc: { ...s.disc, ...patch } })),
    [],
  )

  const s = series[cityMeta.id]
  const onCity = session.view === 'city'
  const model = useMemo(
    () => (s && onCity ? buildModel(cityMeta, s, terrains, p, (f) => u.t(f), u.tu) : null),
    [cityMeta, s, terrains, p, u, onCity],
  )
  const warmMonths = useMemo(
    () => model?.warmMonths ?? (s ? seasonWeights(s, p.window).warmMonths : null),
    [model, s, p.window],
  )

  const ytd = useMemo(
    () => (s && ytdRaw?.id === cityMeta.id ? extend(s, terrains, ytdRaw.raw, ytdRaw.source) : null),
    [s, terrains, ytdRaw, cityMeta.id],
  )
  const ytdSc = useMemo(() => (ytd && s && onCity ? scoreYtd(ytd, s, p, p.window) : null), [ytd, s, p, onCity])

  // Every loaded city on the session state, for Compare, Discover, the opening ranking and the
  // city picker. Deferred, so a dragged handle stays live while the rest of the set catches up.
  const dp = useDeferredValue(p)
  const fits = useMemo(() => {
    const out: Record<string, Fit | null> = {}
    for (const c of CITIES) if (series[c.id]) out[c.id] = fitOf(series[c.id], dp)
    return out
  }, [series, dp])
  const outdoors = useMemo(() => {
    const out: Record<string, Outdoor> = {}
    for (const c of CITIES)
      if (series[c.id]) out[c.id] = outdoorOf(c, series[c.id], terrains, dp.window, dp.acts, dp.drive)
    return out
  }, [series, terrains, dp.window, dp.acts, dp.drive])
  const rows = useMemo<CityRow[]>(
    () =>
      CITIES.filter((c) => series[c.id]).map((c) => ({
        city: c,
        s: series[c.id],
        fit: fits[c.id] ?? null,
        out: outdoors[c.id],
      })),
    [series, fits, outdoors],
  )
  const comfByCity = useMemo(
    () => Object.fromEntries(CITIES.map((c) => [c.id, fits[c.id] ? Math.round(fits[c.id]!.b.counts[0]) : null])),
    [fits],
  )

  return (
    <>
      <ControlBar
        prefs={p}
        set={set}
        reset={reset}
        city={cityMeta}
        setCity={openCity}
        u={u}
        warmMonths={warmMonths}
        calFill={calFill}
        setCalFill={setCalFill}
        comfByCity={comfByCity}
        view={session.view}
        setView={setView}
        cmpCount={session.cmp.length}
      />
      {onCity && error && (
        <div className="loading" style={{ color: 'var(--warn)' }}>
          Could not load data for {cityMeta.name}: {error}. Run <code>npm run fetch-data</code>.
        </div>
      )}
      {onCity && !error && (!s || !model) && <div className="loading">Loading {cityMeta.name} · daily archive…</div>}
      {onCity && s && model && (
        <CityView
          city={cityMeta}
          s={s}
          m={model}
          p={p}
          u={u}
          set={set}
          ytd={ytd}
          ytdSc={ytdSc}
          ytdError={ytdError}
          manifest={manifest}
          calFill={calFill}
          setCalFill={setCalFill}
          cmp={session.cmp}
          rows={rows}
          openCity={openCity}
          openMethods={openMethods}
          toggleCompare={() => setSession((x) => ({ ...x, cmp: toggleCompare(x.cmp, cityMeta.id) }))}
        />
      )}
      {session.view === 'compare' && (
        <Compare
          ids={session.cmp}
          rows={rows}
          p={dp}
          u={u}
          fill={calFill}
          setCmp={setCmp}
          openCity={openCity}
          current={cityMeta.id}
          manifest={manifest}
          failed={failed}
        />
      )}
      {session.view === 'discover' && (
        <Discover
          rows={rows}
          p={dp}
          u={u}
          q={session.disc}
          setQ={setDisc}
          openCity={openCity}
          current={cityMeta.id}
          failed={failed}
        />
      )}
      {session.view === 'methods' && (
        <MethodsPage
          city={cityMeta}
          series={series}
          terrains={terrains}
          manifest={manifest}
          p={dp}
          u={u}
          ytd={ytd}
          ytdError={ytdError}
        />
      )}
      <Tooltip />
    </>
  )
}
