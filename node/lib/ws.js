// Camada de estado e broadcast (tenants) — extraída de server.js na Fase B-2.
// `broadcastStatus`/`broadcastStatusAll` (que dependem do daemonSend) permanecem no server.js.
const { DEFAULT_SETTINGS } = require("../db");

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
      cacaState: { active: false, size: 10, board: [], words: [], found_count: 0, total: 0, finished: false },
      vpetState: null,
      tresState: null,
    });
  }
  return tenants.get(id);
}

function broadcastToClients(clients, msg) {
  const data = JSON.stringify(msg);
  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i].send(data);
    } catch {
      clients.splice(i, 1);
    }
  }
}

function broadcastLog(tenant, item) {
  // Aceita string (legado) ou objeto estruturado {text, game, level}.
  broadcastToClients(tenant.logClients, { type: "log", ...(typeof item === "string" ? { text: item } : item || {}) });
}

module.exports = { tenants, emptyGameState, getTenant, broadcastToClients, broadcastLog };