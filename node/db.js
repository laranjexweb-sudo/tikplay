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
  tap_meta: 1000,
};

try {
  db.exec("ALTER TABLE tenant_gift_config ADD COLUMN sound_alerts TEXT DEFAULT '{}'");
} catch {}
try {
  db.exec("ALTER TABLE tenant_gift_config ADD COLUMN size_gift TEXT DEFAULT ''");
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
  tap_meta INTEGER DEFAULT 1000
);
CREATE TABLE IF NOT EXISTS tenant_gift_config (
  tenant_id INTEGER PRIMARY KEY,
  hint_gifts TEXT DEFAULT '[]',
  riddle_gifts TEXT DEFAULT '[]',
  sound_alerts TEXT DEFAULT '{}',
  size_gift TEXT DEFAULT ''
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
try { db.exec("ALTER TABLE batalha_rounds ADD COLUMN room_id TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE batalha_interactions ADD COLUMN room_id TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN tiktok_engine TEXT NOT NULL DEFAULT 'tiktoklive'"); } catch {}

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
    tap_meta: (row.tap_meta === null || row.tap_meta === undefined) ? 1000 : row.tap_meta,
  };
}

function saveTenantSettings(tenantId, s) {
  db.prepare(`
    INSERT INTO tenant_settings (tenant_id, apenas_seguidores, apenas_heart_me, pct_dica, pct_charada, tts_rate, tts_voice, chat_narr_enabled, chat_narr_mode, chat_narr_char, command_prefix, auto_round, auto_round_pause, tap_meta)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
      tap_meta=excluded.tap_meta
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
    (s.tap_meta === null || s.tap_meta === undefined) ? 1000 : s.tap_meta
  );
}

function getTenantGiftConfig(tenantId) {
  const row = db.prepare("SELECT hint_gifts, riddle_gifts, size_gift FROM tenant_gift_config WHERE tenant_id = ?").get(tenantId);
  if (!row) return { hint_gifts: [], riddle_gifts: [], size_gift: "" };
  let hg = [], rg = [];
  try { hg = JSON.parse(row.hint_gifts || "[]"); } catch {}
  try { rg = JSON.parse(row.riddle_gifts || "[]"); } catch {}
  return { hint_gifts: hg, riddle_gifts: rg, size_gift: row.size_gift || "" };
}

function saveTenantGiftConfig(tenantId, hint_gifts, riddle_gifts, size_gift) {
  db.prepare(`
    INSERT INTO tenant_gift_config (tenant_id, hint_gifts, riddle_gifts, size_gift)
    VALUES (?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET hint_gifts=excluded.hint_gifts, riddle_gifts=excluded.riddle_gifts, size_gift=excluded.size_gift
  `).run(tenantId, JSON.stringify(hint_gifts || []), JSON.stringify(riddle_gifts || []), String(size_gift || ""));
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

module.exports = {
  db,
  DEFAULT_SETTINGS,
  createUser,
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
  getTenantGiftConfig,
  saveTenantGiftConfig,
  getTresGiftConfig,
  saveTresGiftConfig,
  getSoundAlerts,
  saveSoundAlert,
  getTenantHistory,
  saveTenantHistory,
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
};
