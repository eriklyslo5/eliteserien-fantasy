#!/usr/bin/env node
// Scrape lagverdi (value + bank) for the top N teams in TV 2 Eliteserien Fantasy.
// Usage:  node scripts/fetch-top500.mjs [limit=500]
// Writes: data/top500.json

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

const HOST = "https://fantasy.tv2.no";
const OVERALL_LEAGUE_ID = 329; // "Totalt" – global league everyone is in
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 120;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
  Referer: "https://fantasy.tv2.no/",
  Origin: "https://fantasy.tv2.no",
};

const limit = Math.min(Number(process.argv[2]) || 500, 5000);

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (fetchErr) {
    try {
      const out = execFileSync("curl", [
        "-sf", "--max-time", "15",
        "-H", `User-Agent: ${HEADERS["User-Agent"]}`,
        "-H", "Accept: application/json",
        url,
      ], { timeout: 18000 });
      return JSON.parse(out.toString());
    } catch (curlErr) {
      throw new Error(`fetch: ${fetchErr.message} | curl: ${curlErr.message}`);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchStandings(maxEntries) {
  const pages = Math.ceil(maxEntries / PAGE_SIZE);
  const all = [];
  for (let p = 1; p <= pages; p++) {
    const data = await fetchJson(`${HOST}/api/leagues-classic/${OVERALL_LEAGUE_ID}/standings/?page_standings=${p}`);
    const results = data?.standings?.results ?? [];
    all.push(...results);
    if (results.length === 0 || !data?.standings?.has_next) break;
    if (all.length >= maxEntries) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return all.slice(0, maxEntries);
}

async function fetchLatestValueBank(entryId) {
  const data = await fetchJson(`${HOST}/api/entry/${entryId}/history/`);
  const cur = data?.current ?? [];
  if (cur.length === 0) return null;
  const last = cur[cur.length - 1];
  return { event: last.event, value: last.value, bank: last.bank };
}

function summarize(entries) {
  const totals = entries.map((e) => e.total_value).sort((a, b) => a - b);
  const values = entries.map((e) => e.value).sort((a, b) => a - b);
  const banks = entries.map((e) => e.bank).sort((a, b) => a - b);
  const n = totals.length;
  if (!n) return null;
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((arr.length * p) / 100))];
  const sum = (arr) => arr.reduce((s, v) => s + v, 0);
  return {
    count: n,
    total_value: {
      min: totals[0], max: totals[n - 1],
      avg: Math.round(sum(totals) / n),
      median: pct(totals, 50),
      p10: pct(totals, 10), p25: pct(totals, 25), p75: pct(totals, 75), p90: pct(totals, 90),
    },
    value: {
      min: values[0], max: values[n - 1],
      avg: Math.round(sum(values) / n),
      median: pct(values, 50),
    },
    bank: {
      min: banks[0], max: banks[n - 1],
      avg: Math.round(sum(banks) / n),
      median: pct(banks, 50),
    },
  };
}

async function main() {
  console.log(`Fetching top ${limit} from league ${OVERALL_LEAGUE_ID} ("Totalt") …`);
  const standings = await fetchStandings(limit);
  console.log(`  got ${standings.length} entries`);

  const entries = [];
  let lastEvent = null;
  let failed = 0;
  for (let i = 0; i < standings.length; i++) {
    const s = standings[i];
    try {
      const v = await fetchLatestValueBank(s.entry);
      if (v) {
        lastEvent = v.event;
        entries.push({
          rank: s.rank,
          entry: s.entry,
          entry_name: s.entry_name,
          player_name: s.player_name,
          total_points: s.total ?? null,
          event: v.event,
          value: v.value,
          bank: v.bank,
          total_value: v.value + v.bank,
        });
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      if (failed < 5) console.warn(`  entry ${s.entry}: ${err.message}`);
    }
    if ((i + 1) % 50 === 0) {
      console.log(`  ${i + 1}/${standings.length} (${failed} failed)`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const out = {
    fetched_at: new Date().toISOString(),
    league_id: OVERALL_LEAGUE_ID,
    event: lastEvent,
    requested: limit,
    count: entries.length,
    failed,
    stats: summarize(entries),
    entries,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(resolve(DATA_DIR, "top500.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\nDone. ${entries.length} saved (${failed} failed).`);
  if (out.stats) {
    const fmt = (t) => (t / 10).toFixed(1) + "m";
    console.log(`Total value (value + bank):`);
    console.log(`  min ${fmt(out.stats.total_value.min)}  median ${fmt(out.stats.total_value.median)}  avg ${fmt(out.stats.total_value.avg)}  max ${fmt(out.stats.total_value.max)}`);
  }
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
