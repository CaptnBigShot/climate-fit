export interface Fit {
  slope: number
  intercept: number
  r2: number
}

/** Ordinary least squares over evenly spaced points. R² is always reported with
 *  the slope — a confident trend line on noisy data is the dishonesty to avoid. */
export function ols(ys: ArrayLike<number>): Fit {
  const n = ys.length
  if (n < 2) return { slope: 0, intercept: n ? ys[0] : 0, r2: 0 }
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += ys[i]
    sxy += i * ys[i]
    sxx += i * i
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  const intercept = (sy - slope * sx) / n
  const my = sy / n
  let ssr = 0,
    sst = 0
  for (let i = 0; i < n; i++) {
    const f = intercept + slope * i
    ssr += (ys[i] - f) ** 2
    sst += (ys[i] - my) ** 2
  }
  return { slope, intercept, r2: sst === 0 ? 0 : 1 - ssr / sst }
}

/** Linear-interpolated quantile of an already sorted array. */
export function quantileSorted(a: ArrayLike<number>, q: number): number {
  const i = (a.length - 1) * q
  const lo = Math.floor(i),
    hi = Math.ceil(i)
  return a[lo] + (a[hi] - a[lo]) * (i - lo)
}

export const mean = (xs: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < xs.length; i++) s += xs[i]
  return xs.length ? s / xs.length : 0
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN
  const a = xs.slice().sort((x, y) => x - y)
  return quantileSorted(a, 0.5)
}
