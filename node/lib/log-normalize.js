const CATEGORY_ALIASES = Object.freeze({
  conexao: "connection",
  connection: "connection",
  chat: "chat",
  jogos: "game",
  jogo: "game",
  game: "game",
  avisos: "notice",
  notice: "notice",
  erros: "error",
  err: "error",
  error: "error",
  diagnostico: "diagnostic",
  diagnostic: "diagnostic",
  sistema: "system",
  system: "system",
});

const VALID_CATEGORIES = new Set(["connection", "chat", "game", "notice", "error", "diagnostic", "system"]);
const GAME_IDS = new Set(["palavra", "batalha", "caca", "tres", "vpet", "duelo", "corda", "tts", "jogo"]);

const PREFIX_RULES = [
  { pattern: /^\[(?:jogo|palavra|guess|fim|final boss|roleta|tap|manual)\]/i, category: "game", game: "palavra" },
  { pattern: /^\[3\s*dicas\]/i, category: "game", game: "tres" },
  { pattern: /^\[batalha\]/i, category: "game", game: "batalha" },
  { pattern: /^\[duelo\]/i, category: "game", game: "duelo" },
  { pattern: /^\[corda\]/i, category: "game", game: "corda" },
  { pattern: /^\[cacapalavras\]/i, category: "game", game: "caca" },
  { pattern: /^\[bichinho\]/i, category: "game", game: "vpet" },
  { pattern: /^\[tts\]/i, category: "game", game: "tts" },
  { pattern: /^\[chat\]/i, category: "chat", game: "chat" },
  { pattern: /^\[gift\]/i, category: "notice" },
  { pattern: /^\[access\]/i, category: "notice" },
  { pattern: /^\[(?:stderr|erro|error)\]/i, category: "error" },
  { pattern: /^\[(?:debug|diag(?:nostico)?|trace)\]/i, category: "diagnostic" },
  { pattern: /^\[(?:live|main|service|daemon|painel|session|tiktoktools|tiktoklive)\]/i, category: "connection" },
  { pattern: /^\[(?:nivel|nível)\]/i, category: "notice" },
  { pattern: /^\[(?:follow)\]/i, category: "notice" },
  { pattern: /^\[gifts\]/i, category: "connection" },
];

function normalizeLevel(value, text = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (["err", "error"].includes(raw)) return "error";
  if (["critical", "fatal"].includes(raw)) return "critical";
  if (["warn", "warning"].includes(raw)) return "warning";
  if (["ok", "info", ""].includes(raw)) {
    if (!raw && /\[(?:erro|error|stderr)\]|\berro\b|\berror\b/i.test(String(text || ""))) return "error";
    if (!raw && /\[!\]|\[(?:warn|aviso)\]|\bwarning\b|\baviso\b|\batencao\b|\bfalha\b|\bfalhou\b|\bfailed\b/i.test(String(text || ""))) return "warning";
    return "info";
  }
  if (["debug", "trace"].includes(raw)) return "debug";
  if (raw === "chat") return "info";
  return "unknown";
}

function normalizeLog(item, defaults = {}) {
  const base = typeof item === "string" ? { text: item } : (item || {});
  const text = String(base.text == null ? "" : base.text);
  const rawGame = String(base.game || defaults.game || "").trim().toLowerCase();
  const prefixRule = PREFIX_RULES.find((rule) => rule.pattern.test(text));
  const game = GAME_IDS.has(rawGame) ? rawGame : (GAME_IDS.has(String(defaults.game || "").toLowerCase())
    ? String(defaults.game).toLowerCase()
    : (prefixRule && prefixRule.game) || "");
  const level = normalizeLevel(base.level || defaults.level, text);
  const rawCategory = String(base.category || defaults.category || "").trim().toLowerCase();
  const explicitCategory = CATEGORY_ALIASES[rawCategory] || (VALID_CATEGORIES.has(rawCategory) ? rawCategory : "");

  let category;
  if (level === "error" || level === "critical") category = "error";
  else if (level === "debug") category = "diagnostic";
  else if (rawCategory === "chat" || String(base.level || "").toLowerCase() === "chat") category = "chat";
  else if (explicitCategory) category = explicitCategory;
  else if (prefixRule) category = prefixRule.category;
  else if (game) category = "game";
  else if (level === "warning") category = "notice";
  else category = "system";

  const event = String(base.event || defaults.event || (prefixRule ? `legacy.${prefixRule.game || prefixRule.category}.message` : "legacy.message"))
    .slice(0, 96);
  const source = String(base.source || defaults.source || (typeof item === "string" ? "legacy" : "node"))
    .slice(0, 32);

  return {
    text,
    category,
    level,
    game,
    event,
    source,
    session_id: base.session_id || defaults.session_id || null,
    trace_id: base.trace_id || defaults.trace_id || null,
    game_id: base.game_id || defaults.game_id || null,
    code: base.code || defaults.code || null,
    duration_ms: base.duration_ms == null || base.duration_ms === ""
      ? null
      : (Number.isFinite(Number(base.duration_ms)) ? Number(base.duration_ms) : null),
    details: base.details == null ? null : base.details,
  };
}

module.exports = { normalizeLog, normalizeLevel, CATEGORY_ALIASES, GAME_IDS };
