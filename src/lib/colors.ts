// Three separate encodings that must never be confused:
//  1. comfort bands — fit to the user's stated preferences (teal / lavender / gray)
//  2. raw temperature — neutral blue-gray, never reused for comfort
//  3. activity days — amber
import type { ReasonKind } from './scoring'

export const CO = {
  comf: '#3ecfa4',
  tol: '#9b8cf0',
  unb: '#4c5261',
  act: '#d9a03c',
  actSnow: '#f2d8a0',
  actNone: '#26292f',
  unscored: '#23262c',
  warn: '#ff8a6a',
  accent: '#7cc4ff',
  faint: '#5f6672',
  grid: '#23262c',
}
export const BAND_COLOR = [CO.comf, CO.tol, CO.unb]

/** CSS fill for a "why days fall short" bar, in the budget bar's encoding: lavender for a
 *  tolerable shortfall, gray for a day written off. Where the limit was set — a control-bar
 *  slider or a More-controls toggle — does not change what happened to the day, so it does
 *  not change the encoding either. */
export const REASON_FILL: Record<ReasonKind, string> = {
  soft: CO.tol,
  deal: CO.unb,
}
export const REASON_TIP: Record<ReasonKind, string> = {
  soft: 'Tolerable days: inside every limit you set, short of the cutoff',
  deal: 'Unbearable days: crossed a limit you set, and written off whatever else the day did',
}

/** Air-quality drivers. Ozone and PM2.5 are a validated categorical pair on the dark
 *  panel (CVD ΔE 15.9, normal 26.5); everything else folds into a neutral "other". */
export const AQ_COLOR = { o3: '#3987e5', pm25: '#d55181', other: '#6b7280' }

export const LOSS_COLOR = [CO.act, '#8a5a3c', '#3c5a8a', '#4a5560', '#4a5560', '#33373f']

/** Perceptually ordered 0→100 fit ramp for the continuous calendar. Lightness rises
 *  monotonically, so it reads in grayscale and for common color-vision deficiencies. */
const CRAMP = ['#2a2e36', '#3b4a63', '#3f6f86', '#3f9a8e', '#3ecfa4', '#8ef0cf']
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const CRAMP_RGB = CRAMP.map(hex)

function lerpRamp(ramp: number[][], t01: number): string {
  const t = Math.max(0, Math.min(1, t01)) * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(t)),
    f = t - i
  const a = ramp[i],
    b = ramp[i + 1]
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`
}

export const contColor = (score: number) => lerpRamp(CRAMP_RGB, score / 100)

/** Raw daily temperature — observed data only, never comfort. Diverging cool→warm and
 *  deliberately unlike the comfort ramp, so "warm" can never read as "good". Fixed
 *  domain in °F so every city is drawn on the same scale; values beyond it clamp. */
export const TEMP_DOMAIN: [number, number] = [10, 100]
const TRAMP_RGB = ['#3f6fa8', '#79a6c8', '#bcc8d0', '#dcc48f', '#c9834e', '#a8452b'].map(hex)
export const tempColor = (f: number) => lerpRamp(TRAMP_RGB, (f - TEMP_DOMAIN[0]) / (TEMP_DOMAIN[1] - TEMP_DOMAIN[0]))
