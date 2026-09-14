// Open-Meteo request helper shared by the fetch scripts: waits out the per-minute and
// per-hour rate limits, and stops cleanly at the daily one.

export const ARCHIVE_API = 'https://archive-api.open-meteo.com/v1/archive'
export const AQ_API = 'https://air-quality-api.open-meteo.com/v1/air-quality'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function get(params, api = ARCHIVE_API) {
  const url = `${api}?${new URLSearchParams(params)}`
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url)
    if (res.ok) return res.json()
    const body = await res.json().catch(() => ({}))
    const reason = body.reason || res.statusText
    if (res.status !== 429) throw new Error(`${res.status} ${reason}`)
    if (/daily/i.test(reason)) throw new Error(`Daily limit reached — re-run tomorrow. (${reason})`)
    const wait = /hourly/i.test(reason) ? 10 * 60_000 : 65_000
    console.log(`  rate limited (${reason}); waiting ${Math.round(wait / 1000)}s`)
    await sleep(wait)
  }
  throw new Error('gave up after repeated rate limits')
}
