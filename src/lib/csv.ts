import type { CitySeries, CityMeta } from './data'
import { MN, MONTH_START, doyMonth } from './calendar'
import type { MonthRow } from './aggregate'
import { score, REASONS } from './scoring'
import { FIRST_YEAR, windowLabel, windowYears, type Prefs } from './prefs'
import type { Units } from './units'

function download(name: string, body: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const header = (city: CityMeta, p: Prefs, u: Units) => `# Climate Fit · ${city.name}, ${city.code} · ${u.metric ? '°C/mm/km/h' : '°F/in/mph'} · window ${windowLabel(p.window)}\n`

export function downloadMonthlyCsv(city: CityMeta, rows: MonthRow[], p: Prefs, u: Units) {
  const t = (v: number) => (u.metric ? ((v - 32) * 5) / 9 : v).toFixed(1)
  const len = (v: number) => (u.metric ? v * 25.4 : v).toFixed(2)
  const head = ['month', 'avg_high', 'avg_low', 'record_high', 'record_low', 'swing', 'dew_point', 'cloud_pct', 'precip', 'snow', 'sun_h_per_day', 'days_over_ceiling', 'comfortable', 'outdoor']
  const lines = rows.map((r) => [MN[r.m], t(r.hi), t(r.lo), t(r.rhi), t(r.rlo), (u.metric ? (r.swing * 5) / 9 : r.swing).toFixed(1), t(r.dew), r.cloud.toFixed(0),
    len(r.precip), len(r.snow), r.sun.toFixed(1), r.over?.toFixed(1) ?? '', r.comf?.toFixed(1) ?? '', r.out.toFixed(1)].join(','))
  download(`climate-fit-${city.id}-monthly.csv`, header(city, p, u) + head.join(',') + '\n' + lines.join('\n') + '\n')
}

export function downloadDailyCsv(city: CityMeta, s: CitySeries, p: Prefs, u: Units) {
  const sc = score(s, p, p.window)
  const off = (p.window.from - FIRST_YEAR) * 365, N = windowYears(p.window) * 365
  const t = (v: number) => (u.metric ? ((v - 32) * 5) / 9 : v).toFixed(1)
  const len = (v: number) => (u.metric ? v * 25.4 : v).toFixed(2)
  const spd = (v: number) => (u.metric ? v * 1.609 : v).toFixed(1)
  const head = ['date', 'high', 'low', 'dew_point', 'cloud_pct', 'precip', 'snowfall', 'max_wind', 'shortwave_mj_m2', 'sunshine_h', 'band', 'fit_score', 'reason']
  const lines: string[] = []
  for (let i = 0; i < N; i++) {
    const j = off + i, y = p.window.from + Math.floor(i / 365), d = i % 365, m = doyMonth(d)
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d - MONTH_START[m] + 1).padStart(2, '0')}`
    lines.push([date, t(s.high[j]), t(s.low[j]), t(s.dew[j]), s.cloud[j].toFixed(0), len(s.precip[j]), len(s.snow[j]), spd(s.wind[j]), s.rad[j].toFixed(2), s.sun[j].toFixed(1),
      sc ? ['comfortable', 'tolerable', 'unbearable'][sc.band[i]] : '', sc ? sc.score[i].toFixed(0) : '', sc ? REASONS[sc.why[i]] : ''].join(','))
  }
  download(`climate-fit-${city.id}-daily-${p.window.from}-${p.window.to}.csv`, header(city, p, u) + head.join(',') + '\n' + lines.join('\n') + '\n')
}
