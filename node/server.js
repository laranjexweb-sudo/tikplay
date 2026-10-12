require("dotenv").config();
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { tenants, emptyGameState, getTenant, broadcastToClients, broadcastLog, registerLogPersister } = require("./lib/ws");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const multer = require("multer");

const db = require("./db");
const auth = require("./auth");

const logstore = require("./lib/logstore");

// Persiste cada log no ponto único de entrega (daemon/servidor), mantendo o
// contrato {type:"log", text, game, level} + metadados estáveis aditivos (id, ts, category).
registerLogPersister((tenantId, item) => {
  const entry = logstore.append(tenantId, item);
  logstore.maybePrune();
  return entry;
});
try {
  db.pruneLogEntries();
} catch (e) {}

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
const NO_CACHE_ROUTES = new Set(["/duelo", "/painel", "/caca-palavra", "/batalha", "/tres-pontinhos", "/bichinho", "/bichinho-overlay", "/jogo", "/ranking"]);
for (const [route, file] of Object.entries(FRIENDLY_PAGES)) {
  app.get(route, (req, res) => {
    if (NO_CACHE_ROUTES.has(route)) {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    }
    res.sendFile(path.join(PUBLIC_DIR, file));
  });
}
for (const [legacy, target] of Object.entries(LEGACY_PAGES)) {
  app.get(legacy, (req, res) => res.redirect(301, target));
}

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
express.static.mime.define({ "image/webp": ["webp"] });
app.use("/gift-images", express.static(path.join(__dirname, "public", "gift-images"), { maxAge: "1d" }));
app.use("/duelo-audio", express.static(path.join(__dirname, "public", "duelo-audio")));
fs.mkdirSync(path.join(__dirname, "public", "duelo-audio"), { recursive: true });
fs.mkdirSync(path.join(__dirname, "public", "duelo-audio", "_system"), { recursive: true });
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
        tap_meta_current: 0,
        tap_meta_total: msg.tap_meta_total || 1000,
        tap_meta_ready: false,
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

const Daemon = require("./lib/daemon");

const DAEMON_ENV = {
  ...process.env,
  PYTHONIOENCODING: "utf-8",
  PYTHONUNBUFFERED: "1",
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
};

let daemon = null;

function resetAllTenantSessions() {
  for (const tenant of tenants.values()) {
    tenant.sessionStarted = false;
  }
}

function onDaemonDown() {
  resetAllTenantSessions();
  broadcastStatusAll({ state: "offline" });
}

function routeDaemonStderr(line) {
  const tenantId = msgTenant(line);
  if (tenantId && tenants.has(tenantId)) {
    broadcastLog(getTenant(tenantId), `[stderr] ${line}`);
  } else {
    console.error("[Daemon]", line);
  }
}

function startDaemon() {
  daemon = new Daemon({
    pythonBin: PYTHON_BIN,
    servicePath: SERVICE_PATH,
    env: DAEMON_ENV,
    onMessage: handleDaemonMessage,
    onStderr: routeDaemonStderr,
    onDown: onDaemonDown,
  });
  daemon.start();
}

function daemonSend(obj) {
  if (!daemon) startDaemon();
  return daemon ? daemon.send(obj) : false;
}

function handleDaemonMessage(msg) {
  const tenantId = msg.tenant_id;
  if (tenantId !== null && tenantId !== undefined) {
    const tenant = getTenant(tenantId);
    if (msg.type === "status") {
      broadcastStatus(tenant, msg.status || {});
    } else if (msg.type === "game") {
      const gameMsg = msg.msg || {};
      if (gameMsg.type === "duelo_state") {
        tenant.dueloState = gameMsg;
      }
      updateGameState(tenant, gameMsg);
      broadcastToClients(tenant.browserClients, gameMsg);
      broadcastToClients(tenant.logClients, gameMsg);
    } else if (msg.type === "log") {
      broadcastLog(tenant, { text: msg.text || "", game: msg.game || "", level: msg.level || "" });
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
    } else if (msg.type === "gifts_synced") {
      broadcastToClients(tenant.logClients, { type: "gifts_synced", result: msg.text || {} });
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

function killDaemon() {
  if (daemon) daemon.kill();
  daemon = null;
}
process.on("exit", killDaemon);
process.on("SIGINT", () => { killDaemon(); process.exit(); });
process.on("SIGTERM", () => { killDaemon(); process.exit(); });

startDaemon();

// ---------------- Config helpers ----------------

function readGiftTags() {
  try {
    const derived = db.getGiftTagsDerived();
    if (derived && derived.length) return derived;
  } catch {}
  try {
    return JSON.parse(fs.readFileSync(GIFT_TAGS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function readGiftImageMap() {
  try {
    const derived = db.getGiftImageMapDerived();
    if (derived && Object.keys(derived).length) return derived;
  } catch {}
  try {
    return JSON.parse(fs.readFileSync(GIFT_IMAGE_MAP_PATH, "utf-8"));
  } catch {
    return {};
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

// ---------------- Auth / Admin / Panel (rotas - Fase B-2b) ----------------
require("./routes/auth")(app, { db, auth, getTenant, PYTHON_BIN });

// ---------------- Shared/public configs ----------------

// ---------------- Gifts / gift-config / Alertas sonoros (rotas - Fase B-2b) ----------------
require("./routes/gifts")(app, { db, path, fs, multer, auth, getTenant, daemonSend, broadcastToClients, readGiftTags, readGiftImageMap, readTenantGiftConfig });

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
  { key: "edge_antonio", label: "Edge — Antonio (servidor)" },
  { key: "edge_francisca", label: "Edge — Francisca (servidor)" },
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

// Testes VISUAIS do 3 Dicas — efeitos só na tela (não altera regras/pontuação/ranking)
app.post("/api/tres/test", auth.requireAuth, (req, res) => {
  const tenant = getTenant(req.user.id);
  const action = String((req.body && req.body.action) || "").trim();
  const nickname = String((req.body && req.body.nickname) || "Streamer");
  const avatar = String((req.body && req.body.avatar) || "");
  const payload = { type: "tres_test", action, nickname, avatar, user: "streamer" };

  if (action === "dica") {
    payload.stage = Math.max(1, Math.min(3, parseInt((req.body && req.body.stage) || 1, 10) || 1));
  } else if (action === "presente") {
    payload.kind = (req.body && req.body.kind) === "letter" ? "letter" : "size";
    payload.len = Math.max(3, parseInt((req.body && req.body.len) || 7, 10) || 7);
    payload.letter = String((req.body && req.body.letter) || "A").charAt(0);
  } else if (action === "passe" || action === "apoiador") {
    /* entrou como apoiador */
  } else if (action === "vencedor") {
    payload.pontos = Math.max(1, parseInt((req.body && req.body.pontos) || 30, 10) || 30);
    payload.multiplicador = !!(req.body && req.body.multiplicador);
    payload.stage = Math.max(1, Math.min(3, parseInt((req.body && req.body.stage) || 1, 10) || 1));
    payload.palavra = String((req.body && req.body.palavra) || "PALAVRA");
  } else if (action === "timeout") {
    payload.palavra = String((req.body && req.body.palavra) || "Ninguém acertou");
  } else if (action === "ranking") {
    const fake = [
      { user: "top1", nickname: "Top 1", avatar: "", pontos: 240 },
      { user: "top2", nickname: "Top 2", avatar: "", pontos: 180 },
      { user: "top3", nickname: "Top 3", avatar: "", pontos: 150 },
      { user: "top4", nickname: "Top 4", avatar: "", pontos: 95 },
      { user: "top5", nickname: "Top 5", avatar: "", pontos: 60 },
    ];
    payload.weekly = fake;
  } else {
    return res.json({ success: false, error: "Ação de teste inválida" });
  }

  broadcastToClients(tenant.browserClients, payload);
  res.json({ success: true });
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

// ---------------- Histórico de logs (recuperação paginada) ----------------

app.get("/api/logs", auth.requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user || user.status !== "active") {
    return res.status(401).json({ success: false, error: "Conta invalida" });
  }
  // Tenant/streamer SEMPRE derivado da identidade autenticada; nunca do cliente.
  const before = /^\d+$/.test(String(req.query.before || "")) ? Number(req.query.before) : undefined;
  const since = /^\d+$/.test(String(req.query.since || "")) ? Number(req.query.since) : undefined;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), db.LOG_PAGE_MAX);
  const logs = logstore.query({ tenantId: req.user.id, before, since, limit });
  res.json({ success: true, logs, limit, has_more: logs.length >= limit });
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
    case "show_postgame":
      gs.display.postgame_visible = true;
      payload.postgame_visible = true;
      break;
    case "close_postgame":
      gs.display.postgame_visible = false;
      payload.postgame_visible = false;
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
    const t = String((g && g.type) || "").toLowerCase();
    const type = (t === "escudo" || t === "shield") ? "escudo" : ((t === "apoio" || t === "support" || t === "vote") ? "apoio" : "golpe");
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
    } else if (type === "golpe") {
      base.action = ["punch", "kick", "uppercut"].includes(g && g.action) ? g.action : "punch";
      base.damage = Math.max(0, parseInt((g && g.damage) || 0, 10) || 0);
    }
    return base;
  }).filter((g) => g.gift_id || g.name);
}

function dueloInitialState(cfg) {
  const s = normalizeDueloSettings(cfg && cfg.settings);
  return {
    type: "duelo_state",
    mode: s.mode,
    hp: { flavio: s.hp_start, lula: s.hp_start },
    shield: { flavio: s.shield_start, lula: s.shield_start },
    votes: { flavio: 0, lula: 0 },
    debate_wins: { flavio: 0, lula: 0 },
    hp_max: s.hp_max,
    shield_max: s.shield_max,
    vote_target: s.vote_target,
    winner: null,
    roundActive: true,
    final: false,
    active: !!(cfg && cfg.active),
  };
}

function dueloGiftsPayload(gifts) {
  let map = {};
  try { map = JSON.parse(fs.readFileSync(GIFT_IMAGE_MAP_PATH, "utf-8")) || {}; } catch {}
  let price = {};
  try { (JSON.parse(fs.readFileSync(GIFT_TAGS_PATH, "utf-8")) || []).forEach((g) => { if (g && g.name) price[g.name] = g.diamond_count; }); } catch {}
  return (Array.isArray(gifts) ? gifts : []).map((g) => {
    const out = Object.assign({}, g);
    out.image = (g && g.name && map[g.name]) ? `/gift-images/${map[g.name]}` : "";
    out.diamond_count = (g && g.name && price[g.name] != null) ? price[g.name] : 0;
    return out;
  });
}

function dueloClientSettings(userId, settings) {
  const s = Object.assign({}, settings || {});
  if (s.music && Array.isArray(s.music.files)) {
    s.music = Object.assign({}, s.music, { base: `/duelo-audio/${userId}` });
  }
  if (s.supporters && typeof s.supporters === "object") {
    let map = {};
    try { map = JSON.parse(fs.readFileSync(GIFT_IMAGE_MAP_PATH, "utf-8")) || {}; } catch {}
    const out = {};
    for (const k of Object.keys(s.supporters)) {
      const v = s.supporters[k];
      if (!v || typeof v !== "object") { out[k] = v; continue; }
      out[k] = Object.assign({}, v, {
        image: (v.gift_name && map[v.gift_name]) ? `/gift-images/${map[v.gift_name]}` : "",
      });
    }
    s.supporters = out;
  }
  if (s.main_gifts && typeof s.main_gifts === "object") {
    let map = {};
    let tags = {};
    try { map = JSON.parse(fs.readFileSync(GIFT_IMAGE_MAP_PATH, "utf-8")) || {}; } catch {}
    try { readGiftTags().forEach((g) => { if (g && g.name) tags[g.name] = Number(g.diamond_count) || 0; }); } catch {}
    const out = {};
    for (const side of Object.keys(s.main_gifts)) {
      const v = s.main_gifts[side];
      out[side] = (v && typeof v === "object") ? Object.assign({}, v, {
        image: (v.gift_name && map[v.gift_name]) ? `/gift-images/${map[v.gift_name]}` : "",
        value: (v.gift_name && tags[v.gift_name]) ? tags[v.gift_name] : 0,
      }) : v;
    }
    s.main_gifts = out;
  }
  if (s.extra_gifts && typeof s.extra_gifts === "object") {
    let map = {};
    let tags = {};
    try { map = JSON.parse(fs.readFileSync(GIFT_IMAGE_MAP_PATH, "utf-8")) || {}; } catch {}
    try { readGiftTags().forEach((g) => { if (g && g.name) tags[g.name] = Number(g.diamond_count) || 0; }); } catch {}
    const out = {};
    for (const side of Object.keys(s.extra_gifts)) {
      const arr = Array.isArray(s.extra_gifts[side]) ? s.extra_gifts[side] : [];
      out[side] = arr.map((v) => (v && typeof v === "object") ? Object.assign({}, v, {
        image: (v.gift_name && map[v.gift_name]) ? `/gift-images/${map[v.gift_name]}` : "",
        value: (v.gift_name && tags[v.gift_name]) ? tags[v.gift_name] : 0,
      }) : v);
    }
    s.extra_gifts = out;
  }
  if (s.special_attacks && typeof s.special_attacks === "object") {
    let map = {};
    try { map = JSON.parse(fs.readFileSync(GIFT_IMAGE_MAP_PATH, "utf-8")) || {}; } catch {}
    const saOut = {};
    for (const k of Object.keys(s.special_attacks)) {
      const v = s.special_attacks[k];
      if (!v || typeof v !== "object") { saOut[k] = v; continue; }
      saOut[k] = Object.assign({}, v, {
        image: (v.gift_name && map[v.gift_name]) ? `/gift-images/${map[v.gift_name]}` : "",
      });
    }
    s.special_attacks = saOut;
  }
  return s;
}

function normalizeDueloSettings(raw) {
  const out = {
    mode: (raw && raw.mode === "votes") ? "votes" : "hp",
    hp_start: 100,
    hp_max: 100,
    shield_start: 100,
    shield_max: 200,
    dmg_punch: 10,
    dmg_kick: 15,
    dmg_uppercut: 20,
    reset_delay_s: 6,
    match_restart_delay_s: 8,
    vote_target: 0,
    layout: {},
    sfx_volume: 92,
    music: { files: [], volume: 50, enabled: false, default_file: "mixkit-karma-1183.mp3" },
    scene: "brasilia",
    idle: { enabled: true, enter_after: 10, interval: 7 },
    supporters: {},
    game_mode: "hp",
    round_time_s: 180,
    round_result_delay_s: 8,
    kick_combo_min: 5,
    uppercut_combo_min: 20,
    main_gifts: {},
    extra_gifts: {},
  };
  if (raw && typeof raw === "object") {
    const n = (v) => { const x = parseInt(v, 10); return Number.isFinite(x) ? x : null; };
    const hn = n(raw.hp_start);
    const hx = n(raw.hp_max);
    out.hp_max = hx !== null ? Math.max(1, Math.min(10000, hx)) : 100;
    out.hp_start = hn !== null ? Math.max(1, Math.min(out.hp_max, hn)) : Math.min(out.hp_max, 100);
    const ss = n(raw.shield_start);
    const sm = n(raw.shield_max);
    out.shield_max = sm !== null ? Math.max(0, Math.min(100000, sm)) : 200;
    out.shield_start = ss !== null ? Math.max(0, Math.min(out.shield_max, ss)) : Math.min(out.shield_max, 100);
    for (const k of ["dmg_punch", "dmg_kick", "dmg_uppercut"]) {
      const d = n(raw[k]);
      if (d !== null) out[k] = Math.max(1, Math.min(10000, d));
    }
    const rd = n(raw.reset_delay_s); if (rd !== null) out.reset_delay_s = Math.max(1, Math.min(300, rd));
    const mrd = n(raw.match_restart_delay_s); if (mrd !== null) out.match_restart_delay_s = Math.max(2, Math.min(120, mrd));
    const vtRaw = raw.vote_target != null ? raw.vote_target : raw.max_votes;
    const vt = n(vtRaw);
    out.vote_target = (vt !== null && vt > 0) ? Math.max(1, Math.min(100000000, vt)) : 0;
    const sv = n(raw.sfx_volume);
    out.sfx_volume = (sv !== null) ? Math.max(0, Math.min(100, sv)) : 92;
    const safeName = (v) => String((v == null ? "" : v)).trim().replace(/[^a-zA-Z0-9._-]/g, "");
    const mf = (raw.music && Array.isArray(raw.music.files)) ? raw.music.files.map(safeName).filter(Boolean).slice(0, 20) : [];
    const mv = n(raw.music && raw.music.volume);
    out.music = { files: mf, volume: (mv !== null) ? Math.max(0, Math.min(100, mv)) : 50, enabled: !!(raw.music && raw.music.enabled), default_file: safeName((raw.music && raw.music.default_file) || "mixkit-karma-1183.mp3") || "mixkit-karma-1183.mp3" };
    const sc = String(raw.scene || "").trim().toLowerCase();
    out.scene = ["brasilia", "sao-paulo", "rio-de-janeiro", "salvador", "tribunal", "festa-da-picanha", "pantano", "sala-de-controle-global", "usinas-aeolicas"].includes(sc) ? sc : "brasilia";
    const idr = (raw.idle && typeof raw.idle === "object") ? raw.idle : {};
    out.idle = {
      enabled: idr.enabled !== false,
      enter_after: (n(idr.enter_after) !== null) ? Math.max(3, Math.min(120, n(idr.enter_after))) : 10,
      interval: (n(idr.interval) !== null) ? Math.max(3, Math.min(60, n(idr.interval))) : 7,
    };
    const SUPPORT_KEYS = { nikolas: "flavio", "lucas-pavanato": "flavio", "ana-elisa": "lula", "erika-hilton": "lula" };
    out.supporters = {};
    if (raw.supporters && typeof raw.supporters === "object") {
      for (const key of Object.keys(SUPPORT_KEYS)) {
        const s = (raw.supporters[key] && typeof raw.supporters[key] === "object") ? raw.supporters[key] : {};
        out.supporters[key] = {
          enabled: s.enabled !== false,
          side: (s.side === "lula" || s.side === "flavio") ? s.side : SUPPORT_KEYS[key],
          gift_id: String(s.gift_id || "").trim().slice(0, 40),
          gift_name: String(s.gift_name || "").trim().slice(0, 80),
          damage: (n(s.damage) !== null) ? Math.max(1, Math.min(10000, n(s.damage))) : 30,
          audio: String(s.audio || "").trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80),
        };
      }
    }
    const gm = String(raw.game_mode || "").trim().toLowerCase();
    out.game_mode = gm === "timed" ? "timed" : (gm === "hp_new" ? "hp_new" : "hp");
    const nt = (v, lo, hi, fb) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fb; };
    out.round_time_s = nt(raw.round_time_s, 15, 3600, 180);
    out.round_result_delay_s = nt(raw.round_result_delay_s, 2, 120, 8);
    out.kick_combo_min = nt(raw.kick_combo_min, 2, 100, 5);
    out.uppercut_combo_min = nt(raw.uppercut_combo_min, 3, 1000, 20);
    out.damage_multiplier = nt(raw.damage_multiplier, 0.1, 100, 1);
    out.tap_target = nt(raw.tap_target, 10, 10000, 500);
    out.tap_damage = nt(raw.tap_damage, 1, 10000, 100);
    const rawSpec = (raw.special_attacks && typeof raw.special_attacks === "object") ? raw.special_attacks : {};
    out.special_attacks = {};
    for (const key of Object.keys(rawSpec)) {
      if (!/^[a-z0-9_]+$/.test(key)) continue;
      const s = rawSpec[key];
      if (!s || typeof s !== "object") { out.special_attacks[key] = {}; continue; }
      out.special_attacks[key] = {
        side: (s.side === "flavio" || s.side === "lula") ? s.side : "flavio",
        gift_id: String(s.gift_id || "").trim().slice(0, 40),
        gift_name: String(s.gift_name || "").trim().slice(0, 80),
        damage: nt(s.damage, 0, 100000, 0),
        sequence: String(s.sequence || "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 60),
        audio: String(s.audio || "").trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80),
        enabled: s.enabled !== false,
      };
    }
    const mkGift = (o, o2) => ({
      gift_id: String((o && o.gift_id) || (o2 && o2.gift_id) || "").trim().slice(0, 40),
      gift_name: String((o && o.gift_name) || (o2 && o.gift_name) || "").trim().slice(0, 80),
    });
    out.main_gifts = {
      flavio: mkGift(raw.main_gifts && raw.main_gifts.flavio),
      lula: mkGift(raw.main_gifts && raw.main_gifts.lula),
    };
    const mkExtra = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 20).map((x) => ({
      gift_id: String((x && x.gift_id) || "").trim().slice(0, 40),
      gift_name: String((x && x.gift_name) || "").trim().slice(0, 80),
      enabled: !!(x && x.enabled !== false),
      action: /^[a-z_]+$/.test(String((x && x.action) || "")) ? String(x.action) : "vote_only",
    })).filter((x) => x.gift_id || x.gift_name);
    out.extra_gifts = {
      flavio: mkExtra(raw.extra_gifts && raw.extra_gifts.flavio),
      lula: mkExtra(raw.extra_gifts && raw.extra_gifts.lula),
    };
    if (raw.layout && typeof raw.layout === "object") {
      const c = (o, name, def) => {
        const src = (o && o[name] && typeof o[name] === "object") ? o[name] : {};
        const num = (v, lo, hi, fb) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fb; };
        return {
          x: num(src.x, 0, 100, def.x),
          y: num(src.y, 0, 100, def.y),
          scale: num(src.scale, 0.2, 2, def.scale),
        };
      };
      const d = { score: { x: 50, y: 5, scale: 1 }, flavioHud: { x: 2, y: 14, scale: 1 }, lulaHud: { x: 98, y: 14, scale: 1 }, flavioGifts: { x: 2, y: 32, scale: 1 }, lulaGifts: { x: 98, y: 32, scale: 1 } };
      out.layout = {};
      for (const k of Object.keys(d)) out.layout[k] = c(raw.layout, k, d[k]);
      const f = (raw.layout.fighters && typeof raw.layout.fighters === "object") ? raw.layout.fighters : {};
      const fn = (v, lo, hi, fb) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fb; };
      out.layout.fighters = { y: fn(f.y, 0, 100, 20), scale: fn(f.scale, 0.2, 2, 0.9), gap: fn(f.gap, 0, 30, 9) };
    }
  }
  return out;
}

app.get("/api/duelo/config", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  const cfg = db.getDueloConfig(req.user.id);
  res.json({ success: true, gifts: dueloGiftsPayload(cfg.gifts), active: cfg.active, settings: dueloClientSettings(req.user.id, cfg.settings) });
});

app.post("/api/duelo/config", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  const gifts = normalizeDueloGifts(req.body && req.body.gifts);
  const settings = normalizeDueloSettings(req.body && req.body.settings);
  const active = !!(req.body && req.body.active);
  const cfg = db.saveDueloConfig(req.user.id, { gifts, active, settings });
  daemonSend({ cmd: "duelo_config", tenant_id: req.user.id, gifts, settings });
  broadcastToClients(getTenant(req.user.id).browserClients, { type: "duelo_gifts", gifts: dueloGiftsPayload(gifts) });
  broadcastToClients(getTenant(req.user.id).browserClients, { type: "duelo_layout", layout: settings.layout || {} });
  broadcastToClients(getTenant(req.user.id).browserClients, { type: "duelo_settings", settings: dueloClientSettings(req.user.id, settings) });
  res.json({ success: true, gifts: dueloGiftsPayload(cfg.gifts), active: cfg.active, settings: dueloClientSettings(req.user.id, cfg.settings) });
});

app.get("/api/duelo/state", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  const cfg = db.getDueloConfig(req.user.id);
  res.json({ success: true, gifts: dueloGiftsPayload(cfg.gifts), active: cfg.active, settings: dueloClientSettings(req.user.id, cfg.settings) });
});

app.post("/api/duelo/start", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  const tenant = getTenant(req.user.id);
  if (!liveOnline(tenant)) {
    return res.json({ success: false, error: "Live offline — conecte a live antes de iniciar o Duelo" });
  }
  const bodyGifts = Array.isArray(req.body && req.body.gifts) ? normalizeDueloGifts(req.body.gifts) : null;
  const bodySettings = (req.body && req.body.settings && typeof req.body.settings === "object") ? normalizeDueloSettings(req.body.settings) : null;
  const cfg = db.getDueloConfig(req.user.id);
  const gifts = bodyGifts || cfg.gifts || [];
  const settings = bodySettings || normalizeDueloSettings(cfg.settings);
  db.saveDueloConfig(req.user.id, { gifts, active: true, settings });
  const ok = daemonSend({ cmd: "duelo_start", tenant_id: req.user.id, gifts, settings });
  if (!ok) return res.json({ success: false, error: "Servico Python indisponivel" });
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
  const tenant = getTenant(req.user.id);
  const supporter = req.body && req.body.supporter;
  const special = req.body && req.body.special;
  const SUPPORT_KEYS = { nikolas: "flavio", "lucas-pavanato": "flavio", "ana-elisa": "lula", "erika-hilton": "lula" };
  const tCfgTest = db.getDueloConfig(req.user.id);
  const spAudioOf = (key) => String((tCfgTest.settings && tCfgTest.settings.special_attacks && tCfgTest.settings.special_attacks[key] && tCfgTest.settings.special_attacks[key].audio) || "").trim().replace(/[^a-zA-Z0-9._-]/g, "");
  if (special === "virou_jacare") {
    const aJac = spAudioOf("virou_jacare");
    broadcastToClients(tenant.browserClients, {
      type: "duelo_special",
      isTest: true,
      key: "virou_jacare",
      side: "flavio",
      defender: "lula",
      damage: 0,
      absorbed: 0,
      hp_damage: 0,
      sequence: "bolsonaro_jacare",
      audio_url: aJac ? `/duelo-audio/${req.user.id}/${aJac}` : "",
      user: "streamer",
      nickname: "Streamer",
    });
    return res.json({ success: true });
  }
  if (special === "chuva_picanha") {
    const aPica = spAudioOf("chuva_picanha");
    broadcastToClients(tenant.browserClients, {
      type: "duelo_special",
      isTest: true,
      key: "chuva_picanha",
      side: "lula",
      defender: "flavio",
      damage: 0,
      absorbed: 0,
      hp_damage: 0,
      sequence: "chuva_picanha",
      audio_url: aPica ? `/duelo-audio/${req.user.id}/${aPica}` : "",
      user: "streamer",
      nickname: "Streamer",
    });
    return res.json({ success: true });
  }
  if (supporter && SUPPORT_KEYS[supporter]) {
    const side = SUPPORT_KEYS[supporter];
    const tCfg = db.getDueloConfig(req.user.id);
    const supCfg = (tCfg.settings && tCfg.settings.supporters && tCfg.settings.supporters[supporter]) || {};
    const supAudio = String(supCfg.audio || "").trim().replace(/[^a-zA-Z0-9._-]/g, "");
    broadcastToClients(tenant.browserClients, {
      type: "duelo_support_attack",
      isTest: true,
      supporter,
      side,
      target: side === "flavio" ? "lula" : "flavio",
      damage: 0,
      combo: 1,
      final_damage: 0,
      absorbed: 0,
      hp_damage: 0,
      added_votes: 0,
      audio_url: supAudio ? `/duelo-audio/${req.user.id}/${supAudio}` : "",
      gift_id: "",
      gift_name: "",
      user: "streamer",
      nickname: "Streamer",
    });
    return res.json({ success: true });
  }
  const attacker = ["flavio", "lula"].includes(req.body && req.body.attacker) ? req.body.attacker : "flavio";
  const action = ["punch", "kick", "uppercut", "lowKick", "pulo"].includes(req.body && req.body.action) ? req.body.action : "punch";
  const combo = Math.max(1, parseInt((req.body && req.body.combo) || 1, 10) || 1);
  const cfg = db.getDueloConfig(req.user.id);
  const gift = (cfg.gifts || []).find((g) => g.character === attacker && g.action === action);
  let audio = (gift && gift.audio) ? String(gift.audio) : "";
  const DEFAULT_ACTION_AUDIO = { punch: "/duelo-audio/_system/soco-novo.mp3", kick: "/duelo-audio/_system/chute-novo.mp3", uppercut: "/duelo-audio/_system/levantada-novo.mp3", lowKick: "/duelo-audio/_system/chute-novo.mp3" };
  // Teste é SOMENTE visual: isTest true faz a arena ignorar as travas de winner/roundActive,
  // sem alterar HP, escudo, votos, winner ou roundActive (não passa pelo motor).
  broadcastToClients(tenant.browserClients, {
    type: "duelo_attack",
    isTest: true,
    attacker,
    action,
    combo,
    audio_url: audio ? `/duelo-audio/${req.user.id}/${audio}` : (DEFAULT_ACTION_AUDIO[action] || ""),
    gift: gift ? gift.name : "",
    user: "streamer",
    nickname: "Streamer",
  });
  res.json({ success: true });
});

app.post("/api/duelo/audio", auth.requireAuth, requireFeature("duelo"), (req, res) => {
  dueloUpload.single("file")(req, res, (err) => {
    if (err) {
      const msg = err && err.code === "LIMIT_FILE_SIZE"
        ? "Arquivo muito grande (máximo 8MB)"
        : ("Erro no upload: " + ((err && err.message) || "desconhecido"));
      return res.status(413).json({ success: false, error: msg });
    }
    if (!req.file) return res.status(400).json({ success: false, error: "Arquivo de audio obrigatorio (mp3/wav/ogg/m4a)" });
    res.json({ success: true, filename: req.file.filename, url: `/duelo-audio/${req.user.id}/${req.file.filename}` });
  });
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
  // Ao iniciar a live, a ÁREA do Duelo fica DESATIVADA por padrão;
  // só entra quando o operador clicar em "Ativar Área".
  dueloForceStop(user.id);
  res.json({ success: true, message: "Jogo iniciado" });
});

app.post("/stop-game", auth.requireAuth, (req, res) => {
  const ok = daemonSend({ cmd: "stop", tenant_id: req.user.id });
  if (!ok) {
    return res.json({ success: false, error: "Servico Python indisponivel" });
  }
  getTenant(req.user.id).sessionStarted = false;
  dueloForceStop(req.user.id); // desconectar live também desativa a Área do Duelo
  res.json({ success: true, message: "Jogo encerrado" });
});

function dueloForceStop(userId) {
  const cfg = db.getDueloConfig(userId);
  daemonSend({ cmd: "duelo_stop", tenant_id: userId });
  const saved = db.saveDueloConfig(userId, { gifts: cfg.gifts || [], active: false, settings: cfg.settings || {} });
  const st = Object.assign({ type: "duelo_state" }, dueloInitialState(Object.assign({}, saved, { active: false })));
  const tenant = getTenant(userId);
  broadcastToClients(tenant.browserClients, st);
  broadcastToClients(tenant.logClients, st);
}

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
    if (tenant.cacaState) {
      ws.send(JSON.stringify({ type: "caca_state", ...tenant.cacaState }));
    }
    if (tenant.tresState) {
      ws.send(JSON.stringify({ type: "tres_state", ...tenant.tresState }));
    }
    if (tenant.vpetState) {
      ws.send(JSON.stringify({ type: "vpet_state", ...tenant.vpetState }));
    }
    const dueloCfg = db.getDueloConfig(user.id);
    if (dueloCfg) {
      ws.send(JSON.stringify({ type: "duelo_state", ...(tenant.dueloState || dueloInitialState(dueloCfg)) }));
      ws.send(JSON.stringify({ type: "duelo_gifts", gifts: dueloGiftsPayload(dueloCfg.gifts) }));
    }
    return;
  }

  ws.close(1008, "rota invalida");
});
