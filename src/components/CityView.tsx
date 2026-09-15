// The city screen. With a preference stated it is the full dashboard; without one it
// is the opening state — starting points, the record as measured, and a ranking that
// needs no input — because nothing can be scored until you say what comfortable means.
import type { CityMeta, CitySeries, Manifest } from '../lib/data'
import type { Prefs } from '../lib/prefs'
import type { CityRow, Model } from '../lib/model'
import type { Scored } from '../lib/scoring'
import type { Units } from '../lib/units'
import type { Ytd } from '../lib/current'
import { downloadMonthlyCsv } from '../lib/csv'
import { Header } from './Header'
import { Hero } from './Hero'
import { ComfortCalendar, type CalFill } from './ComfortCalendar'
import { TempDistribution } from './TempDistribution'
import { ClimateDrift, FactsPanel, MonthlyTable, OutdoorPanel, ThresholdCounters } from './Panels'
import { MethodsStrip } from './Methods'
import {
  AirQualityPanel,
  BestTimePanel,
  ExtremesPanel,
  MosquitoPanel,
  TypicalDayPanel,
  WhatWouldChangePanel,
} from './Extras'
import { OutdoorRanking, StartingPoints } from './Opening'

export function CityView({
  city,
  s,
  m,
  p,
  u,
  set,
  ytd,
  ytdSc,
  ytdError,
  manifest,
  calFill,
  setCalFill,
  cmp,
  toggleCompare,
  rows,
  openCity,
  openMethods,
}: {
  city: CityMeta
  s: CitySeries
  m: Model
  p: Prefs
  u: Units
  set: (patch: Partial<Prefs>) => void
  ytd: Ytd | null
  ytdSc: Scored | null
  ytdError: string | null
  manifest: Manifest | null
  calFill: CalFill
  setCalFill: (v: CalFill) => void
  cmp: string[]
  toggleCompare: () => void
  rows: CityRow[]
  openCity: (id: string) => void
  openMethods: () => void
}) {
  const mf = manifest?.cities[city.id]
  const unset = !m.b
  return (
    <main className="page">
      {unset && <StartingPoints u={u} set={set} openMethods={openMethods} />}
      <Header
        city={city}
        m={m}
        p={p}
        u={u}
        elevFt={s.demElevM * 3.28084}
        solarIdx={mf?.solarIdx ?? null}
        inCompare={cmp.includes(city.id)}
        compareCount={cmp.length}
        toggleCompare={toggleCompare}
        exportCsv={() => downloadMonthlyCsv(city, m.months, p, u)}
        openCity={openCity}
      />
      {!unset && <Hero m={m} p={p} ytd={ytd} ytdSc={ytdSc} ytdError={ytdError} />}
      <ComfortCalendar
        s={s}
        sc={m.sc}
        p={p}
        terrain={m.terrain?.series ?? null}
        u={u}
        fill={calFill}
        setFill={setCalFill}
        ytd={ytd}
        ytdSc={ytdSc}
        terrainId={m.terrain?.id ?? null}
        cityName={city.name.toUpperCase()}
      />
      <div className="grid-dist">
        <div className="section" style={{ borderBottom: 'none' }}>
          <TempDistribution s={s} p={p} u={u} ytd={ytd} />
        </div>
        <OutdoorPanel m={m} p={p} set={set} u={u} />
      </div>
      {unset && <OutdoorRanking rows={rows} current={city.id} w={p.window} openCity={openCity} />}
      <MonthlyTable m={m} p={p} u={u} />
      <div className="grid-3">
        <BestTimePanel sc={m.sc} p={p} />
        <TypicalDayPanel city={city} p={p} u={u} sc={m.sc} defaultMonth={m.facts.warmestMonth} />
        <WhatWouldChangePanel s={s} p={p} u={u} b={m.b} />
      </div>
      <div className="grid-3">
        <ThresholdCounters key={p.metric ? 'metric' : 'us'} s={s} p={p} set={set} u={u} ytd={ytd} />
        <ClimateDrift s={s} m={m} p={p} u={u} />
        <FactsPanel m={m} u={u} w={p.window} solarIdx={mf?.solarIdx ?? null} seasonsIdx={mf?.seasonsIdx ?? null} />
      </div>
      <div className="grid-3">
        <ExtremesPanel s={s} p={p} u={u} />
        <AirQualityPanel city={city} w={p.window} />
        <MosquitoPanel s={s} p={p} u={u} />
      </div>
      <MethodsStrip city={city} s={s} m={m} p={p} u={u} ytd={ytd} ytdError={ytdError} openMethods={openMethods} />
    </main>
  )
}
