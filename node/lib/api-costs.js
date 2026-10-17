const crypto = require("crypto");

const RATE_UNITS = new Set(["request", "character", "1000_characters", "1000_tokens"]);
const CURRENCIES = new Set(["USD", "BRL"]);

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_cost_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      resource TEXT NOT NULL,
      unit TEXT NOT NULL,
      unit_price REAL NOT NULL CHECK(unit_price >= 0),
      currency TEXT NOT NULL CHECK(currency IN ('USD','BRL')),
      usd_brl REAL,
      effective_from TEXT NOT NULL,
      effective_until TEXT,
      actor_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_api_cost_rates_lookup
      ON api_cost_rates(provider,model,resource,effective_from DESC);
    CREATE TABLE IF NOT EXISTS api_cost_usage (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      provider_request_id TEXT,
      tenant_id INTEGER,
      provider TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      resource TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('success','failed','timeout')),
      duration_ms INTEGER,
      cost_source TEXT NOT NULL CHECK(cost_source IN ('actual','estimated','unknown')),
      cost_usd REAL,
      cost_brl REAL,
      rate_id INTEGER,
      fx_usd_brl REAL,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_cost_usage_time ON api_cost_usage(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_cost_usage_provider_time ON api_cost_usage(provider,occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_cost_usage_tenant_time ON api_cost_usage(tenant_id,occurred_at DESC);
  `);
}

function normalizeUsage(input = {}) {
  const safeText = (value, max = 120) => String(value || "").trim().replace(/[^\w./:@-]/g, "_").slice(0, max);
  const provider = safeText(input.provider, 40).toLowerCase();
  const model = safeText(input.model, 120);
  const resource = safeText(input.resource, 80).toLowerCase();
  const unit = RATE_UNITS.has(input.unit) ? input.unit : "request";
  const quantity = Number(input.quantity);
  const status = ["success", "failed", "timeout"].includes(input.status) ? input.status : "failed";
  const duration = Number(input.duration_ms);
  const actual = input.actual_cost_usd == null || input.actual_cost_usd === "" ? NaN : Number(input.actual_cost_usd);
  if (!provider || !resource || !Number.isFinite(quantity) || quantity < 0) return null;
  return {
    id: crypto.randomUUID(), request_id: safeText(input.request_id, 80) || crypto.randomUUID(),
    provider_request_id: safeText(input.provider_request_id, 120) || null,
    tenant_id: Number.isSafeInteger(Number(input.tenant_id)) && Number(input.tenant_id) > 0 ? Number(input.tenant_id) : null,
    provider, model, resource, unit, quantity, status,
    duration_ms: Number.isFinite(duration) && duration >= 0 ? Math.min(Math.round(duration), 3600000) : null,
    actual_cost_usd: Number.isFinite(actual) && actual >= 0 ? actual : null,
  };
}

function record(db, input) {
  const item = normalizeUsage(input);
  if (!item) return false;
  const now = new Date().toISOString();
  const rate = db.prepare(`SELECT * FROM api_cost_rates WHERE provider=? AND resource=?
    AND (model=? OR model='') AND effective_from<=? AND (effective_until IS NULL OR effective_until>?)
    ORDER BY CASE WHEN model=? THEN 0 ELSE 1 END,effective_from DESC,id DESC LIMIT 1`)
    .get(item.provider, item.resource, item.model, now, now, item.model);
  let costSource = "unknown", costUsd = null, costBrl = null, fx = null, rateId = null;
  if (item.actual_cost_usd !== null) {
    costSource = "actual";
    costUsd = item.actual_cost_usd;
    if (rate?.usd_brl > 0) { costBrl = costUsd * rate.usd_brl; fx = rate.usd_brl; rateId = rate.id; }
  } else if (rate) {
    const divisor = rate.unit === "1000_characters" || rate.unit === "1000_tokens" ? 1000 : 1;
    const matchesUnit = rate.unit === item.unit || (rate.unit === "1000_characters" && item.unit === "character")
      || (rate.unit === "1000_tokens" && item.unit === "token");
    if (matchesUnit) {
      const amount = (item.quantity / divisor) * rate.unit_price;
      costSource = "estimated"; rateId = rate.id;
      if (rate.currency === "USD") { costUsd = amount; fx = rate.usd_brl || null; if (fx) costBrl = amount * fx; }
      else { costBrl = amount; fx = rate.usd_brl || null; if (fx) costUsd = amount / fx; }
    }
  }
  db.prepare(`INSERT OR IGNORE INTO api_cost_usage(id,request_id,provider_request_id,tenant_id,provider,model,resource,unit,quantity,
    status,duration_ms,cost_source,cost_usd,cost_brl,rate_id,fx_usd_brl,occurred_at)
    VALUES(@id,@request_id,@provider_request_id,@tenant_id,@provider,@model,@resource,@unit,@quantity,@status,@duration_ms,
    @cost_source,@cost_usd,@cost_brl,@rate_id,@fx_usd_brl,@occurred_at)`)
    .run({ ...item, cost_source: costSource, cost_usd: costUsd, cost_brl: costBrl, rate_id: rateId, fx_usd_brl: fx,
      occurred_at: input.occurred_at || now });
  return true;
}

function createRate(db, body, actorId) {
  const provider = String(body.provider || "").trim().toLowerCase();
  const model = String(body.model || "").trim().slice(0, 120);
  const resource = String(body.resource || "").trim().toLowerCase();
  const unit = String(body.unit || "");
  const currency = String(body.currency || "").toUpperCase();
  const unitPrice = Number(body.unit_price);
  const usdBrl = body.usd_brl === "" || body.usd_brl == null ? null : Number(body.usd_brl);
  if (!/^[a-z0-9_.-]{2,40}$/.test(provider) || !/^[a-z0-9_.-]{2,80}$/.test(resource)
      || !/^[a-zA-Z0-9._/: -]{0,120}$/.test(model)
      || !RATE_UNITS.has(unit) || !CURRENCIES.has(currency) || !Number.isFinite(unitPrice) || unitPrice < 0
      || (currency === "USD" && (!Number.isFinite(usdBrl) || usdBrl <= 0))
      || (usdBrl !== null && (!Number.isFinite(usdBrl) || usdBrl <= 0 || usdBrl > 10000))) return null;
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE api_cost_rates SET effective_until=? WHERE provider=? AND model=? AND resource=? AND effective_until IS NULL`)
      .run(now, provider, model, resource);
    const result = db.prepare(`INSERT INTO api_cost_rates(provider,model,resource,unit,unit_price,currency,usd_brl,effective_from,actor_id)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(provider, model, resource, unit, unitPrice, currency, usdBrl, now, actorId || null);
    return result.lastInsertRowid;
  });
  return tx.immediate();
}

module.exports = { ensureSchema, normalizeUsage, record, createRate, RATE_UNITS, CURRENCIES };
