#!/usr/bin/env node
// Refresh player prices + fixtures for the planner.
//
// Endpoints (verified against ViktorAlsos/esf-planner, galku/fantasybotes,
// olemabo/viewfantasystats – all publicly hit the TV 2 / Eliteserien APIs):
//
//   https://fantasy.tv2.no/api/bootstrap-static          -> teams, players, events
//   https://fantasy.tv2.no/api/fixtures/                 -> all fixtures
//   https://fantasy.eliteserien.no/api/element-summary/X -> per-player fixtures (fallback)
//
// The bootstrap response is the FPL schema (TV 2 and fantasy.eliteserien.no run the
// same Premier League Fantasy clone). We can usually reach the JSON anonymously; no
// login needed.
//
// Usage:
//   node scripts/fetch-data.mjs
//
// Output:
//   data/bootstrap.json   - teams, players, events (gameweeks)
//   data/fixtures.json    - all fixtures for the season
//   data/meta.json        - fetched_at, source URLs

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

const SOURCES = {
  bootstrap: [
    "https://fantasy.tv2.no/api/bootstrap-static/",
    "https://fantasy.tv2.no/api/bootstrap-static",
    "https://fantasy.eliteserien.no/api/bootstrap-static/",
  ],
  fixtures: [
    "https://fantasy.tv2.no/api/fixtures/",
    "https://fantasy.tv2.no/api/fixtures",
    "https://fantasy.eliteserien.no/api/fixtures/",
  ],
};

// Browser-like headers. TV 2's edge sometimes rejects generic HTTP clients.
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
  Referer: "https://fantasy.tv2.no/",
  Origin: "https://fantasy.tv2.no",
};

async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  // Try Node.js fetch first
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      const text = await res.text();
      if (!ct.includes("json")) {
        return JSON.parse(text);
      }
      return JSON.parse(text);
    } finally {
      clearTimeout(t);
    }
  } catch (fetchErr) {
    // Fallback: curl (different TLS/IP fingerprint, often bypasses CDN blocks)
    try {
      const out = execFileSync("curl", [
        "-sf", "--max-time", "20",
        "-H", `User-Agent: ${HEADERS["User-Agent"]}`,
        "-H", "Accept: application/json",
        "-H", "Accept-Language: nb-NO,nb;q=0.9,en;q=0.8",
        url,
      ], { timeout: 25000 });
      return JSON.parse(out.toString());
    } catch (curlErr) {
      throw new Error(`fetch: ${fetchErr.message} | curl: ${curlErr.message}`);
    }
  }
}

async function fetchFirstOk(urls) {
  const errors = [];
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      console.log(`  ok ${url}`);
      return { url, data };
    } catch (err) {
      console.log(`  skip ${url} (${err.message})`);
      errors.push(`${url} -> ${err.message}`);
    }
  }
  throw new Error(`All sources failed:\n  ${errors.join("\n  ")}`);
}

function normalizeBootstrap(raw) {
  const teams = (raw.teams ?? []).map((t) => ({
    id: t.id,
    code: t.code ?? t.id,
    name: t.name,
    short_name: t.short_name ?? (t.name ? t.name.slice(0, 3).toUpperCase() : ""),
    strength: t.strength ?? null,
    strength_overall_home: t.strength_overall_home ?? null,
    strength_overall_away: t.strength_overall_away ?? null,
  }));

  const elementTypes = new Map(
    (raw.element_types ?? []).map((et) => [
      et.id,
      {
        id: et.id,
        singular: et.singular_name_short ?? et.singular_name ?? String(et.id),
        plural: et.plural_name ?? et.singular_name ?? String(et.id),
      },
    ]),
  );

  const players = (raw.elements ?? raw.players ?? []).map((p) => ({
    id: p.id,
    first_name: p.first_name,
    second_name: p.second_name,
    web_name: p.web_name,
    team: p.team,
    position: elementTypes.get(p.element_type)?.singular ?? p.element_type,
    position_id: p.element_type,
    now_cost: p.now_cost,
    total_points: p.total_points ?? 0,
    form: p.form ?? "0",
    selected_by_percent: p.selected_by_percent ?? "0",
    status: p.status ?? "a",
    news: p.news ?? "",
    chance_of_playing_next_round: p.chance_of_playing_next_round ?? null,
    photo: p.photo ?? null,
  }));

  const events = (raw.events ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    deadline_time: e.deadline_time,
    is_current: !!e.is_current,
    is_next: !!e.is_next,
    finished: !!e.finished,
  }));

  return { teams, element_types: [...elementTypes.values()], players, events };
}

function normalizeFixtures(raw) {
  return (raw ?? []).map((f) => ({
    id: f.id,
    event: f.event,
    kickoff_time: f.kickoff_time,
    team_h: f.team_h,
    team_a: f.team_a,
    team_h_difficulty: f.team_h_difficulty ?? null,
    team_a_difficulty: f.team_a_difficulty ?? null,
    finished: !!f.finished,
    team_h_score: f.team_h_score ?? null,
    team_a_score: f.team_a_score ?? null,
  }));
}

async function writeJson(name, data) {
  const path = resolve(DATA_DIR, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`  wrote ${path}`);
}

async function main() {
  console.log("Fetching bootstrap (teams, players, events) …");
  const bootstrap = await fetchFirstOk(SOURCES.bootstrap);
  const normBoot = normalizeBootstrap(bootstrap.data);
  console.log(
    `  ${normBoot.teams.length} teams, ${normBoot.players.length} players, ${normBoot.events.length} gameweeks`,
  );

  console.log("Fetching fixtures …");
  const fixtures = await fetchFirstOk(SOURCES.fixtures);
  const normFix = normalizeFixtures(fixtures.data);
  console.log(`  ${normFix.length} fixtures`);

  await writeJson("bootstrap.json", normBoot);
  await writeJson("fixtures.json", normFix);
  await writeJson("meta.json", {
    fetched_at: new Date().toISOString(),
    bootstrap_source: bootstrap.url,
    fixtures_source: fixtures.url,
    is_sample: false,
  });

  console.log("Done.");
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  console.error(
    "\nIf TV 2 or fantasy.eliteserien.no is blocking your network, try:\n" +
      "  1. Open https://fantasy.tv2.no/api/bootstrap-static in a browser\n" +
      "  2. Right-click the JSON → Save As → data/bootstrap.json\n" +
      "  3. Do the same for https://fantasy.tv2.no/api/fixtures/ → data/fixtures.json\n",
  );
  process.exit(1);
});
