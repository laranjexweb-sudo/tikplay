const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tikplay-logstore-"));
process.env.DB_PATH = path.join(tempDir, "logs.db");
const legacyDb = new Database(process.env.DB_PATH);
legacyDb.exec(`CREATE TABLE log_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, session_id TEXT,
  ts INTEGER NOT NULL, category TEXT, level TEXT, game TEXT, message TEXT NOT NULL
)`);
legacyDb.prepare("INSERT INTO log_entries(tenant_id,ts,category,message) VALUES(?,?,?,?)")
  .run(83001, Date.now(), "system", "[Jogo] Palavra secreta: resposta antiga");
legacyDb.prepare("INSERT INTO log_entries(tenant_id,ts,category,message) VALUES(?,?,?,?)")
  .run(83001, Date.now() + 1, "system", "[3 Dicas] Dica 1: pista antiga (120s, 30 pts)");
legacyDb.prepare("INSERT INTO log_entries(tenant_id,ts,category,message) VALUES(?,?,?,?)")
  .run(83001, Date.now() + 2, "chat", "[Chat] viewer: comentário antigo");
legacyDb.close();
const db = require("../db");
const logstore = require("../lib/logstore");
const { getTenant, broadcastLog, registerLogPersister } = require("../lib/ws");

test("migrates legacy log schema and redacts persisted game answers", () => {
  assert.equal(logstore.redactLegacyHistory(), 2);
  assert.equal(logstore.normalizeLegacyHistory(), 3);
  const oldRows = logstore.query({ tenantId: 83001, limit: 10 });
  const wordRow = oldRows.find((row) => row.message.startsWith("[Jogo]"));
  const tresRow = oldRows.find((row) => row.message.startsWith("[3 Dicas]"));
  const chatRow = oldRows.find((row) => row.message.startsWith("[Chat]"));
  assert.equal(wordRow.message, "[Jogo] Palavra secreta: [oculta]");
  assert.equal(wordRow.category, "game");
  assert.equal(wordRow.game, "palavra");
  assert.equal(tresRow.message, "[3 Dicas] Dica 1: [dica omitida] (120s, 30 pts)");
  assert.equal(tresRow.category, "game");
  assert.equal(tresRow.game, "tres");
  assert.equal(chatRow.message, "[Chat] viewer: comentário antigo");
  assert.equal(chatRow.category, "chat");
});

test("persists canonical category, event correlation and safe details", () => {
  const appended = logstore.append(83001, {
    text: "[3 Dicas] Rodada 8 iniciada.",
    category: "game",
    level: "info",
    game: "tres",
    event: "tres.round.started",
    source: "python",
    code: "TRES_TEST_EVENT",
    session_id: "session-test",
    trace_id: "trace-test",
    game_id: "8",
    details: { stage: 0, secret_word: "resposta privada" },
  }, "session-test");

  assert.equal(appended.category, "game");
  assert.equal(appended.game, "tres");
  assert.equal(appended.session_id, "session-test");

  const [row] = logstore.query({ tenantId: 83001, limit: 10, trace_id: "trace-test",
    session_id: "session-test", game_id: "8", category: "game", game: "tres",
    level: "info", event: "tres.round.started", source: "python", code: "TRES_TEST_EVENT" });
  assert.equal(row.event, "tres.round.started");
  assert.equal(row.source, "python");
  assert.equal(row.session_id, "session-test");
  assert.equal(row.trace_id, "trace-test");
  assert.equal(row.game_id, "8");
  assert.deepEqual(row.details, { stage: 0, secret_word: "***" });
});

test("WebSocket log delivery persists and preserves canonical 3 Dicas metadata", () => {
  const tenant = getTenant(83002);
  tenant.activeDaemonSessionId = "session-ws";
  const delivered = [];
  tenant.logClients.push({ send: (data) => delivered.push(JSON.parse(data)) });
  registerLogPersister((tenantId, item, activeTenant) =>
    logstore.append(tenantId, item, item.session_id || activeTenant.activeDaemonSessionId));

  broadcastLog(tenant, {
    text: "[3 Dicas] Dica 2 liberada.",
    category: "game", level: "info", game: "tres", event: "tres.clue.revealed",
    source: "python", trace_id: "trace-ws", game_id: "12", details: { stage: 2, clue_text: "privada" },
  });

  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].category, "game");
  assert.equal(delivered[0].game, "tres");
  assert.equal(delivered[0].trace_id, "trace-ws");
  assert.equal(delivered[0].session_id, "session-ws");
  assert.deepEqual(delivered[0].details, { stage: 2, clue_text: "***" });
  const [stored] = logstore.query({ tenantId: 83002, limit: 10, trace_id: "trace-ws" });
  assert.equal(stored.event, "tres.clue.revealed");
  assert.equal(stored.session_id, "session-ws");
  assert.deepEqual(stored.details, { stage: 2, clue_text: "***" });
});

test("chat TTS summaries reach the WebSocket and tenant log store without comment text", () => {
  const tenant = getTenant(83003);
  tenant.activeDaemonSessionId = "session-chat-tts";
  const delivered = [];
  tenant.logClients.push({ send: (data) => delivered.push(JSON.parse(data)) });
  registerLogPersister((tenantId, item, activeTenant) =>
    logstore.append(tenantId, item, item.session_id || activeTenant.activeDaemonSessionId));

  broadcastLog(tenant, {
    text: "Resumo agregado da narração do chat.",
    category: "chat",
    level: "info",
    event: "chat.tts.batch",
    source: "python",
    details: {
      synthesized: 12,
      synthesized_characters: 220,
      configurations: [{ voice: "edge_francisca", rate: 1.4 }],
    },
  });

  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].category, "chat");
  assert.equal(delivered[0].event, "chat.tts.batch");
  assert.equal(delivered[0].session_id, "session-chat-tts");
  assert.doesNotMatch(JSON.stringify(delivered[0]), /comentário bruto|texto privado/);
  const [stored] = logstore.query({ tenantId: 83003, limit: 10, event: "chat.tts.batch" });
  assert.equal(stored.category, "chat");
  assert.equal(stored.session_id, "session-chat-tts");
  assert.deepEqual(stored.details.configurations, [{ voice: "edge_francisca", rate: 1.4 }]);
});

test.after(() => {
  try { db.db.close(); } catch {}
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
});
