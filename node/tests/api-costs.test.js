const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const costs = require("../lib/api-costs");

const db = new Database(":memory:");
costs.ensureSchema(db);

assert.equal(costs.record(db, { provider: "openrouter", model: "google/gemini-test", resource: "chat_voice",
  unit: "character", quantity: 150, status: "success", tenant_id: 4, prompt: "must never be persisted" }), true);
let rows = db.prepare("SELECT * FROM api_cost_usage").all();
assert.equal(rows[0].cost_source, "unknown");
assert.equal(rows[0].tenant_id, 4);
assert.equal(Object.keys(rows[0]).some(key => /prompt|text|secret/i.test(key)), false);

costs.createRate(db, { provider: "openrouter", model: "google/gemini-test", resource: "chat_voice",
  unit: "1000_characters", unit_price: "0.02", currency: "USD", usd_brl: "5.2" }, 99);
costs.record(db, { provider: "openrouter", model: "google/gemini-test", resource: "chat_voice",
  unit: "character", quantity: 150, status: "success", tenant_id: 4 });
rows = db.prepare("SELECT * FROM api_cost_usage ORDER BY rowid").all();
assert.equal(rows[1].cost_source, "estimated");
assert.ok(Math.abs(rows[1].cost_usd - 0.003) < 1e-10);
assert.ok(Math.abs(rows[1].cost_brl - 0.0156) < 1e-10);
assert.equal(rows[0].cost_source, "unknown", "tarifa nova não recalcula chamadas anteriores");

costs.createRate(db, { provider: "openrouter", model: "google/gemini-test", resource: "chat_voice",
  unit: "1000_characters", unit_price: "0.04", currency: "USD", usd_brl: "5.5" }, 99);
costs.record(db, { provider: "openrouter", model: "google/gemini-test", resource: "chat_voice",
  unit: "character", quantity: 150, status: "success", tenant_id: 4 });
rows = db.prepare("SELECT * FROM api_cost_usage ORDER BY rowid").all();
assert.ok(Math.abs(rows[2].cost_usd - 0.006) < 1e-10);
assert.ok(Math.abs(rows[1].cost_usd - 0.003) < 1e-10);

costs.record(db, { provider: "openrouter", model: "google/gemini-test", resource: "chat_voice",
  unit: "character", quantity: 100, status: "success", tenant_id: 4, actual_cost_usd: 0.001,
  prompt: "private text is ignored" });
rows = db.prepare("SELECT * FROM api_cost_usage ORDER BY rowid").all();
assert.equal(rows[3].cost_source, "actual");
assert.equal(rows[3].cost_usd, 0.001);
assert.equal(rows[3].cost_brl, 0.0055, "o câmbio fica capturado junto à chamada real");

assert.equal(costs.createRate(db, { provider: "../bad", resource: "x", unit: "request",
  unit_price: 1, currency: "BRL" }, 1), null);
db.close();
console.log("api-costs.test.js passou (histórico de tarifas, custo real/estimado e privacidade).");
