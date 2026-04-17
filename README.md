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

The app reads three JSON files from `data/`:

- `bootstrap.json` – teams, players, gameweek events
- `fixtures.json` – all season fixtures
- `meta.json` – `fetched_at` timestamp and source URLs

The repo ships with **sample** team/fixture data so the UI works out of the
box. To pull live prices and official fixtures:

```bash
npm run fetch
```

This script tries these endpoints in order (first that responds wins):

1. `https://fantasy.tv2.no/api/bootstrap-static/`
2. `https://fantasy.eliteserien.no/api/bootstrap-static/`

Both follow the Fantasy Premier League schema that TV 2's Eliteserien
Fantasy is based on, so the response normalises to the same shape.

If you're on a network where those APIs are blocked, you can export the
JSON manually from your browser (DevTools → Network → filter
`bootstrap-static`) and drop it into `data/bootstrap.json`. The fetcher
script shows you the expected shape.

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
