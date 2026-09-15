// src/data/catalog.json (the cities in the app) and src/data/queue.json (cities waiting
// for their data, written by build-catalog.mjs). Both are kept in the same hand-editable
// layout: one terrain reference per line, three lines per city. fetch-data.mjs moves a
// city from the queue into the catalogue once all its files are written, so the app
// never lists a city it can't load.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data')
export const CATALOG_FILE = join(DATA, 'catalog.json')
export const QUEUE_FILE = join(DATA, 'queue.json')

const LINES = [['id', 'name', 'code', 'region'], ['lat', 'lon', 'pop', 'coastal', 'continent'], ['terrain']]
const KNOWN = new Set(LINES.flat())
const j = (v) => JSON.stringify(v)
const pairs = (o, keys) =>
  keys
    .filter((k) => o[k] !== undefined)
    .map((k) => `${j(k)}: ${k === 'terrain' ? terrainList(o[k]) : j(o[k])}`)
    .join(', ')
const terrainList = (t) => `[${t.map(([id, min]) => `[${j(id)}, ${min}]`).join(', ')}]`

function formatCity(c) {
  // Anything beyond the catalogue fields (a queue entry's review note) goes on its own line.
  const extra = Object.keys(c).filter((k) => !KNOWN.has(k))
  const lines = [...LINES, ...(extra.length ? [extra] : [])].map((keys) => `      ${pairs(c, keys)}`)
  return `    {\n${lines.join(',\n')}\n    }`
}

function formatTerrain(terrain) {
  const rows = Object.entries(terrain).map(([id, t]) => `    ${j(id)}: { ${pairs(t, Object.keys(t))} }`)
  return rows.length ? `{\n${rows.join(',\n')}\n  }` : '{}'
}

/** Catalogue or queue → text. Top-level keys other than terrain/cities go one per line. */
export function format(doc) {
  const head = Object.entries(doc)
    .filter(([k]) => k !== 'terrain' && k !== 'cities')
    .map(([k, v]) => `  ${j(k)}: { ${pairs(v, Object.keys(v))} }`)
  const cities = doc.cities.length ? `[\n${doc.cities.map(formatCity).join(',\n')}\n  ]` : '[]'
  return `{\n${[...head, `  "terrain": ${formatTerrain(doc.terrain)}`, `  "cities": ${cities}`].join(',\n')}\n}\n`
}

export const readCatalog = async () => JSON.parse(await readFile(CATALOG_FILE, 'utf8'))
export const writeCatalog = (c) => writeFile(CATALOG_FILE, format(c))

export async function readQueue() {
  try {
    return JSON.parse(await readFile(QUEUE_FILE, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}
export const writeQueue = (q) => writeFile(QUEUE_FILE, format(q))

/** A catalogue city: the queue entry without its review fields. */
export const catalogCity = (c) => Object.fromEntries(LINES.flat().map((k) => [k, c[k]]))

/** Move `id` from the queue into the catalogue, with any terrain it needs that the
 *  catalogue doesn't have yet, and drop queue terrain nothing else still waits on. */
export function promote(catalog, queue, id) {
  const city = queue.cities.find((c) => c.id === id)
  if (!city) throw new Error(`${id} is not in the queue`)
  if (catalog.cities.some((c) => c.id === id)) throw new Error(`${id} is already in the catalogue`)
  catalog.cities.push(catalogCity(city))
  for (const [tid] of city.terrain) catalog.terrain[tid] ??= queue.terrain[tid]
  queue.cities = queue.cities.filter((c) => c.id !== id)
  pruneQueueTerrain(catalog, queue)
}

export function pruneQueueTerrain(catalog, queue) {
  const waiting = new Set(queue.cities.flatMap((c) => c.terrain.map(([tid]) => tid)))
  queue.terrain = Object.fromEntries(
    Object.entries(queue.terrain).filter(([tid]) => waiting.has(tid) && !catalog.terrain[tid]),
  )
}
