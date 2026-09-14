// The queue review page: scripts/review-page.html with the draft's review data
// (.cache/catalog/review.json, written by build-catalog.mjs) and Discover's land outline
// inlined, so the page is one self-contained file. Run after npm run catalog:
//   npm run review-page   → .cache/catalog/queue-review.html
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '.cache', 'catalog', 'queue-review.html')
// Inlined JSON can't be allowed to close the script element it sits in.
const inline = async (path) => (await readFile(path, 'utf8')).trim().replace(/</g, '\\u003c')

const data = await inline(join(ROOT, '.cache', 'catalog', 'review.json'))
const land = await inline(join(ROOT, 'public', 'data', 'land.json'))
const html = (await readFile(join(ROOT, 'scripts', 'review-page.html'), 'utf8'))
  .replace('/*__DATA__*/null', () => data)
  .replace('/*__LAND__*/null', () => land)
await writeFile(OUT, html)
console.log(`review page → ${OUT}`)
