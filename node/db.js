const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

const DEFAULT_SETTINGS = {
  apenas_seguidores: false,
  apenas_heart_me: false,
  pct_dica: 70,
  pct_charada: 30,
  tts_rate: 1.0,
  tts_voice: "",
  chat_narr_enabled: false,
  chat_narr_mode: "all",
  chat_narr_char: "#",
  command_prefix: "#",
  auto_round: false,
  auto_round_pause: 20,
  riddle_auto_narrate: true,
  tap_meta: 1000,
  boss_mode: true,
};

try {
  db.exec("ALTER TABLE tenant_gift_config ADD COLUMN sound_alerts TEXT DEFAULT '{}'");
} catch {}
try {
  db.exec("ALTER TABLE tenant_gift_config ADD COLUMN size_gift TEXT DEFAULT ''");
} catch {}
try {
  db.exec("ALTER TABLE tenant_gift_config ADD COLUMN letter_gift TEXT DEFAULT ''");
} catch {}
try {
  db.exec("ALTER TABLE tenant_gift_config ADD COLUMN tres_gifts TEXT DEFAULT '{}'");
} catch {}
try {
  db.exec("ALTER TABLE games ADD COLUMN room_id TEXT DEFAULT ''");
} catch {}
for (const col of [
  "subscription_id TEXT DEFAULT ''",
  "subscription_status TEXT DEFAULT 'active'",
  "plan_expires_at TEXT",
]) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch {}
}
try {
  db.exec("ALTER TABLE users ADD COLUMN features TEXT DEFAULT '{}'");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN command_prefix TEXT DEFAULT '#'");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN chat_narr_char TEXT DEFAULT '#'");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN auto_round INTEGER DEFAULT 0");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN auto_round_pause INTEGER DEFAULT 20");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN tap_meta INTEGER DEFAULT 1000");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN riddle_auto_narrate INTEGER DEFAULT 1");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN boss_mode INTEGER DEFAULT 1");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN likes_overlay_layout TEXT DEFAULT '{\"x\":0,\"y\":0,\"scale\":1}'");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN likes_overlay_v2_layout TEXT DEFAULT '{\"x\":0,\"y\":0,\"scale\":1}'");
} catch {}

// Catálogo de gifts sincronizado (DDL owner). Escrita: python/sync_gifts.py (único escritor).
db.exec(`
CREATE TABLE IF NOT EXISTS log_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  session_id TEXT,
  ts INTEGER NOT NULL,
  category TEXT,
  level TEXT,
  game TEXT,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_entries_tenant_id ON log_entries(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_log_entries_tenant_ts ON log_entries(tenant_id, ts);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS tenant_caca_config (
  tenant_id INTEGER PRIMARY KEY,
  prefix TEXT DEFAULT '',
  count INTEGER DEFAULT 10,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS gifts (
  gid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE,
  name TEXT NOT NULL,
  name_pt TEXT,
  diamond_count INTEGER DEFAULT 0,
  icon_url TEXT DEFAULT '',
  icon_local TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  first_seen INTEGER DEFAULT 0,
  last_seen INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gifts_name ON gifts(name);
CREATE TABLE IF NOT EXISTS gift_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_sync INTEGER DEFAULT 0,
  last_sync_result TEXT DEFAULT ''
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  plan TEXT NOT NULL DEFAULT 'free',
  tiktok_username TEXT NOT NULL DEFAULT '',
  tiktools_api_key TEXT NOT NULL DEFAULT '',
  room_code TEXT UNIQUE NOT NULL,
  features TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS registration_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  used_at TEXT,
  used_by INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS duelo_config (
  tenant_id INTEGER PRIMARY KEY,
  gifts TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS players (
  username TEXT PRIMARY KEY,
  nickname TEXT,
  avatar TEXT,
  total_guesses INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS games (
  game_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER,
  secret_word TEXT,
  winner TEXT,
  winner_nickname TEXT,
  winner_avatar TEXT,
  total_guesses INTEGER,
  played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  room_id TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id INTEGER PRIMARY KEY,
  apenas_seguidores INTEGER DEFAULT 0,
  apenas_heart_me INTEGER DEFAULT 0,
  pct_dica INTEGER DEFAULT 70,
  pct_charada INTEGER DEFAULT 30,
  tts_rate REAL DEFAULT 1.0,
  tts_voice TEXT DEFAULT '',
  chat_narr_enabled INTEGER DEFAULT 0,
  chat_narr_mode TEXT DEFAULT 'all',
  chat_narr_char TEXT DEFAULT '#',
  command_prefix TEXT DEFAULT '#',
  auto_round INTEGER DEFAULT 0,
  auto_round_pause INTEGER DEFAULT 20,
  riddle_auto_narrate INTEGER DEFAULT 1,
  tap_meta INTEGER DEFAULT 1000,
  boss_mode INTEGER DEFAULT 1,
  likes_overlay_layout TEXT DEFAULT '{"x":0,"y":0,"scale":1}',
  likes_overlay_v2_layout TEXT DEFAULT '{"x":0,"y":0,"scale":1}'
);
CREATE TABLE IF NOT EXISTS tenant_gift_config (
  tenant_id INTEGER PRIMARY KEY,
  hint_gifts TEXT DEFAULT '[]',
  riddle_gifts TEXT DEFAULT '[]',
  sound_alerts TEXT DEFAULT '{}',
  size_gift TEXT DEFAULT '',
  letter_gift TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tenant_history (
  tenant_id INTEGER PRIMARY KEY,
  last_id INTEGER DEFAULT 0,
  played_words TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS contextos (
  alvo TEXT PRIMARY KEY,
  gerado_em TEXT,
  ranking TEXT
);
CREATE TABLE IF NOT EXISTS batalha_players (
  tenant_id INTEGER,
  username TEXT,
  nickname TEXT,
  avatar TEXT,
  tap_wins INTEGER DEFAULT 0,
  coin_wins INTEGER DEFAULT 0,
  total_taps INTEGER DEFAULT 0,
  total_coins INTEGER DEFAULT 0,
  PRIMARY KEY (tenant_id, username)
);
CREATE TABLE IF NOT EXISTS batalha_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER,
  room_id TEXT DEFAULT '',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  duration_s INTEGER,
  winner_tap_user TEXT,
  winner_tap_nickname TEXT,
  winner_tap_avatar TEXT,
  winner_coin_user TEXT,
  winner_coin_nickname TEXT,
  winner_coin_avatar TEXT,
  total_taps INTEGER DEFAULT 0,
  total_coins INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS batalha_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER,
  tenant_id INTEGER,
  room_id TEXT DEFAULT '',
  username TEXT,
  nickname TEXT,
  avatar TEXT,
  taps INTEGER DEFAULT 0,
  coins INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS caca_palavras_encontradas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER,
  username TEXT,
  nickname TEXT,
  avatar TEXT,
  palavra TEXT,
  encontrada_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vpet_state (
  tenant_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  updated_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tres_acertos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER,
  username TEXT,
  nickname TEXT,
  avatar TEXT,
  pontos INTEGER DEFAULT 0,
  usou_multiplicador INTEGER DEFAULT 0,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS banned_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT UNIQUE NOT NULL
);
`);
db.exec(`
CREATE TABLE IF NOT EXISTS app_schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);
const likesOverlayDefaultMigration = "likes_overlay_default_top_left_v1";
if (!db.prepare("SELECT 1 FROM app_schema_migrations WHERE name = ?").get(likesOverlayDefaultMigration)) {
  // A rota de edição ainda não existia quando 50/50 era o default, então esse
  // literal legado representa o posicionamento inicial incorreto, não uma escolha.
  db.prepare(`
    UPDATE tenant_settings
    SET likes_overlay_layout = '{"x":0,"y":0,"scale":1}'
    WHERE likes_overlay_layout = '{"x":50,"y":50,"scale":1}'
  `).run();
  db.prepare("INSERT INTO app_schema_migrations (name) VALUES (?)").run(likesOverlayDefaultMigration);
}
try { db.exec("ALTER TABLE batalha_rounds ADD COLUMN room_id TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE batalha_interactions ADD COLUMN room_id TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN tiktok_engine TEXT NOT NULL DEFAULT 'tiktoklive'"); } catch {}

// ---------------- Suporte / Central de Ajuda (DDL) ----------------
// Tickets, sugestões, categorias, respostas rápidas e artigos de ajuda.
// Anexos NÃO ficam em public/: são gravados em node/data/support-files/<tenant>/
// (fora do versionamento) e entregues só por endpoint autenticado (routes/support.js).
db.exec(`
CREATE TABLE IF NOT EXISTS support_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS support_quick_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category_id INTEGER,
  game_id TEXT DEFAULT '',
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'novo',
  priority TEXT NOT NULL DEFAULT 'normal',
  source_article_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id, id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, id);
CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  sender_id INTEGER,
  sender_type TEXT NOT NULL DEFAULT 'user',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, id);
CREATE TABLE IF NOT EXISTS support_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  message_id INTEGER,
  file_path TEXT NOT NULL,
  mime_type TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_support_attachments_ticket ON support_attachments(ticket_id, id);
CREATE TABLE IF NOT EXISTS support_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'outro',
  game_id TEXT DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'recebida',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_support_suggestions_user ON support_suggestions(user_id, id);
CREATE INDEX IF NOT EXISTS idx_support_suggestions_status ON support_suggestions(status, id);
CREATE TABLE IF NOT EXISTS help_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS help_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER,
  game_id TEXT DEFAULT '',
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  summary TEXT DEFAULT '',
  content TEXT DEFAULT '',
  keywords TEXT DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_help_articles_category ON help_articles(category_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_help_articles_published ON help_articles(published, id);
`);

// ---------------- Monitor de Servidor (DDL) ----------------
// Incidentes (histórico/ack) e silêncios por chave de regra. Timestamps em epoch ms.
db.exec(`
CREATE TABLE IF NOT EXISTS monitor_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  title TEXT NOT NULL DEFAULT '',
  detail TEXT DEFAULT '',
  source TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  resolved_at INTEGER,
  ack_by INTEGER,
  ack_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_monitor_incidents_status ON monitor_incidents(status, last_seen);
CREATE INDEX IF NOT EXISTS idx_monitor_incidents_key ON monitor_incidents(key, status);
CREATE TABLE IF NOT EXISTS monitor_silences (
  key TEXT PRIMARY KEY,
  until INTEGER NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
`);

const CODE_CHARS = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeRoomCode(len = 8) {
  let code = "";
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return code;
}

function createUser({ email, name, password_hash, role = "user", plan = "free", tiktok_username = "", tiktools_api_key = "", tiktok_engine = "tiktoklive", features = {} }) {
  const code = makeRoomCode();
  const stmt = db.prepare(
    `INSERT INTO users (email, name, password_hash, role, plan, tiktok_username, tiktools_api_key, tiktok_engine, room_code, features)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(email, name, password_hash, role, plan, tiktok_username, tiktools_api_key, tiktok_engine, code, JSON.stringify(features || {}));
  return info.lastInsertRowid;
}

// ---------------- Convites de cadastro ----------------

function createInvite({ created_by = null, expires_in_days = 7 } = {}) {
  const token = crypto.randomBytes(18).toString("base64url");
  const expiresAt = expires_in_days > 0
    ? new Date(Date.now() + expires_in_days * 86400000).toISOString()
    : null;
  const info = db.prepare(
    "INSERT INTO registration_invites (token, created_by, expires_at, status) VALUES (?, ?, ?, 'active')"
  ).run(token, created_by, expiresAt);
  return { id: info.lastInsertRowid, token, expires_at: expiresAt };
}

function getInviteByToken(token) {
  return db.prepare("SELECT * FROM registration_invites WHERE token = ?").get(token);
}

function listInvites(limit = 100) {
  return db.prepare(
    `SELECT i.id, i.token, i.created_by, i.created_at, i.expires_at, i.used_at, i.status,
            u.email AS used_by_email
     FROM registration_invites i
     LEFT JOIN users u ON u.id = i.used_by
     ORDER BY i.created_at DESC
     LIMIT ?`
  ).all(limit);
}

function revokeInvite(id) {
  const info = db.prepare(
    "UPDATE registration_invites SET status = 'revoked' WHERE id = ? AND status = 'active'"
  ).run(id);
  return info.changes > 0;
}

function validateInvite(inv) {
  if (!inv) return { ok: false, error: "Este convite já foi utilizado ou expirou." };
  if (inv.status === "revoked") return { ok: false, error: "Este convite foi revogado." };
  if (inv.status === "used") return { ok: false, error: "Este convite já foi utilizado ou expirou." };
  if (inv.expires_at && inv.expires_at < new Date().toISOString()) {
    return { ok: false, error: "Este convite já foi utilizado ou expirou.", expired: true };
  }
  return { ok: true };
}

// CORDA: regras persistentes por tenant; partidas ativas permanecem efêmeras.
db.exec(`CREATE TABLE IF NOT EXISTS corda_config (
  tenant_id INTEGER PRIMARY KEY, config TEXT NOT NULL DEFAULT '{}'
)`);
function getCordaConfig(tenantId) {
  const row = db.prepare("SELECT config FROM corda_config WHERE tenant_id = ?").get(tenantId);
  try { return JSON.parse(row?.config || '{}'); } catch { return {}; }
}
function saveCordaConfig(tenantId, config) {
  db.prepare(`INSERT INTO corda_config (tenant_id, config) VALUES (?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET config=excluded.config`).run(tenantId, JSON.stringify(config));
  return getCordaConfig(tenantId);
}

// ---------------- Duelo 1x1 ----------------

function getDueloConfig(tenantId) {
  const row = db.prepare("SELECT gifts, active, settings FROM duelo_config WHERE tenant_id = ?").get(tenantId);
  if (!row) return { gifts: [], active: false, settings: {} };
  let gifts = [];
  let settings = {};
  try { gifts = JSON.parse(row.gifts || "[]"); } catch {}
  try { settings = JSON.parse(row.settings || "{}"); } catch {}
  return { gifts, active: !!row.active, settings };
}

function saveDueloConfig(tenantId, cfg) {
  const gifts = Array.isArray(cfg && cfg.gifts) ? cfg.gifts : [];
  const active = !!(cfg && cfg.active);
  const settings = (cfg && cfg.settings && typeof cfg.settings === "object") ? cfg.settings : {};
  db.prepare(`
    INSERT INTO duelo_config (tenant_id, gifts, active, settings)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      gifts=excluded.gifts,
      active=excluded.active,
      settings=excluded.settings
  `).run(tenantId, JSON.stringify(gifts), active ? 1 : 0, JSON.stringify(settings));
  return getDueloConfig(tenantId);
}

function registerWithInvite({ email, name, password_hash, token, role = "user" }) {
  const run = db.transaction(() => {
    const inv = getInviteByToken(token);
    const st = validateInvite(inv);
    if (!st.ok) {
      if (st.expired) {
        db.prepare("UPDATE registration_invites SET status = 'expired' WHERE id = ?").run(inv.id);
      }
      throw new Error(st.error);
    }
    const id = createUser({
      email,
      name,
      password_hash,
      role,
      plan: "free",
      features: { bichinho: false, duelo: false },
    });
    const consumed = db.prepare(
      "UPDATE registration_invites SET status = 'used', used_at = datetime('now'), used_by = ? WHERE token = ? AND status = 'active'"
    ).run(id, token);
    if (consumed.changes !== 1) {
      throw new Error("Este convite já foi utilizado ou expirou.");
    }
    return id;
  });
  return run();
}

function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).toLowerCase().trim());
}

function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function getUserByRoomCode(code) {
  return db.prepare("SELECT * FROM users WHERE room_code = ?").get(code);
}

function updateUser(id, fields) {
  const allowed = ["name", "password_hash", "role", "status", "plan", "tiktok_username", "tiktools_api_key", "tiktok_engine", "features"];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return false;
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => {
    if (k === "features") return typeof fields[k] === "string" ? fields[k] : JSON.stringify(fields[k] || {});
    return fields[k];
  });
  db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values, id);
  return true;
}

function listUsers() {
  return db.prepare("SELECT * FROM users ORDER BY id").all();
}

function countUsers() {
  return db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
}

function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
}

function publicUser(user) {
  if (!user) return null;
  const { password_hash, tiktools_api_key, features, ...rest } = user;
  let feats = {};
  if (features) {
    try { feats = typeof features === "string" ? JSON.parse(features) : (features || {}); } catch { feats = {}; }
  }
  return {
    ...rest,
    features: feats,
    tiktools_api_key: tiktools_api_key ? maskKey(tiktools_api_key) : "",
  };
}

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 6) return "******";
  return key.slice(0, 3) + "*****" + key.slice(-3);
}

// ---------------- Config por tenant (SQL) ----------------

function getTenantSettings(tenantId) {
  const row = db.prepare("SELECT * FROM tenant_settings WHERE tenant_id = ?").get(tenantId);
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    apenas_seguidores: !!row.apenas_seguidores,
    apenas_heart_me: !!row.apenas_heart_me,
    pct_dica: row.pct_dica,
    pct_charada: row.pct_charada,
    tts_rate: row.tts_rate,
    tts_voice: row.tts_voice,
    chat_narr_enabled: !!row.chat_narr_enabled,
    chat_narr_mode: row.chat_narr_mode,
    chat_narr_char: (row.chat_narr_char === null || row.chat_narr_char === undefined) ? "#" : row.chat_narr_char,
    command_prefix: (row.command_prefix === null || row.command_prefix === undefined) ? "#" : row.command_prefix,
    auto_round: !!row.auto_round,
    auto_round_pause: (row.auto_round_pause === null || row.auto_round_pause === undefined) ? 20 : row.auto_round_pause,
    riddle_auto_narrate: row.riddle_auto_narrate === 0 ? false : true,
    tap_meta: (row.tap_meta === null || row.tap_meta === undefined) ? 1000 : row.tap_meta,
    boss_mode: row.boss_mode === 0 ? false : true,
  };
}

function saveTenantSettings(tenantId, s) {
  db.prepare(`
    INSERT INTO tenant_settings (tenant_id, apenas_seguidores, apenas_heart_me, pct_dica, pct_charada, tts_rate, tts_voice, chat_narr_enabled, chat_narr_mode, chat_narr_char, command_prefix, auto_round, auto_round_pause, riddle_auto_narrate, tap_meta, boss_mode)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      apenas_seguidores=excluded.apenas_seguidores,
      apenas_heart_me=excluded.apenas_heart_me,
      pct_dica=excluded.pct_dica,
      pct_charada=excluded.pct_charada,
      tts_rate=excluded.tts_rate,
      tts_voice=excluded.tts_voice,
      chat_narr_enabled=excluded.chat_narr_enabled,
      chat_narr_mode=excluded.chat_narr_mode,
      chat_narr_char=excluded.chat_narr_char,
      command_prefix=excluded.command_prefix,
      auto_round=excluded.auto_round,
      auto_round_pause=excluded.auto_round_pause,
      riddle_auto_narrate=excluded.riddle_auto_narrate,
      tap_meta=excluded.tap_meta,
      boss_mode=excluded.boss_mode
  `).run(
    tenantId,
    s.apenas_seguidores ? 1 : 0,
    s.apenas_heart_me ? 1 : 0,
    s.pct_dica,
    s.pct_charada,
    s.tts_rate,
    s.tts_voice || "",
    s.chat_narr_enabled ? 1 : 0,
    s.chat_narr_mode || "all",
    (s.chat_narr_char === null || s.chat_narr_char === undefined) ? "#" : s.chat_narr_char,
    (s.command_prefix === null || s.command_prefix === undefined) ? "#" : s.command_prefix,
    s.auto_round ? 1 : 0,
    (s.auto_round_pause === null || s.auto_round_pause === undefined) ? 20 : s.auto_round_pause,
    s.riddle_auto_narrate === false ? 0 : 1,
    (s.tap_meta === null || s.tap_meta === undefined) ? 1000 : s.tap_meta,
    s.boss_mode === false ? 0 : 1
  );
}

const DEFAULT_LIKES_OVERLAY_LAYOUT = Object.freeze({ x: 0, y: 0, scale: 1 });

function likesOverlayLayoutColumn(version) {
  if (version === "v2") return "likes_overlay_v2_layout";
  if (version === "v3") return "likes_overlay_layout";
  throw new RangeError("Unsupported likes overlay version");
}

function getLikesOverlayLayout(tenantId, version = "v3") {
  const column = likesOverlayLayoutColumn(version);
  const row = db.prepare(`SELECT ${column} AS layout_json FROM tenant_settings WHERE tenant_id = ?`).get(tenantId);
  if (!row || !row.layout_json) return { ...DEFAULT_LIKES_OVERLAY_LAYOUT };
  try {
    const layout = JSON.parse(row.layout_json);
    if (
      layout && Number.isFinite(layout.x) && layout.x >= 0 && layout.x <= 100 &&
      Number.isFinite(layout.y) && layout.y >= 0 && layout.y <= 100 &&
      Number.isFinite(layout.scale) && layout.scale >= 0.5 && layout.scale <= 2
    ) {
      return { x: layout.x, y: layout.y, scale: layout.scale };
    }
  } catch {}
  return { ...DEFAULT_LIKES_OVERLAY_LAYOUT };
}

function saveLikesOverlayLayout(tenantId, version, layout) {
  const column = likesOverlayLayoutColumn(version);
  const value = JSON.stringify({ x: layout.x, y: layout.y, scale: layout.scale });
  db.prepare(`
    INSERT INTO tenant_settings (tenant_id, ${column}) VALUES (?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET ${column}=excluded.${column}
  `).run(tenantId, value);
  return { x: layout.x, y: layout.y, scale: layout.scale };
}

function getTenantGiftConfig(tenantId) {
  const row = db.prepare("SELECT hint_gifts, riddle_gifts, size_gift, letter_gift FROM tenant_gift_config WHERE tenant_id = ?").get(tenantId);
  if (!row) return { hint_gifts: [], riddle_gifts: [], size_gift: "", letter_gift: "" };
  let hg = [], rg = [];
  try { hg = JSON.parse(row.hint_gifts || "[]"); } catch {}
  try { rg = JSON.parse(row.riddle_gifts || "[]"); } catch {}
  return { hint_gifts: hg, riddle_gifts: rg, size_gift: row.size_gift || "", letter_gift: row.letter_gift || "" };
}

function saveTenantGiftConfig(tenantId, hint_gifts, riddle_gifts, size_gift, letter_gift) {
  db.prepare(`
    INSERT INTO tenant_gift_config (tenant_id, hint_gifts, riddle_gifts, size_gift, letter_gift)
    VALUES (?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET hint_gifts=excluded.hint_gifts, riddle_gifts=excluded.riddle_gifts, size_gift=excluded.size_gift, letter_gift=excluded.letter_gift
  `).run(tenantId, JSON.stringify(hint_gifts || []), JSON.stringify(riddle_gifts || []), String(size_gift || ""), String(letter_gift || ""));
}

function getCacaConfig(tenantId) {
  const row = db.prepare("SELECT prefix, count FROM tenant_caca_config WHERE tenant_id = ?").get(tenantId);
  if (!row) return { prefix: "", count: 10 };
  return { prefix: row.prefix || "", count: row.count || 10 };
}

function saveCacaConfig(tenantId, cfg) {
  const prefix = String((cfg && cfg.prefix != null) ? cfg.prefix : "").trim().slice(0, 8);
  const count = Math.max(4, Math.min(16, parseInt((cfg && cfg.count != null) ? cfg.count : 10, 10) || 10));
  db.prepare(`
    INSERT INTO tenant_caca_config (tenant_id, prefix, count)
    VALUES (?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET prefix=excluded.prefix, count=excluded.count, updated_at=CURRENT_TIMESTAMP
  `).run(tenantId, prefix, count);
  return { prefix, count };
}

function getTresGiftConfig(tenantId) {
  const row = db.prepare("SELECT tres_gifts FROM tenant_gift_config WHERE tenant_id = ?").get(tenantId);
  if (!row || !row.tres_gifts) return { size: "", letter: "", ticket: "", stage_times: [120, 60, 30], stage_points: [30, 20, 10] };
  try {
    const raw = JSON.parse(row.tres_gifts);
    return {
      size: String(raw.size || ""),
      letter: String(raw.letter || ""),
      ticket: String(raw.ticket || ""),
      stage_times: Array.isArray(raw.stage_times) ? raw.stage_times.map(Number) : [120, 60, 30],
      stage_points: Array.isArray(raw.stage_points) ? raw.stage_points.map(Number) : [30, 20, 10],
    };
  } catch {
    return { size: "", letter: "", ticket: "", stage_times: [120, 60, 30], stage_points: [30, 20, 10] };
  }
}

function saveTresGiftConfig(tenantId, config) {
  db.prepare(`
    INSERT INTO tenant_gift_config (tenant_id, tres_gifts)
    VALUES (?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET tres_gifts=excluded.tres_gifts
  `).run(tenantId, JSON.stringify({
    size: String((config && config.size) || ""),
    letter: String((config && config.letter) || ""),
    ticket: String((config && config.ticket) || ""),
    stage_times: Array.isArray(config && config.stage_times) ? config.stage_times.map(Number) : [120, 60, 30],
    stage_points: Array.isArray(config && config.stage_points) ? config.stage_points.map(Number) : [30, 20, 10],
  }));
}

function getSoundAlerts(tenantId) {
  const row = db.prepare("SELECT sound_alerts FROM tenant_gift_config WHERE tenant_id = ?").get(tenantId);
  if (!row || !row.sound_alerts) return {};
  try {
    const raw = JSON.parse(row.sound_alerts);
    const out = {};
    for (const [gift, val] of Object.entries(raw || {})) {
      if (typeof val === "string") out[gift] = { normal: val, combo: "" };
      else out[gift] = { normal: val.normal || "", combo: val.combo || "" };
    }
    return out;
  } catch { return {}; }
}

function saveSoundAlert(tenantId, gift, slot, url) {
  const cur = getSoundAlerts(tenantId);
  const entry = cur[gift] || { normal: "", combo: "" };
  if (slot === "combo") entry.combo = url || "";
  else entry.normal = url || "";
  if (!entry.normal && !entry.combo) delete cur[gift];
  else cur[gift] = entry;
  db.prepare(`
    INSERT INTO tenant_gift_config (tenant_id, hint_gifts, riddle_gifts, sound_alerts)
    VALUES (?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET sound_alerts=excluded.sound_alerts
  `).run(tenantId, "[]", "[]", JSON.stringify(cur));
}

// ---------------- Histórico / ranking (SQL) ----------------

function getTenantHistory(tenantId) {
  const row = db.prepare("SELECT last_id, played_words FROM tenant_history WHERE tenant_id = ?").get(tenantId);
  if (!row) return { last_id: 0, played_words: [] };
  let pw = [];
  try { pw = JSON.parse(row.played_words || "[]"); } catch {}
  return { last_id: row.last_id, played_words: pw };
}

function saveTenantHistory(tenantId, last_id, played_words) {
  db.prepare(`
    INSERT INTO tenant_history (tenant_id, last_id, played_words)
    VALUES (?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET last_id=excluded.last_id, played_words=excluded.played_words
  `).run(tenantId, last_id, JSON.stringify(played_words || []));
}

// ---------------- Logs persistidos (histórico por streamer) ----------------

// Retenção por idade e limite de volume por tenant (política de privacidade/operação).
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;   // 7 dias
const LOG_MAX_ROWS_PER_TENANT = 20000;              // teto duro por streamer
const LOG_PAGE_MAX = 200;                           // página máxima exposta

function appendLogEntry(tenantId, sessionId, entry) {
  const stmt = db.prepare(`
    INSERT INTO log_entries (tenant_id, session_id, ts, category, level, game, message)
    VALUES (?,?,?,?,?,?,?)
  `);
  const r = stmt.run(tenantId, sessionId || null, entry.ts, entry.category || null, entry.level || null, entry.game || null, entry.message || "");
  return {
    id: Number(r.lastInsertRowid),
    ts: entry.ts,
    category: entry.category || null,
    level: entry.level || null,
    game: entry.game || null,
    message: entry.message || "",
  };
}

function getLogEntries({ tenantId, before, since, limit, game, level }) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 100, 1), LOG_PAGE_MAX);
  const params = [];
  let where = "WHERE tenant_id = ?";
  params.push(tenantId);
  if (since) {
    params.push(Number(since));
    where += " AND ts >= ?";
  }
  if (before) {
    params.push(Number(before));
    where += " AND id < ?";
  }
  if (game) {
    params.push(String(game).slice(0, 32));
    where += " AND game = ?";
  }
  if (level) {
    params.push(String(level).slice(0, 16));
    where += " AND level = ?";
  }
  params.push(take);
  const rows = db.prepare(`
    SELECT id, tenant_id, ts, category, level, game, message
    FROM log_entries ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params);
  return rows.map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    ts: r.ts,
    timestamp: new Date(r.ts).toISOString(),
    category: r.category || null,
    level: r.level || null,
    game: r.game || null,
    message: r.message || "",
    text: r.message || "",
  }));
}

function pruneLogEntries() {
  // Por idade (global) e por teto de volume (por tenant), mantendo os mais recentes.
  const cutoff = Date.now() - LOG_RETENTION_MS;
  db.prepare("DELETE FROM log_entries WHERE ts < ?").run(cutoff);
  const tenants = db.prepare("SELECT DISTINCT tenant_id FROM log_entries").all();
  for (const t of tenants) {
    db.prepare(`
      DELETE FROM log_entries
      WHERE tenant_id = ?
        AND id NOT IN (SELECT id FROM log_entries WHERE tenant_id = ? ORDER BY id DESC LIMIT ?)
    `).run(t.tenant_id, t.tenant_id, LOG_MAX_ROWS_PER_TENANT);
  }
}

function getGames(tenantId, limit) {
  const rows = db.prepare(
    `SELECT game_id, secret_word, winner, winner_nickname, winner_avatar, total_guesses, played_at
     FROM games WHERE tenant_id = ? ORDER BY game_id DESC LIMIT ?`
  ).all(tenantId, limit || 1000);
  return rows.map(r => ({
    id: r.game_id,
    word: r.secret_word,
    winner: r.winner,
    nickname: r.winner_nickname,
    avatar: r.winner_avatar,
    guesses: r.total_guesses,
    time: r.played_at,
  })).reverse();
}

function getGamesPaged(tenantId, opts) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(opts.pageSize, 10) || 10));
  const search = String(opts.search || "").trim();
  let from = String(opts.from || "").trim();
  let to = String(opts.to || "").trim();
  if (from && !/T/.test(from)) from += "T00:00:00";
  if (to && !/T/.test(to)) to += "T23:59:59";
  const where = ["tenant_id = ?"];
  const params = [tenantId];
  if (search) {
    where.push("(winner LIKE ? OR winner_nickname LIKE ? OR secret_word LIKE ?)");
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (from) { where.push("played_at >= ?"); params.push(from); }
  if (to) { where.push("played_at <= ?"); params.push(to); }
  const w = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) c FROM games WHERE ${w}`).get(...params).c;
  const rows = db.prepare(
    `SELECT game_id, secret_word, winner, winner_nickname, winner_avatar, total_guesses, played_at
     FROM games WHERE ${w} ORDER BY game_id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);
  const items = rows.map(r => ({
    id: r.game_id,
    word: r.secret_word,
    winner: r.winner,
    nickname: r.winner_nickname,
    avatar: r.winner_avatar,
    guesses: r.total_guesses,
    time: r.played_at,
  }));
  return { items, total, page, pageSize };
}

function getWeeklyWins(tenantId, limit) {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7; // 0 = segunda
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day, 0, 0, 0, 0));
  const iso = start.toISOString().replace("T", " ").slice(0, 19);
  const rows = db.prepare(`
    SELECT w.winner, w.winner_nickname, w.winner_avatar, cnt.wins
    FROM (
      SELECT winner, winner_nickname, winner_avatar,
             ROW_NUMBER() OVER (PARTITION BY winner ORDER BY played_at DESC, game_id DESC) AS rn
      FROM games
      WHERE tenant_id = ? AND played_at >= ? AND winner IS NOT NULL AND winner != 'Ninguém'
    ) w
    JOIN (
      SELECT winner, COUNT(*) AS wins
      FROM games
      WHERE tenant_id = ? AND played_at >= ? AND winner IS NOT NULL AND winner != 'Ninguém'
      GROUP BY winner
    ) cnt ON cnt.winner = w.winner
    WHERE w.rn = 1
    ORDER BY cnt.wins DESC, w.winner ASC
    LIMIT ?
  `).all(tenantId, iso, tenantId, iso, limit || 10);
  return rows.map(r => ({ winner: r.winner, nickname: r.winner_nickname, avatar: r.winner_avatar, wins: r.wins }));
}

function getLiveWins(tenantId, roomId, limit) {
  if (!roomId) return [];
  const rows = db.prepare(`
    SELECT w.winner, w.winner_nickname, w.winner_avatar, cnt.wins
    FROM (
      SELECT winner, winner_nickname, winner_avatar,
             ROW_NUMBER() OVER (PARTITION BY winner ORDER BY played_at DESC, game_id DESC) AS rn
      FROM games
      WHERE tenant_id = ? AND room_id = ? AND winner IS NOT NULL AND winner != 'Ninguém'
    ) w
    JOIN (
      SELECT winner, COUNT(*) AS wins
      FROM games
      WHERE tenant_id = ? AND room_id = ? AND winner IS NOT NULL AND winner != 'Ninguém'
      GROUP BY winner
    ) cnt ON cnt.winner = w.winner
    WHERE w.rn = 1
    ORDER BY cnt.wins DESC, w.winner ASC
    LIMIT ?
  `).all(tenantId, roomId, tenantId, roomId, limit || 10);
  return rows.map(r => ({ winner: r.winner, nickname: r.winner_nickname, avatar: r.winner_avatar, wins: r.wins }));
}

// ---------------- Contextos (SQL) ----------------

function getContexto(alvo) {
  const row = db.prepare("SELECT ranking FROM contextos WHERE alvo = ?").get(alvo);
  if (!row) return null;
  try { return JSON.parse(row.ranking); } catch { return null; }
}

function saveContexto(alvo, gerado_em, ranking) {
  db.prepare(`
    INSERT INTO contextos (alvo, gerado_em, ranking) VALUES (?,?,?)
    ON CONFLICT(alvo) DO UPDATE SET gerado_em=excluded.gerado_em, ranking=excluded.ranking
  `).run(alvo, gerado_em, JSON.stringify(ranking));
}

function listContextos() {
  return db.prepare("SELECT alvo, gerado_em FROM contextos ORDER BY alvo").all();
}

// ---------------- Batalha (SQL) ----------------

function getBattlePlayers(tenantId, limit) {
  const rows = db.prepare(
    "SELECT username, nickname, avatar, tap_wins, coin_wins, total_taps, total_coins FROM batalha_players WHERE tenant_id = ?"
  ).all(tenantId);
  const fmt = (r) => ({ user: r.username, nickname: r.nickname, avatar: r.avatar, tap_wins: r.tap_wins, coin_wins: r.coin_wins, taps: r.total_taps, coins: r.total_coins });
  const data = rows.map(fmt);
  return {
    taps: data.filter(r => r.taps > 0).sort((a, b) => b.taps - a.taps).slice(0, limit || 5),
    coins: data.filter(r => r.coins > 0).sort((a, b) => b.coins - a.coins).slice(0, limit || 5),
  };
}

function resetBattle(tenantId) {
  for (const t of ["batalha_interactions", "batalha_rounds", "batalha_players"]) {
    db.prepare(`DELETE FROM ${t} WHERE tenant_id = ?`).run(tenantId);
  }
}

function localIsoWeekStart() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 0 = segunda (local)
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  const p = (n) => String(n).padStart(2, "0");
  return `${s.getFullYear()}-${p(s.getMonth() + 1)}-${p(s.getDate())} 00:00:00`;
}

function getBattleWeeklyWinners(tenantId, limit) {
  const iso = localIsoWeekStart();
  const rounds = db.prepare(
    `SELECT winner_tap_user, winner_tap_nickname, winner_tap_avatar, winner_coin_user, winner_coin_nickname, winner_coin_avatar
     FROM batalha_rounds WHERE tenant_id=? AND started_at>=? AND (winner_tap_user IS NOT NULL OR winner_coin_user IS NOT NULL)`
  ).all(tenantId, iso);
  const totals = {};
  for (const r of db.prepare(
    `SELECT username, nickname, avatar, SUM(taps) taps, SUM(coins) coins FROM batalha_interactions
     WHERE tenant_id=? AND round_id IN (SELECT id FROM batalha_rounds WHERE tenant_id=? AND started_at>=?)
     GROUP BY username`
  ).all(tenantId, tenantId, iso)) {
    totals[r.username] = { nickname: r.nickname, avatar: r.avatar, taps: r.taps, coins: r.coins };
  }
  const tw = {}, cw = {};
  for (const r of rounds) {
    if (r.winner_tap_user) { tw[r.winner_tap_user] = tw[r.winner_tap_user] || { nickname: r.winner_tap_nickname, avatar: r.winner_tap_avatar, wins: 0 }; tw[r.winner_tap_user].wins++; }
    if (r.winner_coin_user) { cw[r.winner_coin_user] = cw[r.winner_coin_user] || { nickname: r.winner_coin_nickname, avatar: r.winner_coin_avatar, wins: 0 }; cw[r.winner_coin_user].wins++; }
  }
  const mk = (map, totalKey) =>
    Object.entries(map).map(([u, w]) => ({
      user: u,
      nickname: w.nickname || (totals[u] && totals[u].nickname) || u,
      avatar: w.avatar || (totals[u] && totals[u].avatar) || "",
      wins: w.wins,
      total: (totals[u] && totals[u][totalKey]) || 0,
    })).sort((a, b) => b.wins - a.wins || b.total - a.total).slice(0, limit || 5);
  return { taps: mk(tw, "taps"), coins: mk(cw, "coins") };
}

// ---------------- Caça Palavras ----------------

function recordCacaFound(tenantId, username, nickname, avatar, palavra) {
  if (!tenantId || !username) return;
  db.prepare(
    `INSERT INTO caca_palavras_encontradas (tenant_id, username, nickname, avatar, palavra)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tenantId, username, nickname || username, avatar || "", palavra || "");
}

function getCacaWeekly(tenantId, limit) {
  const iso = localIsoWeekStart();
  const rows = db.prepare(
    `SELECT username, nickname, avatar, COUNT(*) cnt
     FROM caca_palavras_encontradas
     WHERE tenant_id = ? AND encontrada_em >= ?
     GROUP BY username
     ORDER BY cnt DESC
     LIMIT ?`
  ).all(tenantId, iso, limit || 10);
  return rows.map(r => ({
    user: r.username,
    nickname: r.nickname || r.username,
    avatar: r.avatar || "",
    words: r.cnt,
  }));
}

function getCacaTotal(tenantId) {
  return db.prepare("SELECT COUNT(*) c FROM caca_palavras_encontradas WHERE tenant_id = ?").get(tenantId).c;
}

function recordTresHit(tenantId, username, nickname, avatar, pontos, usouMultiplicador) {
  if (!tenantId || !username) return;
  db.prepare(
    `INSERT INTO tres_acertos (tenant_id, username, nickname, avatar, pontos, usou_multiplicador)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(tenantId, username, nickname || username, avatar || "", pontos || 0, usouMultiplicador ? 1 : 0);
}

function getTresWeekly(tenantId, limit) {
  const iso = localIsoWeekStart();
  const rows = db.prepare(
    `SELECT username, nickname, avatar, SUM(pontos) pts, COUNT(*) acertos
     FROM tres_acertos
     WHERE tenant_id = ? AND criado_em >= ?
     GROUP BY username
     ORDER BY pts DESC
     LIMIT ?`
  ).all(tenantId, iso, limit || 10);
  return rows.map(r => ({
    user: r.username,
    nickname: r.nickname || r.username,
    avatar: r.avatar || "",
    pontos: r.pts || 0,
    acertos: r.acertos || 0,
  }));
}

function getVpetState(tenantId) {
  const row = db.prepare("SELECT state FROM vpet_state WHERE tenant_id = ?").get(tenantId);
  if (!row || !row.state) return null;
  try { return JSON.parse(row.state); } catch { return null; }
}

function saveVpetState(tenantId, state) {
  db.prepare(
    `INSERT INTO vpet_state (tenant_id, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
  ).run(tenantId, JSON.stringify(state || {}), Date.now());
}


function getBattleHistory(tenantId, opts) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(opts.pageSize, 10) || 10));
  const search = String(opts.search || "").trim();
  let from = String(opts.from || "").trim();
  let to = String(opts.to || "").trim();
  if (from && !/T/.test(from)) from += "T00:00:00";
  if (to && !/T/.test(to)) to += "T23:59:59";
  const room = String(opts.room || "").trim();
  const where = ["tenant_id = ?"];
  const params = [tenantId];
  if (room) { where.push("room_id = ?"); params.push(room); }
  if (search) {
    where.push("(winner_tap_user LIKE ? OR winner_coin_user LIKE ? OR winner_tap_nickname LIKE ? OR winner_coin_nickname LIKE ?)");
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (from) { where.push("started_at >= ?"); params.push(from); }
  if (to) { where.push("started_at <= ?"); params.push(to); }
  const w = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) c FROM batalha_rounds WHERE ${w}`).get(...params).c;
  const items = db.prepare(
    `SELECT id, room_id, started_at, duration_s, winner_tap_user, winner_tap_nickname, winner_tap_avatar,
            winner_coin_user, winner_coin_nickname, winner_coin_avatar, total_taps, total_coins
     FROM batalha_rounds WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);
  return { items, total, page, pageSize };
}

function getBattleLiveRanking(tenantId, roomId, limit) {
  const rows = db.prepare(
    `SELECT username, nickname, avatar, SUM(taps) taps, SUM(coins) coins FROM batalha_interactions
     WHERE tenant_id=? AND room_id=? GROUP BY username`
  ).all(tenantId, roomId);
  const fmt = (r) => ({ user: r.username, nickname: r.nickname || r.username, avatar: r.avatar || "", taps: r.taps || 0, coins: r.coins || 0 });
  const data = rows.map(fmt);
  const lim = limit || 10;
  return {
    taps: data.filter(r => r.taps > 0).sort((a, b) => b.taps - a.taps).slice(0, lim),
    coins: data.filter(r => r.coins > 0).sort((a, b) => b.coins - a.coins).slice(0, lim),
  };
}

function getBattleReport(tenantId, roomId) {
  const w = "tenant_id = ? AND room_id = ?";
  const rounds = db.prepare(`SELECT * FROM batalha_rounds WHERE ${w} ORDER BY id`).all(tenantId, roomId);
  const stats = db.prepare(
    `SELECT COUNT(DISTINCT username) users, SUM(taps) taps, SUM(coins) coins FROM batalha_interactions WHERE ${w}`
  ).get(tenantId, roomId);
  const tapWins = {}, coinWins = {};
  for (const r of rounds) {
    if (r.winner_tap_user) { tapWins[r.winner_tap_user] = tapWins[r.winner_tap_user] || { nickname: r.winner_tap_nickname, avatar: r.winner_tap_avatar, wins: 0 }; tapWins[r.winner_tap_user].wins++; }
    if (r.winner_coin_user) { coinWins[r.winner_coin_user] = coinWins[r.winner_coin_user] || { nickname: r.winner_coin_nickname, avatar: r.winner_coin_avatar, wins: 0 }; coinWins[r.winner_coin_user].wins++; }
  }
  const mk = (map) => Object.entries(map).map(([u, v]) => ({ user: u, nickname: v.nickname || u, avatar: v.avatar || "", wins: v.wins })).sort((a, b) => b.wins - a.wins).slice(0, 5);
  return {
    room_id: roomId,
    battles: rounds.length,
    users: stats.users || 0,
    total_taps: stats.taps || 0,
    total_coins: stats.coins || 0,
    top_tap_winners: mk(tapWins),
    top_coin_winners: mk(coinWins),
  };
}

function tenantDataPath(tenantId) {
  const dir = path.join(__dirname, "data", String(tenantId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

// Palavras banidas (global, gerenciadas pelo admin super)
function getBannedWords() {
  const rows = db.prepare("SELECT word FROM banned_words ORDER BY word").all();
  return rows.map(r => r.word);
}

function saveBannedWords(words) {
  const clean = (Array.isArray(words) ? words : [])
    .map(w => String(w || "").trim())
    .filter(Boolean);
  const run = db.transaction((list) => {
    db.prepare("DELETE FROM banned_words").run();
    const ins = db.prepare("INSERT OR IGNORE INTO banned_words (word) VALUES (?)");
    for (const w of list) ins.run(w);
  });
  run(clean);
  return clean;
}

// ---------------- Catálogo de gifts (sincronizado) ----------------
// Leitura no node; a ESCRITA é feita exclusivamente pelo python (python/sync_gifts.py),
// evitando dois escritores concorrentes no mesmo SQLite.

function getGifts(opts = {}) {
  const onlyActive = opts.onlyActive !== false; // default: só ativos
  const sql = onlyActive
    ? "SELECT gid, id, name, name_pt, diamond_count, icon_url, icon_local, status, first_seen, last_seen FROM gifts WHERE status = 'active' ORDER BY diamond_count, name"
    : "SELECT gid, id, name, name_pt, diamond_count, icon_url, icon_local, status, first_seen, last_seen FROM gifts ORDER BY diamond_count, name";
  return db.prepare(sql).all();
}

function getGiftById(id) {
  if (id === null || id === undefined || String(id).trim() === "") return null;
  return db.prepare("SELECT gid, id, name, name_pt, diamond_count, icon_url, icon_local, status FROM gifts WHERE id = ?").get(String(id).trim()) || null;
}

function getGiftByName(name) {
  const n = String(name || "").trim();
  if (!n) return null;
  return db.prepare("SELECT gid, id, name, name_pt, diamond_count, icon_url, icon_local, status FROM gifts WHERE lower(name) = lower(?) OR (name_pt IS NOT NULL AND lower(name_pt) = lower(?)) LIMIT 1").get(n, n) || null;
}

// Resolve uma referência (ID ou nome EN/PT) para o ID canônico. Retorna "" se não achar.
function resolveGiftId(ref) {
  const r = String(ref || "").trim();
  if (!r) return "";
  const byId = getGiftById(r);
  if (byId && byId.id) return String(byId.id);
  const byName = getGiftByName(r);
  if (byName && byName.id) return String(byName.id);
  return "";
}

function getGiftMeta() {
  const row = db.prepare("SELECT last_sync, last_sync_result FROM gift_meta WHERE id = 1").get();
  return row || { last_sync: 0, last_sync_result: "" };
}

// Derivados (compat) — usados por /api/gift-tags e /api/gift-image-map.
function getGiftTagsDerived() {
  const rows = db.prepare("SELECT name, diamond_count FROM gifts WHERE status = 'active' AND name <> '' ORDER BY diamond_count, name").all();
  return rows.map(r => ({ name: r.name, diamond_count: r.diamond_count }));
}

function getGiftImageMapDerived() {
  // Mapa composto: `name -> arquivo` e `id -> arquivo` (páginas públicas podem receber ID ou nome).
  const rows = db.prepare("SELECT id, name, icon_local FROM gifts WHERE status = 'active' AND icon_local <> '' AND name <> ''").all();
  const out = {};
  for (const r of rows) {
    if (r.name) out[r.name] = r.icon_local;
    if (r.id) out[r.id] = r.icon_local;
  }
  return out;
}

// ---------------- Suporte / Central de Ajuda (funções) ----------------
// Enums validados no backend; game_id é sempre um slug conhecido (SUPPORT_GAME_SLUGS).
const SUPPORT_TICKET_STATUSES = ["novo", "em_atendimento", "aguardando_usuario", "resolvido", "fechado"];
const SUPPORT_TICKET_PRIORITIES = ["baixa", "normal", "alta", "urgente"];
const SUPPORT_SUGGESTION_TYPES = ["nova_funcionalidade", "melhoria", "novo_jogo", "melhoria_jogo", "interface", "integracao", "outro"];
const SUPPORT_SUGGESTION_STATUSES = ["recebida", "em_avaliacao", "planejada", "em_desenvolvimento", "implementada", "nao_planejada"];
const SUPPORT_SENDER_TYPES = ["user", "staff"];
const SUPPORT_GAME_SLUGS = ["palavra-secreta", "tres", "duelo", "caca", "batalha", "bichinho", "corda"];
const SUPPORT_GAME_LABELS = {
  "palavra-secreta": "Palavra Secreta",
  tres: "3 Dicas",
  duelo: "Duelo 1x1",
  caca: "Caça Palavras",
  batalha: "Batalha",
  bichinho: "Bichinho",
  corda: "CORDA",
};

function slugifySupport(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeSupportGameId(gameId) {
  const g = String(gameId || "").trim();
  return SUPPORT_GAME_SLUGS.includes(g) ? g : "";
}

function supportPageParams(page, pageSize, defSize = 20, maxSize = 100) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const s = Math.max(1, Math.min(maxSize, parseInt(pageSize, 10) || defSize));
  return { page: p, pageSize: s };
}

// ---- Categorias de chamado ----

function listSupportCategories({ activeOnly = true } = {}) {
  const sql = activeOnly
    ? "SELECT id, name, slug, icon, sort_order FROM support_categories WHERE active = 1 ORDER BY sort_order, name"
    : "SELECT id, name, slug, icon, sort_order, active FROM support_categories ORDER BY sort_order, name";
  return db.prepare(sql).all();
}

function getSupportCategoryById(id) {
  return db.prepare("SELECT * FROM support_categories WHERE id = ?").get(id) || null;
}

function saveSupportCategory({ id = null, name, slug, icon = "", sort_order = 0, active = true }) {
  const cleanName = String(name || "").trim();
  const cleanSlug = slugifySupport(slug || cleanName);
  if (!cleanName || !cleanSlug) return null;
  if (id) {
    db.prepare("UPDATE support_categories SET name=?, slug=?, icon=?, sort_order=?, active=? WHERE id=?")
      .run(cleanName, cleanSlug, String(icon || ""), parseInt(sort_order, 10) || 0, active ? 1 : 0, id);
    return getSupportCategoryById(id);
  }
  const info = db.prepare("INSERT INTO support_categories (name, slug, icon, sort_order, active) VALUES (?,?,?,?,?)")
    .run(cleanName, cleanSlug, String(icon || ""), parseInt(sort_order, 10) || 0, active ? 1 : 0);
  return getSupportCategoryById(info.lastInsertRowid);
}

function deleteSupportCategory(id) {
  return db.prepare("DELETE FROM support_categories WHERE id = ?").run(id).changes > 0;
}

// ---- Respostas rápidas (admin) ----

function listSupportQuickReplies({ activeOnly = false } = {}) {
  const sql = activeOnly
    ? "SELECT id, title, body, sort_order FROM support_quick_replies WHERE active = 1 ORDER BY sort_order, id"
    : "SELECT id, title, body, sort_order, active, created_at, updated_at FROM support_quick_replies ORDER BY sort_order, id";
  return db.prepare(sql).all();
}

function getSupportQuickReplyById(id) {
  return db.prepare("SELECT * FROM support_quick_replies WHERE id = ?").get(id) || null;
}

function saveSupportQuickReply({ id = null, title, body = "", sort_order = 0, active = true }) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return null;
  if (id) {
    db.prepare("UPDATE support_quick_replies SET title=?, body=?, sort_order=?, active=?, updated_at=datetime('now') WHERE id=?")
      .run(cleanTitle, String(body || ""), parseInt(sort_order, 10) || 0, active ? 1 : 0, id);
    return getSupportQuickReplyById(id);
  }
  const info = db.prepare("INSERT INTO support_quick_replies (title, body, sort_order, active) VALUES (?,?,?,?)")
    .run(cleanTitle, String(body || ""), parseInt(sort_order, 10) || 0, active ? 1 : 0);
  return getSupportQuickReplyById(info.lastInsertRowid);
}

function deleteSupportQuickReply(id) {
  return db.prepare("DELETE FROM support_quick_replies WHERE id = ?").run(id).changes > 0;
}

// ---- Chamados ----

function getSupportTicket(id) {
  return db.prepare(`
    SELECT t.*, c.name AS category_name, c.slug AS category_slug,
           u.name AS user_name, u.email AS user_email, u.tiktok_username AS user_tiktok
    FROM support_tickets t
    LEFT JOIN support_categories c ON c.id = t.category_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.id = ?
  `).get(id) || null;
}

function createSupportTicket({ user_id, category_id = null, game_id = "", subject, message, priority = "normal", source_article_id = null }) {
  const run = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO support_tickets (user_id, category_id, game_id, subject, status, priority, source_article_id, updated_at)
      VALUES (?, ?, ?, ?, 'novo', ?, ?, datetime('now'))
    `).run(user_id, category_id, String(game_id || ""), subject, priority, source_article_id);
    const ticketId = info.lastInsertRowid;
    const msg = String(message || "").trim();
    if (msg) {
      db.prepare("INSERT INTO support_messages (ticket_id, sender_id, sender_type, message) VALUES (?, ?, 'user', ?)")
        .run(ticketId, user_id, msg);
    }
    return ticketId;
  });
  return getSupportTicket(run());
}

function listSupportTicketsByUser(user_id, { status = "", page = 1, pageSize = 20 } = {}) {
  const p = supportPageParams(page, pageSize, 20, 100);
  const where = ["t.user_id = ?"];
  const params = [user_id];
  if (SUPPORT_TICKET_STATUSES.includes(status)) { where.push("t.status = ?"); params.push(status); }
  const w = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) c FROM support_tickets t WHERE ${w}`).get(...params).c;
  const items = db.prepare(`
    SELECT t.id, t.subject, t.status, t.priority, t.game_id, t.category_id, t.source_article_id,
           t.created_at, t.updated_at, t.closed_at, c.name AS category_name
    FROM support_tickets t
    LEFT JOIN support_categories c ON c.id = t.category_id
    WHERE ${w} ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?
  `).all(...params, p.pageSize, (p.page - 1) * p.pageSize);
  return { items, total, page: p.page, pageSize: p.pageSize };
}

function listAllSupportTickets({ status = "", category_id = null, game_id = "", priority = "", q = "", page = 1, pageSize = 20 } = {}) {
  const p = supportPageParams(page, pageSize, 20, 100);
  const where = [];
  const params = [];
  if (SUPPORT_TICKET_STATUSES.includes(status)) { where.push("t.status = ?"); params.push(status); }
  if (SUPPORT_TICKET_PRIORITIES.includes(priority)) { where.push("t.priority = ?"); params.push(priority); }
  const cid = parseInt(category_id, 10);
  if (Number.isFinite(cid) && cid > 0) { where.push("t.category_id = ?"); params.push(cid); }
  const g = normalizeSupportGameId(game_id);
  if (g) { where.push("t.game_id = ?"); params.push(g); }
  const term = String(q || "").trim();
  if (term) {
    where.push("(t.subject LIKE ? OR u.email LIKE ? OR u.name LIKE ?)");
    const like = `%${term}%`;
    params.push(like, like, like);
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = db.prepare(
    `SELECT COUNT(*) c FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id ${w}`
  ).get(...params).c;
  const items = db.prepare(`
    SELECT t.id, t.user_id, t.subject, t.status, t.priority, t.game_id, t.category_id, t.source_article_id,
           t.created_at, t.updated_at, t.closed_at,
           c.name AS category_name, u.name AS user_name, u.email AS user_email
    FROM support_tickets t
    LEFT JOIN support_categories c ON c.id = t.category_id
    LEFT JOIN users u ON u.id = t.user_id
    ${w} ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?
  `).all(...params, p.pageSize, (p.page - 1) * p.pageSize);
  return { items, total, page: p.page, pageSize: p.pageSize };
}

function listSupportTicketMessages(ticket_id) {
  return db.prepare(`
    SELECT m.id, m.ticket_id, m.sender_id, m.sender_type, m.message, m.created_at,
           u.name AS sender_name
    FROM support_messages m
    LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.ticket_id = ? ORDER BY m.id ASC
  `).all(ticket_id);
}

function addSupportMessage({ ticket_id, sender_id = null, sender_type = "user", message }) {
  const text = String(message || "").trim();
  if (!text) return null;
  const run = db.transaction(() => {
    const info = db.prepare("INSERT INTO support_messages (ticket_id, sender_id, sender_type, message) VALUES (?,?,?,?)")
      .run(ticket_id, sender_id, sender_type, text);
    db.prepare("UPDATE support_tickets SET updated_at = datetime('now') WHERE id = ?").run(ticket_id);
    return info.lastInsertRowid;
  });
  const id = run();
  return db.prepare(`
    SELECT m.id, m.ticket_id, m.sender_id, m.sender_type, m.message, m.created_at, u.name AS sender_name
    FROM support_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?
  `).get(id);
}

function setSupportTicketStatus(id, status) {
  if (!SUPPORT_TICKET_STATUSES.includes(status)) return null;
  const current = db.prepare("SELECT id FROM support_tickets WHERE id = ?").get(id);
  if (!current) return null;
  if (status === "fechado") {
    db.prepare("UPDATE support_tickets SET status = ?, closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(status, id);
  } else {
    // Qualquer transição que não seja "fechado" representa (re)abertura: limpa closed_at.
    db.prepare("UPDATE support_tickets SET status = ?, closed_at = NULL, updated_at = datetime('now') WHERE id = ?").run(status, id);
  }
  return getSupportTicket(id);
}

function countSupportTicketsByUser(user_id) {
  const rows = db.prepare("SELECT status, COUNT(*) c FROM support_tickets WHERE user_id = ? GROUP BY status").all(user_id);
  const out = {};
  for (const s of SUPPORT_TICKET_STATUSES) out[s] = 0;
  for (const r of rows) out[r.status] = r.c;
  return out;
}

function getSupportOverview() {
  const counts = {};
  for (const s of SUPPORT_TICKET_STATUSES) counts[s] = 0;
  for (const r of db.prepare("SELECT status, COUNT(*) c FROM support_tickets GROUP BY status").all()) {
    counts[r.status] = r.c;
  }
  const suggestions = {};
  for (const s of SUPPORT_SUGGESTION_STATUSES) suggestions[s] = 0;
  for (const r of db.prepare("SELECT status, COUNT(*) c FROM support_suggestions GROUP BY status").all()) {
    suggestions[r.status] = r.c;
  }
  const resolvedThisWeek = db.prepare(
    "SELECT COUNT(*) c FROM support_tickets WHERE status IN ('resolvido','fechado') AND COALESCE(closed_at, updated_at) >= datetime('now','-7 days')"
  ).get().c;
  return { tickets: counts, suggestions, resolved_this_week: resolvedThisWeek };
}

// ---- Anexos ----

function addSupportAttachment({ ticket_id, message_id = null, file_path, mime_type = "", size = 0 }) {
  const info = db.prepare("INSERT INTO support_attachments (ticket_id, message_id, file_path, mime_type, size) VALUES (?,?,?,?,?)")
    .run(ticket_id, message_id, file_path, String(mime_type || ""), parseInt(size, 10) || 0);
  db.prepare("UPDATE support_tickets SET updated_at = datetime('now') WHERE id = ?").run(ticket_id);
  return db.prepare("SELECT id, ticket_id, message_id, mime_type, size, created_at FROM support_attachments WHERE id = ?")
    .get(info.lastInsertRowid);
}

function listSupportAttachments(ticket_id) {
  return db.prepare(
    "SELECT id, ticket_id, message_id, mime_type, size, created_at FROM support_attachments WHERE ticket_id = ? ORDER BY id ASC"
  ).all(ticket_id);
}

function getSupportAttachment(id) {
  return db.prepare("SELECT * FROM support_attachments WHERE id = ?").get(id) || null;
}

// ---- Sugestões ----

function getSupportSuggestion(id) {
  return db.prepare(`
    SELECT s.*, u.name AS user_name, u.email AS user_email
    FROM support_suggestions s LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).get(id) || null;
}

function createSupportSuggestion({ user_id, type = "outro", game_id = "", title, description = "" }) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return null;
  const t = SUPPORT_SUGGESTION_TYPES.includes(type) ? type : "outro";
  const info = db.prepare("INSERT INTO support_suggestions (user_id, type, game_id, title, description) VALUES (?,?,?,?,?)")
    .run(user_id, t, normalizeSupportGameId(game_id), cleanTitle, String(description || "").trim());
  return getSupportSuggestion(info.lastInsertRowid);
}

function listSupportSuggestionsByUser(user_id, { status = "", page = 1, pageSize = 20 } = {}) {
  const p = supportPageParams(page, pageSize, 20, 100);
  const where = ["s.user_id = ?"];
  const params = [user_id];
  if (SUPPORT_SUGGESTION_STATUSES.includes(status)) { where.push("s.status = ?"); params.push(status); }
  const w = where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) c FROM support_suggestions s WHERE ${w}`).get(...params).c;
  const items = db.prepare(
    `SELECT s.id, s.type, s.game_id, s.title, s.description, s.status, s.created_at, s.updated_at
     FROM support_suggestions s WHERE ${w} ORDER BY s.id DESC LIMIT ? OFFSET ?`
  ).all(...params, p.pageSize, (p.page - 1) * p.pageSize);
  return { items, total, page: p.page, pageSize: p.pageSize };
}

function listAllSupportSuggestions({ status = "", type = "", game_id = "", q = "", page = 1, pageSize = 20 } = {}) {
  const p = supportPageParams(page, pageSize, 20, 100);
  const where = [];
  const params = [];
  if (SUPPORT_SUGGESTION_STATUSES.includes(status)) { where.push("s.status = ?"); params.push(status); }
  if (SUPPORT_SUGGESTION_TYPES.includes(type)) { where.push("s.type = ?"); params.push(type); }
  const g = normalizeSupportGameId(game_id);
  if (g) { where.push("s.game_id = ?"); params.push(g); }
  const term = String(q || "").trim();
  if (term) {
    where.push("(s.title LIKE ? OR s.description LIKE ? OR u.email LIKE ?)");
    const like = `%${term}%`;
    params.push(like, like, like);
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = db.prepare(
    `SELECT COUNT(*) c FROM support_suggestions s LEFT JOIN users u ON u.id = s.user_id ${w}`
  ).get(...params).c;
  const items = db.prepare(`
    SELECT s.id, s.user_id, s.type, s.game_id, s.title, s.description, s.status, s.created_at, s.updated_at,
           u.name AS user_name, u.email AS user_email
    FROM support_suggestions s LEFT JOIN users u ON u.id = s.user_id
    ${w} ORDER BY s.id DESC LIMIT ? OFFSET ?
  `).all(...params, p.pageSize, (p.page - 1) * p.pageSize);
  return { items, total, page: p.page, pageSize: p.pageSize };
}

function setSupportSuggestionStatus(id, status) {
  if (!SUPPORT_SUGGESTION_STATUSES.includes(status)) return null;
  const info = db.prepare("UPDATE support_suggestions SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  if (info.changes === 0) return null;
  return getSupportSuggestion(id);
}

// ---- Categorias da Central de Ajuda ----

function listHelpCategories({ activeOnly = true } = {}) {
  const sql = activeOnly
    ? "SELECT id, name, slug, icon, sort_order FROM help_categories WHERE active = 1 ORDER BY sort_order, name"
    : "SELECT id, name, slug, icon, sort_order, active FROM help_categories ORDER BY sort_order, name";
  return db.prepare(sql).all();
}

function getHelpCategoryById(id) {
  return db.prepare("SELECT * FROM help_categories WHERE id = ?").get(id) || null;
}

function saveHelpCategory({ id = null, name, slug, icon = "", sort_order = 0, active = true }) {
  const cleanName = String(name || "").trim();
  const cleanSlug = slugifySupport(slug || cleanName);
  if (!cleanName || !cleanSlug) return null;
  if (id) {
    db.prepare("UPDATE help_categories SET name=?, slug=?, icon=?, sort_order=?, active=? WHERE id=?")
      .run(cleanName, cleanSlug, String(icon || ""), parseInt(sort_order, 10) || 0, active ? 1 : 0, id);
    return getHelpCategoryById(id);
  }
  const info = db.prepare("INSERT INTO help_categories (name, slug, icon, sort_order, active) VALUES (?,?,?,?,?)")
    .run(cleanName, cleanSlug, String(icon || ""), parseInt(sort_order, 10) || 0, active ? 1 : 0);
  return getHelpCategoryById(info.lastInsertRowid);
}

function deleteHelpCategory(id) {
  return db.prepare("DELETE FROM help_categories WHERE id = ?").run(id).changes > 0;
}

// ---- Artigos da Central de Ajuda ----

function getHelpArticleById(id) {
  return db.prepare(`
    SELECT a.*, c.name AS category_name, c.slug AS category_slug
    FROM help_articles a LEFT JOIN help_categories c ON c.id = a.category_id
    WHERE a.id = ?
  `).get(id) || null;
}

function getHelpArticleBySlug(slug, { publishedOnly = true } = {}) {
  const where = publishedOnly ? "a.slug = ? AND a.published = 1" : "a.slug = ?";
  return db.prepare(`
    SELECT a.*, c.name AS category_name, c.slug AS category_slug
    FROM help_articles a LEFT JOIN help_categories c ON c.id = a.category_id
    WHERE ${where}
  `).get(String(slug || "")) || null;
}

function listHelpArticles({ category_id = null, game_id = "", q = "", published = null, page = 1, pageSize = 50 } = {}) {
  const p = supportPageParams(page, pageSize, 50, 200);
  const where = [];
  const params = [];
  if (published === true) where.push("a.published = 1");
  else if (published === false) where.push("a.published = 0");
  const cid = parseInt(category_id, 10);
  if (Number.isFinite(cid) && cid > 0) { where.push("a.category_id = ?"); params.push(cid); }
  const g = normalizeSupportGameId(game_id);
  if (g) { where.push("a.game_id = ?"); params.push(g); }
  const term = String(q || "").trim();
  if (term) {
    where.push("(a.title LIKE ? OR a.summary LIKE ? OR a.keywords LIKE ?)");
    const like = `%${term}%`;
    params.push(like, like, like);
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = db.prepare(`SELECT COUNT(*) c FROM help_articles a ${w}`).get(...params).c;
  const items = db.prepare(`
    SELECT a.id, a.category_id, a.game_id, a.title, a.slug, a.summary, a.keywords, a.published, a.sort_order,
           a.created_at, a.updated_at, c.name AS category_name, c.slug AS category_slug
    FROM help_articles a LEFT JOIN help_categories c ON c.id = a.category_id
    ${w} ORDER BY c.sort_order, a.sort_order, a.id LIMIT ? OFFSET ?
  `).all(...params, p.pageSize, (p.page - 1) * p.pageSize);
  return { items, total, page: p.page, pageSize: p.pageSize };
}

function saveHelpArticle({ id = null, category_id = null, game_id = "", title, slug, summary = "", content = "", keywords = "", published = false, sort_order = 0 }) {
  const cleanTitle = String(title || "").trim();
  const cleanSlug = slugifySupport(slug || cleanTitle);
  if (!cleanTitle || !cleanSlug) return null;
  const cid = parseInt(category_id, 10);
  const categoryId = Number.isFinite(cid) && cid > 0 ? cid : null;
  const g = normalizeSupportGameId(game_id);
  const pub = published ? 1 : 0;
  const order = parseInt(sort_order, 10) || 0;
  if (id) {
    db.prepare(`
      UPDATE help_articles
      SET category_id=?, game_id=?, title=?, slug=?, summary=?, content=?, keywords=?, published=?, sort_order=?, updated_at=datetime('now')
      WHERE id=?
    `).run(categoryId, g, cleanTitle, cleanSlug, String(summary || ""), String(content || ""), String(keywords || ""), pub, order, id);
    return getHelpArticleById(id);
  }
  const info = db.prepare(`
    INSERT INTO help_articles (category_id, game_id, title, slug, summary, content, keywords, published, sort_order, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
  `).run(categoryId, g, cleanTitle, cleanSlug, String(summary || ""), String(content || ""), String(keywords || ""), pub, order);
  return getHelpArticleById(info.lastInsertRowid);
}

function deleteHelpArticle(id) {
  return db.prepare("DELETE FROM help_articles WHERE id = ?").run(id).changes > 0;
}

// ---- Seed idempotente (categorias + respostas rápidas + artigos de exemplo) ----

function seedSupportData() {
  const supportCats = [
    ["Problema técnico", "problema-tecnico"],
    ["TikTok / Conexão", "tiktok-conexao"],
    ["Presentes", "presentes"],
    ["OBS / Overlay", "obs-overlay"],
    ["Jogos", "jogos"],
    ["Conta / Plano", "conta-plano"],
    ["Outro", "outro"],
  ];
  const helpCats = [
    ["Primeiros passos", "primeiros-passos", "🚀"],
    ["TikTok e conexão", "tiktok-e-conexao", "🔌"],
    ["OBS e transmissão", "obs-e-transmissao", "🖥️"],
    ["Jogos", "jogos", "🎮"],
    ["Presentes e interações", "presentes-e-interacoes", "🎁"],
    ["Conta e plano", "conta-e-plano", "👤"],
    ["Solução de problemas", "solucao-de-problemas", "🛠️"],
  ];
  const insSupportCat = db.prepare("INSERT OR IGNORE INTO support_categories (name, slug, sort_order, active) VALUES (?,?,?,1)");
  supportCats.forEach(([name, slug], i) => insSupportCat.run(name, slug, i));
  const insHelpCat = db.prepare("INSERT OR IGNORE INTO help_categories (name, slug, icon, sort_order, active) VALUES (?,?,?,?,1)");
  helpCats.forEach(([name, slug, icon], i) => insHelpCat.run(name, slug, icon, i));

  if (db.prepare("SELECT COUNT(*) c FROM support_quick_replies").get().c === 0) {
    const insQR = db.prepare("INSERT INTO support_quick_replies (title, body, sort_order) VALUES (?,?,?)");
    insQR.run("Recebemos seu chamado", "Olá! Recebemos seu chamado e já estamos verificando. Qualquer novidade, respondemos por aqui.", 0);
    insQR.run("Precisamos de mais detalhes", "Para investigar melhor, você poderia descrever o passo a passo e, se possível, enviar uma imagem do que está acontecendo?", 1);
    insQR.run("Problema resolvido", "Ótimo! Vamos considerar este chamado resolvido. Se precisar de algo, é só responder por aqui.", 2);
  }

  if (db.prepare("SELECT COUNT(*) c FROM help_articles").get().c === 0) {
    const catId = (slug) => {
      const row = db.prepare("SELECT id FROM help_categories WHERE slug = ?").get(slug);
      return row ? row.id : null;
    };
    const insArt = db.prepare(`
      INSERT INTO help_articles (category_id, game_id, title, slug, summary, content, keywords, published, sort_order)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    insArt.run(
      catId("primeiros-passos"), "", "Como começar no TikPlay", "como-comecar-no-tikplay",
      "Crie sua conta, acesse o painel e inicie sua primeira live.",
      "## Como fazer\n1. Crie sua conta em /register (é preciso ter um convite).\n2. Faça login e abra o Painel do streamer em /painel.\n3. Conecte sua live na aba Conectar Live.\n\n## O que deve acontecer\nO status da conexão fica Conectado e o público já pode interagir.",
      "primeiros passos, conta, painel, live", 1, 0
    );
    insArt.run(
      catId("tiktok-e-conexao"), "", "Conectar a live do TikTok", "conectar-a-live-do-tiktok",
      "Informe seu @ e escolha o motor de conexão para receber chat, curtidas e presentes.",
      "## Como fazer\n1. No painel, abra Conectar Live.\n2. Informe seu usuário do TikTok (sem o @).\n3. Escolha o motor TikTokLive (recomendado) ou Tik.Tools (requer API key).\n4. Clique em Conectar Live.\n\n## O que deve acontecer\nO estado fica Conectado e os eventos (chat, curtidas, presentes) começam a chegar.",
      "tiktok, conexão, live, chat, presentes", 1, 0
    );
    insArt.run(
      catId("obs-e-transmissao"), "", "Adicionar o TikPlay ao OBS", "adicionar-o-tikplay-ao-obs",
      "Use o link público do painel como fonte de Navegador no OBS.",
      "## Como fazer\n1. No painel, copie o Link público do jogo desejado.\n2. No OBS, adicione uma fonte de Navegador.\n3. Cole o link (ex.: /jogo?room=SEUCODIGO&tk=...).\n\n## O que deve acontecer\nA tela do jogo aparece no OBS e acompanha a live sem pedir login.",
      "obs, overlay, fonte de navegador, transmissão", 1, 0
    );
    insArt.run(
      catId("presentes-e-interacoes"), "palavra-secreta", "Presentes não ativam ações", "presentes-nao-ativam-acoes",
      "Confira se o presente configurado é o mesmo que está sendo enviado na live.",
      "## Como fazer\n1. Abra o jogo no painel (ex.: Palavra Secreta).\n2. Verifique os presentes configurados (nome ou ID).\n3. Faça um teste pelo botão de teste do presente.\n\n## O que deve acontecer\nAo enviar o presente, a ação correspondente dispara na tela.\n\n## Problemas comuns\n- Presente com nome repetido e ID diferente: confirme o ID correto no catálogo.",
      "presentes, gifts, interações, palavra secreta", 1, 0
    );
    insArt.run(
      catId("solucao-de-problemas"), "duelo", "Jogo não inicia", "jogo-nao-inicia",
      "Os jogos só iniciam com a live conectada.",
      "## Como fazer\n1. Confirme que a live está Conectado no painel.\n2. Confirme que a funcionalidade do jogo está liberada para sua conta.\n3. Clique em Iniciar.\n\n## O que deve acontecer\nA partida inicia e o estado é exibido no painel e nas telas públicas.",
      "jogo, iniciar, duelo, live, conexão", 1, 0
    );
    insArt.run(
      catId("conta-e-plano"), "", "Planos e limites", "planos-e-limites",
      "Entenda os planos Free e Pro e o que cada um libera.",
      "## Como fazer\n1. Abra Assinatura no painel.\n2. Compare os planos disponíveis.\n\n## O que deve acontecer\nO plano ativo e a validade aparecem na sua conta.",
      "conta, plano, assinatura, limites", 0, 0
    );
  }
}

seedSupportData();

// ---------------- Monitor de Servidor (funções) ----------------
// Incidentes: no máximo UM aberto/reconhecido por `key` (regra "sem duplicatas").
// `acknowledged` é apenas um marcador de leitura — continua resolvível pelo motor
// quando a condição volta ao normal. Silêncios apenas suprimem eventos visíveis;
// não apagam o histórico já persistido.

const MONITOR_INCIDENT_ACTIVE = "('open','acknowledged')";

function getActiveMonitorIncidentByKey(key) {
  return db.prepare(
    `SELECT * FROM monitor_incidents WHERE key = ? AND status IN ${MONITOR_INCIDENT_ACTIVE} ORDER BY id DESC LIMIT 1`
  ).get(String(key)) || null;
}

function getMonitorIncidentById(id) {
  return db.prepare("SELECT * FROM monitor_incidents WHERE id = ?").get(id) || null;
}

function openMonitorIncident({ key, severity = "warning", title = "", detail = "", source = "", ts }) {
  const now = Number(ts) || Date.now();
  const info = db.prepare(`
    INSERT INTO monitor_incidents (key, severity, title, detail, source, status, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(String(key), severity, String(title || ""), String(detail || ""), String(source || ""), now, now);
  return getMonitorIncidentById(info.lastInsertRowid);
}

function touchMonitorIncident(id, { severity, detail, ts } = {}) {
  const now = Number(ts) || Date.now();
  const current = getMonitorIncidentById(id);
  if (!current) return null;
  db.prepare("UPDATE monitor_incidents SET severity = ?, detail = ?, last_seen = ? WHERE id = ?")
    .run(severity || current.severity, detail != null ? String(detail) : current.detail, now, id);
  return getMonitorIncidentById(id);
}

function resolveMonitorIncident(id, ts) {
  const now = Number(ts) || Date.now();
  const info = db.prepare(
    `UPDATE monitor_incidents SET status = 'resolved', resolved_at = ?, last_seen = ? WHERE id = ? AND status IN ${MONITOR_INCIDENT_ACTIVE}`
  ).run(now, now, id);
  return info.changes > 0 ? getMonitorIncidentById(id) : null;
}

function ackMonitorIncident(id, adminId, ts) {
  const now = Number(ts) || Date.now();
  const current = getMonitorIncidentById(id);
  if (!current || current.status !== "open") return null;
  db.prepare("UPDATE monitor_incidents SET status = 'acknowledged', ack_by = ?, ack_at = ? WHERE id = ?")
    .run(adminId, now, id);
  return getMonitorIncidentById(id);
}

function listMonitorIncidents({ status = "all", limit = 100 } = {}) {
  const take = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
  if (status === "open") {
    return db.prepare(
      `SELECT * FROM monitor_incidents WHERE status IN ${MONITOR_INCIDENT_ACTIVE} ORDER BY last_seen DESC LIMIT ?`
    ).all(take);
  }
  if (["open", "acknowledged", "resolved"].includes(status)) {
    return db.prepare("SELECT * FROM monitor_incidents WHERE status = ? ORDER BY last_seen DESC LIMIT ?").all(status, take);
  }
  return db.prepare("SELECT * FROM monitor_incidents ORDER BY last_seen DESC LIMIT ?").all(take);
}

function countActiveMonitorIncidents() {
  return db.prepare(`SELECT COUNT(*) c FROM monitor_incidents WHERE status IN ${MONITOR_INCIDENT_ACTIVE}`).get().c;
}

function setMonitorSilence(key, until, createdBy) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO monitor_silences (key, until, created_by, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET until = excluded.until, created_by = excluded.created_by, created_at = excluded.created_at
  `).run(String(key), Number(until) || now, createdBy || null, now);
  return getMonitorSilence(key);
}

function getMonitorSilence(key) {
  return db.prepare("SELECT * FROM monitor_silences WHERE key = ?").get(String(key)) || null;
}

function deleteMonitorSilence(key) {
  return db.prepare("DELETE FROM monitor_silences WHERE key = ?").run(String(key)).changes > 0;
}

function listMonitorSilences({ activeOnly = true } = {}) {
  if (activeOnly) {
    return db.prepare("SELECT * FROM monitor_silences WHERE until > ? ORDER BY until DESC").all(Date.now());
  }
  return db.prepare("SELECT * FROM monitor_silences ORDER BY until DESC").all();
}

function pruneMonitorSilences() {
  return db.prepare("DELETE FROM monitor_silences WHERE until <= ?").run(Date.now()).changes;
}

// Contadores de plataforma para o monitor (usuários, planos, jogos, chamados).
function getMonitorPlatformStats() {
  const users = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const usersActive = db.prepare("SELECT COUNT(*) c FROM users WHERE status = 'active'").get().c;
  const newToday = db.prepare("SELECT COUNT(*) c FROM users WHERE date(created_at) = date('now')").get().c;
  const plans = {};
  for (const r of db.prepare("SELECT plan, COUNT(*) c FROM users GROUP BY plan").all()) plans[r.plan || "free"] = r.c;
  let gamesTotal = 0, gamesToday = 0;
  try { gamesTotal = db.prepare("SELECT COUNT(*) c FROM games").get().c; } catch {}
  try { gamesToday = db.prepare("SELECT COUNT(*) c FROM games WHERE date(played_at) = date('now')").get().c; } catch {}
  let openTickets = 0;
  try {
    openTickets = db.prepare("SELECT COUNT(*) c FROM support_tickets WHERE status IN ('novo','em_atendimento','aguardando_usuario')").get().c;
  } catch {}
  return { users_total: users, users_active: usersActive, new_users_today: newToday, plans, games_total: gamesTotal, games_today: gamesToday, open_tickets: openTickets };
}

module.exports = {
  db,
  DEFAULT_SETTINGS,
  getGifts,
  getGiftById,
  getGiftByName,
  resolveGiftId,
  getGiftMeta,
  getGiftTagsDerived,
  getGiftImageMapDerived,
  createUser,
  createInvite,
  getInviteByToken,
  listInvites,
  revokeInvite,
  validateInvite,
  registerWithInvite,
  getCordaConfig,
  saveCordaConfig,
  getDueloConfig,
  saveDueloConfig,
  getUserByEmail,
  getUserById,
  getUserByRoomCode,
  updateUser,
  listUsers,
  countUsers,
  countAdmins,
  publicUser,
  getTenantSettings,
  saveTenantSettings,
  getLikesOverlayLayout,
  saveLikesOverlayLayout,
  getTenantGiftConfig,
  saveTenantGiftConfig,
  getTresGiftConfig,
  saveTresGiftConfig,
  getCacaConfig,
  saveCacaConfig,
  getSoundAlerts,
  saveSoundAlert,
  getTenantHistory,
  saveTenantHistory,
  appendLogEntry,
  getLogEntries,
  pruneLogEntries,
  LOG_RETENTION_MS,
  LOG_MAX_ROWS_PER_TENANT,
  LOG_PAGE_MAX,
  getGames,
  getGamesPaged,
  getWeeklyWins,
  getLiveWins,
  getContexto,
  saveContexto,
  listContextos,
  getBattlePlayers,
  resetBattle,
  getBattleWeeklyWinners,
  getBattleHistory,
  getBattleReport,
  getBattleLiveRanking,
  recordCacaFound,
  getCacaWeekly,
  getCacaTotal,
  recordTresHit,
  getTresWeekly,
  getVpetState,
  saveVpetState,
  getBannedWords,
  saveBannedWords,
  tenantDataPath,
  readJsonFile,
  // Suporte / Central de Ajuda
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_SUGGESTION_TYPES,
  SUPPORT_SUGGESTION_STATUSES,
  SUPPORT_SENDER_TYPES,
  SUPPORT_GAME_SLUGS,
  SUPPORT_GAME_LABELS,
  slugifySupport,
  listSupportCategories,
  getSupportCategoryById,
  saveSupportCategory,
  deleteSupportCategory,
  listSupportQuickReplies,
  getSupportQuickReplyById,
  saveSupportQuickReply,
  deleteSupportQuickReply,
  getSupportTicket,
  createSupportTicket,
  listSupportTicketsByUser,
  listAllSupportTickets,
  listSupportTicketMessages,
  addSupportMessage,
  setSupportTicketStatus,
  countSupportTicketsByUser,
  getSupportOverview,
  addSupportAttachment,
  listSupportAttachments,
  getSupportAttachment,
  getSupportSuggestion,
  createSupportSuggestion,
  listSupportSuggestionsByUser,
  listAllSupportSuggestions,
  setSupportSuggestionStatus,
  listHelpCategories,
  getHelpCategoryById,
  saveHelpCategory,
  deleteHelpCategory,
  getHelpArticleById,
  getHelpArticleBySlug,
  listHelpArticles,
  saveHelpArticle,
  deleteHelpArticle,
  seedSupportData,
  // Monitor de Servidor
  getActiveMonitorIncidentByKey,
  getMonitorIncidentById,
  openMonitorIncident,
  touchMonitorIncident,
  resolveMonitorIncident,
  ackMonitorIncident,
  listMonitorIncidents,
  countActiveMonitorIncidents,
  setMonitorSilence,
  getMonitorSilence,
  deleteMonitorSilence,
  listMonitorSilences,
  pruneMonitorSilences,
  getMonitorPlatformStats,
};
