// Sunshine duration exactly as Open-Meteo derives it from hourly direct radiation
// (Zensun.calculateBackwardsSunshineDuration), with the sun's declination and equation
// of time from NREL SPA sampled every 20 days and Hermite-interpolated
// (SolarPositonFastLookup). The server computes in 32-bit floats, and near sunrise and
// sunset that precision shows in the result, so every step here is rounded to float32.
import { B_TERMS, L_TERMS, PE_TERMS, R_TERMS, Y_TERMS } from './spa-terms.mjs'

const f = Math.fround
const DEG = Math.PI / 180
const PI = f(Math.PI)
/** Float.degreesToRadians: (x * π) / 180 in float32. */
const rad = (x) => f(f(x * PI) / 180)

// ---------- SPA: declination (degrees) and equation of time (minutes) ----------

const limitDegrees = (d) => { const x = d / 360; let l = 360 * (x - Math.floor(x)); if (l < 0) l += 360; return l }
const poly3 = (a, b, c, d, x) => x * (x * (x * a + b) + c) + d
const periodic = (terms, jme) => terms.reduce((s, row, i) => s + row.reduce((t, [a, b, c]) => t + a * Math.cos(c * jme + b), 0) * jme ** i, 0) / 1e8

function spa(jd) {
  const jde = jd + 60 / 86400, jce = (jde - 2451545) / 36525, jme = jce / 10
  const l = limitDegrees(periodic(L_TERMS, jme) / DEG), b = periodic(B_TERMS, jme) / DEG, r = periodic(R_TERMS, jme)
  const theta0 = l + 180, theta = theta0 >= 360 ? theta0 - 360 : theta0, beta = -b
  const x = [
    poly3(1 / 189474, -0.0019142, 445267.11148, 297.85036, jce),
    poly3(-1 / 300000, -0.0001603, 35999.05034, 357.52772, jce),
    poly3(1 / 56250, 0.0086972, 477198.867398, 134.96298, jce),
    poly3(1 / 327270, -0.0036825, 483202.017538, 93.27191, jce),
    poly3(1 / 450000, 0.0020708, -1934.136261, 125.04452, jce),
  ]
  let psi = 0, eps = 0
  for (let i = 0; i < Y_TERMS.length; i++) {
    const y = Y_TERMS[i], arg = (x[0] * y[0] + x[1] * y[1] + x[2] * y[2] + x[3] * y[3] + x[4] * y[4]) * DEG
    psi += (jce * PE_TERMS[i][1] + PE_TERMS[i][0]) * Math.sin(arg)
    eps += (jce * PE_TERMS[i][3] + PE_TERMS[i][2]) * Math.cos(arg)
  }
  const delPsi = psi / 36e6, delEps = eps / 36e6
  const u = jme / 10
  const eps0 = [2.45, 5.79, 27.87, 7.12, -39.05, -249.67, -51.38, 1999.25, -1.55, -4680.93, 84381.448].reduce((a, c, i) => (i === 0 ? c : u * a + c), 0)
  const epsilon = delEps + eps0 / 3600
  const lamda = theta + delPsi - 20.4898 / (3600 * r)
  const alpha = limitDegrees(Math.atan2(Math.sin(lamda * DEG) * Math.cos(epsilon * DEG) - Math.tan(beta * DEG) * Math.sin(epsilon * DEG), Math.cos(lamda * DEG)) / DEG)
  const delta = Math.asin(Math.sin(beta * DEG) * Math.cos(epsilon * DEG) + Math.cos(beta * DEG) * Math.sin(epsilon * DEG) * Math.sin(lamda * DEG)) / DEG
  const m = limitDegrees(jme * (jme * (jme * (jme * (jme * (-1 / 2e6) - 1 / 15300) + 1 / 49931) + 0.03032028) + 360007.6982779) + 280.4664567)
  let eot = 4 * (m - 0.0057183 - alpha + delPsi * Math.cos(epsilon * DEG))
  if (eot < -20) eot += 1440; else if (eot > 20) eot -= 1440
  return { delta, eot }
}

// ---------- lookup: every 20 days from 1950, Hermite ring ----------

const REF_START = Date.UTC(1950, 0, 1) / 1000, REF_DT = 86400 * 20, REF_SPAN = Date.UTC(2050, 0, 1) / 1000 - REF_START
let table = null
function lookup() {
  if (!table) {
    const n = Math.ceil(REF_SPAN / REF_DT), decl = new Float32Array(n), eot = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const p = spa((REF_START + i * REF_DT) / 86400 + 2440587.5)
      decl[i] = p.delta; eot[i] = p.eot
    }
    table = { decl, eot }
  }
  return table
}

function hermiteRing(a, i, t) {
  const n = a.length
  const A = a[(i - 1 + n) % n], B = a[i % n], C = a[(i + 1) % n], D = a[(i + 2) % n]
  const pa = f(f(f(f(-A / 2) + f(f(3 * B) / 2)) - f(f(3 * C) / 2)) + f(D / 2))
  const pb = f(f(f(A - f(f(5 * B) / 2)) + f(2 * C)) - f(D / 2))
  const pc = f(f(-A / 2) + f(C / 2))
  return f(f(f(f(f(f(pa * t) * t) * t) + f(f(pb * t) * t)) + f(pc * t)) + B)
}

/** Declination (degrees) and equation of time (hours) at a Unix time in seconds. */
function sunAt(sec) {
  const { decl, eot } = lookup()
  const x = (((sec - REF_START) % REF_SPAN) + REF_SPAN) % REF_SPAN
  const i = Math.floor(x / REF_DT), t = f(f(x % REF_DT) / REF_DT)
  return { decl: hermiteRing(decl, i, t), eqtime: f(hermiteRing(eot, i, t) / 60) }
}

// ---------- sunshine ----------

/** Seconds of sunshine in each hour ending at `startSec + i * 3600`, from backwards-averaged
 *  direct radiation (W/m²) at the model grid point. NaN in → NaN out. */
export function sunshineDuration(direct, lat, lon, startSec) {
  const dt = 3600, out = new Float32Array(direct.length)
  const t0 = rad(f(90 - lat))
  const sin0 = f(Math.sin(t0)), cos0 = f(Math.cos(t0))
  for (let i = 0; i < direct.length; i++) {
    const dhi = direct[i]
    if (Number.isNaN(dhi)) { out[i] = NaN; continue }
    if (dhi <= 0) { out[i] = 0; continue }
    const sec = startSec + i * dt, { decl, eqtime } = sunAt(sec)
    const ut = f(f(((sec % 86400) + 86400) % 86400) / 3600)
    const t1 = rad(f(90 - decl))
    const p1 = rad(f(-15 * f(f(ut - 12) + eqtime)))
    const ut0 = f(ut - 1)
    const p10 = rad(f(-15 * f(f(ut0 - 12) + eqtime)))
    let p0 = rad(lon)
    if (p0 < f(p1 - PI)) p0 = f(p0 + f(2 * PI))
    if (p0 > f(p1 + PI)) p0 = f(p0 - f(2 * PI))
    const sin1 = f(Math.sin(t1)), cos1 = f(Math.cos(t1))
    const arg = f(f(-f(cos0 * cos1)) / f(sin0 * sin1))
    const carg = arg > 1 || arg < -1 ? PI : f(Math.acos(arg))
    const sunrise = f(p0 + carg), sunset = f(p0 - carg)
    if (p10 < sunset || p1 > sunrise) { out[i] = 0; continue }
    const p1l = Math.min(sunrise, p10), p10l = Math.max(sunset, p1)
    const dtBound = f(dt * Math.abs(f(f(p1l - p10l) / f(p10 - p1))))
    const ss = f(sin0 * sin1)
    const left = f(f(ss * f(Math.sin(f(p1l - p0)))) + f(f(p1l * cos0) * cos1))
    const right = f(f(ss * f(Math.sin(f(p10l - p0)))) + f(f(p10l * cos0) * cos1))
    const pd = f(p1l - p10l)
    const zz = f(f(left - right) / (pd < 0 ? Math.min(f(-0.001), pd) : Math.max(f(0.001), pd)))
    const dni = zz <= f(0.0001) ? dhi : f(dhi / zz)
    out[i] = Math.min(f(f(f(Math.max(f(dni - 60), 0) / 120) * dtBound)), dtBound)
  }
  return out
}
