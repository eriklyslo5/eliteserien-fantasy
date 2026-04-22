// Eliteplan – client-side planner for Eliteserien Fantasy.
// Loads data/bootstrap.json + data/fixtures.json and stores your squad in localStorage.

const BUDGET_TENTHS = 1000; // 100.0m
const SQUAD_SIZE = 15;
const SQUAD_BY_POS = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const POS_MAP = { KPR: "GK", FOR: "DEF", MID: "MID", ANG: "FWD" };
const MAX_PER_CLUB = 3;
const MAX_FREE_TRANSFERS = 5;
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
  squadsByGw: {},        // { [gwId]: [playerId, ...] }
  baseFreeTransfers: 1,  // free transfers available at the earliest GW with data
  swapId: null,
  formation: "4-4-2",
  horizon: 5,
  gameweek: null,
  filters: { search: "", position: "", team: "", sort: "now_cost_desc", minOwnership: 0 },
};

// ---------- squad accessors ----------

function getSquad() {
  const gw = state.gameweek;
  if (gw == null) return [];
  if (state.squadsByGw[gw]) return state.squadsByGw[gw];
  // Fall back to most recent prior GW that has data
  const prior = priorGwWithData(gw);
  return prior != null ? state.squadsByGw[prior] : [];
}

// Commit ids to current GW and persist
function setSquad(ids) {
  if (state.gameweek == null) return;
  state.squadsByGw[state.gameweek] = [...ids];
  saveStored();
}

// Read effective squad, apply mutation fn, write back to current GW
function mutateSquad(fn) {
  const arr = [...getSquad()];
  fn(arr);
  setSquad(arr);
}

// ---------- transfer helpers ----------

function sortedGws() {
  return Object.keys(state.squadsByGw).map(Number).sort((a, b) => a - b);
}

function baselineGw() {
  const gws = sortedGws();
  return gws.length ? gws[0] : null;
}

function priorGwWithData(gw) {
  const gws = sortedGws().filter((g) => g < gw);
  return gws.length ? gws[gws.length - 1] : null;
}

function transfersUsed(gw) {
  const prev = priorGwWithData(gw);
  if (prev == null || !state.squadsByGw[gw]) return 0;
  const prevSet = new Set(state.squadsByGw[prev]);
  return state.squadsByGw[gw].filter((id) => !prevSet.has(id)).length;
}

function freeTransfersAvailable(gw) {
  const base = baselineGw();
  if (base == null) return state.baseFreeTransfers;
  if (gw === base) return state.baseFreeTransfers;
  // Walk forward from baseline
  const gws = sortedGws();
  let free = state.baseFreeTransfers;
  for (const g of gws) {
    if (g >= gw) break;
    const used = transfersUsed(g);
    free = Math.min(MAX_FREE_TRANSFERS, Math.max(0, free - used) + 1);
  }
  return free;
}

// ---------- storage ----------

const STORAGE_KEY = "eliteplan.v2";

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.squadsByGw && typeof s.squadsByGw === "object") state.squadsByGw = s.squadsByGw;
      if (typeof s.baseFreeTransfers === "number") state.baseFreeTransfers = s.baseFreeTransfers;
      if (typeof s.formation === "string" && FORMATIONS[s.formation]) state.formation = s.formation;
      if (typeof s.horizon === "number") state.horizon = s.horizon;
      if (typeof s.gameweek === "number") state.gameweek = s.gameweek;
      return;
    }
    // Migrate from old v1 format
    const old = localStorage.getItem("eliteplan.v1");
    if (old) {
      const s = JSON.parse(old);
      if (typeof s.formation === "string" && FORMATIONS[s.formation]) state.formation = s.formation;
      if (typeof s.horizon === "number") state.horizon = s.horizon;
      if (typeof s.gameweek === "number") state.gameweek = s.gameweek;
      if (Array.isArray(s.squad) && s.squad.length > 0 && s.gameweek) {
        state.squadsByGw[s.gameweek] = s.squad;
      }
    }
  } catch (err) {
    console.warn("Couldn't restore state:", err);
  }
}

function saveStored() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    squadsByGw: state.squadsByGw,
    baseFreeTransfers: state.baseFreeTransfers,
    formation: state.formation,
    horizon: state.horizon,
    gameweek: state.gameweek,
  }));
}

// ---------- data loading ----------

async function loadData() {
  const [boot, fix, meta, myTeam] = await Promise.all([
    fetch("data/bootstrap.json").then((r) => r.json()),
    fetch("data/fixtures.json").then((r) => r.json()),
    fetch("data/meta.json").then((r) => r.json()).catch(() => null),
    fetch("data/my-team.json").then((r) => r.json()).catch(() => null),
  ]);
  applyData(boot, fix, meta);
  if (myTeam?.picks?.length && Object.keys(state.squadsByGw).length === 0) {
    const ids = myTeam.picks.map((p) => p.element).filter((id) => state.players.has(id));
    const importGw = myTeam.gameweek ?? state.gameweek;
    if (ids.length > 0 && importGw != null) {
      state.squadsByGw[importGw] = ids;
      saveStored();
      toast(`Lastet inn laget ditt (Runde ${importGw})`);
    }
  }
}

function applyData(boot, fix, meta) {
  state.bootstrap = boot;
  state.fixtures = fix;
  state.meta = meta;
  state.teams = new Map(boot.teams.map((t) => [t.id, t]));
  state.players = new Map(
    (boot.players ?? []).map((p) => [p.id, { ...p, position: POS_MAP[p.position] ?? p.position }])
  );

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

  state.teamFdr = computeTeamFdr();
}

// ---------- live refresh ----------

function normalizeBootstrapRaw(raw) {
  const etMap = new Map(
    (raw.element_types ?? []).map((et) => [
      et.id,
      et.singular_name_short ?? et.singular_name ?? et.singular ?? String(et.id),
    ]),
  );
  const teams = (raw.teams ?? []).map((t) => ({
    id: t.id,
    code: t.code ?? t.id,
    name: t.name,
    short_name: t.short_name ?? "",
    strength: t.strength ?? null,
  }));
  const players = (raw.elements ?? raw.players ?? []).map((p) => ({
    id: p.id,
    first_name: p.first_name,
    second_name: p.second_name,
    web_name: p.web_name,
    team: p.team,
    position: etMap.get(p.element_type ?? p.position_id) ?? p.position ?? String(p.element_type ?? p.position_id),
    position_id: p.element_type ?? p.position_id,
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
  return { teams, players, events, element_types: [...etMap].map(([id, s]) => ({ id, singular: s })) };
}

function normalizeFixturesRaw(raw) {
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

async function refreshLive() {
  const btn = qs("#refresh-live");
  btn.classList.add("busy");
  try {
    const [bootRaw, fixRaw] = await Promise.all([
      apiFetch("/api/bootstrap-static"),
      apiFetch("/api/fixtures"),
    ]);
    const boot = normalizeBootstrapRaw(bootRaw);
    const fix = normalizeFixturesRaw(fixRaw);
    const meta = {
      fetched_at: new Date().toISOString(),
      bootstrap_source: "fantasy.tv2.no (via proxy)",
      fixtures_source: "fantasy.tv2.no (via proxy)",
      is_sample: false,
    };
    applyData(boot, fix, meta);
    renderGwSelect();
    renderTeamFilter();
    renderAll();
    toast(`Oppdatert – ${boot.players.length} spillere`);
  } catch (err) {
    console.error(err);
    toast("Kunne ikke oppdatere. Kjører du via `npm start`?", true);
  } finally {
    btn.classList.remove("busy");
  }
}

async function requireOk(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const TV2_HOSTS = ["https://fantasy.tv2.no", "https://fantasy.eliteserien.no"];

async function apiFetch(path) {
  let lastStatus = null;
  for (const host of TV2_HOSTS) {
    for (const variant of [path, path.endsWith("/") ? path.slice(0, -1) : path + "/"]) {
      try {
        const res = await fetch(`${host}${variant}`, { signal: AbortSignal.timeout(10000) });
        if (res.ok) return res.json();
        lastStatus = res.status;
      } catch (_) {}
    }
  }
  try {
    const res = await fetch(`/proxy${path}`);
    if (res.ok) return res.json();
    lastStatus = res.status;
  } catch (_) {}
  throw new Error(`HTTP ${lastStatus ?? "?"}`);
}

async function importTeam(teamId) {
  const btn = qs("#import-team");
  btn.classList.add("busy");
  try {
    if (!teamId || teamId < 1) throw new Error("Ugyldig lag-ID");
    const events = state.bootstrap?.events ?? [];
    if (events.length === 0) throw new Error("Mangler runde-info. Last data først.");
    const finished = events.filter((e) => e.finished).map((e) => e.id).sort((a, b) => b - a);
    const candidates = [...new Set(finished.concat([events.find((e) => e.is_current)?.id, events[0].id].filter(Boolean)))];
    let picks = null;
    let usedGw = null;
    let lastErr = null;
    for (const gw of candidates) {
      try {
        picks = await apiFetch(`/api/entry/${teamId}/event/${gw}/picks`);
        usedGw = gw;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!picks) throw new Error(`Fant ingen lagdata (${lastErr?.message ?? "?"})`);
    const picked = (picks.picks ?? []).map((p) => p.element);
    if (picked.length === 0) throw new Error("Fant ingen spillere i laget");
    const valid = picked.filter((id) => state.players.has(id));
    state.squadsByGw[usedGw] = valid;
    saveStored();
    renderAll();
    toast(`Importerte ${valid.length} spillere (Runde ${usedGw})`);
  } catch (err) {
    console.error(err);
    toast(err.message || "Import feilet", true);
  } finally {
    btn.classList.remove("busy");
  }
}

// ---------- helpers ----------

const fmtPrice = (tenths) => (tenths / 10).toFixed(1);

function squadCost() {
  return getSquad().reduce((sum, id) => sum + (state.players.get(id)?.now_cost ?? 0), 0);
}

function squadByPos() {
  const by = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const id of getSquad()) {
    const p = state.players.get(id);
    if (!p) continue;
    if (by[p.position]) by[p.position].push(p);
  }
  return by;
}

function countByClub(teamId) {
  return getSquad().filter((id) => state.players.get(id)?.team === teamId).length;
}

function canAdd(player) {
  const squad = getSquad();
  if (squad.includes(player.id)) return { ok: false, reason: "Allerede valgt" };
  if (squad.length >= SQUAD_SIZE) return { ok: false, reason: "Laget er fullt" };
  const by = squadByPos();
  if ((by[player.position]?.length ?? 0) >= (SQUAD_BY_POS[player.position] ?? 0)) {
    return { ok: false, reason: `Maks ${SQUAD_BY_POS[player.position]} ${player.position}` };
  }
  if (countByClub(player.team) >= MAX_PER_CLUB) {
    return { ok: false, reason: `Maks ${MAX_PER_CLUB} fra hver klubb` };
  }
  return { ok: true };
}

function nextFixturesByGw(teamId, fromEventId, gwCount) {
  const list = state.fixturesByTeam.get(teamId) ?? [];
  const byGw = new Map();
  for (const f of list) {
    if (f.event == null) continue;
    if (fromEventId != null && f.event < fromEventId) continue;
    if (!byGw.has(f.event)) byGw.set(f.event, []);
    byGw.get(f.event).push(f);
  }
  return [...byGw.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, gwCount)
    .map(([, fixtures]) => fixtures);
}

function computeTeamFdr() {
  const points = new Map();
  for (const p of state.players.values()) {
    points.set(p.team, (points.get(p.team) ?? 0) + (p.total_points ?? 0));
  }
  const teamsWithPoints = [...points.entries()].filter(([, pts]) => pts > 0);
  if (teamsWithPoints.length === 0) return new Map();
  teamsWithPoints.sort((a, b) => b[1] - a[1]);
  const tiers = new Map();
  const n = teamsWithPoints.length;
  teamsWithPoints.forEach(([teamId], idx) => {
    const tier = 5 - Math.floor((idx / n) * 5);
    tiers.set(teamId, Math.max(1, Math.min(5, tier)));
  });
  return tiers;
}

function fixtureLabel(fixture, teamId) {
  const oppId = fixture.team_h === teamId ? fixture.team_a : fixture.team_h;
  const opp = state.teams.get(oppId);
  const home = fixture.team_h === teamId;
  const apiDiff = (home ? fixture.team_h_difficulty : fixture.team_a_difficulty) ?? null;
  let difficulty = apiDiff;
  if (difficulty == null) {
    const oppTier = state.teamFdr?.get(oppId) ?? null;
    if (oppTier != null) {
      difficulty = home ? Math.max(1, oppTier - 1) : oppTier;
    }
  }
  return { text: `${opp?.short_name ?? "?"}`, home, difficulty };
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
  const squad = getSquad();
  const cost = squad.reduce((sum, id) => sum + (state.players.get(id)?.now_cost ?? 0), 0);
  const remaining = BUDGET_TENTHS - cost;
  qs("#team-cost").textContent = fmtPrice(cost);
  qs("#team-remaining").textContent = fmtPrice(remaining);
  qs("#team-count").textContent = `${squad.length}/${SQUAD_SIZE}`;
  qs("#budget-panel").classList.toggle("over", remaining < 0);

  const gw = state.gameweek;
  const hasSnapshot = gw != null && !!state.squadsByGw[gw];
  const used = hasSnapshot ? transfersUsed(gw) : 0;
  const avail = gw != null ? freeTransfersAvailable(gw) : state.baseFreeTransfers;
  const isBaseline = gw != null && gw === baselineGw();
  qs("#team-transfers").textContent = isBaseline ? `${avail} (base)` : `${used}/${avail}`;
  qs("#budget-panel").classList.toggle("transfers-over", !isBaseline && used > avail);

  // Keep base-ft input in sync
  const ftInput = qs("#base-ft");
  if (ftInput && ftInput !== document.activeElement) {
    ftInput.value = String(state.baseFreeTransfers);
  }
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
  const gwGroups = nextFixturesByGw(player.team, state.gameweek, state.horizon);
  const fxHtml = gwGroups.map((fixtures) => {
    const pills = fixtures.map((f) => {
      const lbl = fixtureLabel(f, player.team);
      return `<span class="fx ${fdrClass(lbl.difficulty)} ${lbl.home ? "h" : "a"}" title="Runde ${f.event} – ${lbl.home ? "Hjemme" : "Borte"}">${lbl.text}</span>`;
    }).join("");
    return fixtures.length > 1 ? `<span class="fx-dgw">${pills}</span>` : pills;
  }).join("");
  const swapping = state.swapId === player.id ? " swap-selected" : "";

  // Mark as transferred-in if not in prior GW squad
  const prior = priorGwWithData(state.gameweek);
  const isNew = prior != null && state.squadsByGw[state.gameweek]
    && !state.squadsByGw[prior]?.includes(player.id);
  return `<div class="slot filled${swapping}${isNew ? " transferred-in" : ""}" data-player="${player.id}" data-role="${role}">
    <button class="remove" title="Fjern" data-remove="${player.id}">×</button>
    <div class="slot-role">${role}</div>
    <div class="player-name">${escapeHtml(player.web_name || player.second_name || "")}</div>
    <div class="player-club">${escapeHtml(team?.short_name ?? "")}</div>
    <div class="player-price">${fmtPrice(player.now_cost)}</div>
    <div class="fx-row">${fxHtml}</div>
  </div>`;
}

function handleSlotClick(playerId) {
  if (state.swapId === null) {
    state.swapId = playerId;
    renderPitch();
    return;
  }
  if (state.swapId === playerId) {
    state.swapId = null;
    renderPitch();
    return;
  }
  mutateSquad((arr) => {
    const i = arr.indexOf(state.swapId);
    const j = arr.indexOf(playerId);
    if (i !== -1 && j !== -1) [arr[i], arr[j]] = [arr[j], arr[i]];
  });
  state.swapId = null;
  renderAll();
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
  if (f.minOwnership > 0 && parseFloat(player.selected_by_percent ?? 0) < f.minOwnership) return false;
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

  const squad = getSquad();
  const filtered = sortPlayers(players.filter(matchesFilters));
  list.innerHTML = filtered
    .slice(0, 400)
    .map((p) => {
      const team = state.teams.get(p.team);
      const picked = squad.includes(p.id);
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
  const squad = getSquad();
  const idx = squad.indexOf(id);
  if (idx >= 0) {
    mutateSquad((arr) => arr.splice(arr.indexOf(id), 1));
    renderAll();
    return;
  }
  const check = canAdd(p);
  if (!check.ok) {
    toast(check.reason, true);
    return;
  }
  mutateSquad((arr) => arr.push(id));
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
  qs("#refresh-live").addEventListener("click", () => refreshLive());
  qs("#clear-team").addEventListener("click", () => {
    const squad = getSquad();
    if (squad.length === 0) return;
    if (!confirm("Tømme laget for denne runden?")) return;
    setSquad([]);
    renderAll();
  });
  qs("#base-ft").addEventListener("change", (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v >= 0 && v <= MAX_FREE_TRANSFERS) {
      state.baseFreeTransfers = v;
      saveStored();
      renderBudget();
    }
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
  qs("#filter-ownership").addEventListener("change", (e) => {
    state.filters.minOwnership = Number(e.target.value);
    renderPlayerList();
  });

  qs("#players-list").addEventListener("click", (e) => {
    const row = e.target.closest(".player-row");
    if (!row) return;
    togglePlayer(Number(row.dataset.player));
  });

  function pitchClickHandler(e) {
    if (e.target.closest("[data-remove]")) return;
    const slot = e.target.closest(".slot.filled[data-player]");
    if (!slot) return;
    handleSlotClick(Number(slot.dataset.player));
  }
  qs("#pitch").addEventListener("click", pitchClickHandler);
  qs("#bench-slots").addEventListener("click", pitchClickHandler);

  document.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) {
      togglePlayer(Number(removeBtn.dataset.remove));
      e.stopPropagation();
    }
  });

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
