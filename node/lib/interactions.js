// Ingestão de interações por live (relatórios do streamer).
//
// O daemon Python apenas EMITE eventos normalizados; o Node (dono do banco) grava
// em LOTE para não disputar escrita no SQLite nem penalizar o caminho quente.
// Cada evento vira: (a) linha detalhada em `interactions` e (b) incremento de
// agregado por (tenant, sala, minuto, tipo, usuário) em `interaction_aggregates`.
//
// Idempotência: quando o evento traz `event_id` (ex.: msg_id do TikTokLive), o
// índice único parcial + INSERT OR IGNORE evita duplicatas em reconexões.
// No motor TikTools não há event_id/room_id por evento → best-effort.

const db = require("../db");

function intEnv(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

const DETAIL_RETENTION_DAYS = intEnv("INTERACTIONS_DETAIL_RETENTION_DAYS", 90);
const COMMENT_TEXT_RETENTION_DAYS = intEnv("INTERACTIONS_COMMENT_TEXT_RETENTION_DAYS", 7);
const AGG_RETENTION_DAYS = intEnv("INTERACTIONS_AGG_RETENTION_DAYS", 730); // 24 meses
const DAY_MS = 86400000;

const FLUSH_MS = 250;
const MAX_BATCH = 400;
const MAX_META_CHARS = 2000;
const MAX_COMMENT_CHARS = 300;

// Tipos de interação persistidos.
const ALLOWED_TYPES = new Set([
  "like", "gift", "comment", "follow", "share", "join",
  "guess", "hint", "winner", "size_reveal", "letter_reveal",
  "level_up",
]);

let _pending = [];
let _timer = null;

function metaToString(type, meta) {
  if (meta == null) return "";
  let obj = meta;
  if (typeof meta === "string") {
    // já é JSON/string: valida e normaliza
    try { obj = JSON.parse(meta); } catch { obj = { text: meta }; }
  }
  if (typeof obj !== "object") return "";
  if (type === "comment" && typeof obj.text === "string") {
    obj = { ...obj, text: obj.text.slice(0, MAX_COMMENT_CHARS) };
  }
  let s = "";
  try { s = JSON.stringify(obj); } catch { s = ""; }
  return s.slice(0, MAX_META_CHARS);
}

// Normaliza um payload emitido pelo Python para uma linha de `interactions`.
// Retorna null para tipos desconhecidos.
function normalizeEvent(tenant, payload) {
  const p = payload || {};
  const type = String(p.type || "");
  if (!ALLOWED_TYPES.has(type)) return null;
  const ts = Number(p.ts) || Date.now();
  const room_id = String(p.room_id || tenant.currentRoomId || "");
  return {
    tenant_id: tenant.id,
    room_id,
    session_id: tenant.currentSessionId || null,
    ts,
    type,
    user_id: String(p.user_id || ""),
    username: String(p.username || ""),
    nickname: String(p.nickname || ""),
    avatar: String(p.avatar || ""),
    value: Number(p.value) || 0,
    meta: metaToString(type, p.meta),
    event_id: String(p.event_id || ""),
  };
}

function flush() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (!_pending.length) return { inserted: 0 };
  const items = _pending;
  _pending = [];
  try {
    // db.insertInteractionsBatch deduplica por event_id e deriva os agregados
    // somente das linhas efetivamente inseridas.
    const inserted = db.insertInteractionsBatch(items);
    return { inserted };
  } catch (e) {
    // não relança para não derrubar o caminho quente; loga e descarta o lote
    console.error("[Interactions] falha ao gravar lote:", e && e.message);
    return { inserted: 0, error: e && e.message };
  }
}

function scheduleFlush() {
  if (_timer) return;
  _timer = setTimeout(() => { _timer = null; flush(); }, FLUSH_MS);
  if (_timer.unref) _timer.unref();
}

// Ponto de entrada do caminho quente: enfileira e agenda o flush.
function ingest(tenant, payload) {
  if (!tenant) return false;
  const row = normalizeEvent(tenant, payload);
  if (!row) return false;
  _pending.push(row);
  if (_pending.length >= MAX_BATCH) flush();
  else scheduleFlush();
  return true;
}

// Abre/reaproveita a sessão de live da sala e atualiza o tenant.
function openSession(tenant, payload) {
  const p = payload || {};
  const room_id = String(p.room_id || "");
  if (!tenant || !room_id) return null;
  const ts = Number(p.ts) || Date.now();
  const sessionId = db.openLiveSession({
    tenant_id: tenant.id,
    room_id,
    engine: p.engine || "",
    username: p.username || "",
    ts,
  });
  tenant.currentRoomId = room_id;
  tenant.currentSessionId = sessionId;
  tenant.liveSessionStartedAt = ts;
  return sessionId;
}

function prune(now = Date.now()) {
  return db.pruneInteractions({
    detailCutoff: now - DETAIL_RETENTION_DAYS * DAY_MS,
    commentTextCutoff: now - COMMENT_TEXT_RETENTION_DAYS * DAY_MS,
    aggCutoff: now - AGG_RETENTION_DAYS * DAY_MS,
  });
}

let _retentionTimer = null;
function startRetention(intervalMs = 6 * 3600 * 1000) {
  if (_retentionTimer) return;
  prune();
  _retentionTimer = setInterval(() => { try { prune(); } catch (e) { /* ignore */ } }, intervalMs);
  if (_retentionTimer.unref) _retentionTimer.unref();
}

// Utilidades de teste (não usadas no caminho de produção).
function _drainForTests() { return flush(); }
function _pendingSize() { return _pending.length; }

module.exports = {
  DETAIL_RETENTION_DAYS,
  COMMENT_TEXT_RETENTION_DAYS,
  AGG_RETENTION_DAYS,
  FLUSH_MS,
  MAX_BATCH,
  ALLOWED_TYPES,
  normalizeEvent,
  metaToString,
  ingest,
  flush,
  openSession,
  prune,
  startRetention,
  _drainForTests,
  _pendingSize,
};
