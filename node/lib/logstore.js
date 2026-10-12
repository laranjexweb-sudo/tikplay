// Persistência e recuperação do histórico de logs (backend).
// Normaliza os legados {text, game, level} produzidos pelo daemon/servidor,
// sanitiza mensagens (tokens/chaves/URLs secretas), grava e lê de forma
// paginada e isolada por tenant. Não altera o contrato de transporte:
// os eventos ao vivo continuam {type:"log", text, game, level} + metadados aditivos.

const db = require("../db");

const MAX_MESSAGE_LEN = 500;
const MAX_GAME_LEN = 32;
const MAX_LEVEL_LEN = 16;

// Marca (local): evita que segredos apareçam no armazenamento e na exposição.
const MASK = "***";

function sanitizeText(raw) {
  let s = String(raw == null ? "" : raw);
  if (!s) return "";
  // Cabeçalhos/parâmetros de autenticação e segredos.
  s = s.replace(/(\b(?:bearer|authorization|token|api[_-]?key|access[_-]?token|jwt|secret|password|passwd|refresh_token|private_token))\s*[=:]\s*[^\s,;"]+/gi, `$1=${MASK}`);
  s = s.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${MASK}`);
  // Query strings sensíveis (token/tk/api/sig/assinaturas).
  s = s.replace(/([?&](?:token|tk|api_key|apikey|key|secret|sig|signature|X-Amz-Signature|access_token|refresh_token)=)[^&\s]+/gi, `$1${MASK}`);
  // Tokens/claves de plataformas com prefixo conhecido.
  s = s.replace(/\b(?:sk|pk|rk|ak|ghp|github_pat|AIza)[_-]?[A-Za-z0-9_-]{12,}/g, MASK);
  // Sequências hex/base64 longas (prováveis chaves/IDs secretos).
  s = s.replace(/\b[A-Fa-f0-9]{32,}\b/g, MASK);
  if (s.length > MAX_MESSAGE_LEN) s = s.slice(0, MAX_MESSAGE_LEN).trimEnd() + "…";
  return s;
}

// Classificação conservadora. Fallback documentado para linhas sem metadados:
// desconhecido fica em "system" ("Conexão/Sistema" no painel), sem confiança inventada.
function deriveCategory({ text, game, level }) {
  const lv = String(level || "").toLowerCase();
  const t = String(text || "").toLowerCase();
  if (["err", "error"].includes(lv) || t.startsWith("[erro") || t.includes(" error")) return "error";
  if (["debug", "trace"].includes(lv) || t.startsWith("[diag") || t.startsWith("[debug") || t.startsWith("[trace") || t.includes("[diagnostico")) return "diagnostic";
  if (lv === "chat" || t.startsWith("[chat")) return "chat";
  const g = String(game || "").toLowerCase();
  if (["batalha", "caca", "tres", "vpet", "duelo", "palavra", "tts", "jogo", "chat"].includes(g)) return "game";
  return "system";
}

/**
 * Normaliza e persiste um log; retorna o registro com id/timestamp estáveis
 * (id global AUTOINCREMENT = cursor estável p/ deduplicação e paginação).
 */
function append(tenantId, item) {
  const base = (typeof item === "string" ? { text: item } : (item || {})) || {};
  const text = sanitizeText(base.text);
  const game = String(base.game || "").slice(0, MAX_GAME_LEN);
  const level = String(base.level || "").slice(0, MAX_LEVEL_LEN);
  const now = Date.now();
  const entry = { ts: now, category: deriveCategory({ text, game, level }), level, game, message: text };
  try {
    return db.appendLogEntry(Number(tenantId), null, entry);
  } catch (e) {
    // Persistência nunca derruba a entrega ao vivo.
    return { id: null, ts: now, category: entry.category, level, game, message: text };
  }
}

function query({ tenantId, before, since, limit }) {
  try {
    const rows = db.getLogEntries({ tenantId: Number(tenantId), before, since, limit });
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      timestamp: r.timestamp,
      category: r.category,
      level: r.level,
      game: r.game,
      message: sanitizeText(r.message),
      text: sanitizeText(r.message),
    }));
  } catch (e) {
    return [];
  }
}

let pruneCounter = 0;
const PRUNE_EVERY = 150; // contra-baixo: poda a cada N gravações + no boot.

function maybePrune() {
  if (++pruneCounter >= PRUNE_EVERY) {
    pruneCounter = 0;
    try { db.pruneLogEntries(); } catch (e) {}
  }
}

module.exports = { append, query, maybePrune, sanitizeText, deriveCategory, MAX_MESSAGE_LEN };