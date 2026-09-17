# Climate Fit

A historical weather browser that scores cities against **your** definition of comfortable. It covers 242 cities with daily data for 1991–2025, plus the current year so far. The set leans cold, snowy and North American.

## Run

```sh
npm install
npm run dev       # http://localhost:5173
npm test          # vitest: scoring engine, screen logic, URL state, data pipeline
npm run check     # typecheck + oxlint + prettier --check
npm run build     # static site in dist/, no server needed
```

React 19, TypeScript and Vite. There's no backend: all scoring runs in the browser against pre-fetched JSON in `public/data/`, which is committed (~185 MB).

## Deploy

Every push to `main` builds the site and publishes it to GitHub Pages (`.github/workflows/deploy.yml`) at `https://captnbigshot.github.io/climate-fit/`. Production builds use the `/climate-fit/` base path (`vite.config.ts`); `npm run dev` still serves from `/`. The first time, set the repo's Settings → Pages source to **GitHub Actions**.

## Screens

Tabs in the control bar switch between four screens. They all share one session state, so changing a preference re-scores every screen. The whole session is kept in the URL.

- **City**: one city in depth, with a comfort calendar, day budget, temperature distribution, typical day, best time to visit, extremes, air quality and warming sensitivity. With no preference set it opens on starting presets and ranks cities by walk-viable days.
- **Compare**: two to four cities on shared scales, with a map, stacked calendars and a monthly table. Ordered by comfortable days; it never picks a winner.
- **Discover**: the whole set, ranked and filtered (region, population, snow access, coast), on a pan/zoom map, with "like [city] but ___" search. It's never empty: if nothing matches, it shows the nearest misses. Cities can be starred here or on the City screen, and the ranking scoped to starred or unstarred cities. Stars are kept in the URL like everything else.
- **Methods**: data sources, every scoring constant and threshold, and a daily CSV export.

## Data

`npm run fetch-data` builds everything in `public/data/`. It skips existing files, so it can be resumed, and takes city ids to fetch only those (`npm run fetch-data -- calgary prague`).

| Tier                   | Source                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily weather, 1991–   | [Open-Meteo's S3 bucket](https://github.com/open-meteo/open-data) (ERA5 / ERA5-Land / ECMWF IFS, CC-BY 4.0), computed the way their Historical API does |
| Hourly temp, 10 yr     | Same bucket; loaded only by the Typical day panel                                                                                                       |
| Current year           | `ytd/` snapshot from the last fetch; the browser fetches live from Open-Meteo if the snapshot is over a day old                                         |
| Air quality            | US: [EPA AirData](https://aqs.epa.gov/aqsweb/airdata/download_files.html) monitors within 50 km, 2000 on. Elsewhere: the CAMS model via Open-Meteo      |
| Ski-terrain snow depth | ERA5-Land at each terrain reference's mid-mountain elevation                                                                                            |
| Map land               | [Natural Earth](https://www.naturalearthdata.com/) 1:110m (`npm run basemap`)                                                                           |

- Reading from S3 uses no API calls. `--source api` switches to the Open-Meteo API, which is rate-limited and metered against `--budget`.
- `npm run verify-s3` checks a sample of cities against the live API and fails on any mismatch.
- Days are in local standard time and Feb 29 is dropped, so every year has 365 days.
- The partial current year is never mixed into lookback windows. It's only compared like for like against the same dates in past years (`src/lib/ytd.ts`).
- To pick up EPA revisions, delete `public/data/aq/*.json` and re-run. If you change the air-quality file shape or rules, bump `AQ_FORMAT` in `src/lib/aq.ts`.

### Adding cities

`src/data/catalog.json` is the set the app shows. `src/data/queue.json` holds cities waiting for data. `fetch-data` works through the queue and moves each city into the catalogue once all its files are written.

- **One city:** add it to `catalog.json`, then run `npm run fetch-data -- <id>`.
- **Many:** `npm run catalog -- --force` drafts and ranks the queue from `scripts/catalog.config.mjs`. That config sets the population floor, filters, named includes/excludes and continent quotas. Candidates come from GeoNames, and they're ranked by climate fit, nearby tech jobs and walkability (`scripts/fit-score.mjs`). `--dry-run` previews the result; `npm run review-page` builds an HTML review of the draft in `.cache/catalog/`.
- **Nightly:** `npm run nightly -- install` schedules `fetch-data` for 03:00 daily through launchd (use `status` to see the last run, `uninstall` to remove it). It writes files but never commits them.

## Layout

```
src/lib/          pure logic, no React; scoring.ts, aggregate.ts, model.ts are the core
src/components/   one file per screen or dashboard region; calendars draw to canvas
src/hooks/        small shared React hooks
src/data/         catalog.json (the set) and queue.json (waiting for data)
scripts/          build-time data pipeline: fetch, air quality, catalog, manifest, basemap
public/data/      generated data, committed
```

## Not built yet

- Mobile layout (desktop-first, min width 1100px) and a light theme.
- Scoring on relative humidity, snowfall and daylight.
- Discover's elevation-range and deal-breaker filters.
- Keeping the deployed data fresh. `nightly` / `fetch-data` only write files locally, so the Pages site's `ytd/` snapshots are only as new as the last push; past a day old the browser falls back to live Open-Meteo fetches. Options to look into: a scheduled GitHub Action that runs `fetch-data` and commits, or committing the nightly output automatically.
