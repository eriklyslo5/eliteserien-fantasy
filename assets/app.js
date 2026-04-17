// Eliteplan – client-side planner for Eliteserien Fantasy.
// Loads data/bootstrap.json + data/fixtures.json and stores your squad in localStorage.

const BUDGET_TENTHS = 1000; // 100.0m
const SQUAD_SIZE = 15;
const SQUAD_BY_POS = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const MAX_PER_CLUB = 3;
const FORMATIONS = {
  "3-4-3": { DEF: 3, MID: 4, FWD: 3 },
  "3-5-2": { DEF: 3, MID: 5, FWD: 2 },
  "4-3-3": { DEF: 4, MID: 3, FWD: 3 },
  "4-4-2": { DEF: 4, MID: 4, FWD: 2 },
  "4-5-1": { DEF: 4, MID: 5, FWD: 1 },
  "5-3-2": { DEF: 5, MID: 3, FWD: 2 },
  "5-4-1": { DEF: 5, MID: 4, FWD: 1 },
};

const state = {
  bootstrap: null,
  fixtures: [],
  meta: null,
  teams: new Map(),
  players: new Map(),
  fixturesByTeam: new Map(),
  fixturesByEvent: new Map(),
  squad: [], // player ids, ordered by pick
  formation: "4-4-2",
  horizon: 5,
  gameweek: null, // selected event id
  filters: { search: "", position: "", team: "", sort: "now_cost_desc" },
};

// ---------- storage ----------

const STORAGE_KEY = "eliteplan.v1";

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (Array.isArray(s.squad)) state.squad = s.squad;
    if (typeof s.formation === "string" && FORMATIONS[s.formation]) state.formation = s.formation;
    if (typeof s.horizon === "number") state.horizon = s.horizon;
    if (typeof s.gameweek === "number") state.gameweek = s.gameweek;
  } catch (err) {
    console.warn("Couldn't restore state:", err);
  }
}

function saveStored() {
  const snap = {
    squad: state.squad,
    formation: state.formation,
    horizon: state.horizon,
    gameweek: state.gameweek,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
}

// ---------- data loading ----------

async function loadData() {
  const [boot, fix, meta] = await Promise.all([
    fetch("data/bootstrap.json").then((r) => r.json()),
    fetch("data/fixtures.json").then((r) => r.json()),
    fetch("data/meta.json").then((r) => r.json()).catch(() => null),
  ]);
  state.bootstrap = boot;
  state.fixtures = fix;
  state.meta = meta;
  state.teams = new Map(boot.teams.map((t) => [t.id, t]));
  state.players = new Map(boot.players.map((p) => [p.id, p]));

  state.fixturesByTeam = new Map();
  state.fixturesByEvent = new Map();
  for (const f of fix) {
    if (!state.fixturesByTeam.has(f.team_h)) state.fixturesByTeam.set(f.team_h, []);
    if (!state.fixturesByTeam.has(f.team_a)) state.fixturesByTeam.set(f.team_a, []);
    state.fixturesByTeam.get(f.team_h).push(f);
    state.fixturesByTeam.get(f.team_a).push(f);
    if (!state.fixturesByEvent.has(f.event)) state.fixturesByEvent.set(f.event, []);
    state.fixturesByEvent.get(f.event).push(f);
  }
  for (const list of state.fixturesByTeam.values()) {
    list.sort((a, b) => (a.event ?? 0) - (b.event ?? 0));
  }

  if (state.gameweek == null) {
    const events = boot.events ?? [];
    const next = events.find((e) => e.is_next) ?? events.find((e) => e.is_current) ?? events[0];
    state.gameweek = next?.id ?? null;
  }
}

// ---------- helpers ----------

const fmtPrice = (tenths) => (tenths / 10).toFixed(1);

function squadCost() {
  return state.squad.reduce((sum, id) => sum + (state.players.get(id)?.now_cost ?? 0), 0);
}

function squadByPos() {
  const by = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const id of state.squad) {
    const p = state.players.get(id);
    if (!p) continue;
    if (by[p.position]) by[p.position].push(p);
  }
  return by;
}

function countByClub(teamId) {
  return state.squad.filter((id) => state.players.get(id)?.team === teamId).length;
}

function canAdd(player) {
  if (state.squad.includes(player.id)) return { ok: false, reason: "Allerede valgt" };
  if (state.squad.length >= SQUAD_SIZE) return { ok: false, reason: "Laget er fullt" };
  const by = squadByPos();
  if ((by[player.position]?.length ?? 0) >= (SQUAD_BY_POS[player.position] ?? 0)) {
    return { ok: false, reason: `Maks ${SQUAD_BY_POS[player.position]} ${player.position}` };
  }
  if (countByClub(player.team) >= MAX_PER_CLUB) {
    return { ok: false, reason: `Maks ${MAX_PER_CLUB} fra hver klubb` };
  }
  if (squadCost() + player.now_cost > BUDGET_TENTHS) {
    return { ok: false, reason: "Over budsjett" };
  }
  return { ok: true };
}

function nextFixtures(teamId, fromEventId, count) {
  const list = state.fixturesByTeam.get(teamId) ?? [];
  const out = [];
  for (const f of list) {
    if (f.event == null) continue;
    if (fromEventId != null && f.event < fromEventId) continue;
    out.push(f);
    if (out.length >= count) break;
  }
  return out;
}

function fixtureLabel(fixture, teamId) {
  const oppId = fixture.team_h === teamId ? fixture.team_a : fixture.team_h;
  const opp = state.teams.get(oppId);
  const home = fixture.team_h === teamId;
  return {
    text: `${opp?.short_name ?? "?"}${home ? "" : ""}`,
    home,
    difficulty:
      (home ? fixture.team_h_difficulty : fixture.team_a_difficulty) ?? null,
  };
}

// ---------- rendering ----------

const qs = (s) => document.querySelector(s);

function toast(msg, isErr = false) {
  let el = qs(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle("err", isErr);
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1800);
}

function renderGwSelect() {
  const sel = qs("#gw-select");
  const events = state.bootstrap?.events ?? [];
  sel.innerHTML = events
    .map((e) => `<option value="${e.id}">${e.name}</option>`)
    .join("");
  if (state.gameweek != null) sel.value = String(state.gameweek);
}

function renderTeamFilter() {
  const sel = qs("#filter-team");
  const teams = [...state.teams.values()].sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML =
    '<option value="">Alle klubber</option>' +
    teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
}

function renderBudget() {
  const cost = squadCost();
  const remaining = BUDGET_TENTHS - cost;
  qs("#team-cost").textContent = fmtPrice(cost);
  qs("#team-remaining").textContent = fmtPrice(remaining);
  qs("#team-count").textContent = `${state.squad.length}/${SQUAD_SIZE}`;
  qs("#budget-panel").classList.toggle("over", remaining < 0);
}

function fdrClass(d) {
  if (d == null) return "fdr-null";
  return `fdr-${Math.min(5, Math.max(1, d))}`;
}

function playerSlotHtml(player, role) {
  if (!player) {
    return `<div class="slot" data-role="${role}">
      <div class="slot-role">${role}</div>
      <div class="player-name muted">Velg…</div>
    </div>`;
  }
  const team = state.teams.get(player.team);
  const fxs = nextFixtures(player.team, state.gameweek, state.horizon);
  const fxHtml = fxs
    .map((f) => {
      const lbl = fixtureLabel(f, player.team);
      return `<span class="fx ${fdrClass(lbl.difficulty)} ${lbl.home ? "h" : "a"}" title="Runde ${f.event} – ${lbl.home ? "Hjemme" : "Borte"}">${lbl.text}${lbl.home ? " (H)" : " (B)"}</span>`;
    })
    .join("");
  return `<div class="slot filled" data-player="${player.id}" data-role="${role}">
    <button class="remove" title="Fjern" data-remove="${player.id}">×</button>
    <div class="slot-role">${role}</div>
    <div class="player-name">${escapeHtml(player.web_name || player.second_name || "")}</div>
    <div class="player-club">${escapeHtml(team?.short_name ?? "")}</div>
    <div class="player-price">${fmtPrice(player.now_cost)}</div>
    <div class="fx-row">${fxHtml}</div>
  </div>`;
}

function renderPitch() {
  const pitch = qs("#pitch");
  const by = squadByPos();
  const form = FORMATIONS[state.formation];

  const rows = [];
  rows.push({ role: "GK", players: by.GK.slice(0, 1) });
  rows.push({ role: "DEF", players: by.DEF.slice(0, form.DEF) });
  rows.push({ role: "MID", players: by.MID.slice(0, form.MID) });
  rows.push({ role: "FWD", players: by.FWD.slice(0, form.FWD) });

  pitch.innerHTML = rows
    .map((row) => {
      const slotCount = row.role === "GK" ? 1 : form[row.role];
      const slots = [];
      for (let i = 0; i < slotCount; i++) {
        slots.push(playerSlotHtml(row.players[i] ?? null, row.role));
      }
      return `<div class="pitch-row">${slots.join("")}</div>`;
    })
    .join("");

  const bench = document.getElementById("bench-slots");
  const benchPlayers = [
    by.GK[1] ?? null,
    ...["DEF", "MID", "FWD"].flatMap((pos) => by[pos].slice(form[pos])),
  ].slice(0, 4);
  while (benchPlayers.length < 4) benchPlayers.push(null);
  bench.innerHTML = benchPlayers
    .map((p, i) => playerSlotHtml(p, i === 0 ? "GK" : "SUB"))
    .join("");
}

function renderFixturesSummary() {
  const gw = state.gameweek;
  const ev = state.bootstrap.events.find((e) => e.id === gw);
  qs("#fixtures-gw-label").textContent = ev?.name ?? "Runde";
  const list = state.fixturesByEvent.get(gw) ?? [];
  const grid = qs("#fixtures-grid");
  if (list.length === 0) {
    grid.innerHTML = '<div class="muted">Ingen kamper lagret for denne runden.</div>';
    return;
  }
  grid.innerHTML = list
    .map((f) => {
      const h = state.teams.get(f.team_h);
      const a = state.teams.get(f.team_a);
      const kick = f.kickoff_time
        ? new Date(f.kickoff_time).toLocaleString("no-NO", {
            weekday: "short",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      return `<div class="fixture">
        <span class="fx-teams">${escapeHtml(h?.short_name ?? "?")} – ${escapeHtml(a?.short_name ?? "?")}</span>
        <span class="fx-kick">${escapeHtml(kick)}</span>
      </div>`;
    })
    .join("");
}

function matchesFilters(player) {
  const f = state.filters;
  if (f.position && player.position !== f.position) return false;
  if (f.team && player.team !== Number(f.team)) return false;
  if (f.search) {
    const needle = f.search.toLowerCase();
    const team = state.teams.get(player.team);
    const hay = `${player.web_name ?? ""} ${player.first_name ?? ""} ${player.second_name ?? ""} ${team?.name ?? ""} ${team?.short_name ?? ""}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

function sortPlayers(list) {
  const key = state.filters.sort;
  const cmp = {
    now_cost_desc: (a, b) => b.now_cost - a.now_cost,
    now_cost_asc: (a, b) => a.now_cost - b.now_cost,
    total_points_desc: (a, b) => (b.total_points ?? 0) - (a.total_points ?? 0),
    form_desc: (a, b) => parseFloat(b.form ?? 0) - parseFloat(a.form ?? 0),
    selected_by_percent_desc: (a, b) =>
      parseFloat(b.selected_by_percent ?? 0) - parseFloat(a.selected_by_percent ?? 0),
  }[key];
  return [...list].sort(cmp ?? cmp);
}

function renderPlayerList() {
  const empty = qs("#empty-players");
  const list = qs("#players-list");
  const players = [...state.players.values()];
  empty.hidden = players.length > 0;

  const filtered = sortPlayers(players.filter(matchesFilters));
  list.innerHTML = filtered
    .slice(0, 400)
    .map((p) => {
      const team = state.teams.get(p.team);
      const picked = state.squad.includes(p.id);
      const addable = picked ? { ok: true } : canAdd(p);
      return `<div class="player-row ${picked ? "picked" : ""} ${addable.ok ? "" : "disabled"}" data-player="${p.id}" title="${picked ? "Klikk for å fjerne" : addable.ok ? "Klikk for å legge til" : addable.reason}">
        <span class="pos-badge pos-${p.position}">${p.position}</span>
        <div class="player-main">
          <div class="name">${escapeHtml(p.web_name ?? p.second_name ?? "?")}</div>
          <div class="club">${escapeHtml(team?.short_name ?? "")} · ${p.position}</div>
        </div>
        <span class="price">£${fmtPrice(p.now_cost)}</span>
        <span class="pts">${p.total_points ?? 0}p</span>
      </div>`;
    })
    .join("");

  const src = state.meta?.is_sample
    ? "kampdata – eksempel"
    : state.meta?.fetched_at
      ? `oppdatert ${new Date(state.meta.fetched_at).toLocaleString("no-NO")}`
      : "";
  qs("#players-source").textContent = src;
}

function renderAll() {
  renderBudget();
  renderPitch();
  renderFixturesSummary();
  renderPlayerList();
}

// ---------- events ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function togglePlayer(id) {
  const p = state.players.get(id);
  if (!p) return;
  const idx = state.squad.indexOf(id);
  if (idx >= 0) {
    state.squad.splice(idx, 1);
    saveStored();
    renderAll();
    return;
  }
  const check = canAdd(p);
  if (!check.ok) {
    toast(check.reason, true);
    return;
  }
  state.squad.push(id);
  saveStored();
  renderAll();
}

function bind() {
  qs("#gw-select").addEventListener("change", (e) => {
    state.gameweek = Number(e.target.value);
    saveStored();
    renderAll();
  });
  qs("#gw-prev").addEventListener("click", () => stepGw(-1));
  qs("#gw-next").addEventListener("click", () => stepGw(1));
  qs("#formation").addEventListener("change", (e) => {
    state.formation = e.target.value;
    saveStored();
    renderPitch();
  });
  qs("#horizon").addEventListener("change", (e) => {
    state.horizon = Number(e.target.value);
    saveStored();
    renderPitch();
  });
  qs("#clear-team").addEventListener("click", () => {
    if (state.squad.length === 0) return;
    if (!confirm("Tømme laget?")) return;
    state.squad = [];
    saveStored();
    renderAll();
  });
  qs("#search").addEventListener("input", (e) => {
    state.filters.search = e.target.value.trim();
    renderPlayerList();
  });
  qs("#filter-position").addEventListener("change", (e) => {
    state.filters.position = e.target.value;
    renderPlayerList();
  });
  qs("#filter-team").addEventListener("change", (e) => {
    state.filters.team = e.target.value;
    renderPlayerList();
  });
  qs("#sort-by").addEventListener("change", (e) => {
    state.filters.sort = e.target.value;
    renderPlayerList();
  });

  qs("#players-list").addEventListener("click", (e) => {
    const row = e.target.closest(".player-row");
    if (!row) return;
    togglePlayer(Number(row.dataset.player));
  });

  document.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) {
      togglePlayer(Number(removeBtn.dataset.remove));
      e.stopPropagation();
    }
  });

  // Restore form selections
  qs("#formation").value = state.formation;
  qs("#horizon").value = String(state.horizon);
}

function stepGw(dir) {
  const events = state.bootstrap.events;
  const idx = events.findIndex((e) => e.id === state.gameweek);
  const next = events[Math.min(events.length - 1, Math.max(0, idx + dir))];
  if (next) {
    state.gameweek = next.id;
    qs("#gw-select").value = String(next.id);
    saveStored();
    renderAll();
  }
}

// ---------- boot ----------

async function boot() {
  loadStored();
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    document.body.innerHTML =
      '<div class="empty-state"><h3>Kunne ikke laste data</h3><p>Sørg for at data/bootstrap.json og data/fixtures.json finnes. Kjør <code>npm run fetch</code> eller <code>npm run sample-fixtures</code>.</p></div>';
    return;
  }
  renderGwSelect();
  renderTeamFilter();
  bind();
  renderAll();
}

boot();
