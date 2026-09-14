# Climate Fit

A historical weather browser that scores cities against **your** definition of comfortable. Implements the City Dashboard from the Claude Design mockup (`Climate Fit - Mockups.dc.html`, option 1a) against `climate-fit-app-spec.md` v4, using real ERA5 reanalysis data.

## Run

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # scoring engine + URL-state tests (uses the real Tacoma data file)
npm run build        # static site in dist/ — host anywhere, no server
```

## Stack

React 19 + TypeScript + Vite. No backend: the spec puts all scoring on the client with no network round trip, so the app is a static site plus pre-fetched JSON. There are no runtime dependencies beyond React.

## Data pipeline

`npm run fetch-data` pulls 1991–2025 daily data from the [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) for every city in `src/data/catalog.json`, and ERA5-Land snow depth for every ski-terrain reference. It writes compact JSON to `public/data/` and rebuilds `public/data/manifest.json` (the set-relative Solar Intensity and four-season indices). Feb 29 is dropped so every year is 365 columns.

- **The fetch can be resumed.** Existing files are skipped. Pass city ids to fetch only those: `npm run fetch-data -- calgary prague`.
- **Rate limits.** The free tier counts one 35-year request as roughly 900 "calls", against limits of 600 per minute, 5,000 per hour and 10,000 per day. The script waits out the per-minute and per-hour limits on its own. It stops cleanly at the daily limit, so re-run it the next day. Growing to the spec's "few hundred metros" will need an Open-Meteo API key (commercial tier) or a direct ERA5 download from Copernicus CDS.
- **Two shorter tiers** are fetched alongside, each labelled as its own tier wherever it appears:
  - `public/data/hourly/` — hourly temperature for the last 10 years (base64 Int16, ~230 KB/city, loaded only by the Typical day panel).
  - `public/data/aq/` — air quality from the CAMS model: **Aug 2022 onward globally, 2013 onward in Europe**. That's the free history available, which is shorter than the spec's "~2013+".
- The data is committed as static files (~7.5 MB total), so the app runs with no API access at all.

To add a city, append it to `catalog.json` (with any terrain references and drive minutes), then run `npm run fetch-data`.

## Layout

```
src/lib/        pure logic, no React
  scoring.ts    four-point ramps, seasons, apparent/in-sun temperature, per-day bands
  aggregate.ts  day budget, streaks, activities, monthly rollup, counters, facts
  activities.ts fixed activity presets (every threshold published in Data & methods)
  prefs.ts      session state, presets, URL encode/decode
  model.ts      one call: series + prefs → everything the dashboard renders
  extras.ts     spec §5 features: best time, extremes, warming sensitivity, typical day, air quality, mosquito
src/components/ one file per dashboard region; the calendar is a canvas (≤11k cells redrawn per drag)
scripts/        build-time data fetch + manifest
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

## Secondary features (spec §5)

| Spec | Where |
|---|---|
| 5.1 Best time to visit | Panel: top three non-overlapping 1-week / 2-week / 30-day spans by comfortable share |
| 5.2 Streak analysis | Seasonality panel (longest comfortable / unbearable / without-comfortable runs) + worst span of the year |
| 5.3 Air quality / smoke days | Panel on a separate CAMS tier with its own date range; AQI > 100, > 150, PM2.5 smoke proxy, by month |
| 5.4 Mosquito proxy | Panel + threshold counter, labelled as a rough proxy |
| 5.5 Typical day profile | Hourly p10–p90 by month, sunrise/sunset, dawn / afternoon / dusk readouts, comfort band overlay |
| 5.6 Annotated extremes | Panel of dated single-day records; the record high/low is also marked on the distribution chart |
| 5.7 What would have to change | Uniform-warming sensitivity (−4…+12°F), crossing below a chosen comfortable-day count, year at the city's own trend (with R²) |
| 5.8 Deal-breaker reclaim | Hero panel (built in the first pass) |
| 3.5 Month × year matrix | Click any threshold counter |

## Not built yet

- **Compare** and **Discover** screens: to be mocked up in Claude Design first. "Add to compare" already stores the set in the URL.
- Mobile bottom-sheet control bar (the layout is desktop-first, min width 1100px) and a light theme.
- Scoring on relative humidity, snowfall and daylight.
