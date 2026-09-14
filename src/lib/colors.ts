// Three separate encodings that must never be confused:
//  1. comfort bands — fit to the user's stated preferences (teal / lavender / gray)
//  2. raw temperature — neutral blue-gray, never reused for comfort
//  3. activity days — amber
export const CO = {
  comf: '#3ecfa4',
  tol: '#9b8cf0',
  unb: '#4c5261',
  hardBase: '#5b6272',
  hardStripe: '#9aa2ae',
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

export const LOSS_COLOR = [CO.act, '#8a5a3c', '#3c5a8a', '#4a5560', '#4a5560', '#33373f']

/** Perceptually ordered 0→100 fit ramp for the continuous calendar. Lightness rises
 *  monotonically, so it reads in grayscale and for common color-vision deficiencies. */
const CRAMP = ['#2a2e36', '#3b4a63', '#3f6f86', '#3f9a8e', '#3ecfa4', '#8ef0cf']
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const CRAMP_RGB = CRAMP.map(hex)

export function contColor(score: number): string {
  const t = Math.max(0, Math.min(1, score / 100)) * (CRAMP.length - 1)
  const i = Math.min(CRAMP.length - 2, Math.floor(t)), f = t - i
  const a = CRAMP_RGB[i], b = CRAMP_RGB[i + 1]
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`
}
