// Persistência e recuperação do histórico de logs (backend).
// Normaliza eventos legados/estruturados, aplica categorias canônicas e sanitiza
// mensagem/detalhes antes de gravar e expor. Isolamento e paginação são por tenant.

const db = require("../db");
const { normalizeLog } = require("./log-normalize");
const { processLog } = require("./process-log");
const { sanitizeText, sanitizeDetails, MAX_MESSAGE_LEN } = require("./log-sanitize");

const MAX_GAME_LEN = 32;
const MAX_LEVEL_LEN = 16;
const MAX_EVENT_LEN = 96;
const MAX_SOURCE_LEN = 32;
const MAX_CODE_LEN = 64;
const MAX_TRACE_ID_LEN = 128;
const MAX_GAME_ID_LEN = 128;

function deriveCategory(item = {}) {
  return normalizeLog(item).category;
}

function parseSafeDetails(raw) {
  const safe = sanitizeDetails(raw);
  if (safe == null) return null;
  try { return JSON.parse(safe); } catch { return null; }
}

/**
 * Normaliza e persiste um log; retorna o registro com id/timestamp estáveis
 * (id global AUTOINCREMENT = cursor estável p/ deduplicação e paginação).
 */
function append(tenantId, item, sessionId = null) {
  const normalized = normalizeLog(item);
  const category = deriveCategory(normalized);
  const text = sanitizeText(normalized.text, { category });
  const game = String(normalized.game || "").slice(0, MAX_GAME_LEN);
  const level = String(normalized.level || "unknown").slice(0, MAX_LEVEL_LEN);
  const now = Date.now();
  const entry = {
    ts: now,
    session_id: sessionId || normalized.session_id || null,
    category,
    level,
    game,
    event: String(normalized.event || "legacy.message").slice(0, MAX_EVENT_LEN),
    source: String(normalized.source || "legacy").slice(0, MAX_SOURCE_LEN),
    code: normalized.code == null ? null : String(normalized.code).slice(0, MAX_CODE_LEN),
    trace_id: normalized.trace_id == null ? null : String(normalized.trace_id).slice(0, MAX_TRACE_ID_LEN),
    game_id: normalized.game_id == null ? null : String(normalized.game_id).slice(0, MAX_GAME_ID_LEN),
    duration_ms: Number.isFinite(normalized.duration_ms) ? Math.max(0, Math.round(normalized.duration_ms)) : null,
    details: sanitizeDetails(normalized.details),
    message: text,
  };
  try {
    const stored = db.appendLogEntry(Number(tenantId), entry.session_id, entry);
    return { ...stored, details: parseSafeDetails(stored.details) };
  } catch (e) {
    // Persistência nunca derruba a entrega ao vivo.
    processLog({ category: "error", level: "error", event: "logs.persistence.append_failed",
      message: "Não foi possível persistir um evento de log.", code: "LOG_APPEND_FAILED",
      details: { error_type: e && e.name || "Error", tenant_id: Number(tenantId) } });
    return { id: null, ...entry };
  }
}

function query({ tenantId, before, since, limit, game, level, category, event, trace_id, session_id, game_id, source, code }) {
  try {
    const rows = db.getLogEntries({ tenantId: Number(tenantId), before, since, limit, game, level, category, event, trace_id, session_id, game_id, source, code });
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      timestamp: r.timestamp,
      category: r.category,
      level: r.level,
      game: r.game,
      event: r.event,
      source: r.source,
      code: r.code,
      session_id: r.session_id,
      trace_id: r.trace_id,
      game_id: r.game_id,
      duration_ms: r.duration_ms,
      details: parseSafeDetails(r.details),
      message: sanitizeText(r.message, { category: r.category }),
      text: sanitizeText(r.message, { category: r.category }),
    }));
  } catch (e) {
    processLog({ category: "error", level: "error", event: "logs.persistence.query_failed",
      message: "Não foi possível consultar o histórico de logs.", code: "LOG_QUERY_FAILED",
      details: { error_type: e && e.name || "Error", tenant_id: Number(tenantId) } });
    return [];
  }
}

function redactLegacyHistory() {
  return db.redactLegacyLogMessages(sanitizeText);
}

function normalizeLegacyHistory() {
  return db.normalizeLegacyLogEntries(normalizeLog);
}

let pruneCounter = 0;
const PRUNE_EVERY = 150; // contra-baixo: poda a cada N gravações + no boot.

function maybePrune() {
  if (++pruneCounter >= PRUNE_EVERY) {
    pruneCounter = 0;
    try { db.pruneLogEntries(); } catch (e) {
      processLog({ category: "error", level: "error", event: "logs.persistence.prune_failed",
        message: "Falha ao aplicar a retenção do histórico de logs.", code: "LOG_PRUNE_FAILED",
        details: { error_type: e && e.name || "Error" } });
    }
  }
}

module.exports = { append, query, maybePrune, redactLegacyHistory, normalizeLegacyHistory, sanitizeText, sanitizeDetails, parseSafeDetails, deriveCategory, normalizeLog, MAX_MESSAGE_LEN };
