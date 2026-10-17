const apiCosts = require("../lib/api-costs");

const RANGES = new Set(["24h", "7d", "30d", "month"]);

module.exports = function registerAdminDashboardRoutes(app, { db, auth, log = () => {} }) {
  apiCosts.ensureSchema(db.db);
  const bounds = range => {
    const end = new Date();
    let start = new Date(end);
    if (range === "24h") start.setHours(start.getHours() - 24);
    else if (range === "7d") start.setDate(start.getDate() - 7);
    else if (range === "month") start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    else start.setDate(start.getDate() - 30);
    return { from: start.toISOString(), to: end.toISOString() };
  };
  const safeQuery = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  app.get("/api/admin/dashboard/costs", auth.requireAdmin, (req, res) => {
    const range = RANGES.has(String(req.query.range)) ? String(req.query.range) : "7d";
    const { from, to } = bounds(range);
    const usage = safeQuery(() => db.db.prepare(`SELECT provider,model,resource,unit,status,cost_source,
      COUNT(*) requests,COALESCE(SUM(quantity),0) quantity,AVG(duration_ms) avg_duration_ms,
      SUM(cost_usd) cost_usd,SUM(cost_brl) cost_brl,
      SUM(cost_source='actual') actual_requests,SUM(cost_source='estimated') estimated_requests,
      SUM(cost_source='unknown') unknown_cost_requests,SUM(status='failed' OR status='timeout') failures
      FROM api_cost_usage WHERE occurred_at>=? AND occurred_at<=?
      GROUP BY provider,model,resource,unit,status,cost_source`).all(from, to), []);
    const credits = safeQuery(() => db.db.prepare(`SELECT l.model_id model,COUNT(*) requests,
      SUM(l.unit_count) characters, SUM(-l.amount) credits
      FROM tts_credit_ledger l WHERE l.kind='usage' AND julianday(l.created_at)>=julianday(?)
      AND julianday(l.created_at)<=julianday(?) GROUP BY l.model_id ORDER BY credits DESC`).all(from, to), []);
    const creditTotals = safeQuery(() => db.db.prepare(`SELECT COALESCE(SUM(-amount),0) credits,
      COUNT(*) requests,COALESCE(SUM(unit_count),0) characters FROM tts_credit_ledger
      WHERE kind='usage' AND julianday(created_at)>=julianday(?) AND julianday(created_at)<=julianday(?)`).get(from, to),
      { credits: 0, requests: 0, characters: 0 });
    const revenue = safeQuery(() => db.db.prepare(`SELECT COALESCE(SUM(price_cents),0) gross_cents,COUNT(*) purchases
      FROM tts_credit_purchases WHERE status='approved' AND paid_at IS NOT NULL
      AND julianday(paid_at)>=julianday(?) AND julianday(paid_at)<=julianday(?)`).get(from, to),
      { gross_cents: 0, purchases: 0 });
    const byTenantApi = safeQuery(() => db.db.prepare(`SELECT tenant_id,COUNT(*) requests,
      SUM(cost_usd) cost_usd,SUM(cost_brl) cost_brl FROM api_cost_usage
      WHERE occurred_at>=? AND occurred_at<=? AND tenant_id IS NOT NULL GROUP BY tenant_id`).all(from, to), []);
    const byTenantCredits = safeQuery(() => db.db.prepare(`SELECT tenant_id,SUM(-amount) credits
      FROM tts_credit_ledger WHERE kind='usage' AND julianday(created_at)>=julianday(?)
      AND julianday(created_at)<=julianday(?) GROUP BY tenant_id`).all(from, to), []);
    const contexts = safeQuery(() => db.db.prepare(`SELECT a.model,COUNT(*) requests,
      SUM(a.status='success') succeeded,SUM(a.status!='success') failed,
      SUM(a.cost_usd) cost_usd,SUM(a.cost_usd IS NULL) unknown_cost_requests,
      AVG(a.duration_ms) avg_duration_ms,SUM(COALESCE(a.prompt_tokens,0)+COALESCE(a.completion_tokens,0)) quantity
      FROM context_generation_attempts a
      WHERE julianday(a.created_at)>=julianday(?) AND julianday(a.created_at)<=julianday(?) GROUP BY a.model`).all(from, to), []);
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 86400000).toISOString();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const summarizePeriod = (periodFrom, periodTo) => {
      const metered = safeQuery(() => db.db.prepare(`SELECT COUNT(*) requests,
        SUM(status!='success') failures,SUM(cost_source='actual') actual_requests,
        SUM(cost_source='estimated') estimated_requests,SUM(cost_source='unknown') unknown_cost_requests,
        SUM(CASE WHEN cost_source='actual' THEN cost_usd ELSE 0 END) actual_usd,
        SUM(CASE WHEN cost_source='estimated' THEN cost_usd ELSE 0 END) estimated_usd,
        SUM(CASE WHEN cost_source='actual' THEN cost_brl ELSE 0 END) actual_brl,
        SUM(CASE WHEN cost_source='estimated' THEN cost_brl ELSE 0 END) estimated_brl
        FROM api_cost_usage WHERE occurred_at>=? AND occurred_at<=?`).get(periodFrom, periodTo), {});
      const context = safeQuery(() => db.db.prepare(`SELECT COUNT(*) requests,SUM(a.status!='success') failures,
        SUM(a.cost_usd IS NULL) unknown_cost_requests,SUM(a.cost_usd) actual_usd
        FROM context_generation_attempts a WHERE julianday(a.created_at)>=julianday(?) AND julianday(a.created_at)<=julianday(?)`).get(periodFrom, periodTo), {});
      const periodCredits = safeQuery(() => db.db.prepare(`SELECT COALESCE(SUM(-amount),0) credits FROM tts_credit_ledger
        WHERE kind='usage' AND julianday(created_at)>=julianday(?) AND julianday(created_at)<=julianday(?)`).get(periodFrom, periodTo), { credits: 0 });
      const periodRevenue = safeQuery(() => db.db.prepare(`SELECT COALESCE(SUM(price_cents),0) cents FROM tts_credit_purchases
        WHERE status='approved' AND julianday(paid_at)>=julianday(?) AND julianday(paid_at)<=julianday(?)`).get(periodFrom, periodTo), { cents: 0 });
      const actualUsd = Number(metered.actual_usd || 0) + Number(context.actual_usd || 0);
      const estimatedUsd = Number(metered.estimated_usd || 0);
      return { requests: Number(metered.requests || 0) + Number(context.requests || 0),
        failures: Number(metered.failures || 0) + Number(context.failures || 0),
        actual_requests: Number(metered.actual_requests || 0) + Number(context.requests || 0) - Number(context.unknown_cost_requests || 0),
        estimated_requests: Number(metered.estimated_requests || 0),
        unknown_cost_requests: Number(metered.unknown_cost_requests || 0) + Number(context.unknown_cost_requests || 0),
        actual_usd: actualUsd, estimated_usd: estimatedUsd,
        actual_brl: metered.actual_brl == null ? null : Number(metered.actual_brl),
        estimated_brl: metered.estimated_brl == null ? null : Number(metered.estimated_brl),
        credits: Number(periodCredits.credits || 0), gross_revenue_brl: Number(periodRevenue.cents || 0) / 100 };
    };
    const periodOverview = { today: summarizePeriod(todayStart, now.toISOString()),
      last_7d: summarizePeriod(weekStart, now.toISOString()), month: summarizePeriod(monthStart, now.toISOString()) };
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const monthElapsed = Math.max(1, now.getUTCDate());
    const monthKnownRequests = periodOverview.month.actual_requests + periodOverview.month.estimated_requests;
    const projection = monthKnownRequests ? { available: true,
      actual_requests: periodOverview.month.actual_requests, estimated_requests: periodOverview.month.estimated_requests,
      actual_usd: periodOverview.month.actual_usd * daysInMonth / monthElapsed,
      estimated_usd: periodOverview.month.estimated_usd * daysInMonth / monthElapsed,
      actual_brl: periodOverview.month.actual_brl == null ? null : periodOverview.month.actual_brl * daysInMonth / monthElapsed,
      estimated_brl: periodOverview.month.estimated_brl == null ? null : periodOverview.month.estimated_brl * daysInMonth / monthElapsed,
      unknown_cost_requests: periodOverview.month.unknown_cost_requests, partial: true } : { available: false, partial: false };
    const byProvider = new Map();
    const byResource = new Map();
    for (const row of usage) {
      const item = byProvider.get(row.provider) || { provider: row.provider, requests: 0, failures: 0,
        actual_requests: 0, estimated_requests: 0, unknown_cost_requests: 0, cost_usd: 0, cost_brl: 0,
        duration_weighted_ms: 0, duration_samples: 0, has_usd: false, has_brl: false };
      item.requests += Number(row.requests || 0); item.failures += Number(row.failures || 0);
      item.actual_requests += Number(row.actual_requests || 0); item.estimated_requests += Number(row.estimated_requests || 0);
      item.unknown_cost_requests += Number(row.unknown_cost_requests || 0);
      if (row.avg_duration_ms != null) { item.duration_weighted_ms += Number(row.avg_duration_ms) * Number(row.requests || 0); item.duration_samples += Number(row.requests || 0); }
      if (row.cost_usd !== null) { item.cost_usd += Number(row.cost_usd); item.has_usd = true; }
      if (row.cost_brl !== null) { item.cost_brl += Number(row.cost_brl); item.has_brl = true; }
      byProvider.set(row.provider, item);
      const resourceKey = `${row.provider}|${row.model}|${row.resource}|${row.unit}`;
      const resource = byResource.get(resourceKey) || { provider: row.provider, model: row.model,
        resource: row.resource, unit: row.unit, requests: 0, failures: 0, quantity: 0,
        actual_requests: 0, estimated_requests: 0, unknown_cost_requests: 0, cost_usd: 0, cost_brl: 0,
        duration_weighted_ms: 0, duration_samples: 0,
        has_usd: false, has_brl: false };
      resource.requests += Number(row.requests || 0); resource.failures += Number(row.failures || 0);
      resource.quantity += Number(row.quantity || 0); resource.actual_requests += Number(row.actual_requests || 0);
      resource.estimated_requests += Number(row.estimated_requests || 0);
      resource.unknown_cost_requests += Number(row.unknown_cost_requests || 0);
      if (row.avg_duration_ms != null) { resource.duration_weighted_ms += Number(row.avg_duration_ms) * Number(row.requests || 0); resource.duration_samples += Number(row.requests || 0); }
      if (row.cost_usd !== null) { resource.cost_usd += Number(row.cost_usd); resource.has_usd = true; }
      if (row.cost_brl !== null) { resource.cost_brl += Number(row.cost_brl); resource.has_brl = true; }
      byResource.set(resourceKey, resource);
    }
    const total = [...byProvider.values()].reduce((out, row) => {
      out.requests += row.requests; out.failures += row.failures; out.actual_requests += row.actual_requests;
      out.estimated_requests += row.estimated_requests; out.unknown_cost_requests += row.unknown_cost_requests;
      if (row.has_usd) { out.cost_usd += row.cost_usd; out.has_usd = true; }
      if (row.has_brl) { out.cost_brl += row.cost_brl; out.has_brl = true; }
      return out;
    }, { requests: 0, failures: 0, actual_requests: 0, estimated_requests: 0, unknown_cost_requests: 0,
      cost_usd: 0, cost_brl: 0, has_usd: false, has_brl: false });
    for (const context of contexts) {
      const item = byProvider.get("openrouter") || { provider: "openrouter", requests: 0, failures: 0,
        actual_requests: 0, estimated_requests: 0, unknown_cost_requests: 0, cost_usd: 0, cost_brl: 0,
        duration_weighted_ms: 0, duration_samples: 0, has_usd: false, has_brl: false };
      item.requests += Number(context.requests || 0); item.failures += Number(context.failed || 0);
      item.actual_requests += Number(context.requests || 0) - Number(context.unknown_cost_requests || 0);
      item.unknown_cost_requests += Number(context.unknown_cost_requests || 0);
      if (context.avg_duration_ms != null) { item.duration_weighted_ms += Number(context.avg_duration_ms) * Number(context.requests || 0); item.duration_samples += Number(context.requests || 0); }
      total.requests += Number(context.requests || 0); total.failures += Number(context.failed || 0);
      total.actual_requests += Number(context.requests || 0) - Number(context.unknown_cost_requests || 0);
      total.unknown_cost_requests += Number(context.unknown_cost_requests || 0);
      if (context.cost_usd !== null) {
        item.cost_usd += Number(context.cost_usd); item.has_usd = true;
        total.cost_usd += Number(context.cost_usd); total.has_usd = true;
      }
      byProvider.set("openrouter", item);
      const resourceKey = `openrouter|${context.model}|context_generation|token`;
      const resource = byResource.get(resourceKey) || { provider: "openrouter", model: context.model,
        resource: "context_generation", unit: "token", requests: 0, failures: 0, quantity: 0,
        actual_requests: 0, estimated_requests: 0, unknown_cost_requests: 0, cost_usd: 0, cost_brl: 0,
        duration_weighted_ms: 0, duration_samples: 0, has_usd: false, has_brl: false };
      resource.requests += Number(context.requests || 0); resource.failures += Number(context.failed || 0);
      resource.quantity += Number(context.quantity || 0);
      resource.actual_requests += Number(context.requests || 0) - Number(context.unknown_cost_requests || 0);
      resource.unknown_cost_requests += Number(context.unknown_cost_requests || 0);
      if (context.avg_duration_ms != null) { resource.duration_weighted_ms += Number(context.avg_duration_ms) * Number(context.requests || 0); resource.duration_samples += Number(context.requests || 0); }
      if (context.cost_usd !== null) { resource.cost_usd += Number(context.cost_usd); resource.has_usd = true; }
      byResource.set(resourceKey, resource);
    }
    const clientMap = new Map();
    for (const row of byTenantApi) clientMap.set(row.tenant_id, { tenant_id: row.tenant_id,
      requests: Number(row.requests || 0), cost_usd: row.cost_usd == null ? null : Number(row.cost_usd),
      cost_brl: row.cost_brl == null ? null : Number(row.cost_brl), credits: 0 });
    for (const row of byTenantCredits) {
      const item = clientMap.get(row.tenant_id) || { tenant_id: row.tenant_id, requests: 0,
        cost_usd: null, cost_brl: null, credits: 0 };
      item.credits = Number(row.credits || 0); clientMap.set(row.tenant_id, item);
    }
    res.set("Cache-Control", "no-store").json({ success: true, range, from, to,
      coverage: { api_usage: true, historical_tts_before_instrumentation: false,
        context_generation: contexts.length > 0, currency_conversion: total.has_brl },
      totals: { ...total, cost_usd: total.has_usd ? total.cost_usd : null,
        cost_brl: total.has_brl ? total.cost_brl : null,
        success_rate: total.requests ? (total.requests - total.failures) / total.requests : null },
      period_overview: periodOverview, month_projection: projection,
      by_provider: [...byProvider.values()].map(item => ({ ...item,
        avg_duration_ms: item.duration_samples ? item.duration_weighted_ms / item.duration_samples : null,
        cost_usd: item.has_usd ? item.cost_usd : null, cost_brl: item.has_brl ? item.cost_brl : null,
        success_rate: item.requests ? (item.requests - item.failures) / item.requests : null })),
      by_resource: [...byResource.values()].sort((a, b) => b.requests - a.requests).map(item => ({ ...item,
        avg_duration_ms: item.duration_samples ? item.duration_weighted_ms / item.duration_samples : null,
        cost_usd: item.has_usd ? item.cost_usd : null, cost_brl: item.has_brl ? item.cost_brl : null })),
      usage: usage.filter(row => row.status !== "failed" || row.cost_source !== "unknown"),
      contexts, credits: { ...creditTotals, by_model: credits },
      top_clients: [...clientMap.values()].sort((a, b) => b.credits - a.credits || b.requests - a.requests).slice(0, 10),
      revenue: { gross_brl: Number(revenue.gross_cents || 0) / 100, purchases: Number(revenue.purchases || 0),
        basis: "pagamentos de pacotes de crédito aprovados; valor bruto, sem taxas" } });
  });

  app.get("/api/admin/dashboard/rates", auth.requireAdmin, (req, res) => {
    const rates = db.db.prepare(`SELECT id,provider,model,resource,unit,unit_price,currency,usd_brl,effective_from
      FROM api_cost_rates WHERE effective_until IS NULL ORDER BY provider,resource,model`).all();
    res.set("Cache-Control", "no-store").json({ success: true, rates });
  });

  app.post("/api/admin/dashboard/rates", auth.requireAdmin, (req, res) => {
    const id = apiCosts.createRate(db.db, req.body || {}, req.user.id);
    if (!id) return res.status(400).json({ success: false, error: "Confira provedor, recurso, unidade, valor, moeda e câmbio USD/BRL." });
    log({ category: "billing", level: "info", event: "admin.api_cost_rate.saved",
      message: "Tarifa de custo de API atualizada.", details: { actor_id: req.user.id, rate_id: id,
        provider: String(req.body.provider), resource: String(req.body.resource), model: String(req.body.model || "").slice(0, 120) } });
    res.status(201).json({ success: true, id });
  });
};
