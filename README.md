# Eliteplan

A lightweight client-side planner for **Eliteserien Fantasy** (TV 2 Fantasy).
Inspired by the original [eliteplan.team](https://www.eliteplan.team/) tool
that went offline. Preview your squad, see upcoming fixtures, and plan
transfers for future gameweeks.

Features:

- 15-player squad builder with the real game constraints (100.0m budget,
  2 GK / 5 DEF / 5 MID / 3 FWD, max 3 per club)
- Formation picker (3-4-3, 4-4-2, 4-3-3, 3-5-2, 4-5-1, 5-3-2, 5-4-1)
- Next-N fixtures badge on every starter with FDR colouring
- Gameweek selector (prev/next + dropdown)
- Searchable/filterable player pool with price and points sorting
- Squad is persisted to `localStorage`
- 100% static – no build step, no backend

## Quick start

```bash
npm start          # serves http://localhost:5173
```

Or open `index.html` with any static host (`python3 -m http.server`, etc.).

## Refreshing data

There are three ways to get live data in. All three write to the same JSON
files the UI reads (`data/bootstrap.json`, `data/fixtures.json`,
`data/meta.json`).

### 1. In-browser refresh (recommended)

Run `npm start`, then click **↻ Oppdater priser** in the top bar. The dev
server ships with a CORS-bypassing proxy (`/proxy/api/*`) that forwards
the allow-listed paths to `fantasy.tv2.no` (or `fantasy.eliteserien.no`
as a fallback).

### 2. Import your team by ID

Paste your TV 2 team ID and hit **Importer** – the app calls
`/proxy/api/entry/{id}/event/{gw}/picks` and replaces the on-pitch squad
with your actual 15 players.

### 3. Command-line fetch

```bash
npm run fetch
```

Writes the three JSON files to disk so the UI loads live data even
without the dev server running. Tries these endpoints in order:

| Purpose   | Primary                                      | Fallback                                         |
| --------- | -------------------------------------------- | ------------------------------------------------ |
| Bootstrap | `https://fantasy.tv2.no/api/bootstrap-static/` | `https://fantasy.eliteserien.no/api/bootstrap-static/` |
| Fixtures  | `https://fantasy.tv2.no/api/fixtures/`         | `https://fantasy.eliteserien.no/api/fixtures/`         |

Both hosts run the same FPL-clone platform, so the response shape
matches `fantasy.premierleague.com/api/bootstrap-static/` exactly.
Endpoints were verified against the open-source reference clients
[esf-planner](https://github.com/ViktorAlsos/esf-planner),
[fantasybotes](https://github.com/galku/fantasybotes), and
[viewfantasystats](https://github.com/olemabo/viewfantasystats).

### Manual fallback

If those hosts are blocked on your network, open
<https://fantasy.tv2.no/api/bootstrap-static> in a browser, save the
JSON, and drop it in at `data/bootstrap.json` (same for
`data/fixtures.json`).

### Regenerating sample fixtures

If you only have teams and want a placeholder fixture list (double
round-robin across the 30 gameweek events defined in `bootstrap.json`):

```bash
npm run sample-fixtures
```

## Layout

```
index.html            # App shell
assets/styles.css     # Styling (dark theme with pitch gradient)
assets/app.js         # Vanilla JS – rendering, state, storage
data/bootstrap.json   # Teams, players, events
data/fixtures.json    # Fixtures
data/meta.json        # Fetched-at metadata
scripts/fetch-data.mjs        # Live data fetcher
scripts/generate-sample-fixtures.mjs  # Round-robin generator
scripts/serve.mjs             # Tiny static server
```

## Notes on data sources

- **Prices & players**: `fantasy.tv2.no` (the official TV 2 Fantasy site
  for Eliteserien). Falls back to the alternate `fantasy.eliteserien.no`
  host if the first is unreachable.
- **Fixtures**: same API as above. If you need to cross-check, fotmob,
  FBref, and Transfermarkt all publish the Eliteserien schedule.

No data is fetched at runtime from the browser – the planner reads only
local JSON files – so you stay in control of what's loaded.
