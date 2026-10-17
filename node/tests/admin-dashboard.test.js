const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const db = new Database(":memory:");
db.exec(`CREATE TABLE tts_credit_ledger(tenant_id INTEGER,amount INTEGER,kind TEXT,model_id TEXT,unit_count INTEGER,created_at TEXT);
  CREATE TABLE tts_credit_purchases(price_cents INTEGER,status TEXT,paid_at TEXT);
  CREATE TABLE context_generation_attempts(model TEXT,status TEXT,cost_usd REAL,created_at TEXT,duration_ms INTEGER,prompt_tokens INTEGER,completion_tokens INTEGER);
  CREATE TABLE context_generation_runs(created_at TEXT);`);
const app = { routes: new Map(), get(path, ...handlers) { this.routes.set(`GET ${path}`, handlers.at(-1)); },
  post(path, ...handlers) { this.routes.set(`POST ${path}`, handlers.at(-1)); } };
const logs = [];
const auth = { requireAdmin: (_req, _res, next) => next() };
require("../routes/admin-dashboard")(app, { db: { db }, auth, log: event => logs.push(event) });
const apiCosts = require("../lib/api-costs");

function res() { return { statusCode: 200, status(code) { this.statusCode = code; return this; },
  set() { return this; }, json(body) { this.body = body; return this; } }; }
async function call(method, path, req = {}) {
  const response = res();
  await app.routes.get(`${method} ${path}`)({ user: { id: 3 }, query: {}, body: {}, ...req }, response);
  return response;
}

(async () => {
  const now = new Date().toISOString();
  apiCosts.createRate(db, { provider: "elevenlabs", model: "eleven_v4_turbo", resource: "chat_voice",
    unit: "1000_characters", unit_price: 0.5, currency: "BRL" }, 3);
  apiCosts.record(db, { provider: "elevenlabs", model: "eleven_v4_turbo", resource: "chat_voice",
    unit: "character", quantity: 80, status: "success", duration_ms: 600, tenant_id: 42 });
  db.prepare("INSERT INTO tts_credit_ledger VALUES(42,-3,'usage','elevenlabs/eleven-v4-turbo',80,?)").run(now);
  db.prepare("INSERT INTO tts_credit_purchases VALUES(2990,'approved',?)").run(now);
  db.prepare("INSERT INTO context_generation_attempts VALUES('anthropic/test','success',0.02,?,1200,100,50)").run(now);

  let response = await call("GET", "/api/admin/dashboard/costs", { query: { range: "7d" } });
  assert.equal(response.body.success, true);
  assert.equal(response.body.credits.credits, 3);
  assert.equal(response.body.credits.characters, 80);
  assert.equal(response.body.revenue.gross_brl, 29.9);
  assert.equal(response.body.contexts[0].cost_usd, 0.02);
  assert.equal(response.body.period_overview.today.requests, 2);
  assert.equal(response.body.month_projection.available, true);
  assert.equal(response.body.month_projection.partial, true);
  assert.ok(response.body.by_resource.some(row => row.resource === "chat_voice" && row.quantity === 80));
  assert.equal(response.body.top_clients[0].tenant_id, 42);
  assert.equal(response.body.totals.requests, 2);
  assert.equal(response.body.totals.estimated_requests, 1);

  response = await call("POST", "/api/admin/dashboard/rates", { body: { provider: "bad provider", resource: "chat_voice",
    unit: "request", unit_price: 1, currency: "BRL" } });
  assert.equal(response.statusCode, 400);
  response = await call("POST", "/api/admin/dashboard/rates", { body: { provider: "openrouter", model: "test",
    resource: "test_resource", unit: "request", unit_price: 1, currency: "BRL" } });
  assert.equal(response.statusCode, 201);
  assert.equal(logs[0].event, "admin.api_cost_rate.saved");
  db.close();
  console.log("admin-dashboard.test.js passou (agregação, custos, receita e validação de tarifa).");
})().catch(error => { db.close(); console.error(error); process.exitCode = 1; });
