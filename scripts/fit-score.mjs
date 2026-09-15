// How well a candidate city suits the person choosing where to move, 0–1 per part, for
// ranking the fetch queue (build-catalog.mjs) — never for scoring days in the app, which
// stays preference-neutral. The weights live in catalog.config.mjs.
//
//   climate  cool summers, few muggy months, a real winter, ski terrain close by
//   tech     software jobs within commuting reach (a remote job can end)
//   walk     how many people get to work on foot, bike or transit

const clamp01 = (x) => Math.max(0, Math.min(1, x))
/** 0 at x0, 1 at x1, linear between (either direction). */
const lin = (x, x0, x1) => clamp01((x - x0) / (x1 - x0))

/** Warmest month's mean daily high, °F: 1 at 72 or cooler, 0 at 92. */
export const summerScore = (hotHighF) => lin(hotHighF, 92, 72)
/** Months with a mean dew point ≥ 65°F: none is 1, one is ½, two or more 0. */
export const dryScore = (muggyMonths) => clamp01(1 - muggyMonths / 2)
/** Coldest month's mean temperature, °F: 1 for a freezing winter (5–30°F), falling to 0 at
 *  45°F (no winter), and to ½ at −20°F (Yakutsk-cold is a winter too far for most). */
export const winterScore = (coldMeanF) => (coldMeanF >= 5 ? lin(coldMeanF, 45, 30) : 0.5 + 0.5 * lin(coldMeanF, -20, 5))
/** Ski terrain by drive time (the app's stops): ≤1 hr 1, ≤2 hr 0.7, ≤3 hr 0.4, none 0. */
export const snowFromDrive = (minutes) =>
  minutes == null ? 0 : minutes <= 60 ? 1 : minutes <= 120 ? 0.7 : minutes <= 180 ? 0.4 : 0
/** Before routing, the same by straight-line distance to a big ski area: 1 within 60 km, 0 past 220. */
export const snowFromKm = (km) => (km == null ? 0 : lin(km, 220, 60))

export const CLIMATE_PARTS = { summer: 0.35, dry: 0.25, winter: 0.2, snow: 0.2 }
export function climateScore({ hotHigh, muggy, coldMean }, snow) {
  const parts = { summer: summerScore(hotHigh), dry: dryScore(muggy), winter: winterScore(coldMean), snow }
  return Object.entries(CLIMATE_PARTS).reduce((sum, [k, w]) => sum + w * parts[k], 0)
}

/** Software jobs within reach → 0–1 on a log scale: 1,000 jobs is 0, 200,000 (Seattle) is 1. */
export const techScore = (jobs) => clamp01(Math.log10(Math.max(jobs, 1) / 1000) / Math.log10(200))
/** Jobs count fully within 40 km and fade to nothing at 100 km — a long but real commute. */
export const reach = (km) => lin(km, 100, 40)

/** Share of commuters (not counting work-from-home) on foot, bike or transit → 0–1 on a log
 *  scale: 2% (most US cities) is 0, 40% (New York, most European capitals) is 1. */
export const walkScore = (share) => clamp01(Math.log(Math.max(share, 1e-4) / 0.02) / Math.log(20))

export const total = (parts, weights) => Object.entries(weights).reduce((sum, [k, w]) => sum + w * parts[k], 0)
