// Testes de interações por live, relatórios e configuração de overlay.
//
//   node tests/interactions-reports.test.js
//
// Usa um banco SQLite temporário (DB_PATH) — não toca em node/data.db.
// A parte de integração (rotas HTTP) é ignorada se o servidor estiver offline.

const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tikplay-reports-"));
process.env.DB_PATH = path.join(TMP, "data.db");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../db");
const interactions = require("../lib/interactions");
const levels = require("../lib/levels");
const auth = require("../auth");

const BASE = process.env.TEST_BASE || "http://localhost:3100";
const MIN = 60000;
const DAY = 86400000;

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("  PASS " + name); }
  else { failed++; console.log("  FAIL " + name + (extra ? " :: " + extra : "")); }
}
function tenant(id, room, session) {
  return { id, currentRoomId: room, currentSessionId: session || null };
}
function row(over = {}) {
  return Object.assign({
    tenant_id: 1, room_id: "r1", session_id: null, ts: Date.now(),
    type: "like", user_id: "u1", username: "u1", nickname: "U1", avatar: "",
    value: 1, meta: "", event_id: "",
  }, over);
}

function testLiveSessions() {
  console.log("[1] live_sessions");
  const a = db.openLiveSession({ tenant_id: 101, room_id: "roomA", engine: "tiktoklive", username: "x", ts: 1000 });
  const a2 = db.openLiveSession({ tenant_id: 101, room_id: "roomA", ts: 2000 });
  check("mesma sala reaproveita a sessão (não duplica)", a === a2, `${a} vs ${a2}`);
  const b = db.openLiveSession({ tenant_id: 101, room_id: "roomB", ts: 3000 });
  check("sala diferente cria nova sessão", b !== a);
  const sessions = db.getLiveSessions(101);
  check("lista traz 2 sessões", sessions.length === 2, "n=" + sessions.length);
  const roomA = sessions.find(s => s.room_id === "roomA");
  const roomB = sessions.find(s => s.room_id === "roomB");
  check("sessão anterior foi encerrada (ended_at)", roomA && roomA.ended_at === 3000, JSON.stringify(roomA));
  check("sessão atual aberta", roomB && roomB.ended_at == null);
  check("isolamento por tenant", db.getLiveSessions(102).length === 0);
}

function testIngestAggregatesDedupe() {
  console.log("[2] ingestão, agregados e deduplicação");
  const t = tenant(201, "roomZ", 7);
  const now = Date.now();
  interactions.ingest(t, { type: "like", event_id: "e1", value: 3, user_id: "u1", ts: now });
  interactions.ingest(t, { type: "like", event_id: "e2", value: 3, user_id: "u1", ts: now });
  interactions._drainForTests();
  let s = db.summaryInteractions({ tenantId: 201 });
  check("2 curtidas somadas", s.by_type.like && s.by_type.like.count === 2, JSON.stringify(s.by_type));
  check("valor somado (6)", s.by_type.like && s.by_type.like.value_sum === 6);
  check("1 pessoa única", s.people === 1, "people=" + s.people);

  // Reenvio do MESMO event_id => não duplica nem infla agregado.
  const ins = interactions.ingest(t, { type: "like", event_id: "e1", value: 3, user_id: "u1", ts: now });
  const drained = interactions._drainForTests();
  check("event_id aceito na fila", ins === true);
  check("duplicado não é inserido", drained.inserted === 0, JSON.stringify(drained));
  s = db.summaryInteractions({ tenantId: 201 });
  check("agregado não inflado por duplicata", s.by_type.like.count === 2, JSON.stringify(s.by_type));

  interactions.ingest(t, { type: "gift", event_id: "g1", value: 10, user_id: "u2", ts: now, meta: { gift_id: "6247", diamonds: 10 } });
  interactions._drainForTests();
  s = db.summaryInteractions({ tenantId: 201 });
  check("gift conta 1 com valor 10", s.by_type.gift && s.by_type.gift.count === 1 && s.by_type.gift.value_sum === 10, JSON.stringify(s.by_type));
  check("pessoas únicas = 2", s.people === 2, "people=" + s.people);

  // Tipos desconhecidos são ignorados.
  check("tipo desconhecido ignorado", interactions.normalizeEvent(t, { type: "???" }) === null);
}

function testIsolation() {
  console.log("[3] isolamento entre contas");
  const now = Date.now();
  interactions.ingest(tenant(301, "rA"), { type: "like", event_id: "a1", value: 5, user_id: "uX", ts: now });
  interactions._drainForTests();
  const s301 = db.summaryInteractions({ tenantId: 301 });
  const s302 = db.summaryInteractions({ tenantId: 302 });
  check("conta 301 vê seus dados", s301.by_type.like && s301.by_type.like.count === 1);
  check("conta 302 não vê dados da 301", !s302.by_type.like, JSON.stringify(s302.by_type));
  // Filtro por sala
  interactions.ingest(tenant(301, "rB"), { type: "like", event_id: "b1", value: 2, user_id: "uY", ts: now });
  interactions._drainForTests();
  const sRoom = db.summaryInteractions({ tenantId: 301, room_id: "rB" });
  check("filtro por room_id funciona", sRoom.by_type.like && sRoom.by_type.like.count === 1, JSON.stringify(sRoom.by_type));
}

function testSeriesAndRanking() {
  console.log("[4] série temporal e ranking");
  const base = 1_700_000_000_000; // minuto fixo
  interactions.ingest(tenant(401, "r"), { type: "like", event_id: "s1", value: 1, user_id: "u1", ts: base });
  interactions.ingest(tenant(401, "r"), { type: "like", event_id: "s2", value: 1, user_id: "u1", ts: base + 30_000 });
  interactions.ingest(tenant(401, "r"), { type: "like", event_id: "s3", value: 1, user_id: "u1", ts: base + MIN });
  interactions.ingest(tenant(401, "r"), { type: "like", event_id: "s4", value: 1, user_id: "u2", ts: base + MIN });
  interactions._drainForTests();
  const series = db.seriesInteractions({ tenantId: 401, bucketMs: MIN });
  check("2 buckets de minuto", series.points.length === 2, JSON.stringify(series.points));
  check("1º bucket tem 2", series.points[0] && series.points[0].count === 2, JSON.stringify(series.points[0]));
  const rank = db.rankingInteractions({ tenantId: 401, type: "like" });
  check("u1 lidera (3)", rank.ranking[0] && rank.ranking[0].user_id === "u1" && rank.ranking[0].count === 3, JSON.stringify(rank.ranking));
}

function testPagination() {
  console.log("[5] paginação por cursor");
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    interactions.ingest(tenant(501, "r"), { type: "join", event_id: `p${i}`, user_id: `u${i}`, ts: now + i });
  }
  interactions._drainForTests();
  const page1 = db.queryInteractions({ tenantId: 501, limit: 2 });
  check("page1 com 2 eventos", page1.events.length === 2, "n=" + page1.events.length);
  check("tem next_cursor", page1.next_cursor != null);
  const page2 = db.queryInteractions({ tenantId: 501, limit: 2, cursor: page1.next_cursor });
  check("page2 sem repetir page1", page2.events.every(e => !page1.events.some(p => p.id === e.id)));
  check("ordena por id desc", page1.events[0].id > page1.events[1].id);
}

function testRetention() {
  console.log("[6] retenção");
  const now = Date.now();
  // inserções diretas com timestamps antigos
  db.insertInteractionsBatch([
    row({ tenant_id: 601, ts: now - 100 * DAY, type: "like", user_id: "old", ...{} }),
    row({ tenant_id: 601, ts: now - 10 * DAY, type: "comment", user_id: "c1", meta: JSON.stringify({ text: "oi" }) }),
    row({ tenant_id: 601, ts: now - 800 * DAY, type: "like", user_id: "ancient" }),
  ]);
  const res = db.pruneInteractions({
    detailCutoff: now - 90 * DAY,
    commentTextCutoff: now - 7 * DAY,
    aggCutoff: now - 730 * DAY,
  });
  check("detalhe antigo (>90d) removido", res.detail >= 1, JSON.stringify(res));
  check("comentário antigo teve texto limpo", res.comments >= 1, JSON.stringify(res));
  check("agregado >24m removido", res.aggregates >= 1, JSON.stringify(res));
  const rows = db.db.prepare("SELECT type, ts, meta FROM interactions WHERE tenant_id = 601").all();
  check("comentário permanece (dentro de 90d) sem texto", rows.some(r => r.type === "comment" && r.meta === ""), JSON.stringify(rows));
  check("sem detalhe antigo", rows.every(r => r.ts >= now - 90 * DAY));
}

function testMeta() {
  console.log("[7] normalização de meta");
  const t = tenant(701, "r");
  const ev = interactions.normalizeEvent(t, { type: "comment", meta: { text: "x".repeat(500) } });
  const meta = JSON.parse(ev.meta);
  check("texto do comentário truncado (<=300)", meta.text.length <= 300, "len=" + meta.text.length);
  const ev2 = interactions.normalizeEvent(t, { type: "gift", meta: { diamonds: 10 } });
  check("meta JSON válido", JSON.parse(ev2.meta).diamonds === 10);
  check("sem meta => string vazia", interactions.normalizeEvent(t, { type: "join" }).meta === "");
}

function testOverlayConfig() {
  console.log("[8] configuração de overlay (aditiva e validada)");
  const saved = db.saveLikesOverlayLayout(801, "v3", {
    x: 10, y: 20, scale: 1.5, count: 7,
    photo_position: "right", font_color: "#ABCDEF", shadow: "strong",
    animation: "pop", heart_colors: ["#111111", "#222222"],
  });
  check("campos novos persistidos", saved.photo_position === "right" && saved.font_color === "#ABCDEF" && saved.shadow === "strong" && saved.animation === "pop");
  check("corações persistidos", Array.isArray(saved.heart_colors) && saved.heart_colors.length === 2);
  const got = db.getLikesOverlayLayout(801, "v3");
  check("round-trip igual", JSON.stringify(got) === JSON.stringify(saved), JSON.stringify(got));

  // Compatibilidade: campos ausentes recebem default.
  const partial = db.saveLikesOverlayLayout(802, "v3", { x: 1, y: 2, scale: 1, count: 3 });
  check("defaults preenchidos", partial.photo_position === "left" && partial.animation === "float" && partial.heart_colors.length === 1);

  // Validação: valores inválidos lançam (POST => 400).
  let threw = 0;
  for (const bad of [{ x: 999 }, { font_color: "red" }, { shadow: "huge" }, { animation: "css" }, { heart_colors: ["blue"] }]) {
    try { db.saveLikesOverlayLayout(803, "v3", Object.assign({ x: 0, y: 0, scale: 1, count: 5 }, bad)); }
    catch { threw++; }
  }
  check("5 configurações inválidas rejeitadas", threw === 5, "threw=" + threw);

  // GET nunca lança: layout corrompido cai no default.
  db.db.prepare("UPDATE tenant_settings SET likes_overlay_layout = ? WHERE tenant_id = ?").run("{corrompido", 801);
  const fb = db.getLikesOverlayLayout(801, "v3");
  check("layout corrompido => default seguro", fb.x === 0 && fb.photo_position === "left");

  // v2 continua independente de v3.
  db.saveLikesOverlayLayout(804, "v2", { x: 5, y: 5, scale: 2, count: 10, photo_position: "top" });
  const v2 = db.getLikesOverlayLayout(804, "v2");
  const v3 = db.getLikesOverlayLayout(804, "v3");
  check("v2 e v3 independentes", v2.photo_position === "top" && v3.photo_position === "left");
}

async function testIntegration() {
  console.log("[10] integração das rotas (autenticação/isolamento)");
  let up = false;
  try { up = (await fetch(BASE + "/api/plans")).status === 200; } catch { up = false; }
  if (!up) { console.log("  SKIP servidor offline em " + BASE); return; }
  const tok = auth.signToken({ id: 1, role: "admin" });
  async function get(p) {
    const r = await fetch(BASE + p, { headers: { Authorization: "Bearer " + tok } });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, json: j };
  }
  {
    const r = await fetch(BASE + "/api/reports/summary");
    check("/api/reports/summary sem token -> 401", r.status === 401);
  }
  {
    const r = await fetch(BASE + "/api/live-sessions");
    check("/api/live-sessions sem token -> 401", r.status === 401);
  }
  const s = await get("/api/reports/summary");
  check("/api/reports/summary autenticado -> 200", s.status === 200 && s.json.success === true, JSON.stringify(s));
  check("/api/reports/summary inclui level_up por eixo", s.json.level_up && typeof s.json.level_up.total === "number" && typeof s.json.level_up.gifter === "number" && typeof s.json.level_up.fanclub === "number", JSON.stringify(s.json.level_up));
  const ls = await get("/api/live-sessions");
  check("/api/live-sessions autenticado -> 200", ls.status === 200 && Array.isArray(ls.json.sessions), JSON.stringify(ls).slice(0, 120));
  const ev = await get("/api/reports/events?limit=5");
  check("/api/reports/events autenticado -> 200", ev.status === 200 && Array.isArray(ev.json.events));
  const se = await get("/api/reports/series?bucket=hour");
  check("/api/reports/series autenticado -> 200", se.status === 200 && Array.isArray(se.json.points));
  const rk = await get("/api/reports/ranking?type=like");
  check("/api/reports/ranking autenticado -> 200", rk.status === 200 && Array.isArray(rk.json.ranking));
  const lvl = await get("/api/reports/levels");
  check("/api/reports/levels autenticado -> 200", lvl.status === 200 && Array.isArray(lvl.json.levels));
  const lvlEv = await get("/api/reports/events?type=level_up&axis=gifter&limit=5");
  check("/api/reports/events?type=level_up&axis gifter -> 200", lvlEv.status === 200 && Array.isArray(lvlEv.json.events));
}

function testLevels() {
  console.log("[9] níveis (presenteador / fã-clube)");
  const t = (room) => tenant(901, room, 11);

  // Pré-existente de outra live: global gifter 10.
  db.upsertViewerLevel({ tenant_id: 901, user_id: "u1", nickname: "U1", gifter_level: 10, fan_club_level: 0, ts: 1000 });
  // Entrada na live R1 com nível divergente (15) => silencioso (sem animação).
  let r = levels.handleViewerLevel(t("R1"), { room_id: "R1", user_id: "u1", username: "u1", nickname: "U1", gifter_level: 15, ts: 2000 });
  check("entrada na live = sem evento (divergência silenciosa)", r.events.length === 0, JSON.stringify(r));
  check("baseline da live gravado (15)", db.getLiveViewerLevel(901, "R1", "u1").gifter_level === 15);
  check("nível global sincronizado (15)", db.getViewerLevel(901, "u1").gifter_level === 15);

  // Subida DURANTE a live => evento Antes > Depois.
  r = levels.handleViewerLevel(t("R1"), { room_id: "R1", user_id: "u1", username: "u1", nickname: "U1", gifter_level: 16, ts: 3000 });
  check("subida durante a live gera evento (15->16)",
    r.events.length === 1 && r.events[0].axis === "gifter" && r.events[0].before === 15 && r.events[0].after === 16,
    JSON.stringify(r));
  check("baseline atualizado (16)", db.getLiveViewerLevel(901, "R1", "u1").gifter_level === 16);

  // Ausente/0 não sobrescreve nem gera evento.
  r = levels.handleViewerLevel(t("R1"), { room_id: "R1", user_id: "u1", username: "u1", gifter_level: 0, ts: 3100 });
  check("nível ausente/0 não gera evento nem sobrescreve",
    r.events.length === 0 && db.getLiveViewerLevel(901, "R1", "u1").gifter_level === 16);

  // Persistido em level_ups (fonte dedicada).
  const lu = db.queryLevelUps({ tenantId: 901, room_id: "R1", axis: "gifter" });
  check("subida de presenteador persistida em level_ups (15->16)",
    lu.events.length === 1 && lu.events[0].before === 15 && lu.events[0].after === 16 && lu.events[0].axis === "gifter",
    JSON.stringify(lu.events));

  // Eixo fã-clube independente.
  const t2 = tenant(901, "R1", 11);
  db.upsertLiveViewerLevel({ tenant_id: 901, room_id: "R1", user_id: "u2", nickname: "U2", gifter_level: 0, fan_club_level: 3, ts: 4000 });
  r = levels.handleViewerLevel(t2, { room_id: "R1", user_id: "u2", username: "u2", nickname: "U2", fan_club_level: 4, ts: 4100 });
  check("subida de fã-clube (eixo independente 3->4)",
    r.events.length === 1 && r.events[0].axis === "fanclub" && r.events[0].before === 3 && r.events[0].after === 4,
    JSON.stringify(r));

  // Baseline desconhecido (0) => silent set, sem animar; próxima subida anima.
  db.upsertLiveViewerLevel({ tenant_id: 901, room_id: "R1", user_id: "u3", nickname: "U3", gifter_level: 0, fan_club_level: 2, ts: 5000 });
  r = levels.handleViewerLevel(t2, { room_id: "R1", user_id: "u3", username: "u3", gifter_level: 7, ts: 5100 });
  check("baseline desconhecido (0) => sem evento", r.events.length === 0, JSON.stringify(r));
  r = levels.handleViewerLevel(t2, { room_id: "R1", user_id: "u3", username: "u3", gifter_level: 8, ts: 5200 });
  check("após baseline, próxima subida anima (7->8)", r.events.length === 1 && r.events[0].before === 7 && r.events[0].after === 8);

  // Barrage explícito de fã-clube sem baseline => before null (não inventamos).
  const explicit = levels.handleViewerLevel(t2, {
    room_id: "R-explicit", user_id: "u4", username: "u4", nickname: "U4",
    fan_club_level: 30, level_up_axis: "fanclub", ts: 6000,
  });
  check("promoção explícita sem baseline gera evento (before null, after 30)",
    explicit.events.length === 1 && explicit.events[0].axis === "fanclub" && explicit.events[0].before === null && explicit.events[0].after === 30,
    JSON.stringify(explicit));
  check("promoção explícita persiste em level_ups",
    db.queryLevelUps({ tenantId: 901, room_id: "R-explicit", axis: "fanclub" }).events.length === 1);
  const duplicateExplicit = levels.handleViewerLevel(t2, {
    room_id: "R-explicit", user_id: "u4", username: "u4", nickname: "U4",
    fan_club_level: 30, level_up_axis: "fanclub", ts: 6100,
  });
  check("promoção explícita duplicada (mesmo nível) não repete",
    duplicateExplicit.events.length === 0 && db.queryLevelUps({ tenantId: 901, room_id: "R-explicit", axis: "fanclub" }).events.length === 1);

  // Barrage explícito de PRESENTEADOR (USER_UPGRADE) sem baseline.
  const gifterExplicit = levels.handleViewerLevel(t2, {
    room_id: "R-gifter", user_id: "u5", username: "u5", nickname: "U5",
    gifter_level: 20, level_up_axis: "gifter", event_id: "ug-1", ts: 7000,
  });
  check("promoção explícita de presenteador sem baseline (before null, after 20)",
    gifterExplicit.events.length === 1 && gifterExplicit.events[0].axis === "gifter" && gifterExplicit.events[0].before === null && gifterExplicit.events[0].after === 20,
    JSON.stringify(gifterExplicit));
  const dupEventId = levels.handleViewerLevel(t2, {
    room_id: "R-gifter", user_id: "u5", username: "u5", nickname: "U5",
    gifter_level: 20, level_up_axis: "gifter", event_id: "ug-1", ts: 7050,
  });
  check("dedupe por event_id não repete", dupEventId.events.length === 0);

  // Resumo por eixo.
  const luSummary = db.summarizeLevelUps({ tenantId: 901 });
  check("summary de subidas por eixo (gifter>=1, fanclub>=1)",
    luSummary.gifter >= 1 && luSummary.fanclub >= 1 && luSummary.total === luSummary.gifter + luSummary.fanclub,
    JSON.stringify(luSummary));

  // Isolamento e listagem.
  check("isolamento por tenant (level_ups)", db.queryLevelUps({ tenantId: 902 }).events.length === 0);
  check("isolamento por tenant", db.getLiveViewerLevel(902, "R1", "u1") === null);
  const lv = db.listViewerLevels(901, { room_id: "R1" });
  check("listViewerLevels por sala", Array.isArray(lv) && lv.length >= 3, "n=" + lv.length);
}

(async () => {
  testLiveSessions();
  testIngestAggregatesDedupe();
  testIsolation();
  testSeriesAndRanking();
  testPagination();
  testRetention();
  testMeta();
  testOverlayConfig();
  testLevels();
  await testIntegration();
  console.log("\nResultado: " + passed + " passaram, " + failed + " falharam.");
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("ERRO no teste:", e); process.exit(1); });
