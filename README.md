# Climate Fit

A historical weather browser that scores cities against **your** definition of comfortable. Implements the Claude Design mockups (`Climate Fit - Mockups.dc.html`) against `climate-fit-app-spec.md` v4, using real ERA5 reanalysis data: the City Dashboard (option 1a), and the second round's Compare (2a), Discover (2b), Data & Methods (2c) and opening state (2d).

## Run

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # scoring engine, screens' logic and URL-state tests (on the real data files)
npm run build        # static site in dist/ — host anywhere, no server
```

## Stack

React 19 + TypeScript + Vite. No backend: the spec puts all scoring on the client with no network round trip, so the app is a static site plus pre-fetched JSON. There are no runtime dependencies beyond React.

## Screens

One control bar, four screens. Tabs in the bar switch between them (the mockup's navigation option F1), and every screen reads the same session state: drag a handle on Compare and every city in the set re-scores.

| Screen | What it shows |
|---|---|
| **City** | One city in full depth. With nothing set it opens in the **opening state**: starting points (alphabetical, equal weight), the record as measured on a raw-temperature calendar, and every city ranked by walk-viable days — a published physical threshold, so no preference is needed. The raw-temperature ramp is never used for comfort; the calendar keeps it as a TEMPERATURE view once a band is set. |
| **Compare** | Two to four cities: day budgets on one shared scale, why days fall short and the compromise profile per city, calendars stacked on one day-of-year axis, and a pivoted monthly table with a differences-only mode. Ordered by comfortable days; no winner is picked. With nothing set it compares walk-viable days and the raw record instead. |
| **Discover** | The whole set, ranked by comfort (five sorts) or by outdoor days (no input needed). Filters for region, population, snow access and coast; a map; and "like [city] but ___" similarity search. **Never empty**: if no city reaches 100 comfortable days the comfortable-days sort falls back to fewest unbearable days and says so; if no city passes the filters, the nearest misses are shown with the filter each one misses. |
| **Methods** | Data & methods: sources and tiers, grid-cell vs city elevation for every city, observed vs derived with the formula for each, every scoring constant, the activity thresholds in your units, the terrain each drive stop resolves to, derived season boundaries, known limitations and the daily CSV export. The foot of each city page keeps a short strip for that city, linking here. |

Everything is in the URL. On top of the preferences: `view` (`compare`, `discover` or `methods`; the city screen is the default), `cmp` (the compare set, up to four), and Discover's query — `rank`, `sort`, `reg`, `pop`, `snowf`, `coast`, `like`, `but`. Moving to another screen or city adds a history entry, so Back works; control-bar changes replace the current one.

Compare, Discover and the opening ranking score every loaded city on each change (about 5 ms for ten cities over ten years, 20 ms over thirty). They render from a deferred copy of the settings, so a dragged handle stays live while the rest of the set catches up.

## Data pipeline

`npm run fetch-data` pulls 1991–2025 daily data from the [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) for every city in `src/data/catalog.json`, and ERA5-Land snow depth for every ski-terrain reference. It writes compact JSON to `public/data/` and rebuilds `public/data/manifest.json` (the set-relative Solar Intensity and four-season indices). Feb 29 is dropped so every year is 365 columns.

- **The fetch can be resumed.** Existing files are skipped. Pass city ids to fetch only those: `npm run fetch-data -- calgary prague`.
- **Rate limits.** The free tier counts one 35-year request as roughly 900 "calls", against limits of 600 per minute, 5,000 per hour and 10,000 per day. The script waits out the per-minute and per-hour limits on its own. It stops cleanly at the daily limit, so re-run it the next day. Growing to the spec's "few hundred metros" will need an Open-Meteo API key (commercial tier) or a direct ERA5 download from Copernicus CDS.
- **Two shorter tiers** are fetched alongside, each labelled as its own tier wherever it appears:
  - `public/data/hourly/` — hourly temperature for the last 10 years (base64 Int16, ~230 KB/city, loaded only by the Typical day panel).
  - `public/data/aq/` — air quality, one file shape for every city (`src/lib/aq.ts`) from one of two sources:
    - **US cities: EPA monitors, 2000 onward.** Validated daily AQI from [EPA AirData](https://aqs.epa.gov/aqsweb/airdata/download_files.html) for ozone, PM2.5, PM10 and NO₂, from monitors within 50 km. Ozone takes each day's highest monitor, the way the EPA and AirNow report a metro: ozone is regional, and downtown monitors read low because fresh traffic exhaust destroys it at street level. With three or more monitors reporting, a lone top reading more than 50 AQI points above the next is treated as a faulty monitor and skipped. Without that guard, one bad monitor (Fort McDowell, AZ, 2020–21) gave Phoenix 137 "unhealthy" ozone days in 2020, and the EPA's own metro AQI counts it too. PM2.5, PM10 and NO₂ are local, so each day takes the nearest monitor that reported. The rule per pollutant is `epaPick` in `src/lib/aq.ts`.
    - **Everywhere else: the CAMS model** via Open-Meteo, Aug 2022 onward globally and 2013 onward in Europe. A US city with no monitor in range falls back to it too.
    - The AirData zips (~350 MB for the full history) are cached in `.cache/airdata/`, which git ignores. They're revalidated on every run, so only files the EPA has changed are downloaded again. The step needs the `unzip` command (standard on macOS and Linux).
- The data is committed as static files (~8.3 MB total), so the app runs with no API access at all.

### The current year

The archive is whole years (1991–2025). The current year (2026) is **partial**, so it is kept out of every lookback window. A year missing its autumn and winter would skew every per-year mean. Instead it's shown alongside the window and only ever compared like for like: Jan 1 → the last observed day, against the same dates in each window year.

- **Live:** the app fetches the current year from Open-Meteo in the browser when a city loads. That's two small requests, cached for the day in `localStorage`. The dashboard never waits for it.
- **Fallback:** if the live fetch fails, the app uses `public/data/ytd/<city>.json`, a snapshot that `npm run fetch-data` re-writes on every run. It's labelled with its date.
- **Partial-data rules** (`src/lib/ytd.ts`):
  - "Observed" is the unbroken run of days from Jan 1 that have a high and a low, ending at the city's **local** yesterday (today isn't over).
  - Anything after a gap is dropped.
  - Feb 29 is dropped, as in the archive.
  - Seasons come from the window, not the partial year.
  - Comparisons are withheld until 14 days are observed.
  - Ski-terrain snow depth lags a few days; the last value is carried forward up to 7 days.
  - The most recent days are provisional and are labelled that way.
- **Where it appears:** the hero ("2026 so far" vs typical-by-this-date), an extra calendar row below the window (unobserved days are outlined, never coloured), a "2026 so far" mode on the temperature chart (with counts above p90 and below p10), and a 2026 / typical column on the threshold counters.
- The live fetch means the deployed app calls Open-Meteo from users' browsers. The free tier is for non-commercial use; a commercial deployment needs an API key or a server-side cache.

To add a city, append it to `catalog.json` (with its continent, any terrain references and drive minutes), then run `npm run fetch-data`.

The Discover map's land comes from [Natural Earth](https://www.naturalearthdata.com/) 1:110m (public domain). `npm run basemap` flattens it into one SVG path in `public/data/land.json` (~21 KB, committed like the rest), loaded only by Discover.

### Updating air quality

- **EPA revisions and new years.** The EPA publishes each year about six months after it ends and revises recent years each June and December. To pick those up, delete the air-quality files and re-run: `rm public/data/aq/*.json && npm run fetch-data`. Air quality follows `archive.endYear` in `catalog.json`, the same as the weather.
- **Changing the file shape or how it's built.** Bump `AQ_FORMAT` in `src/lib/aq.ts`. The next `npm run fetch-data` rebuilds every file with an older format.
- **Adding a pollutant** (or changing the radius, start year or outlier guard). Edit `POLLUTANTS` (or `EPA_RADIUS_KM` / `EPA_START_YEAR` / `EPA_OUTLIER_AQI`) in `src/lib/aq.ts`. The fetch script and the app both read those, so bump `AQ_FORMAT` and re-run.

## Layout

```
src/lib/        pure logic, no React
  scoring.ts    four-point ramps, seasons, apparent/in-sun temperature, per-day bands
  aggregate.ts  day budget, streaks, activities, monthly rollup, counters, facts
  activities.ts fixed activity presets as plain numbers; the day test and the published wording both derive from them
  prefs.ts      preferences, presets, URL encode/decode
  session.ts    the whole session (city, screen, prefs, compare set, Discover query) ↔ URL
  model.ts      series + prefs → everything the city screen renders; per-city summaries for the other screens
  compare.ts    compare set, monthly pivot and its tolerances
  discover.ts   filters, rankings, the never-empty fallbacks, "like [city] but ___"
  extras.ts     spec §5 features: best time, extremes, warming sensitivity, typical day, mosquito
  aq.ts         air-quality tier: pollutants, thresholds, file format, stats (shared with the fetch script)
  ytd.ts        current-year fetch (shared by the browser and the fetch script)
  current.ts    current-year loading, fallback, and like-for-like comparisons
src/components/ one file per screen or dashboard region; calendars are canvases (≤11k cells redrawn per drag)
scripts/        build-time data fetch (fetch-data.mjs; air-quality.mjs for EPA + CAMS), manifest, basemap
```

## Where the mockup and spec disagreed

Spec sections 2 and 9 are marked non-negotiable, so they won over the mockup:

| Mockup | Built |
|---|---|
| Opens in the cold-preferring example state | Opens **unset**: nothing is scored until you state a preference. The example state is one click away. |
| 4 presets including "Warm and sunny", warm-first | The spec's 7 presets, **alphabetical**. Every value a preset sets is printed next to its name. |
| Lookback 3/5/10/20/30 | 3/5/7/10/15/20/30 **plus a custom range** |
| Dual-range slider + separate ceiling slider | A **four-point slider**. Drag a hard handle off the track (or click the chip) to make that bound open (±∞). |
| Seasons hard-coded May–Oct; cold band derived from the warm band | Seasons **derived per city** from its six warmest months (hemisphere-agnostic, blended at the boundaries). The cold-season band is a real second slider. |
| Wind ceiling changed activity thresholds | Activity thresholds are **fixed** (v1). Wind is a comfort variable instead. |
| Drift colours treated "less snow" as bad | Count deltas are neutral. Only your-fit rows are coloured good/bad. |

Kept from the mockup: open-ended bounds fade on a soft ramp rather than scoring as ideal. The spec's literal reading ("colder is never a problem" = score 1.0) would make a 5°F day "comfortable" for anyone with no floor. Hatched unbearable = crossed a line drawn in the control bar. Solid unbearable = a deal-breaker from More controls.

### Second round (Compare, Discover, Data & Methods, opening state)

Some of these follow the same rule. The rest come from running on the real data and scoring engine, where the mockup ran on synthetic series.

| Mockup | Built |
|---|---|
| Six activities (walk, hike, run, ride, patio, garden), wind caps tied to the control bar | The app's own three (walk, run/cycle, ride) with fixed thresholds, printed in your units, everywhere: Discover's outdoor table, Compare, Data & Methods |
| Discover's fallback overrides whichever sort is chosen | Only the comfortable-days sort falls back, as spec 4.3 describes; a sort you choose is honoured |
| Filters can empty the result set | Never empty: the cities missing the fewest filters are shown, with what each misses |
| Trend slopes coloured by sign | Coloured only where R² ≥ 0.3; below that the fit is mostly year-to-year noise |
| Map with a plain graticule, "basemap substituted in build" | Natural Earth land under the graticule; fill = comfortable share of your year, radius = outdoor days |
| "Like [city] but" distance on hand-set climatology | Distance on the window's own mean high, dew point, cloud, shortwave and snow-sport days in reach; scales published in Data & Methods |
| Compare's unset state not drawn | Compares walk-viable days, the raw record and raw-temperature calendars |
| Compare chips re-sort as you drag | Chips stay in the order added, so they are stable to click; the rows below are ranked |
| Grid-cell flag at 200 ft | 300 ft, the same threshold as the city page |
| Opening state without the city header | The header stays (it is facts, not scoring), below the starting points |
| Three navigation options (F1 tabs, F2 rail, F3 command bar) | F1: tabs in the control bar; ⌘K still opens the city picker |

## Secondary features (spec §5)

| Spec | Where |
|---|---|
| 5.1 Best time to visit | Panel: top three non-overlapping 1-week / 2-week / 30-day spans by comfortable share |
| 5.2 Streak analysis | Seasonality panel (longest comfortable / unbearable / without-comfortable runs) + worst span of the year |
| 5.3 Air quality / smoke days | Panel on a separate tier with its own dates (EPA monitors for US cities, CAMS elsewhere), clipped to the lookback window. Days above AQI 50 / 100 / 150, overall and per pollutant (ozone, PM2.5, PM10, NO₂); AQI > 100 by month, stacked by pollutant; per-year trend; the monitors used |
| 5.4 Mosquito proxy | Panel + threshold counter, labelled as a rough proxy |
| 5.5 Typical day profile | Hourly p10–p90 by month, sunrise/sunset, dawn / afternoon / dusk readouts, comfort band overlay |
| 5.6 Annotated extremes | Panel of dated single-day records; the record high/low is also marked on the distribution chart |
| 5.7 What would have to change | Uniform-warming sensitivity (−4…+12°F), crossing below a chosen comfortable-day count, year at the city's own trend (with R²) |
| 5.8 Deal-breaker reclaim | Hero panel (built in the first pass) |
| 3.5 Month × year matrix | Click any threshold counter |

## Not built yet

- Mobile bottom-sheet control bar (the layout is desktop-first, min width 1100px) and a light theme.
- Scoring on relative humidity, snowfall and daylight.
- Discover's elevation-range and deal-breaker filters (spec 4.3), and an "improving / declining" split beyond sorting by trend.
