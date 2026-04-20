#!/usr/bin/env node
// Fetch a user's fantasy team picks from TV2 and write to data/my-team.json.
// Usage: node scripts/fetch-team.mjs <team-id>

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
  Referer: "https://fantasy.tv2.no/",
  Origin: "https://fantasy.tv2.no",
};

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

const teamId = Number(process.argv[2]);
if (!teamId || teamId < 1) {
  console.error("Usage: node scripts/fetch-team.mjs <team-id>");
  process.exit(1);
}

const HOSTS = ["https://fantasy.tv2.no", "https://fantasy.eliteserien.no"];

// Load bootstrap to find finished/current gameweeks.
let bootstrap = null;
for (const host of HOSTS) {
  try {
    bootstrap = await fetchJson(`${host}/api/bootstrap-static/`);
    break;
  } catch (e) {
    console.warn(`bootstrap from ${host} failed:`, e.message);
  }
}
if (!bootstrap) { console.error("Could not load bootstrap"); process.exit(1); }

const events = (bootstrap.events ?? []).filter((e) => e.finished || e.is_current);
events.sort((a, b) => b.id - a.id); // most recent first

let picks = null;
let usedGw = null;
for (const ev of events) {
  for (const host of HOSTS) {
    try {
      picks = await fetchJson(`${host}/api/entry/${teamId}/event/${ev.id}/picks/`);
      usedGw = ev.id;
      break;
    } catch (e) {
      console.warn(`picks gw${ev.id} from ${host}:`, e.message);
    }
  }
  if (picks) break;
}

if (!picks) {
  console.error(`No picks found for team ${teamId}`);
  process.exit(1);
}

await mkdir(DATA_DIR, { recursive: true });
const out = {
  team_id: teamId,
  gameweek: usedGw,
  fetched_at: new Date().toISOString(),
  picks: picks.picks ?? [],
};
await writeFile(resolve(DATA_DIR, "my-team.json"), JSON.stringify(out, null, 2));
console.log(`Saved ${out.picks.length} picks for team ${teamId} (gw${usedGw})`);
