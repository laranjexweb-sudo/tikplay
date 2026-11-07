// Camada de estado e broadcast (tenants) — extraída de server.js na Fase B-2.
// `broadcastStatus`/`broadcastStatusAll` (que dependem do daemonSend) permanecem no server.js.
const { DEFAULT_SETTINGS, getActiveGameRecovery } = require("../db");
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
    const recovery = getActiveGameRecovery(id);
    const gameState = emptyGameState();
    if (recovery && recovery.room_id && recovery.secret_word && recovery.game_id) {
      gameState.active = true;
      gameState.game_id = recovery.game_id;
      gameState.secret_length = recovery.size_revealed || !recovery.size_gift ? String(recovery.secret_word).length : 0;
      gameState.guesses = Array.isArray(recovery.guesses) ? recovery.guesses.slice(-500) : [];
      gameState.hints = Array.isArray(recovery.hints) ? recovery.hints.slice(-100) : [];
      gameState.guess_count = gameState.guesses.length;
      gameState.hint_gifts = Array.isArray(recovery.hint_gifts) ? recovery.hint_gifts : [];
      gameState.riddle_gifts = Array.isArray(recovery.riddle_gifts) ? recovery.riddle_gifts : [];
      gameState.size_gift = recovery.size_gift || "";
      gameState.size_revealed = !!recovery.size_revealed;
      gameState.letter_gift = recovery.letter_gift || "";
      gameState.first_letter_revealed = !!recovery.first_letter_revealed;
      gameState.first_letter = gameState.first_letter_revealed ? String(recovery.secret_word).slice(0, 1) : "";
      gameState.current_riddle_stage = Number(recovery.current_riddle_stage) || 0;
      gameState.current_riddle = recovery.current_riddle || null;
      gameState.active_gift = recovery.active_gift || null;
      gameState.tension_score = Number(recovery.tension_score) || 0;
      gameState.is_final_boss = !!recovery.is_final_boss;
      gameState.tap_meta_current = Number(recovery.tap_meta_current) || 0;
      gameState.tap_meta_total = Number(recovery.tap_meta_total) || 1000;
      gameState.tap_meta_ready = !!recovery.tap_meta_ready;
    }
    tenants.set(id, {
      id,
      gameState,
      browserClients: [],
      logClients: [],
      currentStatus: null,
      currentWord: "",
      sessionStarted: false,
      activeDaemonSessionId: null,
      activeLiveUsername: null,
      activeLiveEngine: null,
      currentRoomId: recovery && recovery.room_id || null,
      gameRecoveryCheckpoint: recovery,
      currentSessionId: null,
      likesByUser: new Map(),
      likeEventIds: new Set(),
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
