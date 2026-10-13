// Smoke test for persisted, tenant-scoped likes-overlay layout.
// Run with: node tests/likes-overlay-layout.db.test.js

const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dbPath = path.join(os.tmpdir(), `tikplay-layout-${process.pid}.db`);
process.env.DB_PATH = dbPath;
const legacyDb = new Database(dbPath);
legacyDb.exec(`CREATE TABLE tenant_settings (
  tenant_id INTEGER PRIMARY KEY,
  apenas_seguidores INTEGER DEFAULT 0,
  apenas_heart_me INTEGER DEFAULT 0,
  pct_dica INTEGER DEFAULT 70,
  pct_charada INTEGER DEFAULT 30,
  tts_rate REAL DEFAULT 1,
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
  likes_overlay_layout TEXT DEFAULT '{"x":50,"y":50,"scale":1}'
);`);
legacyDb.prepare("INSERT INTO tenant_settings (tenant_id) VALUES (?)").run(101);
legacyDb.close();
const db = require("../db");

try {
  assert.deepEqual(db.getLikesOverlayLayout(101, "v3"), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(db.getLikesOverlayLayout(101, "v2"), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(db.getLikesOverlayLayout(202, "v3"), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(db.getLikesOverlayLayout(202, "v2"), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(
    db.saveLikesOverlayLayout(101, "v3", { x: 12.5, y: 87.25, scale: 1.5 }),
    { x: 12.5, y: 87.25, scale: 1.5 }
  );
  assert.deepEqual(db.getLikesOverlayLayout(101, "v3"), { x: 12.5, y: 87.25, scale: 1.5 });
  assert.deepEqual(db.getLikesOverlayLayout(101, "v2"), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(
    db.saveLikesOverlayLayout(101, "v2", { x: 75, y: 20, scale: 0.75 }),
    { x: 75, y: 20, scale: 0.75 }
  );
  assert.deepEqual(db.getLikesOverlayLayout(101, "v2"), { x: 75, y: 20, scale: 0.75 });
  assert.deepEqual(db.getLikesOverlayLayout(101, "v3"), { x: 12.5, y: 87.25, scale: 1.5 });
  assert.deepEqual(db.saveLikesOverlayLayout(202, "v3", { x: 50, y: 50, scale: 1 }), { x: 50, y: 50, scale: 1 });
  assert.deepEqual(db.getLikesOverlayLayout(202, "v3"), { x: 50, y: 50, scale: 1 });

  db.saveTenantSettings(101, { ...db.getTenantSettings(101), pct_dica: 55 });
  assert.deepEqual(db.getLikesOverlayLayout(101, "v3"), { x: 12.5, y: 87.25, scale: 1.5 });
  assert.deepEqual(db.getLikesOverlayLayout(101, "v2"), { x: 75, y: 20, scale: 0.75 });
  console.log("PASS legacy-default migration, per-version persistence, tenant isolation, and settings coexistence");
} finally {
  db.db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
}
