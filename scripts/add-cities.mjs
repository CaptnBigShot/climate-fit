// Adds named places to the set in one step: drafts their catalogue entries
// (build-catalog.mjs --add), fetches their data (fetch-data.mjs), and writes a summary of what
// happened to each name — added, already there, not found (with close spellings), or failed.
// The add-cities GitHub workflow runs this for an issue or a manual run; it works the same
// locally.
//
//   npm run add-cities -- "Aspen, CO" "Winthrop, WA"
//   npm run add-cities -- "Aspen, CO; Leavenworth, Washington; Kyoto, Japan"
//   npm run add-cities -- --dry-run "Leavenworth"     only resolve the names (no routing, no data)
//
// A name is "Place", "Place, ST" (US state or Canadian province, code or name) or
// "Place, Country". Without the state, the biggest place of that name wins, so add it.
// The summary goes to stdout, .cache/add-cities.md, and the GitHub job summary when there
// is one; .cache/add-cities.json lists the ids added, for the commit message.
import { spawnSync } from 'node:child_process'
import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { readCatalog } from './catalog-file.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache')
/** Written by build-catalog.mjs --add (its ADDED_FILE; importing it from there would run it). */
const ADDED_FILE = join(CACHE, 'catalog', 'added.json')
const SITE = 'https://captnbigshot.github.io/climate-fit/'

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'dry-run': { type: 'boolean' } },
})
// An issue form's body arrives whole: "### Places to add", a blank line, then the list.
const names = positionals
  .flatMap((v) => v.split(/[;\n]/))
  .map((s) => s.replace(/^\s*[-*•]\s*/, '').trim())
  .filter((s) => s && !s.startsWith('#') && s !== '_No response_')
if (!names.length) {
  console.error('usage: npm run add-cities -- "Aspen, CO" "Winthrop, WA"')
  process.exit(2)
}

const run = (script, args) =>
  spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { stdio: 'inherit' }).status

const before = new Set((await readCatalog()).cities.map((c) => c.id))
const drafted = run('build-catalog.mjs', [...names.map((n) => `--add=${n}`), ...(opts['dry-run'] ? ['--dry-run'] : [])])
if (drafted !== 0) throw new Error(`build-catalog exited with ${drafted}`)
const added = JSON.parse(await readFile(ADDED_FILE, 'utf8'))

let fetchFailed = false
if (!opts['dry-run'] && added.queued.length) {
  fetchFailed =
    run(
      'fetch-data.mjs',
      added.queued.map((q) => q.id),
    ) !== 0
}

// ---------- summary ----------

const catalog = await readCatalog()
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
/** Mean daily high over every January and every July in the archive, and mean yearly snowfall. */
async function stats(id) {
  const d = JSON.parse(await readFile(join(ROOT, 'public', 'data', 'cities', `${id}.json`), 'utf8'))
  const inMonth = (from, to) => d.high.filter((_, i) => i % 365 >= from && i % 365 < to)
  return {
    elevFt: Math.round((d.demElevM * 3.28084) / 10) * 10,
    jan: Math.round(mean(inMonth(0, 31))),
    jul: Math.round(mean(inMonth(181, 212))),
    snowIn: Math.round(d.snow.reduce((a, b) => a + b, 0) / d.years),
  }
}
const fmtPop = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

const lines = []
const ok = [],
  failed = []
for (const q of added.queued) {
  const c = catalog.cities.find((c) => c.id === q.id)
  if (opts['dry-run']) ok.push(`- **${q.name}, ${q.code}** (pop. ${fmtPop(q.pop)}) for “${q.text}”`)
  else if (c && !before.has(c.id)) {
    const s = await stats(c.id)
    const ski = c.terrain.map(([tid, min]) => `${catalog.terrain[tid]?.name ?? tid} ${min} min`).join(', ')
    ok.push(
      `- **[${c.name}, ${c.code}](${SITE}?city=${c.id})**, ${c.region} · pop. ${fmtPop(c.pop)} · ${s.elevFt.toLocaleString('en-US')} ft · ` +
        `Jan high ${s.jan}°F, Jul high ${s.jul}°F, ${s.snowIn}″ snow a year · ski: ${ski || 'none within 3 h'}` +
        (fold(q.text) === fold(`${c.name}, ${c.code}`) ? '' : ` _(for “${q.text}”)_`),
    )
  } else failed.push(`- **${q.name}, ${q.code}** (for “${q.text}”): its data didn't finish; see the log`)
}
function fold(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

if (ok.length) lines.push(`### ${opts['dry-run'] ? 'Would add' : 'Added'} ${ok.length}`, '', ...ok, '')
if (failed.length) lines.push(`### Failed ${failed.length}`, '', ...failed, '')
if (added.notFound.length) {
  lines.push(`### Not found ${added.notFound.length}`, '')
  for (const n of added.notFound)
    lines.push(
      `- “${n.text}”${n.suggestions.length ? `: did you mean ${n.suggestions.map((s) => `**${s}**`).join(', ')}?` : ': no town or city by that name'}`,
    )
  lines.push('')
}
if (added.noClimate.length) {
  lines.push(`### Left out ${added.noClimate.length}`, '')
  for (const n of added.noClimate)
    lines.push(`- **${n.name}, ${n.code}** (for “${n.text}”): no climate normals within ~50 km`)
  lines.push('')
}
if (added.already.length) {
  lines.push(`### Already in the set ${added.already.length}`, '')
  for (const a of added.already)
    lines.push(
      `- [${a.name}, ${a.code}](${SITE}?city=${a.id})${fold(a.text) === fold(`${a.name}, ${a.code}`) ? '' : ` (for “${a.text}”)`}`,
    )
  lines.push('')
}
const summary = lines.join('\n')

const addedIds = opts['dry-run'] ? [] : catalog.cities.filter((c) => !before.has(c.id))
await mkdir(CACHE, { recursive: true })
await writeFile(join(CACHE, 'add-cities.md'), summary)
await writeFile(
  join(CACHE, 'add-cities.json'),
  JSON.stringify({
    added: addedIds.map((c) => c.id),
    names: addedIds.map((c) => `${c.name}, ${c.code}`),
    problems: failed.length + added.notFound.length + added.noClimate.length,
  }),
)
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
console.log(`\n${summary}`)
if (fetchFailed) process.exit(1)
