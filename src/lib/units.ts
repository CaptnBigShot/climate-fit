// All data is stored and scored in °F / inches / mph / feet. These helpers only
// convert for display.
export interface Units {
  metric: boolean
  tu: string
  /** Absolute temperature. */
  t: (f: number, dp?: number) => string
  /** Temperature difference (no offset). */
  dt: (f: number, dp?: number) => string
  /** Precipitation depth. */
  len: (inches: number, dp?: number) => string
  /** Snow depth, whole units. */
  depth: (inches: number) => string
  elev: (ft: number) => string
  speed: (mph: number) => string
  /** Convert a displayed temperature back to °F (for user-typed thresholds). */
  toF: (v: number) => number
}

export function units(metric: boolean): Units {
  const c = (f: number) => ((f - 32) * 5) / 9
  return {
    metric,
    tu: metric ? '°C' : '°F',
    t: (f, dp = 0) => (metric ? c(f) : f).toFixed(dp).replace(/^-0$/, '0'),
    dt: (f, dp = 1) => { const v = metric ? (f * 5) / 9 : f; return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(dp) },
    len: (i, dp) => (metric ? `${(i * 25.4).toFixed(dp ?? 0)} mm` : `${i.toFixed(dp ?? 2)}"`),
    depth: (i) => (metric ? `${Math.round(i * 2.54)} cm` : `${Math.round(i)}"`),
    elev: (ft) => (metric ? `${Math.round(ft * 0.3048).toLocaleString()} m` : `${Math.round(ft).toLocaleString()} ft`),
    speed: (mph) => (metric ? `${Math.round(mph * 1.609)} km/h` : `${Math.round(mph)} mph`),
    toF: (v) => (metric ? (v * 9) / 5 + 32 : v),
  }
}

export const signed = (v: number, dp = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(dp)
