// Köppen–Geiger class from monthly climatology, following Beck et al. (2018), Sci. Data 5,
// 180214, Table 1. Used by build-catalog.mjs to label and summarise the draft queue only;
// nothing in the app scores on it.

const NAMES = {
  Af: 'tropical rainforest', Am: 'tropical monsoon', Aw: 'tropical savanna',
  BWh: 'hot desert', BWk: 'cold desert', BSh: 'hot semi-arid', BSk: 'cold semi-arid',
  Csa: 'hot-summer Mediterranean', Csb: 'warm-summer Mediterranean', Csc: 'cold-summer Mediterranean',
  Cwa: 'humid subtropical, dry winter', Cwb: 'subtropical highland', Cwc: 'cold subtropical highland',
  Cfa: 'humid subtropical', Cfb: 'oceanic', Cfc: 'subpolar oceanic',
  Dsa: 'hot-summer continental, dry summer', Dsb: 'warm-summer continental, dry summer', Dsc: 'subarctic, dry summer', Dsd: 'extreme subarctic, dry summer',
  Dwa: 'hot-summer continental, dry winter', Dwb: 'warm-summer continental, dry winter', Dwc: 'subarctic, dry winter', Dwd: 'extreme subarctic, dry winter',
  Dfa: 'hot-summer humid continental', Dfb: 'warm-summer humid continental', Dfc: 'subarctic', Dfd: 'extreme subarctic',
  ET: 'tundra', EF: 'ice cap',
}
export const koppenName = (cls) => NAMES[cls] ?? cls

/** @param t monthly mean temperature, °C, Jan–Dec  @param p monthly precipitation, mm */
export function koppen(t, p) {
  const sum = (xs) => xs.reduce((a, b) => a + b, 0)
  const MAT = sum(t) / 12, MAP = sum(p)
  const Tcold = Math.min(...t), Thot = Math.max(...t)
  const Tmon10 = t.filter((v) => v > 10).length
  // Summer is the warmer half-year: Apr–Sep or Oct–Mar, so the rules work in both hemispheres.
  const aprSep = [3, 4, 5, 6, 7, 8]
  const northern = sum(aprSep.map((m) => t[m])) >= sum(t) / 2
  const summer = northern ? aprSep : [9, 10, 11, 0, 1, 2]
  const winter = [...Array(12).keys()].filter((m) => !summer.includes(m))
  const ps = summer.map((m) => p[m]), pw = winter.map((m) => p[m])
  const Psdry = Math.min(...ps), Pswet = Math.max(...ps), Pwdry = Math.min(...pw), Pwwet = Math.max(...pw)
  const Pdry = Math.min(...p)
  const Pthreshold = sum(pw) > 0.7 * MAP ? 2 * MAT : sum(ps) > 0.7 * MAP ? 2 * MAT + 28 : 2 * MAT + 14

  if (Thot <= 10) return Thot > 0 ? 'ET' : 'EF'
  if (MAP < 10 * Pthreshold) return `B${MAP < 5 * Pthreshold ? 'W' : 'S'}${MAT >= 18 ? 'h' : 'k'}`
  if (Tcold >= 18) return Pdry >= 60 ? 'Af' : Pdry >= 100 - MAP / 25 ? 'Am' : 'Aw'
  const group = Tcold > 0 ? 'C' : 'D'
  const dry = Psdry < 40 && Psdry < Pwwet / 3 ? 's' : Pwdry < Pswet / 10 ? 'w' : 'f'
  const heat = Thot >= 22 ? 'a' : Tmon10 >= 4 ? 'b' : group === 'D' && Tcold < -38 ? 'd' : 'c'
  return `${group}${dry}${heat}`
}
