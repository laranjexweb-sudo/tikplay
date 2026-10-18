const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dbPath = path.join(os.tmpdir(), `tikplay-action-alerts-${process.pid}.db`);
process.env.DB_PATH = dbPath;
const db = require("../db");

try {
  assert.equal(db.getActionGifterMinLevel(1001), 30);
  assert.equal(db.saveActionGifterMinLevel(1001, 42), 42);
  assert.equal(db.getActionGifterMinLevel(1001), 42);
  assert.equal(db.saveActionGifterMinLevel(1001, 99), 50);
  assert.equal(db.getActionGifterMinLevel(1001), 50);

  db.saveSoundAlert(1001, "__action_follow__", "normal", "/alert-audio/1001/follow.mp3");
  db.saveSoundAlert(1001, "Rose", "normal", "/alert-audio/1001/rose.mp3");
  assert.equal(db.getSoundAlerts(1001).__action_follow__.normal, "/alert-audio/1001/follow.mp3");
  assert.equal(db.getSoundAlerts(1001).Rose.normal, "/alert-audio/1001/rose.mp3");
  assert.equal(db.getSoundAlerts(2002).__action_follow__, undefined, "alertas permanecem isolados por tenant");
  console.log("action-sound-alerts.db: OK");
} finally {
  db.db.close();
  try { fs.unlinkSync(dbPath); } catch {}
  try { fs.unlinkSync(dbPath + "-wal"); } catch {}
  try { fs.unlinkSync(dbPath + "-shm"); } catch {}
}
