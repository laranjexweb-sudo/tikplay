// Testes do objeto `activity` do Dashboard do Super Admin.
//
//   node tests/admin-activity.test.js
//
// Parte 1 (unidade): funcoes puras de lib/admin-activity.js.
// Parte 2 (integracao): GET /api/admin/users inclui `activity` e mantem a
// autorizacao (401 sem token / 403 nao-admin / 200 admin) — requer o servidor
// rodando em TEST_BASE (default http://localhost:3100); se estiver offline, a
// parte 2 e reportada como ignorada.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const activity = require("../lib/admin-activity");
const auth = require("../auth");

const BASE = process.env.TEST_BASE || "http://localhost:3100";

let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) { passed++; console.log("  PASS " + name); }
  else { failed++; console.log("  FAIL " + name + (extra ? " :: " + extra : "")); }
}

function ws(readyState) { return { readyState }; }

function tenant(over = {}) {
  return Object.assign({
    gameState: {},
    logClients: [],
    browserClients: [],
    currentStatus: null,
    sessionStarted: false,
    tresState: null,
    cacaState: null,
    vpetState: null,
    dueloState: null,
    cordaState: null,
    lastActivityAt: null,
  }, over);
}

function unit() {
  console.log("[1] panel_online");

  check("sem aba -> painel offline",
    activity.computeActivity(tenant()).panel_online === false);
  check("1 aba do painel -> online",
    activity.computeActivity(tenant({ logClients: [ws(1)] })).panel_online === true);
  check("multiplas abas -> online",
    activity.computeActivity(tenant({ logClients: [ws(1), ws(1)] })).panel_online === true);
  check("aba encerrada (readyState 3) nao conta",
    activity.computeActivity(tenant({ logClients: [ws(3)] })).panel_online === false);
  check("aba encerrada + aberta -> online",
    activity.computeActivity(tenant({ logClients: [ws(3), ws(1)] })).panel_online === true);
  check("somente OBS/overlay (/browser) NAO conta como painel",
    activity.computeActivity(tenant({ browserClients: [ws(1), ws(1)] })).panel_online === false);
  check("OBS aberto + painel aberto -> online",
    activity.computeActivity(tenant({ browserClients: [ws(1)], logClients: [ws(1)] })).panel_online === true);

  console.log("[2] tiktok_status");

  check("tenant ausente -> offline", activity.mapTiktokStatus(undefined) === "offline");
  check("sem sessao -> offline (mesmo com status residual)",
    activity.mapTiktokStatus(tenant({ sessionStarted: false, currentStatus: { state: "connected" } })) === "offline");
  check("sessao + connected -> connected",
    activity.mapTiktokStatus(tenant({ sessionStarted: true, currentStatus: { state: "connected" } })) === "connected");
  check("sessao + waiting -> reconnecting",
    activity.mapTiktokStatus(tenant({ sessionStarted: true, currentStatus: { state: "waiting" } })) === "reconnecting");
  check("sessao + disconnected -> disconnected",
    activity.mapTiktokStatus(tenant({ sessionStarted: true, currentStatus: { state: "disconnected" } })) === "disconnected");
  check("sessao + offline -> offline",
    activity.mapTiktokStatus(tenant({ sessionStarted: true, currentStatus: { state: "offline" } })) === "offline");
  check("sessao sem status -> connecting",
    activity.mapTiktokStatus(tenant({ sessionStarted: true, currentStatus: null })) === "connecting");

  console.log("[3] game_name / game_status");

  check("sem partida -> idle/null",
    (() => { const g = activity.currentGame(tenant()); return g.status === "idle" && g.name === null; })());
  check("Palavra Secreta rodando",
    (() => { const g = activity.currentGame(tenant({ gameState: { active: true, finished: false } })); return g.name === "Palavra Secreta" && g.status === "running"; })());
  check("Palavra Secreta encerrada",
    (() => { const g = activity.currentGame(tenant({ gameState: { active: true, finished: true } })); return g.status === "finished"; })());
  check("3 Dicas pausado",
    (() => { const g = activity.currentGame(tenant({ tresState: { active: true, paused: true, finished: false } })); return g.name === "3 Dicas" && g.status === "paused"; })());
  check("Caça Palavras rodando",
    (() => { const g = activity.currentGame(tenant({ cacaState: { active: true, finished: false } })); return g.name === "Caça Palavras" && g.status === "running"; })());
  check("Bichinho Virtual rodando",
    (() => { const g = activity.currentGame(tenant({ vpetState: { active: true } })); return g.name === "Bichinho Virtual" && g.status === "running"; })());
  check("Batalha rodando",
    (() => { const g = activity.currentGame(tenant({ gameState: { battle: { active: true } } })); return g.name === "Batalha" && g.status === "running"; })());
  check("Duelo 1x1 rodando",
    (() => { const g = activity.currentGame(tenant({ dueloState: { active: true, final: false, winner: null } })); return g.name === "Duelo 1x1" && g.status === "running"; })());
  check("Duelo 1x1 encerrado",
    (() => { const g = activity.currentGame(tenant({ dueloState: { active: true, final: true, winner: "flavio" } })); return g.status === "finished"; })());
  check("Corda rodando",
    (() => { const g = activity.currentGame(tenant({ cordaState: { active: true, match_winner: null } })); return g.name === "Corda" && g.status === "running"; })());
  check("Corda encerrada",
    (() => { const g = activity.currentGame(tenant({ cordaState: { active: true, match_winner: "lula" } })); return g.status === "finished"; })());

  console.log("[4] jogos simultaneos (prevalece running; depois a ordem de prioridade)");
  check("Palavra encerrada + Duelo rodando -> Duelo (running vence finished)",
    (() => {
      const t = tenant({ gameState: { active: true, finished: true }, dueloState: { active: true, final: false, winner: null } });
      const g = activity.currentGame(t);
      return g.name === "Duelo 1x1" && g.status === "running";
    })());
  check("Palavra rodando + Batalha rodando -> Palavra (prioridade)",
    (() => {
      const t = tenant({ gameState: { active: true, finished: false, battle: { active: true } } });
      const g = activity.currentGame(t);
      return g.name === "Palavra Secreta" && g.status === "running";
    })());
  check("3 Dicas pausado + Caça rodando -> Caça (running > paused)",
    (() => {
      const t = tenant({ tresState: { active: true, paused: true, finished: false }, cacaState: { active: true, finished: false } });
      const g = activity.currentGame(t);
      return g.name === "Caça Palavras" && g.status === "running";
    })());

  console.log("[5] computeActivity (contrato completo + dados ausentes)");
  check("tenant ausente -> neutro",
    (() => {
      const a = activity.computeActivity(undefined);
      return a.panel_online === false && a.tiktok_status === "offline" && a.game_name === null && a.game_status === "idle" && a.last_activity_at === null;
    })());
  check("last_activity_at em ISO 8601 com fuso (Z)",
    (() => {
      const a = activity.computeActivity(tenant({ lastActivityAt: Date.parse("2026-10-13T20:00:00Z") }));
      return typeof a.last_activity_at === "string" && /Z$/.test(a.last_activity_at) && Number.isFinite(Date.parse(a.last_activity_at));
    })());
  check("last_activity_at null quando nunca houve acao",
    activity.computeActivity(tenant()).last_activity_at === null);

  console.log("[6] paths de atividade (abrir dashboard nao conta)");
  check("POST /start-game conta", activity.isActivityTouchPath("/start-game") === true);
  check("POST /api/new-game conta", activity.isActivityTouchPath("/api/new-game") === true);
  check("POST /api/tres/pause conta", activity.isActivityTouchPath("/api/tres/pause") === true);
  check("GET /api/admin/users NAO conta (consulta)", activity.isActivityTouchPath("/api/admin/users") === false);
  check("POST /api/settings NAO conta (config)", activity.isActivityTouchPath("/api/settings") === false);
  check("POST /api/gift-config NAO conta (config)", activity.isActivityTouchPath("/api/gift-config") === false);
  check("POST /api/duelo/config NAO conta (config)", activity.isActivityTouchPath("/api/duelo/config") === false);
}

async function serverUp() {
  try {
    const r = await fetch(BASE + "/api/plans");
    return r.status === 200;
  } catch { return false; }
}

async function integration() {
  console.log("[7] integracao GET /api/admin/users");

  if (!(await serverUp())) {
    console.log("  SKIP servidor nao respondeu em " + BASE + " (inicie-o para a parte de integracao)");
    return;
  }

  async function req(token) {
    const headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    const r = await fetch(BASE + "/api/admin/users", { headers });
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, json };
  }

  {
    const r = await req(null);
    check("sem token -> 401", r.status === 401, "status=" + r.status);
  }
  {
    const r = await req(auth.signToken({ id: 2, role: "user" }));
    check("streamer (nao-admin) -> 403", r.status === 403, "status=" + r.status);
  }
  {
    const r = await req(auth.signToken({ id: 1, role: "admin" }));
    check("admin -> 200", r.status === 200, "status=" + r.status);
    const users = (r.json && r.json.users) || [];
    check("lista de usuarios presente", Array.isArray(users) && users.length > 0, "n=" + users.length);
    const withActivity = users.filter(u => u.activity && typeof u.activity === "object");
    check("todos os usuarios tem activity", withActivity.length === users.length, withActivity.length + "/" + users.length);
    const a = (users[0] || {}).activity || {};
    check("activity.panel_online booleano", typeof a.panel_online === "boolean");
    check("activity.tiktok_status valido",
      ["connected", "disconnected", "connecting", "reconnecting", "offline"].includes(a.tiktok_status), "v=" + a.tiktok_status);
    check("activity.game_status valido",
      ["running", "paused", "finished", "idle"].includes(a.game_status), "v=" + a.game_status);
    check("activity.last_activity_at string|null",
      a.last_activity_at === null || typeof a.last_activity_at === "string");
    check("campos existentes preservados (email/role/plan)",
      "--" !== undefined && ["email", "role", "plan"].every(k => k in users[0]));
    check("nao expoe password_hash", users.every(u => !("password_hash" in u)));
    check("api key mascarada (sem segredo em claro)",
      users.every(u => typeof u.tiktools_api_key !== "string" || u.tiktools_api_key === "" || u.tiktools_api_key.includes("*")));
  }
}

// Validacao end-to-end de panel_online: /logs = painel; /browser = OBS/overlay.
async function panelOnlineIntegration() {
  console.log("[8] painel_online via WebSocket (end-to-end)");
  if (!(await serverUp())) {
    console.log("  SKIP servidor nao respondeu em " + BASE);
    return;
  }

  const WebSocket = require("ws");
  const wsBase = BASE.replace(/^http/, "ws");
  const adminTok = auth.signToken({ id: 1, role: "admin" });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  async function listUsers() {
    const r = await fetch(BASE + "/api/admin/users", { headers: { Authorization: "Bearer " + adminTok } });
    const j = await r.json();
    return (j && j.users) || [];
  }
  async function activityOf(id) {
    const u = (await listUsers()).find(x => x.id === id);
    return u && u.activity;
  }
  function openSocket(pathAndQuery) {
    return new Promise((resolve, reject) => {
      const s = new WebSocket(wsBase + pathAndQuery);
      s.on("open", () => resolve(s));
      s.on("error", reject);
    });
  }
  function closeSocket(s) {
    return new Promise((resolve) => { s.on("close", resolve); try { s.close(); } catch { resolve(); } });
  }

  // Escolhe dinamicamente um usuario ativo, nao-admin, que hoje NAO tenha painel
  // conectado (o ambiente pode ter um painel real aberto).
  const candidate = (await listUsers()).find(u =>
    u.role !== "admin" && u.status === "active" && u.activity && u.activity.panel_online === false);
  if (!candidate) {
    console.log("  SKIP nenhum usuario ativo sem painel conectado para isolar o teste");
    return;
  }
  const uid = candidate.id;
  const tok = auth.signToken({ id: uid, role: "user" });

  let a = await activityOf(uid);
  check("pre-condicao: usuario sem painel -> panel_online false", a && a.panel_online === false, JSON.stringify(a));

  // Uma aba do painel (/logs).
  const tab1 = await openSocket("/logs?token=" + encodeURIComponent(tok));
  await wait(300);
  a = await activityOf(uid);
  check("1 aba do painel -> panel_online true", a && a.panel_online === true, JSON.stringify(a));

  // Segunda aba (multiplas abas).
  const tab2 = await openSocket("/logs?token=" + encodeURIComponent(tok));
  await wait(300);
  a = await activityOf(uid);
  check("2 abas do painel -> panel_online true", a && a.panel_online === true, JSON.stringify(a));

  // Fecha as duas abas -> volta a offline.
  await closeSocket(tab1);
  await closeSocket(tab2);
  await wait(400);
  a = await activityOf(uid);
  check("abas fechadas -> panel_online false", a && a.panel_online === false, JSON.stringify(a));

  // Somente OBS/overlay (/browser) NAO conta como painel online.
  const obs = await openSocket("/browser?token=" + encodeURIComponent(tok));
  await wait(300);
  a = await activityOf(uid);
  check("somente OBS (/browser) -> panel_online false", a && a.panel_online === false, JSON.stringify(a));
  await closeSocket(obs);
}

(async () => {
  unit();
  await integration();
  await panelOnlineIntegration();
  console.log("\nResultado: " + passed + " passaram, " + failed + " falharam.");
  // Drena sockets/undici antes do exit para evitar artefato de teardown no Windows.
  await new Promise((r) => setTimeout(r, 300));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("ERRO no teste:", e); process.exit(1); });
