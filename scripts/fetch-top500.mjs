#!/usr/bin/env node
// Scrape lagverdi for the top N teams in TV 2 Eliteserien Fantasy.
//
// Lagverdi is computed as: sum of current player prices (now_cost) for the
// squad they used in the latest finished gameweek, plus money in bank.
// This matches what fantasy.tv2.no shows under "Troppens verdi" + "I banken",
// rather than the API's history.value snapshot which freezes at the previous
// deadline and drifts as prices change.
//
// Usage:  node scripts/fetch-top500.mjs [limit=500]
// Writes: data/top500.json

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

const HOST = "https://fantasy.tv2.no";
const OVERALL_LEAGUE_ID = 329; // "Totalt" – global league everyone is in
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 100;

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

async function loadPriceMap() {
  // Use the locally cached bootstrap.json so we share the exact prices the UI
  // uses. fetch-data.mjs is responsible for keeping it fresh.
  const raw = await readFile(resolve(DATA_DIR, "bootstrap.json"), "utf8");
  const boot = JSON.parse(raw);
  const map = new Map();
  for (const p of boot.players ?? []) {
    if (p.id != null && typeof p.now_cost === "number") map.set(p.id, p.now_cost);
  }
  return map;
}

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

// Chips that temporarily inflate budget (Rik Onkel-equivalent). Any team using
// one in the latest scored event is flagged because their value/bank reflect
// the chip-boosted state, not their real lagverdi.
const BUDGET_CHIPS = new Set(["pdbus", "rikonkel", "rik_onkel"]);
// Bank > 3.0m signals the team is mid-transfer between deadlines: they sold a
// player but haven't bought a replacement, so the (still-stored GW8) picks
// double-count with the cash. Drop them from stats.
const BANK_OUTLIER_TENTHS = 30;

async function fetchHistory(entryId) {
  const data = await fetchJson(`${HOST}/api/entry/${entryId}/history/`);
  const cur = data?.current ?? [];
  if (cur.length === 0) return null;
  const last = cur[cur.length - 1];
  const chips = data?.chips ?? [];
  const chipThisEvent = chips.find((c) => c.event === last.event)?.name ?? null;
  return {
    event: last.event,
    api_value: last.value,
    bank: last.bank,
    chip_this_event: chipThisEvent,
  };
}

async function fetchPicks(entryId, eventId) {
  const data = await fetchJson(`${HOST}/api/entry/${entryId}/event/${eventId}/picks/`);
  return (data?.picks ?? []).map((p) => p.element);
}

function squadCostFromPicks(pickIds, priceMap) {
  let cost = 0;
  let missing = 0;
  for (const id of pickIds) {
    const p = priceMap.get(id);
    if (typeof p === "number") cost += p;
    else missing++;
  }
  return { cost, missing };
}

function summarize(entries) {
  if (!entries.length) return null;
  const totals = entries.map((e) => e.lagverdi).sort((a, b) => a - b);
  const squadCosts = entries.map((e) => e.squad_cost).sort((a, b) => a - b);
  const banks = entries.map((e) => e.bank).sort((a, b) => a - b);
  const n = totals.length;
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((arr.length * p) / 100))];
  const sum = (arr) => arr.reduce((s, v) => s + v, 0);
  return {
    count: n,
    lagverdi: {
      min: totals[0], max: totals[n - 1],
      avg: Math.round(sum(totals) / n),
      median: pct(totals, 50),
      p10: pct(totals, 10), p25: pct(totals, 25), p75: pct(totals, 75), p90: pct(totals, 90),
    },
    squad_cost: {
      min: squadCosts[0], max: squadCosts[n - 1],
      avg: Math.round(sum(squadCosts) / n),
      median: pct(squadCosts, 50),
    },
    bank: {
      min: banks[0], max: banks[n - 1],
      avg: Math.round(sum(banks) / n),
      median: pct(banks, 50),
    },
  };
}

async function main() {
  console.log(`Loading current player prices from data/bootstrap.json …`);
  const priceMap = await loadPriceMap();
  console.log(`  ${priceMap.size} players loaded`);

  console.log(`Fetching top ${limit} from league ${OVERALL_LEAGUE_ID} ("Totalt") …`);
  const standings = await fetchStandings(limit);
  console.log(`  got ${standings.length} entries`);

  const entries = [];
  let lastEvent = null;
  let failed = 0;
  for (let i = 0; i < standings.length; i++) {
    const s = standings[i];
    try {
      const h = await fetchHistory(s.entry);
      if (!h) {
        failed++;
        continue;
      }
      lastEvent = h.event;
      await sleep(REQUEST_DELAY_MS);
      const pickIds = await fetchPicks(s.entry, h.event);
      const { cost: squadCost, missing } = squadCostFromPicks(pickIds, priceMap);
      const usedBudgetChip = h.chip_this_event && BUDGET_CHIPS.has(h.chip_this_event);
      // Picks list should always be 15 players; missing prices means the
      // bootstrap is stale (e.g. a transferred-in player not in our snapshot).
      const incompletePicks = pickIds.length !== 15 || missing > 0;
      const bankOutlier = h.bank > BANK_OUTLIER_TENTHS;
      const reason = usedBudgetChip
        ? "budget_chip"
        : incompletePicks
          ? "incomplete_picks"
          : bankOutlier
            ? "bank_outlier"
            : null;
      entries.push({
        rank: s.rank,
        entry: s.entry,
        entry_name: s.entry_name,
        player_name: s.player_name,
        total_points: s.total ?? null,
        event: h.event,
        squad_cost: squadCost,
        bank: h.bank,
        lagverdi: squadCost + h.bank,
        api_value: h.api_value,
        chip_this_event: h.chip_this_event,
        excluded: reason !== null,
        excluded_reason: reason,
      });
    } catch (err) {
      failed++;
      if (failed < 5) console.warn(`  entry ${s.entry}: ${err.message}`);
    }
    if ((i + 1) % 50 === 0) {
      console.log(`  ${i + 1}/${standings.length} (${failed} failed)`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const cleanEntries = entries.filter((e) => !e.excluded);
  const excludedCount = entries.length - cleanEntries.length;
  const out = {
    fetched_at: new Date().toISOString(),
    league_id: OVERALL_LEAGUE_ID,
    event: lastEvent,
    requested: limit,
    count: entries.length,
    clean_count: cleanEntries.length,
    excluded: excludedCount,
    failed,
    method: "current squad cost (now_cost sum) + bank",
    stats: summarize(cleanEntries),
    raw_stats: summarize(entries),
    entries,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(resolve(DATA_DIR, "top500.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\nDone. ${entries.length} fetched (${failed} failed). ${cleanEntries.length} after excluding ${excludedCount}.`);
  if (out.stats) {
    const fmt = (t) => (t / 10).toFixed(1) + "m";
    console.log(`Lagverdi (squadCost + bank, current prices), clean:`);
    console.log(`  min ${fmt(out.stats.lagverdi.min)}  median ${fmt(out.stats.lagverdi.median)}  avg ${fmt(out.stats.lagverdi.avg)}  max ${fmt(out.stats.lagverdi.max)}`);
  }
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
