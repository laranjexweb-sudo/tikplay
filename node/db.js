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
  tts_volume: 1.0,
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
  db.exec("ALTER TABLE tenant_settings ADD COLUMN tts_volume REAL DEFAULT 1.0");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN boss_mode INTEGER DEFAULT 1");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN likes_overlay_layout TEXT DEFAULT '{\"x\":0,\"y\":0,\"scale\":1,\"count\":5}'");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN likes_overlay_v2_layout TEXT DEFAULT '{\"x\":0,\"y\":0,\"scale\":1,\"count\":5}'");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN presenter_level_overlay_layout TEXT DEFAULT '{\"x\":50,\"y\":50,\"scale\":1}'");
} catch {}
try {
  db.exec("ALTER TABLE tenant_settings ADD COLUMN gift_ranking_overlay_layout TEXT DEFAULT NULL");
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
  event TEXT,
  source TEXT,
  code TEXT,
  trace_id TEXT,
  game_id TEXT,
  duration_ms INTEGER,
  details TEXT,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_entries_tenant_id ON log_entries(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_log_entries_tenant_ts ON log_entries(tenant_id, ts);
`);
for (const [column, type] of [
  ["event", "TEXT"], ["source", "TEXT"], ["code", "TEXT"], ["trace_id", "TEXT"],
  ["game_id", "TEXT"], ["duration_ms", "INTEGER"], ["details", "TEXT"],
]) {
  try { db.exec(`ALTER TABLE log_entries ADD COLUMN ${column} ${type}`); } catch {}
}
db.exec("CREATE INDEX IF NOT EXISTS idx_log_entries_tenant_trace ON log_entries(tenant_id, trace_id, id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_log_entries_tenant_session_game ON log_entries(tenant_id, session_id, game_id, id)");
// Interações por live (relatórios do streamer). Node é o único escritor (ingestão em lote).
db.exec(`
CREATE TABLE IF NOT EXISTS live_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  room_id TEXT NOT NULL,
  engine TEXT DEFAULT '',
  username TEXT DEFAULT '',
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_sessions_room ON live_sessions(tenant_id, room_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_tenant ON live_sessions(tenant_id, started_at);

CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  room_id TEXT DEFAULT '',
  session_id INTEGER,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  user_id TEXT DEFAULT '',
  username TEXT DEFAULT '',
  nickname TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  value INTEGER DEFAULT 0,
  meta TEXT DEFAULT '',
  event_id TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_interactions_tenant_ts ON interactions(tenant_id, ts);
CREATE INDEX IF NOT EXISTS idx_interactions_tenant_room_type ON interactions(tenant_id, room_id, type, ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_event ON interactions(tenant_id, event_id) WHERE event_id <> '';

CREATE TABLE IF NOT EXISTS interaction_aggregates (
  tenant_id INTEGER NOT NULL,
  room_id TEXT NOT NULL DEFAULT '',
  bucket_minute INTEGER NOT NULL,
  type TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  value_sum INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, room_id, bucket_minute, type, user_id)
);
CREATE INDEX IF NOT EXISTS idx_interaction_agg_tenant ON interaction_aggregates(tenant_id, bucket_minute);

-- Níveis por usuário (presenteador = pay_grade; membro = fã-clube).
-- viewer_levels: o que o backend "sabe" do usuário (global).
-- live_viewer_levels: baseline capturado na 1ª aparição do usuário na live.
CREATE TABLE IF NOT EXISTS viewer_levels (
  tenant_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  nickname TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  gifter_level INTEGER DEFAULT 0,
  gifter_grade TEXT DEFAULT '',
  fan_club_level INTEGER DEFAULT 0,
  fan_club_name TEXT DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE IF NOT EXISTS live_viewer_levels (
  tenant_id INTEGER NOT NULL,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  nickname TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  gifter_level INTEGER DEFAULT 0,
  fan_club_level INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, room_id, user_id)
);

-- Subidas de nível por live/eixo (presenteador|fanclub). Armazenamento dedicado,
-- com retenção maior que os detalhes de interactions (agregados históricos).
CREATE TABLE IF NOT EXISTS level_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  room_id TEXT DEFAULT '',
  session_id INTEGER,
  user_id TEXT DEFAULT '',
  username TEXT DEFAULT '',
  nickname TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  axis TEXT NOT NULL,
  level_before INTEGER,
  level_after INTEGER NOT NULL,
  event_id TEXT DEFAULT '',
  ts INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_level_ups_reached
  ON level_ups(tenant_id, room_id, user_id, axis, level_after);
DROP INDEX IF EXISTS idx_level_ups_event;
CREATE UNIQUE INDEX IF NOT EXISTS idx_level_ups_event_axis
  ON level_ups(tenant_id, room_id, user_id, axis, event_id) WHERE event_id <> '';
CREATE INDEX IF NOT EXISTS idx_level_ups_tenant_ts ON level_ups(tenant_id, ts);
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
  tts_volume REAL DEFAULT 1.0,
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
  likes_overlay_layout TEXT DEFAULT '{"x":0,"y":0,"scale":1,"count":5}',
  likes_overlay_v2_layout TEXT DEFAULT '{"x":0,"y":0,"scale":1,"count":5}',
  presenter_level_overlay_layout TEXT DEFAULT '{"x":50,"y":50,"scale":1}',
  gift_ranking_overlay_layout TEXT DEFAULT NULL
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
CREATE TABLE IF NOT EXISTS word_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  word_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'geral',
  difficulty TEXT NOT NULL DEFAULT 'media' CHECK (difficulty IN ('facil','media','dificil')),
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('active','review','inactive')),
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_word_catalog_status ON word_catalog(status, category, difficulty, id);
CREATE TABLE IF NOT EXISTS word_cycles (
  tenant_id INTEGER PRIMARY KEY,
  current_cycle INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS word_cycle_migrations (
  tenant_id INTEGER PRIMARY KEY,
  migrated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS word_usage (
  tenant_id INTEGER NOT NULL,
  cycle_id INTEGER NOT NULL,
  word_key TEXT NOT NULL,
  word TEXT NOT NULL,
  game_id INTEGER,
  game_type TEXT NOT NULL DEFAULT 'palavra',
  source TEXT NOT NULL DEFAULT 'draw',
  used_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, cycle_id, word_key)
);
CREATE INDEX IF NOT EXISTS idx_word_usage_tenant_time ON word_usage(tenant_id, used_at DESC);
CREATE INDEX IF NOT EXISTS idx_word_usage_word ON word_usage(word_key, used_at DESC);
CREATE TABLE IF NOT EXISTS word_draw_settings (
  tenant_id INTEGER PRIMARY KEY,
  categories TEXT NOT NULL DEFAULT '[]',
  difficulties TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
function normalizeCatalogWord(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}
try {
  const initialWords = readJsonFile(path.join(__dirname, '..', 'python', 'words.json'), []);
  const seedWord = db.prepare("INSERT OR IGNORE INTO word_catalog(word,word_key,category,difficulty,status,source) VALUES(?,?, 'geral','media','active','words.json')");
  const seedWords = db.transaction((words) => {
    for (const word of words) {
      const text = String(word || '').trim();
      const key = normalizeCatalogWord(text);
      if (text && key) seedWord.run(text, key);
    }
  });
  seedWords(Array.isArray(initialWords) ? initialWords : []);
} catch (error) {
  console.error('[word-catalog] seed failed:', error && error.name || 'Error');
}
try {
  const pendingHistory = db.prepare(`SELECT h.tenant_id,h.played_words FROM tenant_history h
    LEFT JOIN word_cycle_migrations m ON m.tenant_id=h.tenant_id WHERE m.tenant_id IS NULL`).all();
  const migrateLegacyWordUsage = db.transaction((rows) => {
    const addUsage = db.prepare("INSERT OR IGNORE INTO word_usage(tenant_id,cycle_id,word_key,word,source) VALUES(?,1,?,?,'legacy')");
    const mark = db.prepare('INSERT OR IGNORE INTO word_cycle_migrations(tenant_id) VALUES(?)');
    const addCycle = db.prepare('INSERT OR IGNORE INTO word_cycles(tenant_id,current_cycle) VALUES(?,1)');
    for (const row of rows) {
      let words = []; try { const parsed = JSON.parse(row.played_words || '[]'); words = Array.isArray(parsed) ? parsed : []; } catch {}
      addCycle.run(row.tenant_id);
      for (const word of words) if (typeof word === 'string' && word.trim())
        addUsage.run(row.tenant_id, normalizeCatalogWord(word), word.trim());
      mark.run(row.tenant_id);
    }
  });
  migrateLegacyWordUsage(pendingHistory);
} catch (error) {
  console.error('[word-catalog] history migration failed:', error && error.name || 'Error');
}
db.exec(`
CREATE TABLE IF NOT EXISTS app_schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);
try { db.exec("ALTER TABLE word_usage ADD COLUMN game_type TEXT NOT NULL DEFAULT 'palavra'"); } catch {}
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
    tts_volume: row.tts_volume === null || row.tts_volume === undefined ? 1.0 : row.tts_volume,
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
    INSERT INTO tenant_settings (tenant_id, apenas_seguidores, apenas_heart_me, pct_dica, pct_charada, tts_rate, tts_volume, tts_voice, chat_narr_enabled, chat_narr_mode, chat_narr_char, command_prefix, auto_round, auto_round_pause, riddle_auto_narrate, tap_meta, boss_mode)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      apenas_seguidores=excluded.apenas_seguidores,
      apenas_heart_me=excluded.apenas_heart_me,
      pct_dica=excluded.pct_dica,
      pct_charada=excluded.pct_charada,
      tts_rate=excluded.tts_rate,
      tts_volume=excluded.tts_volume,
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
    s.tts_volume === undefined ? 1.0 : s.tts_volume,
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

// Opções validadas (sem CSS arbitrário). Aditivas ao contrato x/y/scale/count.
const LIKES_OVERLAY_OPTIONS = Object.freeze({
  photo_position: ["left", "right", "top", "bottom"],
  shadow: ["none", "soft", "medium", "strong"],
  animation: ["float", "rise", "pop", "sway"],
  heart_colors_max: 5,
});
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_LIKES_OVERLAY_LAYOUT = Object.freeze({
  x: 0, y: 0, scale: 1, count: 5,
  photo_position: "left", font_color: "#ffffff", shadow: "soft",
  animation: "float", heart_colors: ["#ff4d6d"],
});
const DEFAULT_PRESENTER_LEVEL_OVERLAY_LAYOUT = Object.freeze({ x: 50, y: 50, scale: 1 });
const DEFAULT_GIFT_RANKING_OVERLAY_LAYOUT = Object.freeze({ x: 0, y: 0, scale: 1, count: 10 });

function normalizeGiftRankingOverlayLayout(layout, strict = false) {
  const value = (layout && typeof layout === "object" && !Array.isArray(layout)) ? layout : {};
  const defaults = DEFAULT_GIFT_RANKING_OVERLAY_LAYOUT;
  return {
    x: pickNumber(value.x, defaults.x, 0, 100, strict, "x"),
    y: pickNumber(value.y, defaults.y, 0, 100, strict, "y"),
    scale: pickNumber(value.scale, defaults.scale, 0.5, 2, strict, "scale"),
    count: Math.round(pickNumber(value.count, defaults.count, 1, 10, strict, "count")),
  };
}

function getGiftRankingOverlayLayout(tenantId) {
  const row = db.prepare("SELECT gift_ranking_overlay_layout AS layout_json FROM tenant_settings WHERE tenant_id = ?").get(tenantId);
  if (!row || !row.layout_json) return { ...DEFAULT_GIFT_RANKING_OVERLAY_LAYOUT };
  try { return normalizeGiftRankingOverlayLayout(JSON.parse(row.layout_json)); } catch {}
  return { ...DEFAULT_GIFT_RANKING_OVERLAY_LAYOUT };
}

function hasGiftRankingOverlayLayout(tenantId) {
  const row = db.prepare("SELECT gift_ranking_overlay_layout AS layout_json FROM tenant_settings WHERE tenant_id = ?").get(tenantId);
  return Boolean(row && row.layout_json);
}

function saveGiftRankingOverlayLayout(tenantId, layout) {
  const normalized = normalizeGiftRankingOverlayLayout(layout, true);
  db.prepare(`
    INSERT INTO tenant_settings (tenant_id, gift_ranking_overlay_layout) VALUES (?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET gift_ranking_overlay_layout=excluded.gift_ranking_overlay_layout
  `).run(tenantId, JSON.stringify(normalized));
  return normalized;
}

function normalizePresenterLevelOverlayLayout(layout, strict = false) {
  const value = (layout && typeof layout === "object" && !Array.isArray(layout)) ? layout : {};
  const defaults = DEFAULT_PRESENTER_LEVEL_OVERLAY_LAYOUT;
  return {
    x: pickNumber(value.x, defaults.x, 0, 100, strict, "x"),
    y: pickNumber(value.y, defaults.y, 0, 100, strict, "y"),
    scale: pickNumber(value.scale, defaults.scale, 0.5, 2, strict, "scale"),
  };
}

function getPresenterLevelOverlayLayout(tenantId) {
  const row = db.prepare("SELECT presenter_level_overlay_layout AS layout_json FROM tenant_settings WHERE tenant_id = ?").get(tenantId);
  if (!row || !row.layout_json) return { ...DEFAULT_PRESENTER_LEVEL_OVERLAY_LAYOUT };
  try { return normalizePresenterLevelOverlayLayout(JSON.parse(row.layout_json)); } catch {}
  return { ...DEFAULT_PRESENTER_LEVEL_OVERLAY_LAYOUT };
}

function savePresenterLevelOverlayLayout(tenantId, layout) {
  const normalized = normalizePresenterLevelOverlayLayout(layout, true);
  db.prepare(`
    INSERT INTO tenant_settings (tenant_id, presenter_level_overlay_layout) VALUES (?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET presenter_level_overlay_layout=excluded.presenter_level_overlay_layout
  `).run(tenantId, JSON.stringify(normalized));
  return normalized;
}

function likesOverlayLayoutColumn(version) {
  if (version === "v2") return "likes_overlay_v2_layout";
  if (version === "v3") return "likes_overlay_layout";
  throw new RangeError("Unsupported likes overlay version");
}

function isHexColor(v) {
  return typeof v === "string" && HEX_COLOR_RE.test(v);
}

function pickNumber(value, def, min, max, strict, label) {
  if (value === undefined || value === null) return def;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    if (strict) throw new Error(`${label} fora do intervalo permitido`);
    return def;
  }
  return n;
}

function pickEnum(value, allowed, def, strict, label) {
  if (value === undefined || value === null) return def;
  if (allowed.includes(value)) return value;
  if (strict) throw new Error(`${label} inválido`);
  return def;
}

function pickColor(value, def, strict, label) {
  if (value === undefined || value === null) return def;
  if (isHexColor(value)) return value;
  if (strict) throw new Error(`${label} deve ser hexadecimal #rrggbb`);
  return def;
}

function pickColors(value, def, strict) {
  if (value === undefined || value === null) return [...def];
  if (!Array.isArray(value)) {
    if (strict) throw new Error("heart_colors deve ser uma lista");
    return [...def];
  }
  const valid = value.filter(isHexColor).slice(0, LIKES_OVERLAY_OPTIONS.heart_colors_max);
  if (!valid.length) {
    if (strict) throw new Error("heart_colors inválido");
    return [...def];
  }
  if (strict && valid.length !== value.length) throw new Error("heart_colors contém cores inválidas");
  return valid;
}

// Valida/normaliza o layout. Campos ausentes recebem default (compatibilidade);
// com `strict = true` (POST) valores inválidos lançam erro (resposta 400).
function normalizeLikesOverlayLayout(layout, strict = false) {
  const l = (layout && typeof layout === "object" && !Array.isArray(layout)) ? layout : {};
  const D = DEFAULT_LIKES_OVERLAY_LAYOUT;
  return {
    x: pickNumber(l.x, D.x, 0, 100, strict, "x"),
    y: pickNumber(l.y, D.y, 0, 100, strict, "y"),
    scale: pickNumber(l.scale, D.scale, 0.5, 2, strict, "scale"),
    count: Math.round(pickNumber(l.count, D.count, 1, 10, strict, "count")),
    photo_position: pickEnum(l.photo_position, LIKES_OVERLAY_OPTIONS.photo_position, D.photo_position, strict, "photo_position"),
    font_color: pickColor(l.font_color, D.font_color, strict, "font_color"),
    shadow: pickEnum(l.shadow, LIKES_OVERLAY_OPTIONS.shadow, D.shadow, strict, "shadow"),
    animation: pickEnum(l.animation, LIKES_OVERLAY_OPTIONS.animation, D.animation, strict, "animation"),
    heart_colors: pickColors(l.heart_colors, D.heart_colors, strict),
  };
}

function defaultLikesOverlayLayout() {
  return normalizeLikesOverlayLayout({}, false);
}

function getLikesOverlayLayout(tenantId, version = "v3") {
  const column = likesOverlayLayoutColumn(version);
  const row = db.prepare(`SELECT ${column} AS layout_json FROM tenant_settings WHERE tenant_id = ?`).get(tenantId);
  if (!row || !row.layout_json) return defaultLikesOverlayLayout();
  try {
    return normalizeLikesOverlayLayout(JSON.parse(row.layout_json), false);
  } catch {}
  return defaultLikesOverlayLayout();
}

function saveLikesOverlayLayout(tenantId, version, layout) {
  const column = likesOverlayLayoutColumn(version);
  const normalized = normalizeLikesOverlayLayout(layout, true);
  db.prepare(`
    INSERT INTO tenant_settings (tenant_id, ${column}) VALUES (?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET ${column}=excluded.${column}
  `).run(tenantId, JSON.stringify(normalized));
  return normalized;
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
    INSERT INTO log_entries
      (tenant_id, session_id, ts, category, level, game, event, source, code, trace_id, game_id, duration_ms, details, message)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const r = stmt.run(
    tenantId, sessionId || null, entry.ts, entry.category || null, entry.level || null, entry.game || null,
    entry.event || null, entry.source || null, entry.code || null, entry.trace_id || null,
    entry.game_id || null, entry.duration_ms == null ? null : entry.duration_ms,
    entry.details || null, entry.message || "",
  );
  return {
    id: Number(r.lastInsertRowid),
    ts: entry.ts,
    session_id: sessionId || null,
    category: entry.category || null,
    level: entry.level || null,
    game: entry.game || null,
    event: entry.event || null,
    source: entry.source || null,
    code: entry.code || null,
    trace_id: entry.trace_id || null,
    game_id: entry.game_id || null,
    duration_ms: entry.duration_ms == null ? null : entry.duration_ms,
    details: entry.details || null,
    message: entry.message || "",
  };
}

function getLogEntries({ tenantId, before, since, limit, game, level, category, event, trace_id, session_id, game_id, source, code }) {
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
  if (category) {
    params.push(String(category).slice(0, 24));
    where += " AND category = ?";
  }
  if (event) {
    params.push(String(event).slice(0, 96));
    where += " AND event = ?";
  }
  if (trace_id) {
    params.push(String(trace_id).slice(0, 128));
    where += " AND trace_id = ?";
  }
  if (session_id) {
    params.push(String(session_id).slice(0, 128));
    where += " AND session_id = ?";
  }
  if (game_id) {
    params.push(String(game_id).slice(0, 128));
    where += " AND game_id = ?";
  }
  if (source) {
    params.push(String(source).slice(0, 32));
    where += " AND source = ?";
  }
  if (code) {
    params.push(String(code).slice(0, 64));
    where += " AND code = ?";
  }
  params.push(take);
  const rows = db.prepare(`
    SELECT id, tenant_id, session_id, ts, category, level, game, event, source, code,
           trace_id, game_id, duration_ms, details, message
    FROM log_entries ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params);
  return rows.map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    session_id: r.session_id || null,
    ts: r.ts,
    timestamp: new Date(r.ts).toISOString(),
    category: r.category || null,
    level: r.level || null,
    game: r.game || null,
    event: r.event || null,
    source: r.source || null,
    code: r.code || null,
    trace_id: r.trace_id || null,
    game_id: r.game_id || null,
    duration_ms: r.duration_ms == null ? null : r.duration_ms,
    details: r.details || null,
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

function redactLegacyLogMessages(redactText) {
  const migrationName = "log_entries_sensitive_text_redaction_v1";
  if (db.prepare("SELECT 1 FROM app_schema_migrations WHERE name = ?").get(migrationName)) return 0;
  const rows = db.prepare(`
    SELECT id, message FROM log_entries
    WHERE message LIKE ? OR message LIKE ? OR message LIKE ? OR message LIKE ?
       OR message LIKE ? OR message LIKE ? OR message LIKE ?
       OR message LIKE ? OR message LIKE ? OR message LIKE ? OR message LIKE ?
  `).all(
    "%Palavra secreta:%", "%Palavra:%", "%Charada:%", "%palavra era %",
    "[3 Dicas] Dica %", "[3 Dicas]%acertou %", "[Guess]%", "[Access]%",
    "[TTS]%para:%", "[Bichinho] Streamer falou:%", "[CacaPalavras]%",
  );
  const update = db.prepare("UPDATE log_entries SET message = ? WHERE id = ?");
  let changed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const safe = String(redactText(row.message) || "");
      if (safe !== row.message) {
        update.run(safe, row.id);
        changed++;
      }
    }
    db.prepare("INSERT INTO app_schema_migrations(name) VALUES (?)").run(migrationName);
  })();
  return changed;
}

function normalizeLegacyLogEntries(normalizeLog) {
  const migrationName = "log_entries_canonical_categories_v1";
  if (db.prepare("SELECT 1 FROM app_schema_migrations WHERE name = ?").get(migrationName)) return 0;
  const rows = db.prepare(`
    SELECT id, category, level, game, event, source, message
    FROM log_entries
  `).all();
  const update = db.prepare(`
    UPDATE log_entries SET category = ?, level = ?, game = ?, event = ?, source = ? WHERE id = ?
  `);
  let changed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const item = { text: row.message || "", level: row.level, game: row.game,
        event: row.event, source: row.source };
      if (row.category && row.category !== "system") item.category = row.category;
      const normalized = normalizeLog(item);
      const next = {
        category: normalized.category || "system",
        level: normalized.level || "unknown",
        game: normalized.game || null,
        event: row.event || normalized.event || "legacy.message",
        source: row.source || "legacy",
      };
      if (next.category !== (row.category || null) || next.level !== (row.level || null) ||
          next.game !== (row.game || null) || next.event !== (row.event || null) || next.source !== (row.source || null)) {
        update.run(next.category, next.level, next.game, next.event, next.source, row.id);
        changed++;
      }
    }
    db.prepare("INSERT INTO app_schema_migrations(name) VALUES (?)").run(migrationName);
  })();
  return changed;
}

// ---------------- Interações por live (relatórios) ----------------

// Abre/reaproveita a sessão da sala atual e encerra a sessão anterior de outra sala.
function openLiveSession({ tenant_id, room_id, engine = "", username = "", ts }) {
  const t = Number(ts) || Date.now();
  const rid = String(room_id || "");
  db.prepare("UPDATE live_sessions SET ended_at = ? WHERE tenant_id = ? AND ended_at IS NULL AND room_id <> ?")
    .run(t, tenant_id, rid);
  const existing = db.prepare("SELECT id, ended_at FROM live_sessions WHERE tenant_id = ? AND room_id = ?").get(tenant_id, rid);
  if (existing) {
    // Reconexão na MESMA sala: reabre se estava encerrada, preservando started_at.
    if (existing.ended_at) db.prepare("UPDATE live_sessions SET ended_at = NULL WHERE id = ?").run(existing.id);
    return existing.id;
  }
  const info = db.prepare(
    "INSERT INTO live_sessions (tenant_id, room_id, engine, username, started_at, ended_at) VALUES (?,?,?,?,?,NULL)"
  ).run(tenant_id, rid, String(engine || ""), String(username || ""), t);
  return Number(info.lastInsertRowid);
}

function getLiveSessions(tenantId, { from, to, limit } = {}) {
  const where = ["tenant_id = ?"];
  const args = [tenantId];
  if (from != null) { where.push("started_at >= ?"); args.push(from); }
  if (to != null) { where.push("started_at <= ?"); args.push(to); }
  const lim = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
  args.push(lim);
  return db.prepare(
    `SELECT id, room_id, engine, username, started_at, ended_at FROM live_sessions
     WHERE ${where.join(" AND ")} ORDER BY started_at DESC LIMIT ?`
  ).all(...args);
}

// Ingestão em lote: detalhe + agregados por (tenant, sala, minuto, tipo, usuário).
// Deduplica por event_id (quando presente) via índice único parcial + INSERT OR IGNORE.
// Os agregados contam SOMENTE as linhas efetivamente inseridas (duplicatas não inflam).
function insertInteractionsBatch(items) {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO interactions
       (tenant_id, room_id, session_id, ts, type, user_id, username, nickname, avatar, value, meta, event_id)
     VALUES (@tenant_id, @room_id, @session_id, @ts, @type, @user_id, @username, @nickname, @avatar, @value, @meta, @event_id)`
  );
  const agg = db.prepare(
    `INSERT INTO interaction_aggregates (tenant_id, room_id, bucket_minute, type, user_id, count, value_sum)
     VALUES (@tenant_id, @room_id, @bucket_minute, @type, @user_id, @count, @value_sum)
     ON CONFLICT(tenant_id, room_id, bucket_minute, type, user_id)
     DO UPDATE SET count = count + excluded.count, value_sum = value_sum + excluded.value_sum`
  );
  const tx = db.transaction((rows) => {
    let inserted = 0;
    const aggs = new Map();
    for (const r of rows) {
      const info = ins.run(r);
      if (!info.changes) continue; // duplicado por event_id
      inserted++;
      const bk = Math.floor((Number(r.ts) || 0) / 60000) * 60000;
      const key = `${r.room_id}|${bk}|${r.type}|${r.user_id}`;
      const a = aggs.get(key) || {
        tenant_id: r.tenant_id, room_id: r.room_id, bucket_minute: bk,
        type: r.type, user_id: r.user_id, count: 0, value_sum: 0,
      };
      a.count += 1;
      a.value_sum += Number(r.value) || 0;
      aggs.set(key, a);
    }
    for (const a of aggs.values()) agg.run(a);
    return inserted;
  });
  return tx(items || []);
}

function pruneInteractions({ detailCutoff, commentTextCutoff, aggCutoff }) {
  const delDetail = db.prepare("DELETE FROM interactions WHERE ts < ?").run(detailCutoff);
  const clearComments = db.prepare(
    "UPDATE interactions SET meta = '' WHERE type = 'comment' AND ts < ? AND meta <> ''"
  ).run(commentTextCutoff);
  const delAgg = db.prepare("DELETE FROM interaction_aggregates WHERE bucket_minute < ?").run(aggCutoff);
  return { detail: delDetail.changes, comments: clearComments.changes, aggregates: delAgg.changes };
}

function queryInteractions({ tenantId, from, to, room_id, type, cursor, limit } = {}) {
  const where = ["tenant_id = ?"];
  const args = [tenantId];
  if (from != null) { where.push("ts >= ?"); args.push(from); }
  if (to != null) { where.push("ts <= ?"); args.push(to); }
  if (room_id) { where.push("room_id = ?"); args.push(String(room_id)); }
  if (type) { where.push("type = ?"); args.push(String(type)); }
  if (cursor != null) { where.push("id < ?"); args.push(Number(cursor)); }
  const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
  args.push(lim);
  const rows = db.prepare(
    `SELECT id, room_id, session_id, ts, type, user_id, username, nickname, avatar, value, meta
     FROM interactions WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`
  ).all(...args);
  const next_cursor = rows.length === lim ? rows[rows.length - 1].id : null;
  return { events: rows, next_cursor };
}

// Resumo por tipo usando agregados (rápido), mais pessoas únicas no período.
function summaryInteractions({ tenantId, from, to, room_id } = {}) {
  const where = ["tenant_id = ?"];
  const args = [tenantId];
  if (from != null) { where.push("bucket_minute >= ?"); args.push(bucketFloorMinute(from)); }
  if (to != null) { where.push("bucket_minute <= ?"); args.push(bucketFloorMinute(to)); }
  if (room_id) { where.push("room_id = ?"); args.push(String(room_id)); }
  const w = where.join(" AND ");
  const byType = db.prepare(
    `SELECT type, SUM(count) AS count, SUM(value_sum) AS value_sum
     FROM interaction_aggregates WHERE ${w} GROUP BY type`
  ).all(...args);
  const uniq = db.prepare(
    `SELECT COUNT(DISTINCT user_id) AS people FROM interaction_aggregates WHERE ${w} AND user_id <> ''`
  ).get(...args);
  const totals = {};
  let events = 0;
  for (const r of byType) {
    totals[r.type] = { count: r.count || 0, value_sum: r.value_sum || 0 };
    events += r.count || 0;
  }
  return { from: from ?? null, to: to ?? null, room_id: room_id || null, events, people: uniq.people || 0, by_type: totals };
}

function seriesInteractions({ tenantId, from, to, room_id, type, bucketMs = 60000 } = {}) {
  const where = ["tenant_id = ?"];
  const args = [tenantId];
  if (from != null) { where.push("bucket_minute >= ?"); args.push(bucketFloorMinute(from)); }
  if (to != null) { where.push("bucket_minute <= ?"); args.push(bucketFloorMinute(to)); }
  if (room_id) { where.push("room_id = ?"); args.push(String(room_id)); }
  if (type) { where.push("type = ?"); args.push(String(type)); }
  const step = Math.max(60000, parseInt(bucketMs, 10) || 60000);
  const rows = db.prepare(
    `SELECT bucket_minute, type, SUM(count) AS count, SUM(value_sum) AS value_sum
     FROM interaction_aggregates WHERE ${where.join(" AND ")}
     GROUP BY bucket_minute, type ORDER BY bucket_minute ASC`
  ).all(...args);
  const buckets = new Map();
  for (const r of rows) {
    const b = Math.floor(r.bucket_minute / step) * step;
    let entry = buckets.get(b);
    if (!entry) { entry = { t: b, by_type: {}, count: 0, value_sum: 0 }; buckets.set(b, entry); }
    entry.by_type[r.type] = { count: r.count || 0, value_sum: r.value_sum || 0 };
    entry.count += r.count || 0;
    entry.value_sum += r.value_sum || 0;
  }
  return { bucket_ms: step, points: [...buckets.values()].sort((a, b) => a.t - b.t) };
}

// Ranking de participantes (por contagem total, ou por valor quando type é gift).
function rankingInteractions({ tenantId, from, to, room_id, type, limit } = {}) {
  const where = ["tenant_id = ?", "user_id <> ''"];
  const args = [tenantId];
  if (from != null) { where.push("bucket_minute >= ?"); args.push(bucketFloorMinute(from)); }
  if (to != null) { where.push("bucket_minute <= ?"); args.push(bucketFloorMinute(to)); }
  if (room_id) { where.push("room_id = ?"); args.push(String(room_id)); }
  if (type) { where.push("type = ?"); args.push(String(type)); }
  const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 20));
  const order = type === "gift" ? "value_sum" : "count";
  args.push(lim);
  const rows = db.prepare(
    `SELECT user_id, SUM(count) AS count, SUM(value_sum) AS value_sum
     FROM interaction_aggregates WHERE ${where.join(" AND ")}
     GROUP BY user_id ORDER BY ${order} DESC, user_id ASC LIMIT ?`
  ).all(...args);
  return { ranking: rows };
}

function bucketFloorMinute(ts) {
  const n = Number(ts) || 0;
  return Math.floor(n / 60000) * 60000;
}

// ---------------- Níveis por usuário (presenteador / fã-clube) ----------------

function getViewerLevel(tenantId, userId) {
  return db.prepare("SELECT * FROM viewer_levels WHERE tenant_id = ? AND user_id = ?").get(tenantId, String(userId)) || null;
}

function getLiveViewerLevel(tenantId, roomId, userId) {
  return db.prepare(
    "SELECT * FROM live_viewer_levels WHERE tenant_id = ? AND room_id = ? AND user_id = ?"
  ).get(tenantId, String(roomId), String(userId)) || null;
}

function upsertViewerLevel({ tenant_id, user_id, nickname = "", avatar = "", gifter_level = 0, gifter_grade = "", fan_club_level = 0, fan_club_name = "", ts }) {
  const t = Number(ts) || Date.now();
  db.prepare(`
    INSERT INTO viewer_levels (tenant_id, user_id, nickname, avatar, gifter_level, gifter_grade, fan_club_level, fan_club_name, updated_at)
    VALUES (@tenant_id, @user_id, @nickname, @avatar, @gifter_level, @gifter_grade, @fan_club_level, @fan_club_name, @ts)
    ON CONFLICT(tenant_id, user_id) DO UPDATE SET
      nickname = CASE WHEN excluded.nickname <> '' THEN excluded.nickname ELSE nickname END,
      avatar = CASE WHEN excluded.avatar <> '' THEN excluded.avatar ELSE avatar END,
      gifter_level = excluded.gifter_level,
      gifter_grade = CASE WHEN excluded.gifter_grade <> '' THEN excluded.gifter_grade ELSE gifter_grade END,
      fan_club_level = excluded.fan_club_level,
      fan_club_name = CASE WHEN excluded.fan_club_name <> '' THEN excluded.fan_club_name ELSE fan_club_name END,
      updated_at = excluded.updated_at
  `).run({
    tenant_id, user_id: String(user_id), nickname: String(nickname || ""), avatar: String(avatar || ""),
    gifter_level: Number(gifter_level) || 0, gifter_grade: String(gifter_grade || ""),
    fan_club_level: Number(fan_club_level) || 0, fan_club_name: String(fan_club_name || ""), ts: t,
  });
}

function upsertLiveViewerLevel({ tenant_id, room_id, user_id, nickname = "", avatar = "", gifter_level = 0, fan_club_level = 0, ts }) {
  const t = Number(ts) || Date.now();
  db.prepare(`
    INSERT INTO live_viewer_levels (tenant_id, room_id, user_id, nickname, avatar, gifter_level, fan_club_level, created_at, updated_at)
    VALUES (@tenant_id, @room_id, @user_id, @nickname, @avatar, @gifter_level, @fan_club_level, @ts, @ts)
    ON CONFLICT(tenant_id, room_id, user_id) DO UPDATE SET
      nickname = CASE WHEN excluded.nickname <> '' THEN excluded.nickname ELSE nickname END,
      avatar = CASE WHEN excluded.avatar <> '' THEN excluded.avatar ELSE avatar END,
      gifter_level = excluded.gifter_level,
      fan_club_level = excluded.fan_club_level,
      updated_at = excluded.updated_at
  `).run({
    tenant_id, room_id: String(room_id), user_id: String(user_id), nickname: String(nickname || ""),
    avatar: String(avatar || ""), gifter_level: Number(gifter_level) || 0, fan_club_level: Number(fan_club_level) || 0, ts: t,
  });
}

// Níveis atuais para uma sala (ou globais) — para overlay/tela de níveis.
function listViewerLevels(tenantId, { room_id, limit } = {}) {
  const lim = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
  if (room_id) {
    return db.prepare(`
      SELECT user_id, nickname, avatar, gifter_level, fan_club_level, updated_at
      FROM live_viewer_levels WHERE tenant_id = ? AND room_id = ?
      ORDER BY updated_at DESC LIMIT ?
    `).all(tenantId, String(room_id), lim);
  }
  return db.prepare(`
    SELECT user_id, nickname, avatar, gifter_level, gifter_grade, fan_club_level, fan_club_name, updated_at
    FROM viewer_levels WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT ?
  `).all(tenantId, lim);
}

// ---------------- Subidas de nível (level_ups) ----------------

// Insere uma subida. Deduplica por (tenant, sala, usuário, eixo, nível alcançado)
// e por event_id (quando houver). Retorna true se foi inserida (nova) e false se
// já existia (evento atrasado / reenvio / reinício do processo).
function insertLevelUp({ tenant_id, room_id = "", session_id = null, user_id = "", username = "", nickname = "", avatar = "", axis, level_before = null, level_after, event_id = "", ts }) {
  const info = db.prepare(`
    INSERT OR IGNORE INTO level_ups
      (tenant_id, room_id, session_id, user_id, username, nickname, avatar, axis, level_before, level_after, event_id, ts)
    VALUES (@tenant_id, @room_id, @session_id, @user_id, @username, @nickname, @avatar, @axis, @level_before, @level_after, @event_id, @ts)
  `).run({
    tenant_id, room_id: String(room_id || ""), session_id: session_id || null,
    user_id: String(user_id || ""), username: String(username || ""), nickname: String(nickname || ""),
    avatar: String(avatar || ""), axis: String(axis || ""),
    level_before: level_before != null ? Number(level_before) : null,
    level_after: Number(level_after) || 0,
    event_id: String(event_id || ""), ts: Number(ts) || Date.now(),
  });
  return info.changes > 0;
}

function _levelUpToEvent(r) {
  return {
    id: r.id,
    room_id: r.room_id,
    session_id: r.session_id,
    ts: r.ts,
    type: "level_up",
    user_id: r.user_id,
    username: r.username,
    nickname: r.nickname,
    avatar: r.avatar,
    axis: r.axis,
    value: r.level_after,
    before: r.level_before,
    after: r.level_after,
    event_id: r.event_id,
    meta: { axis: r.axis, before: r.level_before, after: r.level_after },
  };
}

function queryLevelUps({ tenantId, from, to, room_id, axis, cursor, limit } = {}) {
  const where = ["tenant_id = ?"];
  const args = [tenantId];
  if (from != null) { where.push("ts >= ?"); args.push(from); }
  if (to != null) { where.push("ts <= ?"); args.push(to); }
  if (room_id) { where.push("room_id = ?"); args.push(String(room_id)); }
  if (axis) { where.push("axis = ?"); args.push(String(axis)); }
  if (cursor != null) { where.push("id < ?"); args.push(Number(cursor)); }
  const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
  args.push(lim);
  const rows = db.prepare(
    `SELECT * FROM level_ups WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`
  ).all(...args);
  const next_cursor = rows.length === lim ? rows[rows.length - 1].id : null;
  return { events: rows.map(_levelUpToEvent), next_cursor };
}

// Contagens por eixo (independentes da retenção curta dos detalhes).
function summarizeLevelUps({ tenantId, from, to, room_id } = {}) {
  const where = ["tenant_id = ?"];
  const args = [tenantId];
  if (from != null) { where.push("ts >= ?"); args.push(from); }
  if (to != null) { where.push("ts <= ?"); args.push(to); }
  if (room_id) { where.push("room_id = ?"); args.push(String(room_id)); }
  const rows = db.prepare(
    `SELECT axis, COUNT(*) AS count FROM level_ups WHERE ${where.join(" AND ")} GROUP BY axis`
  ).all(...args);
  const by_axis = {};
  let total = 0;
  for (const r of rows) { by_axis[r.axis] = r.count; total += r.count; }
  return { total, gifter: by_axis.gifter || 0, fanclub: by_axis.fanclub || 0, by_axis };
}

function pruneLevelUps(cutoff) {
  return db.prepare("DELETE FROM level_ups WHERE ts < ?").run(Number(cutoff) || 0).changes;
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

const WORD_DIFFICULTIES = ['facil', 'media', 'dificil'];
const WORD_STATUSES = ['active', 'review', 'inactive'];
function listWordCatalog({ search = '', status = '', category = '', page = 1, pageSize = 50 } = {}) {
  const where = [], params = [];
  if (search) { where.push('(word LIKE ? OR category LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (WORD_STATUSES.includes(status)) { where.push('status=?'); params.push(status); }
  if (category) { where.push('category=?'); params.push(category); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) count FROM word_catalog ${clause}`).get(...params).count;
  const rows = db.prepare(`SELECT id,word,word_key,category,difficulty,status,source,created_at,updated_at
    FROM word_catalog ${clause} ORDER BY word COLLATE NOCASE,id LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);
  const summary = db.prepare(`SELECT COUNT(*) total,SUM(status='active') active,SUM(status='review') review,
    SUM(status='inactive') inactive FROM word_catalog`).get();
  summary.eligible = getWordCatalogEligibleStats().eligible;
  const categories = db.prepare('SELECT DISTINCT category FROM word_catalog ORDER BY category COLLATE NOCASE').all().map(r => r.category);
  const banned = new Set(getBannedWords().map(normalizeCatalogWord));
  return { items: rows.map(row => ({ ...row, banned: banned.has(row.word_key) })), total, page, page_size: pageSize,
    pages: Math.ceil(total / pageSize), summary: Object.fromEntries(Object.entries(summary).map(([k,v]) => [k, Number(v || 0)])),
    categories, difficulties: WORD_DIFFICULTIES, statuses: WORD_STATUSES };
}

function importWordCatalogWords(items) {
  const insert = db.prepare(`INSERT OR IGNORE INTO word_catalog(word,word_key,category,difficulty,status,source)
    VALUES(@word,@word_key,@category,@difficulty,@status,'import')`);
  const run = db.transaction((list) => {
    let inserted = 0;
    for (const item of list) inserted += insert.run(item).changes;
    return inserted;
  });
  return run(items);
}

function updateWordCatalogWord(id, { category, difficulty, status }) {
  return db.transaction(() => {
    const current = db.prepare('SELECT * FROM word_catalog WHERE id=?').get(id);
    if (!current) return null;
    if (current.status === 'active' && status !== 'active' &&
        db.prepare("SELECT COUNT(*) count FROM word_catalog WHERE status='active'").get().count <= 1) {
      const error = new Error('LAST_ACTIVE_WORD'); error.code = 'LAST_ACTIVE_WORD'; throw error;
    }
    db.prepare('UPDATE word_catalog SET category=?,difficulty=?,status=?,updated_at=datetime(\'now\') WHERE id=?')
      .run(category, difficulty, status, id);
    return db.prepare('SELECT id,word,word_key,category,difficulty,status,source,created_at,updated_at FROM word_catalog WHERE id=?').get(id);
  })();
}

function getWordDrawSettings(tenantId) {
  const row = db.prepare('SELECT categories,difficulties FROM word_draw_settings WHERE tenant_id=?').get(tenantId);
  const parse = (value) => { try { const data = JSON.parse(value || '[]'); return Array.isArray(data) ? data : []; } catch { return []; } };
  return { categories: parse(row && row.categories), difficulties: parse(row && row.difficulties) };
}

function saveWordDrawSettings(tenantId, { categories, difficulties }) {
  db.prepare(`INSERT INTO word_draw_settings(tenant_id,categories,difficulties,updated_at) VALUES(?,?,?,datetime('now'))
    ON CONFLICT(tenant_id) DO UPDATE SET categories=excluded.categories,difficulties=excluded.difficulties,updated_at=excluded.updated_at`)
    .run(tenantId, JSON.stringify(categories), JSON.stringify(difficulties));
  return getWordDrawSettings(tenantId);
}

function listWordUsageStreamers() {
  const streamers = db.prepare(`SELECT u.id tenant_id,u.name,u.email,u.tiktok_username,
    COALESCE(c.current_cycle,1) current_cycle,
    COALESCE((SELECT COUNT(*) FROM word_usage w WHERE w.tenant_id=u.id AND w.cycle_id=COALESCE(c.current_cycle,1)),0) used_in_cycle,
    COALESCE((SELECT COUNT(*) FROM word_usage w WHERE w.tenant_id=u.id),0) total_used
    FROM users u LEFT JOIN word_cycles c ON c.tenant_id=u.id ORDER BY u.name COLLATE NOCASE,u.id`).all()
    .map(row => ({ ...row, ...getWordDrawSettings(row.tenant_id) }));
  const banned = new Set(getBannedWords().map(normalizeCatalogWord));
  const eligible = db.prepare("SELECT word_key,category,difficulty FROM word_catalog WHERE status='active'").all()
    .filter(word => !banned.has(word.word_key));
  const usedRows = db.prepare('SELECT tenant_id,cycle_id,word_key FROM word_usage').all();
  const usedByStreamer = new Map();
  for (const row of usedRows) {
    const key = `${row.tenant_id}:${row.cycle_id}`;
    if (!usedByStreamer.has(key)) usedByStreamer.set(key, new Set());
    usedByStreamer.get(key).add(row.word_key);
  }
  return streamers.map(streamer => {
    const pool = eligible.filter(word => (!streamer.categories.length || streamer.categories.includes(word.category)) &&
      (!streamer.difficulties.length || streamer.difficulties.includes(word.difficulty)));
    const key = `${streamer.tenant_id}:${streamer.current_cycle}`;
    const used = usedByStreamer.get(key) || new Set();
    return { ...streamer, used_in_cycle: pool.filter(word => used.has(word.word_key)).length, eligible_count: pool.length,
      remaining_in_cycle: pool.filter(word => !used.has(word.word_key)).length };
  });
}

function listWordUsageEntries({ tenantId = null, search = '', page = 1, pageSize = 50 } = {}) {
  const where = [], params = [];
  if (Number.isInteger(tenantId)) { where.push('w.tenant_id=?'); params.push(tenantId); }
  if (search) { where.push('(w.word LIKE ? OR u.name LIKE ? OR u.tiktok_username LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) count FROM word_usage w LEFT JOIN users u ON u.id=w.tenant_id ${clause}`).get(...params).count;
  const rows = db.prepare(`SELECT w.tenant_id,w.cycle_id,w.game_id,w.game_type,w.word,w.used_at,w.source,
    COALESCE(u.name,'') streamer_name,COALESCE(u.tiktok_username,'') tiktok_username
    FROM word_usage w LEFT JOIN users u ON u.id=w.tenant_id ${clause}
    ORDER BY w.used_at DESC,w.tenant_id LIMIT ? OFFSET ?`).all(...params, pageSize, (page-1)*pageSize);
  return { items: rows, total, page, page_size: pageSize, pages: Math.ceil(total / pageSize) };
}

function getWordCatalogEligibleStats() {
  const rows = db.prepare("SELECT word_key,status FROM word_catalog").all();
  const banned = new Set(getBannedWords().map(normalizeCatalogWord));
  const eligible = rows.filter(row => row.status === 'active' && !banned.has(row.word_key)).length;
  return { total: rows.length, active: rows.filter(row => row.status === 'active').length, eligible };
}

function resetWordUsageCycle(tenantId) {
  return db.transaction(() => {
    const row = db.prepare('SELECT current_cycle FROM word_cycles WHERE tenant_id=?').get(tenantId);
    const legacy = db.prepare('SELECT played_words FROM tenant_history WHERE tenant_id=?').get(tenantId);
    let oldWords = [];
    try { const parsed = JSON.parse(legacy?.played_words || '[]'); oldWords = Array.isArray(parsed) ? parsed : []; } catch {}
    const previous = row ? row.current_cycle : (oldWords.length ? 1 : 0);
    const next = previous + 1;
    if (!db.prepare('SELECT 1 FROM word_cycle_migrations WHERE tenant_id=?').get(tenantId)) {
      const insertLegacy = db.prepare("INSERT OR IGNORE INTO word_usage(tenant_id,cycle_id,word_key,word,source) VALUES(?,?,?,?,'legacy')");
      for (const word of oldWords) if (typeof word === 'string' && word.trim())
        insertLegacy.run(tenantId, Math.max(1, previous), normalizeCatalogWord(word), word.trim());
      db.prepare('INSERT OR IGNORE INTO word_cycle_migrations(tenant_id) VALUES(?)').run(tenantId);
    }
    db.prepare(`INSERT INTO word_cycles(tenant_id,current_cycle,updated_at) VALUES(?,?,datetime('now'))
      ON CONFLICT(tenant_id) DO UPDATE SET current_cycle=excluded.current_cycle,updated_at=excluded.updated_at`)
      .run(tenantId, next);
    db.prepare("UPDATE tenant_history SET played_words='[]' WHERE tenant_id=?").run(tenantId);
    return { previous_cycle: previous, current_cycle: next };
  })();
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
  getPresenterLevelOverlayLayout,
  savePresenterLevelOverlayLayout,
  getGiftRankingOverlayLayout,
  hasGiftRankingOverlayLayout,
  saveGiftRankingOverlayLayout,
  normalizeGiftRankingOverlayLayout,
  LIKES_OVERLAY_OPTIONS,
  DEFAULT_LIKES_OVERLAY_LAYOUT,
  DEFAULT_PRESENTER_LEVEL_OVERLAY_LAYOUT,
  DEFAULT_GIFT_RANKING_OVERLAY_LAYOUT,
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
  redactLegacyLogMessages,
  normalizeLegacyLogEntries,
  LOG_RETENTION_MS,
  LOG_MAX_ROWS_PER_TENANT,
  LOG_PAGE_MAX,
  openLiveSession,
  getLiveSessions,
  insertInteractionsBatch,
  pruneInteractions,
  queryInteractions,
  summaryInteractions,
  seriesInteractions,
  rankingInteractions,
  bucketFloorMinute,
  getViewerLevel,
  getLiveViewerLevel,
  upsertViewerLevel,
  upsertLiveViewerLevel,
  listViewerLevels,
  insertLevelUp,
  queryLevelUps,
  summarizeLevelUps,
  pruneLevelUps,
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
  WORD_DIFFICULTIES,
  WORD_STATUSES,
  listWordCatalog,
  importWordCatalogWords,
  updateWordCatalogWord,
  getWordDrawSettings,
  saveWordDrawSettings,
  listWordUsageStreamers,
  listWordUsageEntries,
  getWordCatalogEligibleStats,
  resetWordUsageCycle,
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
