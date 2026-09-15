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

`npm run fetch-data` builds 1991–2025 daily data for every city in `src/data/catalog.json`, and ERA5-Land snow depth for every ski-terrain reference. It writes compact JSON to `public/data/` and rebuilds `public/data/manifest.json` (the set-relative Solar Intensity and four-season indices). Feb 29 is dropped so every year is 365 columns.

- **Source.** The weather comes from [Open-Meteo's public S3 bucket](https://github.com/open-meteo/open-data) (AWS Open Data, CC-BY 4.0), not the API. `scripts/open-meteo-s3.mjs` reads the raw hourly model data and computes each value the way the [Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) server does: the same blend of ECMWF IFS (2017 on), ERA5-Land and ERA5, the same grid-cell choice and elevation correction, the same daily aggregation and rounding. That takes no API calls, about 10 s and 8 MB per city. `--source api` uses the API instead.
- **Verified against the API.** Rebuilt this way, the original API files for all 11 seed cities, 15 terrain references and 11 hourly files came out identical: every value on every day, bar ≤0.02% of sunshine days that differ in the last digit. Air quality matched the API hour for hour on 20 cities across both CAMS models. `npm run verify-s3` repeats the check live for a sample of cities (the same requests both ways, weather and air quality, ~20 API calls a city) and exits non-zero on any mismatch.
- **Days are local standard time.** The API applies a zone's offset at the moment of the request to the whole record, so a file fetched in summer would run on daylight time all year. The S3 source always uses the zone's winter offset, the climatological convention, so a file doesn't depend on the season it was fetched in. Hourly data uses the local clock, daylight saving included.

- **The fetch can be resumed.** Existing files are skipped. Pass city ids to fetch only those: `npm run fetch-data -- calgary prague`.
- **API rate limits** now apply only to `--source api` and to the browser when it has to fetch live (below). The free tier counts one 35-year request as roughly 900 "calls", against limits of 600 per minute, 5,000 per hour and 10,000 per day. The script waits out the per-minute and per-hour limits on its own. It stops cleanly at the daily limit, so re-run it the next day.
- **Run budget.** Every request is priced the way Open-Meteo counts it (`weight` in `scripts/open-meteo.mjs`: per location, per 10 variables, per 14 days) and metered against `--budget` (default 9,000, leaving headroom for the app's own live fetches). A city is started only if its whole cost fits, so a run stops between cities. With the S3 source a new city costs nothing. From the API it costs ~950 calls in the US and ~1,050–1,300 elsewhere (CAMS air quality), plus ~913 for each ski-terrain reference it brings that isn't already fetched.
- **Two shorter tiers** are fetched alongside, each labelled as its own tier wherever it appears:
  - `public/data/hourly/` — hourly temperature for the last 10 years (base64 Int16, ~230 KB/city, loaded only by the Typical day panel). Every city has one: from S3 they cost nothing, so `fetch-data` writes them by default (`--no-hourly` skips them; with `--source api` they cost ~261 calls a city and need `--hourly`). The manifest lists which cities have a file. One without (added by hand with `--no-hourly`, say) has its decade fetched live from Open-Meteo the first time its panel opens, labelled as live and kept in the browser's Cache Storage. The hours are local clock time, daylight saving included, matching the panel's sunrise and sunset marks.
  - `public/data/aq/` — air quality, one file shape for every city (`src/lib/aq.ts`) from one of two sources:
    - **US cities: EPA monitors, 2000 onward.** Validated daily AQI from [EPA AirData](https://aqs.epa.gov/aqsweb/airdata/download_files.html) for ozone, PM2.5, PM10 and NO₂, from monitors within 50 km. Ozone takes each day's highest monitor, the way the EPA and AirNow report a metro: ozone is regional, and downtown monitors read low because fresh traffic exhaust destroys it at street level. With three or more monitors reporting, a lone top reading more than 50 AQI points above the next is treated as a faulty monitor and skipped. Without that guard, one bad monitor (Fort McDowell, AZ, 2020–21) gave Phoenix 137 "unhealthy" ozone days in 2020, and the EPA's own metro AQI counts it too. PM2.5, PM10 and NO₂ are local, so each day takes the nearest monitor that reported. The rule per pollutant is `epaPick` in `src/lib/aq.ts`.
    - **Everywhere else: the CAMS model** from Open-Meteo, computed from its S3 bucket the way the air-quality API computes US AQI (running means, EPA breakpoints), and identical to the API wherever the bucket has the data: Aug 2022 onward globally, 2024 onward in Europe. The API also serves Europe's 2013–2023 reanalysis, which isn't in the bucket; the European cities fetched before the S3 switch have it, and `--source api` still fetches it. A US city with no monitor in range falls back to CAMS too.
    - The AirData zips (~350 MB for the full history) are cached in `.cache/airdata/`, which git ignores. They're revalidated on every run, so only files the EPA has changed are downloaded again. The step needs the `unzip` command (standard on macOS and Linux).
- The data is committed as static files (~186 MB for 238 cities: ~450 KB of daily archive and ~230 KB of hourly temperature a city), so the app runs with no API access at all.

### The current year

The archive is whole years (1991–2025). The current year (2026) is **partial**, so it is kept out of every lookback window. A year missing its autumn and winter would skew every per-year mean. Instead it's shown alongside the window and only ever compared like for like: Jan 1 → the last observed day, against the same dates in each window year.

- **Snapshot first:** `public/data/ytd/<city>.json` is a snapshot built by `npm run fetch-data`, labelled with its date. While it's under a day old the app uses it: it ends at the city's local yesterday, same as a live fetch. From S3 every run refreshes all of them (from the API, weekly with whatever budget is left; `--refresh-ytd` forces it), so with a daily run the browser never calls Open-Meteo for the current year.
- **Live otherwise:** with an older snapshot the app fetches the current year from Open-Meteo in the browser when a city loads: two small requests, cached for the day in `localStorage`. If that fails it falls back to the snapshot, however old. The dashboard never waits for either.
- **Partial-data rules** (`src/lib/ytd.ts`):
  - "Observed" is the unbroken run of days from Jan 1 that have a high and a low, ending at the city's **local** yesterday (today isn't over).
  - Anything after a gap is dropped.
  - Feb 29 is dropped, as in the archive.
  - Seasons come from the window, not the partial year.
  - Comparisons are withheld until 14 days are observed.
  - Ski-terrain snow depth lags a few days; the last value is carried forward up to 7 days.
  - The most recent days are provisional and are labelled that way.
- **Where it appears:** the hero ("2026 so far" vs typical-by-this-date), an extra calendar row below the window (unobserved days are outlined, never coloured), a "2026 so far" mode on the temperature chart (with counts above p90 and below p10), and a 2026 / typical column on the threshold counters.
- A live fetch means the deployed app calls Open-Meteo from users' browsers. The free tier is for non-commercial use; a commercial deployment needs an API key or a server-side cache.

### Adding cities

`src/data/catalog.json` is the set the app shows. `src/data/queue.json` is the cities waiting for data. `npm run fetch-data` works through the queue in order and moves each city into the catalogue once all its files are written, so the app never lists a city it can't load.

- **One city by hand:** append it to `catalog.json` (with its continent, any terrain references and drive minutes), then run `npm run fetch-data -- <id>`.
- **Many:** `npm run catalog -- --force` drafts the queue from `scripts/catalog.config.mjs`, then ranks it. It spends no Open-Meteo calls. Review the queue, then let the nightly job drain it. From S3 that spends no API calls, so one run fetches the whole queue. The config says who the set is for: a software engineer choosing where to move, leaning cold and snowy, mostly North America. It shapes which cities are in the set and the order they're fetched, never how the app scores days.
  - **Candidates.** [GeoNames](https://download.geonames.org/export/dump/) towns over the population floor (150k; 75k in the US and Canada), one per 25 km. Suburbs are left out:
    - **US:** a city is a suburb if its metro area (CBSA, from NBER's copy of the Census delineation) has a city 1.5× bigger. Minneapolis and St. Paul both stay; Aurora (Denver) and Kent (Seattle) don't. Boulder, Provo and Ann Arbor are their own metros.
    - **Elsewhere:** within 50 km of a place 4× bigger, or 70 km of one 15× bigger.
    - **Filters:** places with more than two muggy months (mean dew point ≥ 65°F) are out. So are countries under a US State Department Level 4 advisory. Russia, Belarus and Ukraine keep one city each, fetched last.
  - **Named cities.** `include` and `exclude` in the config, each with its reason. The exclusions came from validating the ranked draft: suburbs the rules miss, and places with little to recommend them as a home (high crime, decline, remoteness). Named includes skip every filter (Portland ME, Burlington, Bozeman, Missoula and Flagstaff are under the floor).
  - **Choice.** Named cities first. Then every European country gets its best-fitting city, capital preferred. Then the rest, inside continent quotas (`shares`) and country caps, each pick the best fit, with a place whose climate is already in the set counting half. The set stays varied without passing over a major city just because its neighbour is similar. A continent without enough cities fitting better than `minFit` stays short rather than handing its places to another.
  - **Ranking (the fetch order).** Fit = 0.5 climate + 0.35 tech + 0.15 walkability, each 0–1 (`scripts/fit-score.mjs`):
    - **Climate:** cool summers, few muggy months, a real winter, and ski terrain by drive time.
    - **Tech:** software jobs within commuting reach, full within 40 km and gone by 100 km. For the US it's measured: BLS QCEW private employment in NAICS 5132/5182/5192/5415 by county. Elsewhere it's an estimate: hub tiers in the config.
    - **Walkability:** the share of commuters who take transit, walk or cycle. For the US it's measured: ACS table B08301 by place. Elsewhere it's an estimate by country, adjusted for size.
    - **Climate data:** [CRU CL 2.0](https://crudata.uea.ac.uk/cru/data/hrg/tmc/) (New et al. 2002), 1961–1990 monthly normals on a 10′ grid, used for choosing and ranking only. It's bulk files, so it's repeatable and never rate-limited; NASA POWER throttled the run after about 850 points.
  - **Ski terrain.** [OpenSkiMap](https://openskimap.org/) operating downhill areas with at least 150 m of vertical, at least one operating lift, and nothing summer-only or private. The reference elevation is mid-mountain (the midpoint of the runs), which matches every hand-set entry to within a few hundred feet.
    - **Drive times** come from the [OSRM](https://project-osrm.org/) demo server, routed to each area's lift bottom stations with the quickest one winning. Routing to the area's centre snaps to mountain tracks, and routing to the lowest lift can land on a back side.
    - OSRM's demo profile runs slow on highways, so its minutes are scaled by 0.86. That's the median ratio against the seed's 18 hand-set routes (range 0.71–1.04). With the scale, the rules reproduce the hand-set references closely: Denver gets Echo 55 / Loveland 65, Prague gets Špindlerův Mlýn 110, Phoenix gets Snowbowl 160.
    - **One reference per band** (≤1, ≤2, ≤3 hr): the highest in the band, with bigger resorts counted 40 m higher per doubling of their run count. A farther band only adds one if it's 200 m higher than anything closer, and an already-fetched reference wins unless a new one sits 300 m higher. Each new reference costs ~913 calls; these rules took the queue from 225 new references to about 165.
  - **Coastal:** within 20 km of the Natural Earth 1:10m coastline.
  - **Review.** Each queue entry carries a `note` (fit, its parts, Köppen class, why it's there) that is dropped on promotion. Reorder, edit or delete entries freely.
    - `--dry-run` prints the choice and ranking in seconds, with the best candidates just below each continent's line.
    - `--check` prints what the terrain and coastal rules give for the seed cities, next to their hand-set values.
    - Everything else about the draft goes to `.cache/catalog/review.json`. `npm run review-page` turns it into `.cache/catalog/queue-review.html`: a map, the ranked table with each fit's parts and whether they're measured or estimated, what was left out and why, and the best cities just below each region's line.
  - Downloads are cached in `.cache/catalog/`. Delete a file there to refresh it.
- **Nightly:** `npm run nightly -- install` schedules `fetch-data` daily at 03:00 through launchd (a run missed while the Mac slept happens on wake), logging to `.cache/nightly.log`. `npm run nightly -- status` shows the last run; `uninstall` removes it. It only writes files; commit them when you like.

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
  hourly.ts     hourly tier: request, 365 × 24 grid, live fetch (shared the same way)
  current.ts    current-year loading, fallback, and like-for-like comparisons
src/components/ one file per screen or dashboard region; calendars are canvases (≤11k cells redrawn per drag)
scripts/        build-time data fetch (fetch-data.mjs; air-quality.mjs for EPA + CAMS), manifest, basemap
  open-meteo.mjs     request pricing (weight), the run budget, the archive requests
  catalog-file.mjs   catalog.json / queue.json layout and promotion
  build-catalog.mjs  drafts and ranks the queue; catalog.config.mjs says for whom
  fit-score.mjs      the ranking's climate / tech / walk parts; us-metrics.mjs (BLS, ACS, Census) feeds it
  koppen.mjs         Köppen–Geiger classes, for labelling the queue
  nightly.mjs        installs the daily fetch in launchd
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
