#!/usr/bin/env node
// Generate a plausible double round-robin fixture list for the 16 Eliteserien teams
// defined in data/bootstrap.json. Used only when we can't reach the live API;
// the UI will gracefully replace this with real fixtures once scripts/fetch-data.mjs runs.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");

function circleRoundRobin(ids) {
  // Classic Berger tables (circle method). Returns rounds[] of matches {h, a}.
  const teams = ids.slice();
  if (teams.length % 2) teams.push(null); // bye
  const n = teams.length;
  const rounds = [];
  const fixed = teams[0];
  let rotating = teams.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    const list = [fixed, ...rotating];
    for (let i = 0; i < n / 2; i++) {
      const h = list[i];
      const a = list[n - 1 - i];
      if (h == null || a == null) continue;
      // alternate home/away roughly by round parity for variety
      if (i === 0 && r % 2 === 1) round.push({ h: a, a: h });
      else round.push({ h, a });
    }
    rounds.push(round);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

function reverseFixtures(rounds) {
  return rounds.map((round) => round.map((m) => ({ h: m.a, a: m.h })));
}

const bootstrap = JSON.parse(await readFile(resolve(DATA_DIR, "bootstrap.json"), "utf8"));
const teamIds = bootstrap.teams.map((t) => t.id);
const events = bootstrap.events;

const first = circleRoundRobin(teamIds);
const second = reverseFixtures(first);
const allRounds = [...first, ...second]; // 15 + 15 = 30

if (allRounds.length !== events.length) {
  throw new Error(`round/event mismatch: ${allRounds.length} vs ${events.length}`);
}

const fixtures = [];
let id = 1;
for (let r = 0; r < allRounds.length; r++) {
  const event = events[r];
  const deadline = new Date(event.deadline_time);
  const kickBase = new Date(deadline.getTime() + 1000 * 60 * 60 * 24); // ~1 day after deadline
  for (let i = 0; i < allRounds[r].length; i++) {
    const m = allRounds[r][i];
    const kick = new Date(kickBase.getTime() + i * 1000 * 60 * 60 * 2); // stagger 2h
    fixtures.push({
      id: id++,
      event: event.id,
      kickoff_time: kick.toISOString(),
      team_h: m.h,
      team_a: m.a,
      team_h_difficulty: null,
      team_a_difficulty: null,
      finished: false,
      team_h_score: null,
      team_a_score: null,
    });
  }
}

await writeFile(
  resolve(DATA_DIR, "fixtures.json"),
  JSON.stringify(fixtures, null, 2) + "\n",
  "utf8",
);
console.log(`wrote ${fixtures.length} sample fixtures`);
