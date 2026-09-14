// Builds the Discover map's basemap: Natural Earth 1:110m land (public domain),
// flattened into one SVG path. Coordinates are in fifths of a degree (x = lon·5,
// y = −lat·5) as relative moves, which keeps the file around 20 KB.
// Run once, or whenever the source changes: npm run basemap
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'land.json')
const K = 5

const res = await fetch(SRC)
if (!res.ok) throw new Error(`${SRC}: ${res.status}`)
const geo = await res.json()

const rings = []
for (const f of geo.features) {
  const g = f.geometry
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  for (const poly of polys) for (const ring of poly) rings.push(ring)
}

let d = '', points = 0
for (const ring of rings) {
  const pts = []
  for (const [lon, lat] of ring) {
    const p = [Math.round(lon * K), Math.round(-lat * K)]
    const last = pts[pts.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p)
  }
  if (pts.length < 4) continue
  d += `M${pts[0][0]} ${pts[0][1]}l`
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1]
    d += `${i > 1 && dx >= 0 ? ' ' : ''}${dx}${dy >= 0 ? ' ' : ''}${dy}`
  }
  d += 'z'
  points += pts.length
}

await writeFile(OUT, JSON.stringify({ source: 'Natural Earth 1:110m land, public domain', units: `1/${K} degree; x = lon, y = -lat`, scale: K, d }))
console.log(`basemap: ${rings.length} rings, ${points} points, ${(d.length / 1024).toFixed(1)} KB → ${OUT}`)
