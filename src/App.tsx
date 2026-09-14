import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CITIES, cityById, loadCity, loadManifest, loadTerrain, type CitySeries, type Manifest, type TerrainSeries } from './lib/data'
import { DEFAULT_PREFS, decodePrefs, encodePrefs, type Prefs } from './lib/prefs'
import { budget } from './lib/aggregate'
import { score } from './lib/scoring'
import { buildModel } from './lib/model'
import { units } from './lib/units'
import { downloadMonthlyCsv } from './lib/csv'
import { ControlBar } from './components/ControlBar'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { ComfortCalendar } from './components/ComfortCalendar'
import { TempDistribution } from './components/TempDistribution'
import { ClimateDrift, FactsPanel, MonthlyTable, OutdoorPanel, ThresholdCounters } from './components/Panels'
import { Methods } from './components/Methods'
import { AirQualityPanel, BestTimePanel, ExtremesPanel, MosquitoPanel, TypicalDayPanel, WhatWouldChangePanel } from './components/Extras'
import { Tooltip } from './components/Tooltip'
import { extend, loadYtdRaw, scoreYtd } from './lib/current'
import type { YtdRaw } from './lib/ytd'

const DEFAULT_CITY = 'tacoma'

interface Session { city: string; prefs: Prefs; cmp: string[] }

function readUrl(): Session {
  const q = new URLSearchParams(window.location.search)
  return {
    city: cityById(q.get('city') ?? '')?.id ?? DEFAULT_CITY,
    prefs: decodePrefs(q),
    cmp: (q.get('cmp') ?? '').split(',').filter((id) => cityById(id)),
  }
}

function writeUrl(s: Session) {
  const q = new URLSearchParams()
  q.set('city', s.city)
  encodePrefs(s.prefs, q)
  if (s.cmp.length) q.set('cmp', s.cmp.join(','))
  const url = `${window.location.pathname}?${q.toString().replace(/%2C/g, ',').replace(/%7E/g, '~')}`
  if (url !== window.location.pathname + window.location.search) window.history.replaceState(null, '', url)
}

export default function App() {
  const [session, setSession] = useState<Session>(readUrl)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [series, setSeries] = useState<Record<string, CitySeries>>({})
  const [terrains, setTerrains] = useState<Record<string, TerrainSeries>>({})
  const [error, setError] = useState<string | null>(null)
  const [calFill, setCalFill] = useState<'banded' | 'continuous'>('banded')

  // URL is the persistence layer. Throttled: browsers rate-limit replaceState, and a drag fires dozens of changes a second.
  const urlTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(urlTimer.current)
    urlTimer.current = window.setTimeout(() => writeUrl(session), 200)
  }, [session])
  useEffect(() => {
    const onPop = () => setSession(readUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const cityMeta = cityById(session.city)!
  useEffect(() => {
    let live = true
    Promise.all([
      loadManifest(),
      loadCity(cityMeta.id),
      Promise.all(cityMeta.terrain.map(([id]) => loadTerrain(id).catch(() => null))),
    ]).then(([mf, cs, ts]) => {
      if (!live) return
      setManifest(mf)
      setSeries((prev) => ({ ...prev, [cs.id]: cs }))
      setTerrains((prev) => { const n = { ...prev }; ts.forEach((t) => { if (t) n[t.id] = t }); return n })
    }).catch((e: Error) => live && setError(e.message))
    return () => { live = false }
  }, [cityMeta])

  // Once the first city is on screen, quietly fetch the rest so switching is instant
  // and the city picker can show each city's comfortable-day count.
  const firstLoaded = Object.keys(series).length > 0
  useEffect(() => {
    if (!firstLoaded) return
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300))
    idle(() => {
      for (const c of CITIES) {
        loadCity(c.id).then((cs) => setSeries((prev) => (prev[cs.id] ? prev : { ...prev, [cs.id]: cs }))).catch(() => undefined)
        for (const [tid] of c.terrain) loadTerrain(tid).then((t) => setTerrains((prev) => (prev[t.id] ? prev : { ...prev, [t.id]: t }))).catch(() => undefined)
      }
    })
  }, [firstLoaded])

  // Current partial year: fetched after the city is on screen; the dashboard never waits for it.
  const [ytdRaw, setYtdRaw] = useState<{ id: string; raw: YtdRaw; source: 'live' | 'snapshot' } | null>(null)
  const [ytdError, setYtdError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    loadYtdRaw(cityMeta).then((r) => live && setYtdRaw({ id: cityMeta.id, ...r })).catch((e: Error) => live && setYtdError(e.message))
    return () => { live = false }
  }, [cityMeta])

  const p = session.prefs
  const u = useMemo(() => units(p.metric), [p.metric])
  const set = useCallback((patch: Partial<Prefs>) => setSession((s) => ({ ...s, prefs: { ...s.prefs, ...patch } })), [])
  const reset = useCallback(() => setSession((s) => ({ ...s, prefs: { ...structuredClone(DEFAULT_PREFS), metric: s.prefs.metric, window: s.prefs.window } })), [])
  const setCity = useCallback((id: string) => { setError(null); setYtdError(null); setSession((s) => ({ ...s, city: id })) }, [])

  const s = series[cityMeta.id]
  const model = useMemo(() => (s ? buildModel(cityMeta, s, terrains, p, (f) => u.t(f), u.tu) : null), [cityMeta, s, terrains, p, u])

  const ytd = useMemo(() => (s && ytdRaw?.id === cityMeta.id ? extend(s, terrains, ytdRaw.raw, ytdRaw.source) : null), [s, terrains, ytdRaw, cityMeta.id])
  const ytdSc = useMemo(() => (ytd && s ? scoreYtd(ytd, s, p, p.window) : null), [ytd, s, p])

  const comfByCity = useMemo(() => {
    const out: Record<string, number | null> = {}
    for (const c of CITIES) {
      const cs = series[c.id]
      const sc = cs ? score(cs, p, p.window) : null
      out[c.id] = sc ? Math.round(budget(sc).counts[0]) : null
    }
    return out
  }, [series, p])

  const mf = manifest?.cities[cityMeta.id]
  const inCompare = session.cmp.includes(cityMeta.id)

  return (
    <>
      <ControlBar prefs={p} set={set} reset={reset} city={cityMeta} setCity={setCity} u={u}
        warmMonths={model?.warmMonths ?? null} calFill={calFill} setCalFill={setCalFill} comfByCity={comfByCity} />
      {error && <div className="loading" style={{ color: 'var(--warn)' }}>Could not load data for {cityMeta.name}: {error}. Run <code>npm run fetch-data</code>.</div>}
      {!error && (!s || !model) && <div className="loading">Loading {cityMeta.name} · daily archive…</div>}
      {s && model && (
        <main className="page">
          <Header city={cityMeta} m={model} p={p} u={u} elevFt={s.demElevM * 3.28084} solarIdx={mf?.solarIdx ?? null}
            inCompare={inCompare} compareCount={session.cmp.length}
            toggleCompare={() => setSession((x) => ({ ...x, cmp: inCompare ? x.cmp.filter((c) => c !== cityMeta.id) : [...x.cmp, cityMeta.id] }))}
            exportCsv={() => downloadMonthlyCsv(cityMeta, model.months, p, u)} />
          <Hero m={model} p={p} u={u} set={set} ytd={ytd} ytdSc={ytdSc} ytdError={ytdError} />
          <ComfortCalendar s={s} sc={model.sc} p={p} terrain={model.terrain?.series ?? null} u={u} fill={calFill} setFill={setCalFill} ytd={ytd} ytdSc={ytdSc} terrainId={model.terrain?.id ?? null} />
          <div className="grid-dist">
            <div className="section" style={{ borderBottom: 'none' }}><TempDistribution s={s} p={p} u={u} ytd={ytd} /></div>
            <OutdoorPanel m={model} p={p} set={set} u={u} />
          </div>
          <MonthlyTable m={model} p={p} u={u} />
          <div className="grid-3">
            <BestTimePanel sc={model.sc} p={p} />
            <TypicalDayPanel city={cityMeta} p={p} u={u} sc={model.sc} defaultMonth={model.facts.warmestMonth} />
            <WhatWouldChangePanel s={s} p={p} u={u} b={model.b} />
          </div>
          <div className="grid-3">
            <ThresholdCounters key={p.metric ? 'metric' : 'us'} s={s} p={p} set={set} u={u} ytd={ytd} />
            <ClimateDrift s={s} m={model} p={p} u={u} />
            <FactsPanel m={model} u={u} w={p.window} solarIdx={mf?.solarIdx ?? null} seasonsIdx={mf?.seasonsIdx ?? null} />
          </div>
          <div className="grid-3">
            <ExtremesPanel s={s} p={p} u={u} />
            <AirQualityPanel city={cityMeta} />
            <MosquitoPanel s={s} p={p} u={u} />
          </div>
          <Methods city={cityMeta} s={s} m={model} p={p} u={u} ytd={ytd} ytdError={ytdError} />
        </main>
      )}
      <Tooltip />
    </>
  )
}
