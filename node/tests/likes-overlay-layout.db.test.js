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

// Default completo do layout (inclui os campos de personalização aditivos).
const D = db.DEFAULT_LIKES_OVERLAY_LAYOUT;
const expectLayout = (x, y, scale, count) => ({ ...D, x, y, scale, count });

try {
  assert.deepEqual(db.getLikesOverlayLayout(101, "v3"), expectLayout(0, 0, 1, 5));
  assert.deepEqual(db.getLikesOverlayLayout(101, "v2"), expectLayout(0, 0, 1, 5));
  assert.deepEqual(db.getLikesOverlayLayout(202, "v3"), expectLayout(0, 0, 1, 5));
  assert.deepEqual(db.getLikesOverlayLayout(202, "v2"), expectLayout(0, 0, 1, 5));
  assert.deepEqual(
    db.saveLikesOverlayLayout(101, "v3", { x: 12.5, y: 87.25, scale: 1.5, count: 7 }),
    expectLayout(12.5, 87.25, 1.5, 7)
  );
  assert.deepEqual(db.getLikesOverlayLayout(101, "v3"), expectLayout(12.5, 87.25, 1.5, 7));
  assert.deepEqual(db.getLikesOverlayLayout(101, "v2"), expectLayout(0, 0, 1, 5));
  assert.deepEqual(
    db.saveLikesOverlayLayout(101, "v2", { x: 75, y: 20, scale: 0.75, count: 3 }),
    expectLayout(75, 20, 0.75, 3)
  );
  assert.deepEqual(db.getLikesOverlayLayout(101, "v2"), expectLayout(75, 20, 0.75, 3));
  assert.deepEqual(db.getLikesOverlayLayout(101, "v3"), expectLayout(12.5, 87.25, 1.5, 7));
  assert.deepEqual(db.saveLikesOverlayLayout(202, "v3", { x: 50, y: 50, scale: 1, count: 4 }), expectLayout(50, 50, 1, 4));
  assert.deepEqual(db.getLikesOverlayLayout(202, "v3"), expectLayout(50, 50, 1, 4));

  const presenterDefault = { x: 50, y: 50, scale: 1 };
  assert.deepEqual(db.DEFAULT_PRESENTER_LEVEL_OVERLAY_LAYOUT, presenterDefault);
  assert.deepEqual(db.getPresenterLevelOverlayLayout(101), presenterDefault);
  assert.deepEqual(db.getPresenterLevelOverlayLayout(202), presenterDefault);
  const presenterSaved = { x: 26, y: 74, scale: 1.35 };
  assert.deepEqual(db.savePresenterLevelOverlayLayout(101, presenterSaved), presenterSaved);
  assert.deepEqual(db.getPresenterLevelOverlayLayout(101), presenterSaved);
  assert.deepEqual(db.getPresenterLevelOverlayLayout(202), presenterDefault);
  assert.throws(() => db.savePresenterLevelOverlayLayout(101, { x: 101, y: 50, scale: 1 }));

  const giftRankingDefault = { x: 0, y: 0, scale: 1, count: 10 };
  assert.deepEqual(db.DEFAULT_GIFT_RANKING_OVERLAY_LAYOUT, giftRankingDefault);
  assert.deepEqual(db.getGiftRankingOverlayLayout(101), giftRankingDefault);
  assert.deepEqual(db.getGiftRankingOverlayLayout(202), giftRankingDefault);
  assert.equal(db.hasGiftRankingOverlayLayout(101), false);
  const giftRankingSaved = { x: 11, y: 8, scale: 1.35, count: 5 };
  assert.deepEqual(db.saveGiftRankingOverlayLayout(101, giftRankingSaved), giftRankingSaved);
  assert.deepEqual(db.getGiftRankingOverlayLayout(101), giftRankingSaved);
  assert.deepEqual(db.getGiftRankingOverlayLayout(202), giftRankingDefault);
  assert.equal(db.hasGiftRankingOverlayLayout(101), true);
  assert.equal(db.hasGiftRankingOverlayLayout(202), false);
  assert.throws(() => db.saveGiftRankingOverlayLayout(101, { ...giftRankingSaved, x: 101 }));
  assert.throws(() => db.saveGiftRankingOverlayLayout(101, { ...giftRankingSaved, scale: 2.1 }));
  assert.throws(() => db.saveGiftRankingOverlayLayout(101, { ...giftRankingSaved, count: 11 }));

  db.saveTenantSettings(101, {
    ...db.getTenantSettings(101),
    pct_dica: 55,
    chat_narr_enabled: true,
    chat_narr_mode: "only",
    chat_narr_char: "!",
    tts_voice: "edge_francisca",
    tts_rate: 1.5,
  });
  const savedSettings = db.getTenantSettings(101);
  assert.equal(savedSettings.chat_narr_enabled, true);
  assert.equal(savedSettings.chat_narr_mode, "only");
  assert.equal(savedSettings.chat_narr_char, "!");
  assert.equal(savedSettings.tts_voice, "edge_francisca");
  assert.equal(savedSettings.tts_rate, 1.5);
  assert.deepEqual(db.getLikesOverlayLayout(101, "v3"), expectLayout(12.5, 87.25, 1.5, 7));
  assert.deepEqual(db.getLikesOverlayLayout(101, "v2"), expectLayout(75, 20, 0.75, 3));
  assert.deepEqual(db.getPresenterLevelOverlayLayout(101), presenterSaved);
  assert.deepEqual(db.getGiftRankingOverlayLayout(101), giftRankingSaved);
  console.log("PASS legacy migration, overlay persistence, tenant isolation, bounds validation, and settings coexistence");
} finally {
  db.db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
}
