const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dbPath = path.join(os.tmpdir(), `tikplay-caca-config-${process.pid}.sqlite`);
const legacy = new Database(dbPath);
legacy.exec(`CREATE TABLE tenant_caca_config (
  tenant_id INTEGER PRIMARY KEY, prefix TEXT DEFAULT '', count INTEGER DEFAULT 10,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
); INSERT INTO tenant_caca_config(tenant_id,prefix,count) VALUES(23,'cp',9);`);
legacy.close();

process.env.DB_PATH = dbPath;
const db = require("../db");
try {
  const vertical = { preset: "vertical", safe_top: 13, safe_bottom: 22, safe_left: 4, safe_right: 4 };
  assert.deepEqual(db.getCacaConfig(23), { prefix: "cp", answer_mode: "both", show_ranking: true, count: 9, display: vertical });
  assert.deepEqual(db.saveCacaConfig(23, { prefix: "cp", answer_mode: "word", show_ranking: false, count: 9 }),
    { prefix: "cp", answer_mode: "word", show_ranking: false, count: 9, display: vertical });
  assert.equal(db.getCacaConfig(23).answer_mode, "word");
  assert.equal(db.getCacaConfig(23).show_ranking, false);
  assert.equal(db.saveCacaConfig(23, { answer_mode: "word" }).show_ranking, false);
  assert.equal(db.saveCacaConfig(23, { answer_mode: "unsupported" }).answer_mode, "both");
  const landscape = db.saveCacaConfig(23, { display: { preset: "landscape" } }).display;
  assert.deepEqual(landscape, { preset: "landscape", safe_top: 8, safe_bottom: 12, safe_left: 5, safe_right: 5 });
  const custom = db.saveCacaConfig(23, { display: { preset: "custom", safe_top: 0, safe_bottom: 90, safe_left: 30, safe_right: 30 } }).display;
  assert.deepEqual(custom, { preset: "custom", safe_top: 0, safe_bottom: 35, safe_left: 20, safe_right: 20 });
  assert.deepEqual(db.getCacaConfig(23).display, custom);
  console.log("caca-config.test.js passou (migração legada, presets, limites e persistência).");
} finally {
  db.db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbPath + suffix, { force: true });
}
