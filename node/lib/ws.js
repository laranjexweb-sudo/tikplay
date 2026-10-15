// Camada de estado e broadcast (tenants) — extraída de server.js na Fase B-2.
// `broadcastStatus`/`broadcastStatusAll` (que dependem do daemonSend) permanecem no server.js.
const { DEFAULT_SETTINGS } = require("../db");
const metrics = require("./metrics");

const tenants = new Map();

function emptyGameState() {
  return {
    active: false,
    game_id: null,
    secret_length: 0,
    secret_word: null,
    guesses: [],
    hints: [],
    finished: false,
    winner: null,
    guess_count: 0,
    hint_gifts: [],
    riddle_gifts: [],
    current_riddle_stage: 0,
    current_riddle: null,
    size_gift: "",
    size_revealed: false,
    letter_gift: "",
    first_letter: "",
    first_letter_revealed: false,
    display: { riddle_visible: false, ranking_view: "live" },
    post_game_summary: null,
    likes_ranking: [],
    tap_meta_current: 0,
    tap_meta_total: 1000,
    tap_meta_ready: false,
    settings: { ...DEFAULT_SETTINGS },
  };
}

function getTenant(id) {
  if (!tenants.has(id)) {
    tenants.set(id, {
      id,
      gameState: emptyGameState(),
      browserClients: [],
      logClients: [],
      currentStatus: null,
      currentWord: "",
      sessionStarted: false,
      activeDaemonSessionId: null,
      activeLiveUsername: null,
      activeLiveEngine: null,
      currentRoomId: null,
      currentSessionId: null,
      liveSessionStartedAt: null,
      cacaState: { active: false, size: 10, board: [], words: [], found_count: 0, total: 0, finished: false },
      vpetState: null,
      tresState: null,
    });
  }
  return tenants.get(id);
}

function broadcastToClients(clients, msg) {
  const data = JSON.stringify(msg);
  let delivered = 0;
  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i].send(data);
      delivered++;
    } catch {
      clients.splice(i, 1);
    }
  }
  // Contador de eventos/min do Monitor de Servidor (entregas por cliente).
  try { if (delivered > 0) metrics.recordWsEvent(delivered); } catch {}
}

let logPersister = null;

// Hooks opcionais para persistir logs no ponto único de entrega, sem mudar o contrato.
function registerLogPersister(fn) {
  logPersister = fn;
}

function broadcastLog(tenant, item) {
  // Aceita string legada ou evento estruturado; metadados são aditivos ao contrato.
  const base = (typeof item === "string" ? { text: item } : (item || {})) || {};
  const payload = { type: "log" };
  let meta = null;
  if (logPersister) {
    try {
      meta = logPersister(tenant.id, base, tenant) || null;
    } catch {
      meta = null;
    }
  }
  payload.text = (meta && meta.message != null) ? meta.message : (base.text || "");
  payload.game = (meta && meta.game != null) ? meta.game : (base.game || "");
  payload.level = (meta && meta.level != null) ? meta.level : (base.level || "");
  for (const key of ["id", "ts", "category", "event", "source", "code", "session_id", "trace_id", "game_id", "duration_ms", "details"]) {
    const value = meta && meta[key] != null ? meta[key] : base[key];
    if (value != null) payload[key] = value;
  }
  broadcastToClients(tenant.logClients, payload);
}

module.exports = { tenants, emptyGameState, getTenant, broadcastToClients, broadcastLog, registerLogPersister };
