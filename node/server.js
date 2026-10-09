require("dotenv").config();
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const multer = require("multer");

const db = require("./db");
const auth = require("./auth");

const HTTP_PORT = process.env.PORT || 3100;
const defaultPythonPath = "C:\\Users\\djlar\\AppData\\Local\\Programs\\Python\\Python312\\python.exe";
const PYTHON_BIN = process.env.PYTHON_BIN || (fs.existsSync(defaultPythonPath) ? defaultPythonPath : "python");
const SERVICE_PATH = path.join(__dirname, "..", "python", "service.py");

const app = express();

// ---------------- URLs amigaveis ----------------

const PUBLIC_DIR = path.join(__dirname, "public");
const FRIENDLY_PAGES = {
  "/painel": "control-panel.html",
  "/admin": "admin.html",
  "/login": "login.html",
  "/register": "login.html",
  "/cadastro": "login.html",
  "/jogo": "web-game.html",
  "/ranking": "obs-ranking.html",
  "/batalha": "batalha.html",
  "/caca-palavra": "caca-palavra.html",
  "/bichinho": "bichinho.html",
  "/bichinho-overlay": "bichinho-overlay.html",
  "/tres-pontinhos": "tres-pontinhos.html",
  "/duelo": "duelo.html",
  "/docs": "docs.html",
};
const LEGACY_PAGES = {
  "/control-panel.html": "/painel",
  "/admin.html": "/admin",
  "/login.html": "/login",
  "/web-game.html": "/jogo",
  "/obs-ranking.html": "/ranking",
};

app.get("/", (req, res) => res.redirect("/login"));
for (const [route, file] of Object.entries(FRIENDLY_PAGES)) {
  app.get(route, (req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
}
for (const [legacy, target] of Object.entries(LEGACY_PAGES)) {
  app.get(legacy, (req, res) => res.redirect(301, target));
}

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
express.static.mime.define({ "image/webp": ["webp"] });
app.use("/gift-images", express.static(path.join(__dirname, "public", "gift-images"), { maxAge: "1d" }));
app.use("/duelo-audio", express.static(path.join(__dirname, "public", "duelo-audio")));
app.use("/alert-audio", express.static(path.join(__dirname, "public", "alert-audio"), { maxAge: "1d" }));
app.use("/vendor", express.static(path.join(__dirname, "vendor")));

const httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Servidor rodando em http://localhost:${HTTP_PORT}`);
  console.log(`[HTTP] Painel de Controle: http://localhost:${HTTP_PORT}/painel`);
  console.log(`[HTTP] Login: http://localhost:${HTTP_PORT}/login`);
  console.log(`[HTTP] Admin: http://localhost:${HTTP_PORT}/admin`);
});

const wss = new WebSocketServer({ server: httpServer });
console.log(`[WS] WebSocket compartilhando a porta ${HTTP_PORT}`);

// ---------------- Tenants ----------------

const GIFT_TAGS_PATH = path.join(__dirname, "gift-tags.json");
const GIFT_IMAGE_MAP_PATH = path.join(__dirname, "public", "gift-image-map.json");

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

// Trava de seguranca: jogos so iniciam com a live ONLINE (status "connected")
function liveOnline(tenant) {
  return !!(tenant && tenant.sessionStarted && tenant.currentStatus && tenant.currentStatus.state === "connected");
}

// Funcionalidades liberáveis por cliente (abas do painel)
const FEATURE_TABS = ["connect", "chat", "alerts", "games", "batalha", "caca", "bichinho", "tres", "duelo"];

// features: {} ou chaves ausentes = tudo liberado; false = bloqueada
function featureAllowed(user, feat) {
  if (!user || user.role === "admin") return true;
  const f = (user.features && typeof user.features === "object") ? user.features : {};
  if (!Object.keys(f).length) return true;
  return f[feat] !== false;
}

function requireFeature(feat) {
  return (req, res, next) => {
    const user = db.getUserById(req.user.id);
    if (!user) return res.status(401).json({ success: false, error: "Usuario nao encontrado" });
    if (!featureAllowed(user, feat)) {
      return res.status(403).json({ success: false, error: "Funcionalidade nao liberada para sua conta" });
    }
    next();
  };
}

function updateGameState(tenant, msg) {
  const gs = tenant.gameState;
  switch (msg.type) {
    case "game_start":
      tenant.gameState = {
        active: true,
        game_id: msg.game_id,
        secret_length: msg.secret_length,
        secret_word: null,
        guesses: [],
        hints: [],
        finished: false,
        winner: null,
        guess_count: 0,
        hint_gifts: msg.hint_gifts || [],
        riddle_gifts: msg.riddle_gifts || [],
        current_riddle_stage: 0,
        active_gift: msg.active_gift || null,
        tension_score: msg.tension_score || 0,
        is_final_boss: !!msg.is_final_boss,
        likes_ranking: (gs && gs.likes_ranking) || [],
        size_gift: msg.size_gift || "",
        size_revealed: !!msg.size_revealed,
        letter_gift: msg.letter_gift || "",
        first_letter: msg.first_letter || "",
        first_letter_revealed: !!msg.first_letter_revealed,
        current_riddle: null,
        display: { riddle_visible: false, ranking_view: (gs && gs.display && gs.display.ranking_view) || "live" },
        tap_meta_current: (gs && gs.tap_meta_current) || 0,
        tap_meta_total: (gs && gs.tap_meta_total) || 1000,
        tap_meta_ready: !!(gs && gs.tap_meta_ready),
        settings: (gs && gs.settings) || { ...DEFAULT_SETTINGS },
      };
      break;
    case "size_revealed":
      gs.size_revealed = true;
      if (msg.secret_length) gs.secret_length = msg.secret_length;
      break;
    case "letter_revealed":
      if (msg.first_letter !== undefined) gs.first_letter = msg.first_letter;
      gs.first_letter_revealed = true;
      if (msg.secret_length) gs.secret_length = msg.secret_length;
      break;
    case "guess":
      if (msg.word) {
        const exists = gs.guesses.some(g => g.word.toLowerCase() === msg.word.toLowerCase());
        if (!exists) {
          gs.guesses.push({
            word: msg.word,
            rank: msg.rank,
            user: msg.user,
            nickname: msg.nickname || msg.user,
            avatar: msg.avatar || "",
            color: msg.color,
            is_hint: !!msg.is_hint,
            gift: msg.gift || null,
          });
          gs.guess_count = gs.guesses.length;
        }
      }
      if (msg.active_gift) {
        gs.active_gift = msg.active_gift;
      }
      if (msg.tension_score !== undefined) {
        gs.tension_score = msg.tension_score;
      }
      if (msg.is_final_boss !== undefined) {
        gs.is_final_boss = msg.is_final_boss;
      }
      break;
    case "gift_hint":
      if (msg.hint_word && !gs.hints.includes(msg.hint_word)) {
        gs.hints.push(msg.hint_word);
      }
      break;
    case "riddle_started":
      broadcastToClients(tenant.browserClients, msg);
      break;
    case "riddle_ready":
      gs.current_riddle_stage = msg.stage || gs.current_riddle_stage;
      gs.current_riddle = {
        stage: msg.stage || gs.current_riddle_stage,
        text: msg.text || "",
        audio_url: msg.audio_url || "",
        user: msg.user || "",
        nickname: msg.nickname || msg.user || "",
      };
      if (gs.display) gs.display.riddle_visible = true;
      broadcastToClients(tenant.browserClients, msg);
      break;
    case "roulette_drop":
      if (msg.active_gift) {
        gs.active_gift = msg.active_gift;
      }
      if (msg.tension_score !== undefined) {
        gs.tension_score = msg.tension_score;
      }
      if (msg.is_final_boss !== undefined) {
        gs.is_final_boss = msg.is_final_boss;
      }
      if (msg.reward_type === "hint" && msg.hint_word) {
        if (!gs.hints.includes(msg.hint_word)) {
          gs.hints.push(msg.hint_word);
        }
        const exists = gs.guesses.some(g => g.word.toLowerCase() === msg.hint_word.toLowerCase());
        if (!exists) {
          gs.guesses.push({
            word: msg.hint_word,
            rank: msg.hint_rank,
            user: msg.user,
            nickname: msg.nickname || msg.user,
            avatar: msg.avatar || "",
            color: msg.color,
            is_hint: true,
            gift: msg.gift || null,
          });
          gs.guess_count = gs.guesses.length;
        }
      } else if (msg.reward_type === "riddle_ready") {
        gs.current_riddle_stage = msg.stage || gs.current_riddle_stage;
        gs.current_riddle = {
          stage: msg.stage || gs.current_riddle_stage,
          text: msg.text || "",
          audio_url: msg.audio_url || "",
          user: msg.user || "",
          nickname: msg.nickname || msg.user || "",
        };
        if (gs.display) gs.display.riddle_visible = true;
      }
      break;
    case "likes_ranking":
      gs.likes_ranking = msg.ranking || [];
      gs.tap_meta_current = msg.tap_meta_current;
      gs.tap_meta_total = msg.tap_meta_total;
      gs.tap_meta_ready = !!msg.tap_meta_ready;
      break;
    case "tap_meta_reached":
      gs.tap_meta_reached = msg;
      gs.tap_meta_ready = !!msg.ready;
      break;
    case "game_over":
      gs.finished = true;
      gs.secret_word = msg.secret_word;
      if (msg.secret_word) gs.secret_length = msg.secret_word.length;
      gs.winner = msg.winner;
      gs.post_game_summary = msg.post_game_summary || null;
      break;
    case "battle_state":
      gs.battle = { active: msg.active, duration: msg.duration, remaining: msg.remaining, leaders: msg.leaders || null };
      break;
    case "battle_tick":
      gs.battle = { ...(gs.battle || {}), active: true, remaining: msg.remaining, duration: msg.duration, leaders: msg.leaders || null };
      break;
    case "battle_action":
      gs.battle = { ...(gs.battle || {}), last_action: msg };
      break;
    case "battle_round_end":
      gs.battle = { ...(gs.battle || {}), active: false, remaining: 0, last_winners: msg };
      break;
    case "battle_ranking":
      gs.battle_ranking = msg;
      break;
    case "caca_state":
      tenant.cacaState = msg;
      break;
    case "vpet_state":
      tenant.vpetState = msg;
      break;
    case "vpet_status":
      if (tenant.vpetState) {
        tenant.vpetState.hunger = msg.hunger !== undefined ? msg.hunger : tenant.vpetState.hunger;
        tenant.vpetState.energy = msg.energy !== undefined ? msg.energy : tenant.vpetState.energy;
        tenant.vpetState.phase = msg.phase || tenant.vpetState.phase;
        tenant.vpetState.level = msg.level !== undefined ? msg.level : tenant.vpetState.level;
      }
      break;
    case "vpet_bag":
      if (!tenant.vpetState) tenant.vpetState = {};
      tenant.vpetState.batalhas_disponiveis = msg.batalhas_disponiveis !== undefined ? msg.batalhas_disponiveis : 0;
      tenant.vpetState.bag_max = msg.max !== undefined ? msg.max : 3;
      break;
    case "vpet_battle_start":
      if (!tenant.vpetState) tenant.vpetState = {};
      tenant.vpetState.battle = {
        state: msg.state || "countdown",
        boss_name: msg.boss_name || "BOSS",
        boss_hp: msg.boss_hp || 0,
        boss_max_hp: msg.boss_max_hp || 1,
        timer: msg.timer || 0,
        next_in: msg.next_in || 900,
        color: msg.color || "",
      };
      break;
    case "vpet_battle_tick":
      if (!tenant.vpetState) tenant.vpetState = {};
      if (!tenant.vpetState.battle || tenant.vpetState.battle.state === "idle") {
        tenant.vpetState.battle = { state: "fight", boss_name: "BOSS", boss_hp: msg.hp || 0, boss_max_hp: msg.max || 1, timer: msg.timer || 0, next_in: 900 };
      } else {
        tenant.vpetState.battle.boss_hp = msg.hp !== undefined ? msg.hp : tenant.vpetState.battle.boss_hp;
        tenant.vpetState.battle.boss_max_hp = msg.max || tenant.vpetState.battle.boss_max_hp;
        tenant.vpetState.battle.timer = msg.timer !== undefined ? msg.timer : tenant.vpetState.battle.timer;
      }
      break;
    case "vpet_battle_fight":
      if (tenant.vpetState && tenant.vpetState.battle) {
        tenant.vpetState.battle.state = "fight";
        tenant.vpetState.battle.timer = msg.timer !== undefined ? msg.timer : tenant.vpetState.battle.timer;
      }
      break;
    case "vpet_battle_end":
      if (tenant.vpetState && msg.state) {
        tenant.vpetState = msg.state;
      } else if (tenant.vpetState) {
        tenant.vpetState.battle = { state: "idle", boss_name: "", boss_hp: 0, boss_max_hp: 0, timer: 0, next_in: 900 };
      }
      break;
    case "tres_state":
      tenant.tresState = msg;
      break;
    case "tres_winner":
    case "tres_timeout":
    case "tres_reveal_size":
    case "tres_reveal_letter":
    case "tres_dica":
    case "tres_tick":
    case "tres_wrong_guess":
      if (tenant.tresState) tenant.tresState = { ...tenant.tresState, ...msg };
      break;
    case "caca_word_found":
      // o estado completo chega junto via caca_state
      break;
  }
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

function broadcastLog(tenant, text) {
  broadcastToClients(tenant.logClients, { type: "log", text });
}

function broadcastStatus(tenant, status) {
  tenant.currentStatus = status;
  broadcastToClients(tenant.logClients, { type: "status", ...status });
  if (status.state === "connected") {
    broadcastToClients(tenant.browserClients, { type: "python_connected" });
  } else if (status.state === "offline" || status.state === "disconnected") {
    // Não limpa currentWord: mantém a palavra da rodada em andamento mesmo com queda
    broadcastToClients(tenant.browserClients, { type: "python_disconnected" });
    // Auto-pause: se o V-Pet está ativo, pausa para não zerar fome/energia offline
    const vs = tenant.vpetState;
    if (vs && vs.active) {
      daemonSend({ cmd: "vpet_stop", tenant_id: tenant.id });
      vs.active = false;
      broadcastToClients(tenant.browserClients, { type: "vpet_state", ...vs });
      broadcastToClients(tenant.logClients, { type: "log", text: "[Bichinho] Live desconectada — mascote pausado automaticamente" });
    }
  }
}

function broadcastStatusAll(status) {
  for (const tenant of tenants.values()) {
    broadcastStatus(tenant, status);
  }
}

// ---------------- Daemon (Python service) ----------------

let daemon = null;
let daemonPid = null;
let daemonBackoff = 1000;
let daemonRespawnTimer = null;

function resetAllTenantSessions() {
  for (const tenant of tenants.values()) {
    tenant.sessionStarted = false;
  }
}

function spawnDaemon() {
  if (daemonRespawnTimer) {
    clearTimeout(daemonRespawnTimer);
    daemonRespawnTimer = null;
  }
  if (daemonPid) {
    try {
      process.kill(daemonPid);
    } catch (e) {}
    daemonPid = null;
  }
  const env = {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
  };
  daemon = spawn(PYTHON_BIN, ["-u", SERVICE_PATH], { env });
  daemonPid = daemon.pid;

  let daemonBuffer = "";
  daemon.stdout.on("data", (data) => {
    daemonBackoff = 1000;
    daemonBuffer += data.toString("utf-8");
    const lines = daemonBuffer.split("\n");
    daemonBuffer = lines.pop() || "";
    for (let line of lines) {
      line = line.replace(/\r$/, "");
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      handleDaemonMessage(msg);
    }
  });

  daemon.stderr.on("data", (data) => {
    const lines = data.toString("utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const tenantId = msgTenant(line);
      if (tenantId && tenants.has(tenantId)) {
        broadcastLog(getTenant(tenantId), `[stderr] ${line}`);
      } else {
        console.error("[Daemon]", line);
      }
    }
  });

  daemon.on("error", (err) => {
    console.error("[Daemon] Erro ao iniciar:", err.message);
    daemon = null;
    daemonPid = null;
    resetAllTenantSessions();
    broadcastStatusAll({ state: "offline" });
    scheduleDaemonRespawn();
  });

  daemon.on("close", (code) => {
    console.log(`[Daemon] Encerrado (codigo: ${code})`);
    daemon = null;
    daemonPid = null;
    resetAllTenantSessions();
    broadcastStatusAll({ state: "offline" });
    scheduleDaemonRespawn();
  });
}

function scheduleDaemonRespawn() {
  if (daemon || daemonRespawnTimer) return;
  daemonRespawnTimer = setTimeout(() => {
    daemonRespawnTimer = null;
    spawnDaemon();
  }, daemonBackoff);
  daemonBackoff = Math.min(daemonBackoff * 2, 15000);
}

function handleDaemonMessage(msg) {
  const tenantId = msg.tenant_id;
  if (tenantId !== null && tenantId !== undefined) {
    const tenant = getTenant(tenantId);
    if (msg.type === "status") {
      broadcastStatus(tenant, msg.status || {});
    } else if (msg.type === "game") {
      updateGameState(tenant, msg.msg || {});
      broadcastToClients(tenant.browserClients, msg.msg || {});
      broadcastToClients(tenant.logClients, msg.msg || {});
    } else if (msg.type === "log") {
      broadcastLog(tenant, msg.text || "");
    } else if (msg.type === "panel_word") {
      tenant.currentWord = msg.text || "";
      broadcastToClients(tenant.logClients, { type: "word", word: tenant.currentWord });
    } else if (msg.type === "tts_test_ready") {
      broadcastToClients(tenant.logClients, { type: "tts_test_ready", url: msg.text || "" });
    } else if (msg.type === "narrate") {
      const payload = msg.text || {};
      broadcastToClients(tenant.logClients, {
        type: "chat_narrate",
        text: typeof payload === "object" ? payload.text || "" : payload,
        url: (typeof payload === "object" && payload.url) || "",
      });
    }
    return;
  }
  if (msg.type === "log") {
    console.log("[Daemon]", msg.text);
  }
}

function msgTenant(line) {
  try {
    const parsed = JSON.parse(line);
    return parsed.tenant_id;
  } catch {
    return null;
  }
}

function daemonSend(obj) {
  if (!daemon) {
    spawnDaemon();
  }
  if (!daemon || !daemon.stdin || !daemon.stdin.writable) {
    return false;
  }
  daemon.stdin.write(JSON.stringify(obj) + "\n");
  return true;
}

spawnDaemon();

// Ensure the child process is killed when Node exits
function killDaemon() {
  if (daemon) {
    try {
      daemon.kill();
    } catch (e) {}
    daemon = null;
    daemonPid = null;
  }
}
process.on("exit", killDaemon);
process.on("SIGINT", () => {
  killDaemon();
  process.exit();
});
process.on("SIGTERM", () => {
  killDaemon();
  process.exit();
});

// ---------------- Config helpers ----------------

function readGiftTags() {
  try {
    return JSON.parse(fs.readFileSync(GIFT_TAGS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function readTenantGiftConfig(tenantId) {
  return db.getTenantGiftConfig(tenantId);
}

const DEFAULT_SETTINGS = db.DEFAULT_SETTINGS;

function readTenantSettings(tenantId) {
  return db.getTenantSettings(tenantId);
}

function normalizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === "object") {
    if (typeof raw.apenas_seguidores === "boolean") out.apenas_seguidores = raw.apenas_seguidores;
    if (typeof raw.apenas_heart_me === "boolean") out.apenas_heart_me = raw.apenas_heart_me;
    let dica = typeof raw.pct_dica === "number" ? raw.pct_dica : parseInt(raw.pct_dica, 10);
    if (!Number.isFinite(dica)) dica = DEFAULT_SETTINGS.pct_dica;
    dica = Math.max(0, Math.min(100, dica));
    out.pct_dica = dica;
    out.pct_charada = 100 - dica;

    let rate = typeof raw.tts_rate === "number" ? raw.tts_rate : parseFloat(raw.tts_rate);
    if (!Number.isFinite(rate)) rate = DEFAULT_SETTINGS.tts_rate;
    out.tts_rate = Math.max(0.1, Math.min(10, rate));
    out.tts_voice = typeof raw.tts_voice === "string" ? raw.tts_voice.trim() : "";
    if (typeof raw.chat_narr_enabled === "boolean") out.chat_narr_enabled = raw.chat_narr_enabled;
    if (raw.chat_narr_mode === "no_guesses") out.chat_narr_mode = "exclude";
    else if (["all", "exclude", "only"].includes(raw.chat_narr_mode)) out.chat_narr_mode = raw.chat_narr_mode;
    if (typeof raw.chat_narr_char === "string") {
      out.chat_narr_char = raw.chat_narr_char.slice(0, 1) || "#";
    }
    if (["#", "!", ""].includes(raw.command_prefix)) out.command_prefix = raw.command_prefix;
    if (typeof raw.auto_round === "boolean") out.auto_round = raw.auto_round;
    let pause = parseInt(raw.auto_round_pause, 10);
    if (Number.isFinite(pause)) out.auto_round_pause = Math.max(5, Math.min(300, pause));
    if (typeof raw.riddle_auto_narrate === "boolean") out.riddle_auto_narrate = raw.riddle_auto_narrate;
    let tapMeta = parseInt(raw.tap_meta, 10);
    if (Number.isFinite(tapMeta)) out.tap_meta = Math.max(50, Math.min(100000, tapMeta));
  }
  return out;
}

// ---------------- Auth ----------------

const loginAttempts = new Map();

function loginRateLimit(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (rec.count >= 10) return false;
  rec.count++;
  return true;
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

const REGISTER_MODE = (process.env.REGISTER_MODE || "public").toLowerCase();
const REGISTER_INVITE_MSG = "O cadastro na TikPlay está disponível apenas por convite durante o período de testes.";
const REGISTER_CLOSED_MSG = "Cadastro indisponível no momento.";
function registerModeMessage() {
  if (REGISTER_MODE === "closed") return REGISTER_CLOSED_MSG;
  if (REGISTER_MODE === "invite") return REGISTER_INVITE_MSG;
  return "";
}

app.get("/api/auth/register-mode", (req, res) => {
  res.json({ success: true, mode: REGISTER_MODE, message: registerModeMessage() });
});

app.get("/api/auth/invite/:token", (req, res) => {
  if (REGISTER_MODE === "closed") return res.json({ valid: false, closed: true, status: "closed", message: REGISTER_CLOSED_MSG });
  const inv = db.getInviteByToken(String(req.params.token || ""));
  if (!inv) return res.json({ valid: false, status: null, message: REGISTER_INVITE_MSG });
  const st = db.validateInvite(inv);
  res.json({
    valid: st.ok,
    status: st.ok ? "active" : inv.status,
    expires_at: inv.expires_at || null,
    message: st.ok ? "" : (st.error || REGISTER_INVITE_MSG),
  });
});

app.post("/api/auth/register", (req, res) => {
  const { name = "", email, password, inviteToken } = req.body;
  if (REGISTER_MODE === "closed") {
    return res.status(403).json({ success: false, error: REGISTER_CLOSED_MSG });
  }
  if (REGISTER_MODE === "invite") {
    if (!inviteToken) {
      return res.status(403).json({ success: false, error: REGISTER_INVITE_MSG });
    }
    const st = db.validateInvite(db.getInviteByToken(String(inviteToken)));
    if (!st.ok) {
      return res.status(403).json({ success: false, error: st.error });
    }
  }
  if (!validEmail(email)) {
    return res.json({ success: false, error: "Email invalido" });
  }
  if (!password || String(password).length < 8) {
    return res.json({ success: false, error: "Senha deve ter no minimo 8 caracteres" });
  }
  if (db.getUserByEmail(email)) {
    return res.json({ success: false, error: "Email ja cadastrado" });
  }
  const role = db.countUsers() === 0 ? "admin" : "user";
  let id;
  try {
    if (REGISTER_MODE === "invite") {
      id = db.registerWithInvite({
        email: String(email).toLowerCase().trim(),
        name: String(name).trim(),
        password_hash: auth.hashPassword(password),
        token: String(inviteToken),
        role,
      });
    } else {
      id = db.createUser({
        email: String(email).toLowerCase().trim(),
        name: String(name).trim(),
        password_hash: auth.hashPassword(password),
        role,
        features: { bichinho: false },
      });
    }
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
  const user = db.getUserById(id);
  const token = auth.signToken(user);
  res.json({ success: true, role: user.role, token, user: db.publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "";
  if (!loginRateLimit(ip)) {
    return res.status(429).json({ success: false, error: "Muitas tentativas. Aguarde 1 minuto." });
  }
  const { email, password } = req.body;
  const user = db.getUserByEmail(email);
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    return res.json({ success: false, error: "Email ou senha incorretos" });
  }
  if (user.status !== "active") {
    return res.json({ success: false, error: "Conta desativada" });
  }
  const token = auth.signToken(user);
  res.json({ success: true, token, user: db.publicUser(user) });
});

app.get("/api/auth/me", auth.requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(401).json({ success: false, error: "Usuario nao encontrado" });
  const pub = db.publicUser(user);
  pub.tiktools_api_key_masked = pub.tiktools_api_key;
  pub.tiktools_api_key = user.tiktools_api_key ? true : false;
  pub.has_api_key = !!user.tiktools_api_key;
  res.json({ success: true, user: pub });
});

app.post("/api/auth/change-password", auth.requireAuth, (req, res) => {
  const { old_password, new_password } = req.body;
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(401).json({ success: false, error: "Usuario nao encontrado" });
  if (!auth.verifyPassword(old_password, user.password_hash)) {
    return res.json({ success: false, error: "Senha atual incorreta" });
  }
  if (!new_password || String(new_password).length < 8) {
    return res.json({ success: false, error: "Senha deve ter no minimo 8 caracteres" });
  }
  db.updateUser(user.id, { password_hash: auth.hashPassword(new_password) });
  res.json({ success: true });
});

// ---------------- Admin ----------------

app.get("/api/admin/users", auth.requireAdmin, (req, res) => {
  res.json({ success: true, users: db.listUsers().map(db.publicUser) });
});

app.post("/api/admin/users/:id/status", auth.requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!["active", "disabled"].includes(status)) {
    return res.json({ success: false, error: "Status invalido" });
  }
  db.updateUser(Number(req.params.id), { status });
  res.json({ success: true });
});

app.post("/api/admin/users/:id/reset-password", auth.requireAdmin, (req, res) => {
  const { new_password } = req.body;
  if (!new_password || String(new_password).length < 8) {
    return res.json({ success: false, error: "Senha deve ter no minimo 8 caracteres" });
  }
  db.updateUser(Number(req.params.id), { password_hash: auth.hashPassword(new_password) });
  res.json({ success: true });
});

app.post("/api/admin/users", auth.requireAdmin, (req, res) => {
  const { email, name, password, plan = "free", role = "user", tiktok_username = "", tiktools_api_key = "", features } = req.body;
  if (!validEmail(email)) return res.json({ success: false, error: "Email invalido" });
  if (!password || String(password).length < 8) {
    return res.json({ success: false, error: "Senha deve ter no minimo 8 caracteres" });
  }
  if (db.getUserByEmail(email)) return res.json({ success: false, error: "Email ja cadastrado" });
  if (!["user", "admin"].includes(role)) return res.json({ success: false, error: "Role invalido" });
  const id = db.createUser({
    email: String(email).toLowerCase().trim(),
    name: String(name || "").trim(),
    password_hash: auth.hashPassword(password),
    role,
    plan,
    tiktok_username: String(tiktok_username || "").trim(),
    tiktools_api_key: String(tiktools_api_key || "").trim(),
    features: (features && typeof features === "object") ? features : {},
  });
  res.json({ success: true, user: db.publicUser(db.getUserById(id)) });
});

app.put("/api/admin/users/:id", auth.requireAdmin, (req, res) => {
  const { name, plan, role, status, tiktok_username, tiktools_api_key, features } = req.body;
  const fields = {};
  if (typeof name === "string") fields.name = name.trim();
  if (typeof plan === "string") fields.plan = plan.trim();
  if (features && typeof features === "object") fields.features = features;
  if (["user", "admin"].includes(role)) fields.role = role;
  if (["active", "disabled"].includes(status)) fields.status = status;
  if (typeof tiktok_username === "string") fields.tiktok_username = tiktok_username.trim();
  if (typeof tiktools_api_key === "string") fields.tiktools_api_key = tiktools_api_key.trim();
  if (Object.keys(fields).length === 0) return res.json({ success: false, error: "Nada para atualizar" });
  db.updateUser(Number(req.params.id), fields);
  res.json({ success: true, user: db.publicUser(db.getUserById(Number(req.params.id))) });
});

// ---------------- Gerar Contextos (super admin) ----------------

const CONTEXTOS_SCRIPT = path.join(__dirname, "..", "python", "generate_contextos.py");

let contextosJob = null;

function spawnContextosJob(interval_min, limit, words) {
  if (contextosJob && contextosJob.running) {
    return { started: false, reason: "ja rodando" };
  }
  const env = {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
    LLM_BASE_URL: process.env.LLM_BASE_URL || "http://127.0.0.1:1234/v1",
    LLM_MODEL: process.env.LLM_MODEL || "qwen2.5-coder-7b-instruct",
    INTERVAL_S: String(Math.max(0, Math.round((interval_min || 15) * 60))),
    LIMIT: String(Math.max(0, limit || 0)),
    WORDS_PER_CONTEXT: String(Math.max(100, words || 1000)),
    CORRIGE_TOP: String(Math.max(10, parseInt(process.env.CORRIGE_TOP, 10) || 200)),
  };
  const proc = spawn(PYTHON_BIN, ["-u", CONTEXTOS_SCRIPT], { env });
  contextosJob = {
    proc,
    running: true,
    finished: false,
    done: 0,
    total: 0,
    current: "",
    errors: 0,
    last_error: null,
    started_at: new Date().toISOString(),
    logs: [],
  };
  proc.stdout.on("data", (data) => {
    const lines = data.toString("utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (!contextosJob) continue;
        if (typeof msg.done === "number") contextosJob.done = msg.done;
        if (typeof msg.total === "number") contextosJob.total = msg.total;
        if (typeof msg.current === "string") contextosJob.current = msg.current;
        if (typeof msg.errors === "number") contextosJob.errors = msg.errors;
        if (msg.last_error !== undefined) contextosJob.last_error = msg.last_error;
        if (msg.running === false) contextosJob.running = false;
        if (msg.finished === true) contextosJob.finished = true;
        if (typeof msg.log === "string" && msg.log) {
          contextosJob.logs.push({ t: new Date().toISOString(), text: msg.log });
          if (contextosJob.logs.length > 300) contextosJob.logs = contextosJob.logs.slice(-300);
        }
      } catch {}
    }
  });
  proc.stderr.on("data", () => {});
  proc.on("close", (code) => {
    if (contextosJob) {
      contextosJob.running = false;
      contextosJob.finished = true;
    }
  });
  proc.on("error", (err) => {
    if (contextosJob) {
      contextosJob.running = false;
      contextosJob.last_error = err.message;
    }
  });
  return { started: true };
}

function killContextosJob() {
  if (contextosJob && contextosJob.proc) {
    try {
      contextosJob.proc.kill();
    } catch (e) {}
  }
}

app.post("/api/admin/generate-contexts", auth.requireAdmin, (req, res) => {
  const interval_min = req.body && typeof req.body.interval_min === "number" ? req.body.interval_min : 15;
  const limit = req.body && typeof req.body.limit === "number" ? req.body.limit : 0;
  const words = req.body && typeof req.body.words === "number" ? req.body.words : 1000;
  const r = spawnContextosJob(interval_min, limit, words);
  res.json({ success: true, started: r.started, reason: r.reason || "" });
});

app.get("/api/admin/generate-contexts/status", auth.requireAdmin, (req, res) => {
  res.json({
    success: true,
    running: !!(contextosJob && contextosJob.running),
    finished: !!(contextosJob && contextosJob.finished),
    done: contextosJob ? contextosJob.done : 0,
    total: contextosJob ? contextosJob.total : 0,
    current: contextosJob ? contextosJob.current : "",
    errors: contextosJob ? contextosJob.errors : 0,
    last_error: contextosJob ? contextosJob.last_error : null,
    started_at: contextosJob ? contextosJob.started_at : null,
    logs: contextosJob ? contextosJob.logs : [],
  });
});

app.post("/api/admin/generate-contexts/stop", auth.requireAdmin, (req, res) => {
  killContextosJob();
  res.json({ success: true });
});

// ---------------- Palavras banidas (global, admin super) ----------------

app.get("/api/admin/banned-words", auth.requireAdmin, (req, res) => {
  res.json({ success: true, words: db.getBannedWords() });
});

app.post("/api/admin/banned-words", auth.requireAdmin, (req, res) => {
  const words = (req.body && req.body.words) || [];
  const clean = db.saveBannedWords(words);
  res.json({ success: true, words: clean, count: clean.length });
});

// ---------------- Convites de cadastro (Admin) ----------------

app.post("/api/admin/invites", auth.requireAdmin, (req, res) => {
  const raw = parseInt((req.body && req.body.expires_in_days) ?? 7, 10);
  const expires_in_days = Number.isFinite(raw) ? Math.max(0, Math.min(365, raw)) : 7;
  const inv = db.createInvite({ created_by: req.user.id, expires_in_days });
  const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  res.json({ success: true, ...inv, link: `${base}/register?invite=${inv.token}` });
});

app.get("/api/admin/invites", auth.requireAdmin, (req, res) => {
  res.json({ success: true, invites: db.listInvites(200) });
});

app.post("/api/admin/invites/:id/revoke", auth.requireAdmin, (req, res) => {
  const ok = db.revokeInvite(Number(req.params.id));
  res.json({ success: ok, ...(ok ? {} : { error: "Convite nao encontrado ou ja utilizado/revogado" }) });
});

// ---------------- Panel config ----------------

app.get("/api/panel-config", auth.requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  res.json({
    success: true,
    username: user.tiktok_username,
    room_code: user.room_code,
    has_api_key: !!user.tiktools_api_key,
    tiktools_api_key: db.publicUser(user).tiktools_api_key,
    tiktok_engine: user.tiktok_engine || "tiktoklive",
    current_word: getTenant(req.user.id).currentWord,
  });
});

app.post("/api/panel-config", auth.requireAuth, (req, res) => {
  const { username, api_key, clear_api_key, clear_username, tiktok_engine } = req.body;
  const fields = {};
  if (typeof username === "string" && username.trim() !== "") {
    fields.tiktok_username = username.trim();
  } else if (clear_username) {
    fields.tiktok_username = "";
  }
  if (typeof api_key === "string" && api_key.trim() !== "") {
    fields.tiktools_api_key = api_key.trim();
  } else if (clear_api_key) {
    fields.tiktools_api_key = "";
  }
  if (tiktok_engine === "tiktoks" || tiktok_engine === "tiktoklive" || tiktok_engine === "tiktools") {
    fields.tiktok_engine = tiktok_engine === "tiktoks" ? "tiktools" : tiktok_engine;
  }
  db.updateUser(req.user.id, fields);
  res.json({ success: true });
});

// ---------------- Shared/public configs ----------------

app.get("/api/gift-tags", (req, res) => {
  res.json({ success: true, gifts: readGiftTags() });
});

app.get("/api/gift-image-map", (req, res) => {
  try {
    const map = JSON.parse(fs.readFileSync(GIFT_IMAGE_MAP_PATH, "utf-8"));
    res.json({ success: true, map });
  } catch {
    res.json({ success: false, map: {} });
  }
});

// ---------------- Tenant gift config ----------------

function normalizeHintGifts(rawList, maxCount = 5) {
  if (!Array.isArray(rawList)) {
    return { ok: false, error: "hint_gifts deve ser uma lista" };
  }
  if (rawList.length > maxCount) {
    return { ok: false, error: `Maximo de ${maxCount} gifts` };
  }
  const catalog = readGiftTags();
  const byLower = new Map();
  for (const g of catalog) {
    if (g && g.name) byLower.set(String(g.name).toLowerCase(), g.name);
  }
  const seen = new Set();
  const normalized = [];
  for (const item of rawList) {
    const name = String(item || "").trim();
    if (!name) return { ok: false, error: "Nome de gift vazio" };
    const canonical = byLower.get(name.toLowerCase());
    if (!canonical) return { ok: false, error: `Gift invalido: ${name}` };
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(canonical);
  }
  return { ok: true, gifts: normalized };
}

app.get("/api/gift-config", auth.requireAuth, (req, res) => {
  const config = readTenantGiftConfig(req.user.id);
  res.json({ success: true, ...config });
});

app.post("/api/gift-config", auth.requireAuth, (req, res) => {
  const { hint_gifts, riddle_gifts, size_gift, letter_gift } = req.body;
  if (hint_gifts === undefined && riddle_gifts === undefined && size_gift === undefined && letter_gift === undefined) {
    return res.json({ success: false, error: "hint_gifts, riddle_gifts, size_gift ou letter_gift obrigatorio" });
  }

  const config = readTenantGiftConfig(req.user.id);

  if (hint_gifts !== undefined) {
    const checked = normalizeHintGifts(hint_gifts);
    if (!checked.ok) return res.json({ success: false, error: checked.error });
    config.hint_gifts = checked.gifts;
  }

  if (riddle_gifts !== undefined) {
    const checkedRiddles = normalizeHintGifts(riddle_gifts, 1);
    if (!checkedRiddles.ok) return res.json({ success: false, error: "Máximo de 1 presente revelador" });
    config.riddle_gifts = checkedRiddles.gifts.slice(0, 1);
  }

  if (size_gift !== undefined) {
    config.size_gift = String(size_gift || "").trim();
  }

  if (letter_gift !== undefined) {
    config.letter_gift = String(letter_gift || "").trim();
  }

  try {
    db.saveTenantGiftConfig(req.user.id, config.hint_gifts || [], config.riddle_gifts || [], config.size_gift, config.letter_gift);
    const newGifts = config.hint_gifts || [];
    const newRiddleGifts = config.riddle_gifts || [];
    const newSizeGift = config.size_gift || "";
    const newLetterGift = config.letter_gift || "";
    const tenant = getTenant(req.user.id);
    tenant.gameState.hint_gifts = newGifts;
    tenant.gameState.riddle_gifts = newRiddleGifts;
    daemonSend({ cmd: "update_gift_config", tenant_id: req.user.id, hint_gifts: newGifts, riddle_gifts: newRiddleGifts, size_gift: newSizeGift, letter_gift: newLetterGift });
    broadcastToClients(tenant.browserClients, { type: "gift_config_updated", hint_gifts: newGifts, riddle_gifts: newRiddleGifts, size_gift: newSizeGift, letter_gift: newLetterGift });
    res.json({ success: true, hint_gifts: newGifts, riddle_gifts: newRiddleGifts, size_gift: newSizeGift, letter_gift: newLetterGift });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ---------------- Alertas Sonoros (som custom por gift) ----------------

function slugifyGift(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "gift";
}

const soundUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, "public", "alert-audio", String(req.user.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = slugifyGift(req.body && req.body.gift);
      const ext = (path.extname(file.originalname) || ".mp3").toLowerCase();
      cb(null, `${safe}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname || "";
    const ok = /\.(mp3|wav|ogg|m4a|aac|flac|webm|mp4|opus)$/i.test(name);
    cb(null, ok);
  },
});

app.post("/api/sound-alerts", auth.requireAuth, soundUpload.single("file"), (req, res) => {
  const gift = String(req.body.gift || "").trim();
  const slot = req.body.type === "combo" ? "combo" : "normal";
  if (!gift) return res.json({ success: false, error: "Gift obrigatorio" });
  if (!req.file) return res.json({ success: false, error: "Arquivo de audio obrigatorio" });
  try {
    const url = `/alert-audio/${req.user.id}/${req.file.filename}`;
    db.saveSoundAlert(req.user.id, gift, slot, url);
    broadcastToClients(getTenant(req.user.id).browserClients, { type: "sound_alerts_updated" });
    res.json({ success: true, gift, slot, url });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.get("/api/sound-alerts", auth.requireAuth, (req, res) => {
  res.json({ success: true, alerts: db.getSoundAlerts(req.user.id) });
});

app.delete("/api/sound-alerts", auth.requireAuth, (req, res) => {
  const gift = String(req.query.gift || "").trim();
  if (!gift) return res.json({ success: false, error: "Gift obrigatorio" });
  const slot = req.query.slot === "combo" ? "combo" : (req.query.slot === "normal" ? "normal" : null);
  const alerts = db.getSoundAlerts(req.user.id);
  const entry = alerts[gift];
  if (entry) {
    const targets = slot ? [entry[slot]] : [entry.normal, entry.combo];
    for (const t of targets) {
      if (t) {
        try {
          const rel = t.replace("/alert-audio/", "");
          const file = path.join(__dirname, "public", "alert-audio", rel);
          if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch {}
      }
    }
  }
  if (slot) {
    db.saveSoundAlert(req.user.id, gift, slot, "");
  } else {
    db.saveSoundAlert(req.user.id, gift, "normal", "");
    db.saveSoundAlert(req.user.id, gift, "combo", "");
  }
  broadcastToClients(getTenant(req.user.id).browserClients, { type: "sound_alerts_updated" });
  res.json({ success: true });
});

// ---------------- Planos e Assinaturas (Mercado Pago) ----------------

const MP_API = "https://api.mercadopago.com";
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "";
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";

const PLANS = {
  free: { code: "free", name: "Free", price_cents: 0, period: "none", description: "Conta gratuita com recursos basicos" },
  pro_mensal: { code: "pro_mensal", name: "Pro Mensal", price_cents: 2990, period: "monthly", description: "Pro por R$ 29,90/mes" },
  pro_anual: { code: "pro_anual", name: "Pro Anual", price_cents: 29990, period: "yearly", description: "Pro por R$ 299,90/ano (desconto)" },
};

async function mpFetch(path, opts = {}) {
  const res = await fetch(MP_API + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text }; }
}

app.get("/api/plans", (req, res) => {
  res.json({ success: true, plans: Object.values(PLANS).map(({ price_cents, ...p }) => ({ ...p, price: (price_cents / 100).toFixed(2) })) });
});

app.get("/api/billing", auth.requireAuth, (req, res) => {
  const u = db.getUserById(req.user.id);
  res.json({
    success: true,
    plan: u.plan,
    subscription_status: u.subscription_status,
    plan_expires_at: u.plan_expires_at || null,
    plans: Object.values(PLANS).map(({ price_cents, ...p }) => ({ ...p, price: (price_cents / 100).toFixed(2) })),
  });
});

app.post("/api/billing/checkout", auth.requireAuth, async (req, res) => {
  const plan = PLANS[req.body && req.body.plan];
  if (!plan || plan.code === "free") return res.json({ success: false, error: "Plano invalido" });
  if (!MP_ACCESS_TOKEN) return res.json({ success: false, error: "Pagamento nao configurado (MP_ACCESS_TOKEN)" });
  const u = db.getUserById(req.user.id);
  const frequency = plan.period === "yearly" ? 12 : 1;
  const payload = {
    reason: `Assinatura Contexto - ${plan.name}`,
    external_reference: String(u.id),
    payer_email: u.email,
    auto_recurring: {
      frequency,
      frequency_type: "months",
      transaction_amount: plan.price_cents / 100,
      currency_id: "BRL",
    },
    back_url: `${req.protocol}://${req.get("host")}/painel`,
    notification_url: `${req.protocol}://${req.get("host")}/api/webhooks/mercadopago`,
    status: "pending",
  };
  try {
    const r = await mpFetch("/preapproval", { method: "POST", body: JSON.stringify(payload) });
    if (![200, 201].includes(r.status)) {
      return res.json({ success: false, error: `Mercado Pago: ${r.data && (r.data.message || r.data.error) || r.status}` });
    }
    db.updateUser(u.id, { subscription_id: r.data.id, subscription_status: "pending", plan });
    res.json({ success: true, checkout_url: r.data.init_point, preapproval_id: r.data.id });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post("/api/webhooks/mercadopago", async (req, res) => {
  const body = req.body || {};
  const dataId = body.data && body.data.id;

  // Validação opcional de assinatura (se MP_WEBHOOK_SECRET estiver configurado)
  if (MP_WEBHOOK_SECRET) {
    try {
      const sigHeader = req.headers["x-signature"] || "";
      const reqId = req.headers["x-request-id"] || "";
      const ts = (sigHeader.match(/ts=(\d+)/) || [])[1] || "";
      const v1 = (sigHeader.match(/v1=([a-f0-9]+)/) || [])[1] || "";
      const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
      const expected = crypto.createHmac("sha256", MP_WEBHOOK_SECRET).update(manifest).digest("hex");
      const ok = v1 && expected && v1.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(v1, "utf8"), Buffer.from(expected, "utf8"));
      if (!ok) {
        console.log(`[Billing] Webhook MP com assinatura invalida (id=${dataId})`);
        return res.status(401).json({ success: false, error: "Assinatura invalida" });
      }
    } catch (e) {
      return res.status(401).json({ success: false, error: "Assinatura invalida" });
    }
  }

  res.status(200).json({ success: true });
  const topic = body.type || (body.action || "");
  if (!String(topic).toLowerCase().includes("preapproval") || !dataId) return;
  try {
    const r = await mpFetch(`/preapproval/${dataId}`);
    if (r.status !== 200) return;
    const p = r.data;
    const userId = parseInt(p.external_reference, 10);
    if (!userId) return;
    const u = db.getUserById(userId);
    if (!u) return;
    const status = p.status;
    let expiresAt = null;
    if (p.next_payment_date) expiresAt = p.next_payment_date;
    if (status === "authorized") {
      db.updateUser(userId, { subscription_status: "active", status: "active", subscription_id: dataId, plan_expires_at: expiresAt || u.plan_expires_at });
    } else {
      db.updateUser(userId, { subscription_status: status, subscription_id: dataId });
      if (["cancelled", "expired"].includes(status)) {
        db.updateUser(userId, { status: "disabled" });
      }
    }
  } catch (e) {}
});

setInterval(() => {
  try {
    const now = new Date().toISOString();
    const rows = db.db.prepare(
      "SELECT id, plan_expires_at, plan FROM users WHERE subscription_status = 'active' AND plan != 'free' AND plan_expires_at IS NOT NULL AND plan_expires_at != '' AND plan_expires_at < ?"
    ).all(now);
    for (const r of rows) {
      db.updateUser(r.id, { subscription_status: "expired", status: "disabled" });
      console.log(`[Billing] Conta ${r.id} expirada (plano ${r.plan})`);
    }
  } catch (e) {}
}, 30 * 60 * 1000);

// ---------------- Tenant settings (Preferências de Jogo) ----------------

app.get("/api/settings", auth.requireAuth, (req, res) => {
  res.json({ success: true, settings: readTenantSettings(req.user.id) });
});

app.post("/api/settings", auth.requireAuth, (req, res) => {
  const settings = normalizeSettings(req.body && req.body.settings);
  try {
    db.saveTenantSettings(req.user.id, settings);
    const tenant = getTenant(req.user.id);
    tenant.gameState.settings = settings;
    daemonSend({ cmd: "update_settings", tenant_id: req.user.id, settings });
    res.json({ success: true, settings });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ---------------- TTS (voz do servidor) ----------------

const TTS_VOICES = [
  { key: "gtts", label: "Google (gTTS) — servidor" },
  { key: "piper_faber", label: "Piper — Faber (servidor)" },
  { key: "edge_antonio", label: "Edge — Antonio (servidor)" },
  { key: "edge_francisca", label: "Edge — Francisca (servidor)" },
  { key: "kokoro_pf_dora", label: "Kokoro — Dora (Feminina) — servidor" },
  { key: "kokoro_pm_alex", label: "Kokoro — Alex (Masculina) — servidor" },
];

app.get("/api/tts/voices", auth.requireAuth, (req, res) => {
  res.json({ success: true, voices: TTS_VOICES });
});

app.post("/api/tts/test", auth.requireAuth, (req, res) => {
  const rate = req.body && typeof req.body.rate === "number" ? req.body.rate : 1.0;
  const voice = req.body && typeof req.body.voice === "string" ? req.body.voice : "gtts";
  const ok = daemonSend({ cmd: "tts_test", tenant_id: req.user.id, rate, voice });
  if (!ok) {
    return res.json({ success: false, error: "Servico Python indisponivel" });
  }
  res.json({ success: true });
});

// ---------------- Game state / history ----------------

function loadTenantGameState(tenantId) {
  const user = db.getUserById(tenantId);
  if (!user) return null;
  const tenant = getTenant(tenantId);
  const liveGifts = tenant.gameState.hint_gifts || [];
  const savedGifts = (readTenantGiftConfig(tenantId).hint_gifts || []);
  const liveRiddles = tenant.gameState.riddle_gifts || [];
  const savedRiddles = (readTenantGiftConfig(tenantId).riddle_gifts || []);
  return {
    ...tenant.gameState,
    hint_gifts: savedGifts.length ? savedGifts : liveGifts,
    riddle_gifts: savedRiddles.length ? savedRiddles : liveRiddles,
    settings: readTenantSettings(tenantId),
    current_word: tenant.currentWord,
    python_connected: !!tenant.currentStatus && tenant.currentStatus.state === "connected",
    last_status: tenant.currentStatus,
  };
}

app.get("/api/game-state", auth.requireAuth, (req, res) => {
  res.json({ success: true, ...loadTenantGameState(req.user.id) });
});

// ---------------- Batalha (jogo BATALHA) ----------------

function battleTenantId(req) {
  const token = auth.extractToken(req);
  if (token) {
    try { return auth.verifyToken(token).id; } catch {}
  }
  return null;
}

app.get("/api/battle/state", auth.requireAuth, (req, res) => {
  const tid = req.user.id;
  const tenant = tenants.get(tid);
  const battle = (tenant && tenant.gameState && tenant.gameState.battle) || { active: false, duration: 180, remaining: 0, leaders: null };
  const ranking = db.getBattlePlayers(tid, 8);
  res.json({ success: true, battle, ranking });
});

app.get("/api/battle/ranking", auth.requireAuth, (req, res) => {
  const tid = req.user.id;
  res.json({ success: true, ranking: db.getBattlePlayers(tid, 8) });
});

app.post("/api/battle/start", auth.requireAuth, requireFeature("batalha"), (req, res) => {
  if (!liveOnline(tenants.get(req.user.id))) {
    return res.json({ success: false, error: "Live offline — conecte a live antes de iniciar a BATALHA" });
  }
  const duration = Math.max(10, Math.min(600, parseInt((req.body && req.body.duration), 10) || 180));
  const ok = daemonSend({ cmd: "battle_start", tenant_id: req.user.id, duration });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true, duration });
});

app.post("/api/battle/stop", auth.requireAuth, (req, res) => {
  const ok = daemonSend({ cmd: "battle_stop", tenant_id: req.user.id });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/battle/reset", auth.requireAuth, (req, res) => {
  db.resetBattle(req.user.id);
  const tenant = tenants.get(req.user.id);
  if (tenant) broadcastToClients(tenant.browserClients, { type: "battle_reset" });
  res.json({ success: true });
});

app.get("/api/battle/weekly", auth.requireAuth, (req, res) => {
  res.json({ success: true, weekly: db.getBattleWeeklyWinners(req.user.id, 5) });
});

app.get("/api/battle/history", auth.requireAuth, (req, res) => {
  res.json({
    success: true,
    ...db.getBattleHistory(req.user.id, {
      page: req.query.page,
      pageSize: req.query.pageSize,
      search: req.query.search,
      from: req.query.from,
      to: req.query.to,
      room: req.query.room,
    }),
  });
});

app.get("/api/battle/report", auth.requireAuth, (req, res) => {
  const roomId = String(req.query.room_id || "").trim();
  if (!roomId) return res.json({ success: false, error: "room_id obrigatorio" });
  res.json({ success: true, report: db.getBattleReport(req.user.id, roomId) });
});

app.get("/api/battle/live-ranking", auth.requireAuth, (req, res) => {
  const tid = req.user.id;
  const tenant = tenants.get(tid);
  const liveRoom = (tenant && tenant.currentStatus && tenant.currentStatus.room_id) || "";
  if (!liveRoom) return res.json({ success: true, live_room_id: "", ranking: { taps: [], coins: [] } });
  res.json({ success: true, live_room_id: liveRoom, ranking: db.getBattleLiveRanking(tid, liveRoom, 10) });
});

app.get("/api/history", auth.requireAuth, (req, res) => {
  const user = req.user.id;
  const th = db.getTenantHistory(user);
  const games = db.getGamesPaged(user, {
    page: req.query.page,
    pageSize: req.query.pageSize,
    search: req.query.search,
    from: req.query.from,
    to: req.query.to,
  });
  res.json({ games, played: th.played_words, last_id: th.last_id });
});

app.get("/api/winners", auth.requireAuth, (req, res) => {
  const ranking = db.getWeeklyWins(req.user.id, 10);
  res.json({ success: true, ranking });
});

app.get("/api/ranking-live", auth.requireAuth, (req, res) => {
  const tenant = tenants.get(req.user.id);
  const liveRoom = (tenant && tenant.currentStatus && tenant.currentStatus.room_id) || "";
  if (!liveRoom) return res.json({ success: true, live_room_id: "", ranking: [] });
  const ranking = db.getLiveWins(req.user.id, liveRoom, 10);
  res.json({ success: true, live_room_id: liveRoom, ranking });
});

// ---------------- Game control ----------------

app.post("/api/new-game", auth.requireAuth, (req, res) => {
  const tenantId = req.user.id;
  const user = db.getUserById(tenantId);
  if (user && !featureAllowed(user, "games")) {
    return res.status(403).json({ success: false, error: "Funcionalidade nao liberada para sua conta" });
  }
  const tenant = tenants.get(tenantId);
  if (!liveOnline(tenant)) {
    return res.json({ success: false, error: "Live offline — conecte a live antes de iniciar a Palavra Secreta" });
  }
  const config = readTenantGiftConfig(tenantId);
  const ok = daemonSend({
    cmd: "new_game",
    tenant_id: tenantId,
    hint_gifts: config.hint_gifts || [],
    riddle_gifts: config.riddle_gifts || [],
    size_gift: config.size_gift || "",
    letter_gift: config.letter_gift || "",
  });
  if (!ok) {
    return res.json({ success: false, error: "Servico Python indisponivel" });
  }
  res.json({ success: true });
});

app.post("/api/end-game", auth.requireAuth, (req, res) => {
  const tenantId = req.user.id;
  const tenant = tenants.get(tenantId);
  if (!liveOnline(tenant)) {
    return res.json({ success: false, error: "Live offline — conecte a live antes de finalizar" });
  }
  const ok = daemonSend({
    cmd: "end_game",
    tenant_id: tenantId,
  });
  if (!ok) {
    return res.json({ success: false, error: "Servico Python indisponivel" });
  }
  res.json({ success: true });
});

app.post("/api/game/manual-action", auth.requireAuth, (req, res) => {
  const tenantId = req.user.id;
  const action = (req.body && req.body.action) || "";
  const cmd = action === "riddle" ? "manual_riddle" : action === "hint" ? "manual_hint" : null;
  if (!cmd) {
    return res.json({ success: false, error: "action invalida (use hint ou riddle)" });
  }
  const tenant = tenants.get(tenantId);
  if (!liveOnline(tenant)) {
    return res.json({ success: false, error: "Live offline — conecte a live antes de usar" });
  }
  const ok = daemonSend({ cmd, tenant_id: tenantId });
  if (!ok) {
    return res.json({ success: false, error: "Servico Python indisponivel" });
  }
  res.json({ success: true });
});

// ---------------- Caça Palavras ----------------

function cacaTenantId(req) {
  const token = auth.extractToken(req);
  if (token) {
    try { return auth.verifyToken(token).id; } catch {}
  }
  return null;
}

app.post("/api/caca/start", auth.requireAuth, requireFeature("caca"), (req, res) => {
  if (!liveOnline(tenants.get(req.user.id))) {
    return res.json({ success: false, error: "Live offline — conecte a live antes de iniciar o Caça Palavras" });
  }
  const count = Math.max(4, Math.min(16, parseInt((req.body && req.body.count), 10) || 10));
  const ok = daemonSend({ cmd: "caca_start", tenant_id: req.user.id, count });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/caca/stop", auth.requireAuth, (req, res) => {
  const ok = daemonSend({ cmd: "caca_stop", tenant_id: req.user.id });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/caca/config", auth.requireAuth, (req, res) => {
  const prefix = (req.body && typeof req.body.prefix === "string") ? req.body.prefix.trim() : "";
  const ok = daemonSend({ cmd: "caca_config", tenant_id: req.user.id, prefix });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/caca/reveal", auth.requireAuth, (req, res) => {
  const start = String((req.body && req.body.start) || "").trim();
  const end = String((req.body && req.body.end) || "").trim();
  if (!start || !end) return res.json({ success: false, error: "start e end obrigatorios" });
  const ok = daemonSend({ cmd: "caca_reveal", tenant_id: req.user.id, start, end });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.get("/api/caca/state", auth.requireAuth, (req, res) => {
  const tid = req.user.id;
  const tenant = tenants.get(tid);
  const st = (tenant && tenant.cacaState) || { active: false, size: 10, board: [], words: [], found_count: 0, total: 0, finished: false };
  res.json({ success: true, ...st });
});

app.get("/api/caca/weekly", auth.requireAuth, (req, res) => {
  const weekly = db.getCacaWeekly(req.user.id, 10);
  res.json({ success: true, weekly });
});

// ---------------- Jogo dos 3 Pontinhos ----------------

function tresTenantId(req) {
  const token = auth.extractToken(req);
  if (token) {
    try { return auth.verifyToken(token).id; } catch {}
  }
  return null;
}

app.post("/api/tres/start", auth.requireAuth, requireFeature("tres"), (req, res) => {
  const tenant = tenants.get(req.user.id);
  if (!liveOnline(tenant)) {
    return res.json({ success: false, error: "Live offline — conecte a live antes de iniciar o Jogo dos 3 Pontinhos" });
  }
  const ok = daemonSend({ cmd: "tres_start", tenant_id: req.user.id, palavra: (req.body && req.body.palavra) || "" });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/tres/stop", auth.requireAuth, (req, res) => {
  const ok = daemonSend({ cmd: "tres_stop", tenant_id: req.user.id });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/tres/pause", auth.requireAuth, (req, res) => {
  const ok = daemonSend({ cmd: "tres_pause", tenant_id: req.user.id });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/tres/resume", auth.requireAuth, (req, res) => {
  const ok = daemonSend({ cmd: "tres_resume", tenant_id: req.user.id });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/tres/reset", auth.requireAuth, (req, res) => {
  const ok = daemonSend({ cmd: "tres_reset", tenant_id: req.user.id });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/tres/config", auth.requireAuth, (req, res) => {
  const config = (req.body && req.body.config) || {};
  try {
    db.saveTresGiftConfig(req.user.id, {
      size: config.size || "",
      letter: config.letter || "",
      ticket: config.ticket || "",
      stage_times: config.stage_times || [120, 60, 30],
      stage_points: config.stage_points || [30, 20, 10],
    });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
  const ok = daemonSend({ cmd: "tres_config", tenant_id: req.user.id, config });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.get("/api/tres/config", auth.requireAuth, (req, res) => {
  res.json({ success: true, config: db.getTresGiftConfig(req.user.id) });
});

app.get("/api/tres/state", auth.requireAuth, (req, res) => {
  const tid = req.user.id;
  const tenant = tenants.get(tid);
  const st = (tenant && tenant.tresState) || {
    active: false, round_id: 0, stage: 0, stage_remaining: 0, stage_time: 0, stage_points: 0,
    paused: false, finished: false, timeout: false, palavra: null, palavra_len: 0, first_letter: "",
    size_revealed: false, first_letter_revealed: false, dicas: [], winner: null,
    gift_config: { size: "", letter: "", ticket: "" }, stage_times: [120, 60, 30], stage_points: [30, 20, 10],
  };
  res.json({ success: true, ...st });
});

app.get("/api/tres/weekly", auth.requireAuth, (req, res) => {
  res.json({ success: true, weekly: db.getTresWeekly(req.user.id, 10) });
});

// ---------------- Bichinho Virtual (V-Pet) ----------------

function vpetTenantId(req) {
  const token = auth.extractToken(req);
  if (token) {
    try { return auth.verifyToken(token).id; } catch {}
  }
  return null;
}

app.post("/api/vpet/start", auth.requireAuth, requireFeature("bichinho"), (req, res) => {
  const tenant = tenants.get(req.user.id);
  if (!liveOnline(tenant)) {
    return res.json({ success: false, error: "Live offline — conecte a live antes de ativar o Bichinho" });
  }
  const ok = daemonSend({ cmd: "vpet_start", tenant_id: req.user.id });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/vpet/stop", auth.requireAuth, (req, res) => {
  const ok = daemonSend({ cmd: "vpet_stop", tenant_id: req.user.id });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/vpet/assistant_mode", auth.requireAuth, (req, res) => {
  const ok = daemonSend({ cmd: "vpet_assistant_mode", tenant_id: req.user.id, enabled: !!req.body.enabled });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.post("/api/vpet/battle/start", auth.requireAuth, (req, res) => {
  const tenant = tenants.get(req.user.id);
  if (!liveOnline(tenant)) {
    return res.json({ success: false, error: "Live offline — conecte a live antes de invocar o boss" });
  }
  const vs = (tenant && tenant.vpetState) || null;
  if (!vs || !vs.active) {
    return res.json({ success: false, error: "Ative o Bichinho primeiro (aba Bichinho)" });
  }
  if ((vs.level || 0) < 1) {
    return res.json({ success: false, error: "O ovo ainda não chocou — use #chocar ou envie presentes" });
  }
  const bs = (vs.battle && vs.battle.state) || "idle";
  if (bs === "fight" || bs === "countdown") {
    return res.json({ success: false, error: "Já há uma batalha em andamento" });
  }
  if ((vs.batalhas_disponiveis || 0) < 1) {
    return res.json({ success: false, error: "Nenhuma batalha na mochila — aguarde o 15 min acumular ou use !abrirportal" });
  }
  const ok = daemonSend({ cmd: "vpet_battle_start", tenant_id: req.user.id });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true });
});

app.get("/api/vpet/state", auth.requireAuth, (req, res) => {
  const tid = req.user.id;
  const tenant = tenants.get(tid);
  let st = (tenant && tenant.vpetState) || null;
  if (!st) {
    try { st = db.getVpetState(tid); } catch {}
  }
  if (!st) {
    st = { active: false, phase: "ovo-estelar", level: 0, hunger: 100, energy: 100, xp: 0, hatch_points: 0, hatch_need: 1000, batalhas_disponiveis: 0, bag_max: 3, battle_wins: 0, anim: "idle", hatched: false, battle: { state: "idle", boss_name: "", boss_hp: 0, boss_max_hp: 0, timer: 0, next_in: 900 } };
  }
  res.json({ success: true, ...st });
});

app.post("/api/play-riddle", auth.requireAuth, (req, res) => {
  const tenantId = req.user.id;
  const tenant = tenants.get(tenantId);
  if (!tenant) {
    return res.json({ success: false, error: "Tenant nao encontrado" });
  }
  broadcastToClients(tenant.browserClients, { type: "riddle_play" });
  res.json({ success: true });
});

app.post("/api/game/display-action", auth.requireAuth, (req, res) => {
  const tenantId = req.user.id;
  const tenant = tenants.get(tenantId);
  if (!tenant) {
    return res.json({ success: false, error: "Tenant nao encontrado" });
  }
  const gs = tenant.gameState;
  if (!gs.display) gs.display = { riddle_visible: false, ranking_view: "live" };
  const action = String((req.body && req.body.action) || "").trim();
  const payload = { type: "display_action", action };

  switch (action) {
    case "show_riddle":
      gs.display.riddle_visible = true;
      break;
    case "close_riddle":
      gs.display.riddle_visible = false;
      broadcastToClients(tenant.browserClients, payload);
      broadcastToClients(tenant.logClients, payload);
      return res.json({ success: true, message: "Charada fechada no OBS.", riddle_visible: false });
    case "change_ranking": {
      const order = ["round", "live", "weekly", "hidden"];
      const cur = gs.display.ranking_view || "live";
      const next = order[(order.indexOf(cur) + 1) % order.length] || "live";
      gs.display.ranking_view = next;
      payload.ranking_view = next;
      broadcastToClients(tenant.browserClients, payload);
      broadcastToClients(tenant.logClients, payload);
      return res.json({ success: true, ranking_view: next, message: "Ranking alterado para " + rankingLabel(next) + "." });
    }
    case "show_ranking":
      gs.display.ranking_view = String((req.body && req.body.ranking_view) || "live").trim() || "live";
      payload.ranking_view = gs.display.ranking_view;
      break;
    case "hide_ranking":
      gs.display.ranking_view = "hidden";
      payload.ranking_view = "hidden";
      break;
    case "close_winner":
    case "clear_screen":
      // Reservado para futuras acoes visuais
      break;
    default:
      return res.json({ success: false, error: "Action desconhecida: " + action });
  }
  broadcastToClients(tenant.browserClients, payload);
  broadcastToClients(tenant.logClients, payload);
  res.json({ success: true, ...gs.display });
});

function rankingLabel(view) {
  const map = { round: "Ranking da Rodada", live: "Ranking da Live", weekly: "Ranking Semanal", hidden: "Oculto" };
  return map[view] || view;
}

app.post("/api/game/room-link", auth.requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) {
    return res.status(401).json({ success: false, error: "Usuario nao encontrado" });
  }
  const token = auth.signToken(user, { ttl: "365d" });
  res.json({ success: true, token, room: user.room_code || "" });
});

// ---------------- Duelo 1x1 ----------------

const dueloUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, "public", "duelo-audio", String(req.user.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const base = (req.body && req.body.gift_id) || "duelo";
      const safe = String(base).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "duelo";
      const ext = (path.extname(file.originalname) || ".mp3").toLowerCase();
      cb(null, `${safe}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname || "";
    cb(null, /\.(mp3|wav|ogg|m4a|aac|flac|webm|mp4|opus)$/i.test(name));
  },
});

function normalizeDueloGifts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((g) => {
    const type = (g && g.type) === "escudo" ? "escudo" : "golpe";
    const base = {
      type,
      gift_id: String((g && g.gift_id) || "").trim(),
      name: String((g && g.name) || "").trim(),
      character: ["flavio", "lula"].includes(g && g.character) ? g.character : "flavio",
      audio: String((g && g.audio) || ""),
      active: (g && g.active) !== false,
    };
    if (type === "escudo") {
      base.shield = Math.max(0, parseInt((g && g.shield) || 0, 10) || 0);
    } else {
      base.action = ["punch", "kick", "uppercut"].includes(g && g.action) ? g.action : "punch";
      base.damage = Math.max(0, parseInt((g && g.damage) || 0, 10) || 0);
    }
    return base;
  }).filter((g) => g.gift_id || g.name);
}

function normalizeDueloSettings(raw) {
  const out = {
    mode: (raw && raw.mode === "votes") ? "votes" : "hp",
    hp_start: 100,
    shield_start: 100,
    shield_max: 200,
    dmg_punch: 10,
    dmg_kick: 15,
    dmg_uppercut: 20,
    reset_delay_s: 6,
    max_votes: 0,
  };
  if (raw && typeof raw === "object") {
    const n = (v) => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : null; };
    const hn = n(raw.hp_start); if (hn !== null) out.hp_start = Math.max(20, Math.min(10000, hn));
    const ss = n(raw.shield_start); if (ss !== null) out.shield_start = Math.max(0, Math.min(10000, ss));
    const sm = n(raw.shield_max); if (sm !== null) out.shield_max = Math.max(out.shield_start, Math.min(100000, sm));
    for (const k of ["dmg_punch", "dmg_kick", "dmg_uppercut"]) {
      const d = n(raw[k]);
      if (d !== null) out[k] = Math.max(1, Math.min(10000, d));
    }
    const rd = n(raw.reset_delay_s); if (rd !== null) out.reset_delay_s = Math.max(1, Math.min(300, rd));
    const mv = n(raw.max_votes);
    out.max_votes = (mv !== null && mv > 0) ? Math.max(1, Math.min(1000, mv)) : 0;
  }
  return out;
}

app.get("/api/duelo/config", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  res.json({ success: true, ...db.getDueloConfig(req.user.id) });
});

app.post("/api/duelo/config", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  const gifts = normalizeDueloGifts(req.body && req.body.gifts);
  const settings = normalizeDueloSettings(req.body && req.body.settings);
  const active = !!(req.body && req.body.active);
  const cfg = db.saveDueloConfig(req.user.id, { gifts, active, settings });
  daemonSend({ cmd: "duelo_config", tenant_id: req.user.id, gifts, settings });
  res.json({ success: true, ...cfg });
});

app.get("/api/duelo/state", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  res.json({ success: true, ...db.getDueloConfig(req.user.id) });
});

app.post("/api/duelo/start", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  const tenant = getTenant(req.user.id);
  if (!liveOnline(tenant)) {
    return res.json({ success: false, error: "Live offline — conecte a live antes de iniciar o Duelo" });
  }
  const cfg = db.getDueloConfig(req.user.id);
  const settings = normalizeDueloSettings(cfg.settings);
  const ok = daemonSend({ cmd: "duelo_start", tenant_id: req.user.id, gifts: cfg.gifts, settings });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  db.saveDueloConfig(req.user.id, { gifts: cfg.gifts, active: true, settings });
  res.json({ success: true, active: true });
});

app.post("/api/duelo/stop", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  const ok = daemonSend({ cmd: "duelo_stop", tenant_id: req.user.id });
  const cfg = db.getDueloConfig(req.user.id);
  db.saveDueloConfig(req.user.id, { gifts: cfg.gifts, active: false, settings: cfg.settings });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
  res.json({ success: true, active: false });
});

app.post("/api/duelo/reset-round", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  daemonSend({ cmd: "duelo_reset_round", tenant_id: req.user.id });
  res.json({ success: true });
});

app.post("/api/duelo/new-match", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  daemonSend({ cmd: "duelo_new_match", tenant_id: req.user.id });
  res.json({ success: true });
});

app.post("/api/duelo/test", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  const attacker = ["flavio", "lula"].includes(req.body && req.body.attacker) ? req.body.attacker : "flavio";
  const action = ["punch", "kick", "uppercut"].includes(req.body && req.body.action) ? req.body.action : "punch";
  const combo = Math.max(1, parseInt((req.body && req.body.combo) || 1, 10) || 1);
  const cfg = db.getDueloConfig(req.user.id);
  const gift = (cfg.gifts || []).find((g) => g.character === attacker && g.action === action);
  const tenant = getTenant(req.user.id);
  broadcastToClients(tenant.browserClients, {
    type: "duelo_attack",
    attacker,
    action,
    combo,
    audio_url: (gift && gift.audio) ? `/duelo-audio/${req.user.id}/${gift.audio}` : "",
    gift: gift ? gift.name : "",
    user: "streamer",
    nickname: "Streamer",
  });
  res.json({ success: true });
});

app.post("/api/duelo/audio", auth.requireAuth, requireFeature("duelo"), dueloUpload.single("file"), (req, res) => {
  if (!req.file) return res.json({ success: false, error: "Arquivo de audio obrigatorio" });
  res.json({ success: true, filename: req.file.filename, url: `/duelo-audio/${req.user.id}/${req.file.filename}` });
});

app.post("/start-game", auth.requireAuth, requireFeature("connect"), (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(401).json({ success: false, error: "Usuario nao encontrado" });
  if (!user.tiktok_username) {
    return res.json({ success: false, error: "Defina o usuario do TikTok no painel" });
  }
  const engine = user.tiktok_engine || "tiktoklive";
  if (engine === "tiktools" && !user.tiktools_api_key) {
    return res.json({ success: false, error: "Defina a API key do Tik.Tools no painel (motor Tik.Tools)" });
  }
  const ok = daemonSend({
    cmd: "start",
    tenant_id: user.id,
    username: user.tiktok_username,
    api_key: user.tiktools_api_key,
    settings: readTenantSettings(user.id),
    engine,
    tres_gifts: db.getTresGiftConfig(user.id),
  });
  if (!ok) {
    return res.json({ success: false, error: "Servico Python indisponivel" });
  }
  getTenant(user.id).sessionStarted = true;
  res.json({ success: true, message: "Jogo iniciado" });
});

app.post("/stop-game", auth.requireAuth, (req, res) => {
  const ok = daemonSend({ cmd: "stop", tenant_id: req.user.id });
  if (!ok) {
    return res.json({ success: false, error: "Servico Python indisponivel" });
  }
  getTenant(req.user.id).sessionStarted = false;
  res.json({ success: true, message: "Jogo encerrado" });
});

// ---------------- WebSocket ----------------

wss.on("connection", (ws, req) => {
  const parsed = new URL(req.url, `http://localhost:${HTTP_PORT}`);
  const pathname = parsed.pathname;

  if (pathname === "/logs") {
    const token = parsed.searchParams.get("token");
    let payload;
    try {
      payload = auth.verifyToken(token);
    } catch {
      ws.close(1008, "nao autenticado");
      return;
    }
    const user = db.getUserById(payload.id);
    if (!user || user.status !== "active") {
      ws.close(1008, "conta invalida");
      return;
    }
    const tenant = getTenant(user.id);
    tenant.logClients.push(ws);
    ws.on("close", () => {
      const idx = tenant.logClients.indexOf(ws);
      if (idx !== -1) tenant.logClients.splice(idx, 1);
    });
    ws.send(JSON.stringify({ type: "log", text: "[Painel] Conectado ao servidor de logs" }));
    if (tenant.currentStatus) {
      ws.send(JSON.stringify({ type: "status", ...tenant.currentStatus }));
    }
    if (tenant.currentWord) {
      ws.send(JSON.stringify({ type: "word", word: tenant.currentWord }));
    }
    return;
  }

  if (pathname === "/browser") {
    const token = parsed.searchParams.get("token");
    let payload;
    try {
      payload = auth.verifyToken(token);
    } catch {
      ws.close(1008, "nao autenticado");
      return;
    }
    const user = db.getUserById(payload.id);
    if (!user || user.status !== "active") {
      ws.close(1008, "conta invalida");
      return;
    }
    const tenant = getTenant(user.id);
    tenant.browserClients.push(ws);
    ws.on("close", () => {
      const idx = tenant.browserClients.indexOf(ws);
      if (idx !== -1) tenant.browserClients.splice(idx, 1);
    });
    if (tenant.currentStatus && tenant.currentStatus.state === "connected") {
      ws.send(JSON.stringify({ type: "python_connected" }));
    }
    if (tenant.vpetState) {
      ws.send(JSON.stringify({ type: "vpet_state", ...tenant.vpetState }));
    }
    return;
  }

  ws.close(1008, "rota invalida");
});
