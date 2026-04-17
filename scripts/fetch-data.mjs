#!/usr/bin/env node
// Refresh player prices + fixtures for the planner.
//
// Primary source: fantasy.tv2.no (FPL-style API).
// Fixture fallback: fbref CSV scrape.
//
// Usage:
//   node scripts/fetch-data.mjs
//
// Output:
//   data/bootstrap.json   - teams, players, events (gameweeks)
//   data/fixtures.json    - all fixtures for the season
//   data/meta.json        - fetched_at, season label, source URLs

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

const SOURCES = {
  bootstrap: [
    "https://fantasy.tv2.no/api/bootstrap-static/",
    "https://fantasy.eliteserien.no/api/bootstrap-static/",
  ],
  fixtures: [
    "https://fantasy.tv2.no/api/fixtures/",
    "https://fantasy.eliteserien.no/api/fixtures/",
  ],
};

const UA = {
  "User-Agent":
    "Mozilla/5.0 (eliteserien-fantasy-planner; +https://github.com/eriklyslo5/eliteserien-fantasy)",
  Accept: "application/json,*/*;q=0.8",
};

async function fetchFirstOk(urls) {
  const errors = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) {
        errors.push(`${url} -> HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      return { url, data };
    } catch (err) {
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
    short_name: t.short_name ?? t.name?.slice(0, 3).toUpperCase(),
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

  const players = (raw.elements ?? []).map((p) => ({
    id: p.id,
    first_name: p.first_name,
    second_name: p.second_name,
    web_name: p.web_name,
    team: p.team,
    position: elementTypes.get(p.element_type)?.singular ?? p.element_type,
    position_id: p.element_type,
    now_cost: p.now_cost, // in tenths (55 -> 5.5m)
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
  console.log("Fetching bootstrap (teams, players, events)...");
  const bootstrap = await fetchFirstOk(SOURCES.bootstrap);
  const normBoot = normalizeBootstrap(bootstrap.data);
  console.log(
    `  ${normBoot.teams.length} teams, ${normBoot.players.length} players, ${normBoot.events.length} gameweeks`,
  );

  console.log("Fetching fixtures...");
  const fixtures = await fetchFirstOk(SOURCES.fixtures);
  const normFix = normalizeFixtures(fixtures.data);
  console.log(`  ${normFix.length} fixtures`);

  await writeJson("bootstrap.json", normBoot);
  await writeJson("fixtures.json", normFix);
  await writeJson("meta.json", {
    fetched_at: new Date().toISOString(),
    bootstrap_source: bootstrap.url,
    fixtures_source: fixtures.url,
  });

  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
