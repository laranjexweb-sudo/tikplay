// Rotas do Monitor de Servidor (Super Admin).
//
// Modelo híbrido:
//  - REST (polling): snapshot, series, widget, incidents, silences, thresholds.
//  - SSE: /api/admin/monitor/events — só alertas/incidentes/status de serviço.
//
// Autenticação: REST via Bearer + requireAdmin. O SSE não usa header (EventSource
// não envia Authorization), então usa ticket de uso único e curta duração obtido
// em POST /api/admin/monitor/events-ticket.

const crypto = require("crypto");

const SSE_TICKET_TTL_MS = 60000;

module.exports = function registerMonitorRoutes(app, ctx = {}) {
  const { db, auth, metrics, monitor, sse, getDaemonStatus, tenants, ttsConfigured } = ctx;

  const tickets = new Map(); // token -> { adminId, exp, used }

  function pruneTickets() {
    const now = Date.now();
    for (const [token, t] of tickets) if (t.exp <= now || t.used) tickets.delete(token);
  }

  function snapshotDeps() {
    return { db, tenants, metrics, getDaemonStatus, ttsConfigured };
  }

  function safeSnapshot() {
    try {
      return monitor.buildSnapshot(snapshotDeps());
    } catch (e) {
      return {
        generated_at: new Date().toISOString(),
        environment: process.env.MONITOR_ENV || process.env.NODE_ENV || "production",
        overall: { status: "unknown", label: "Indeterminado" },
        host: null, nodes: [], services: [], websocket: null, database: null,
        platform: null, latency: null, rates: null, alerts: [], silenced_alerts: 0,
        incidents: { active: 0, items: [] }, degraded_sections: ["snapshot"],
        error: e && e.message,
      };
    }
  }

  // ---------------- REST ----------------

  app.get("/api/admin/monitor/snapshot", auth.requireAdmin, (req, res) => {
    res.json({ success: true, snapshot: safeSnapshot() });
  });

  app.get("/api/admin/monitor/series", auth.requireAdmin, (req, res) => {
    const data = metrics.getSeries({ windowMin: req.query.window, bucketSec: req.query.bucket });
    res.json({ success: true, ...data });
  });

  app.get("/api/admin/monitor/widget", auth.requireAdmin, (req, res) => {
    const snap = safeSnapshot();
    const services = snap.services || [];
    const byStatus = { healthy: 0, attention: 0, warning: 0, degraded: 0, down: 0, unknown: 0 };
    for (const s of services) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    const database = snap.database || {};
    res.json({
      success: true,
      generated_at: snap.generated_at,
      overall: snap.overall,
      services: {
        total: services.length,
        ok: byStatus.healthy,
        issues: services.length - byStatus.healthy,
        by_status: byStatus,
      },
      latency: snap.latency ? { avg_ms: snap.latency.avg, p95_ms: snap.latency.p95, window_min: snap.latency.window_min } : null,
      errors_5min: snap.rates ? snap.rates.errors : null,
      error_rate: snap.rates ? snap.rates.error_rate : null,
      streamers_online: snap.platform ? snap.platform.streamers_online : null,
      sessions: snap.websocket ? snap.websocket.clients_total : null,
      cpu_pct: snap.host ? snap.host.cpu_pct : null,
      ram_pct: snap.host && snap.host.ram ? snap.host.ram.pct : null,
      disk_pct: snap.host && snap.host.disk ? snap.host.disk.pct : null,
      db_status: database.status || null,
    });
  });

  app.get("/api/admin/monitor/thresholds", auth.requireAdmin, (req, res) => {
    res.json({ success: true, thresholds: monitor.THRESHOLDS, error_rate_window_min: monitor.ERROR_RATE_WINDOW_MIN });
  });

  app.get("/api/admin/monitor/incidents", auth.requireAdmin, (req, res) => {
    const items = db.listMonitorIncidents({ status: req.query.status || "all", limit: req.query.limit }).map(monitor.publicIncident);
    res.json({ success: true, items, active: db.countActiveMonitorIncidents() });
  });

  app.post("/api/admin/monitor/incidents/:id/ack", auth.requireAdmin, (req, res) => {
    const inc = db.ackMonitorIncident(parseInt(req.params.id, 10), req.user.id, Date.now());
    if (!inc) return res.status(404).json({ success: false, error: "Incidente não encontrado ou já reconhecido" });
    res.json({ success: true, incident: monitor.publicIncident(inc) });
  });

  app.post("/api/admin/monitor/incidents/:id/resolve", auth.requireAdmin, (req, res) => {
    const inc = db.resolveMonitorIncident(parseInt(req.params.id, 10), Date.now());
    if (!inc) return res.status(404).json({ success: false, error: "Incidente não encontrado ou já resolvido" });
    res.json({ success: true, incident: monitor.publicIncident(inc) });
  });

  app.get("/api/admin/monitor/silences", auth.requireAdmin, (req, res) => {
    const all = req.query.all === "1";
    res.json({ success: true, silences: db.listMonitorSilences({ activeOnly: !all }) });
  });

  app.post("/api/admin/monitor/silences", auth.requireAdmin, (req, res) => {
    const b = req.body || {};
    const key = String(b.key || "").trim();
    if (!key) return res.status(400).json({ success: false, error: "key obrigatória" });
    const minutes = Math.max(1, Math.min(7 * 24 * 60, parseInt(b.minutes, 10) || 60));
    const until = Date.now() + minutes * 60000;
    const silence = db.setMonitorSilence(key, until, req.user.id);
    res.status(201).json({ success: true, silence });
  });

  app.delete("/api/admin/monitor/silences/:key", auth.requireAdmin, (req, res) => {
    const ok = db.deleteMonitorSilence(String(req.params.key));
    if (!ok) return res.status(404).json({ success: false, error: "Silêncio não encontrado" });
    res.json({ success: true });
  });

  // ---------------- SSE ----------------

  app.post("/api/admin/monitor/events-ticket", auth.requireAdmin, (req, res) => {
    pruneTickets();
    const token = crypto.randomBytes(24).toString("base64url");
    tickets.set(token, { adminId: req.user.id, exp: Date.now() + SSE_TICKET_TTL_MS, used: false });
    res.json({ success: true, ticket: token, expires_in_ms: SSE_TICKET_TTL_MS });
  });

  app.get("/api/admin/monitor/events", (req, res) => {
    const token = String(req.query.ticket || "");
    const entry = tickets.get(token);
    if (!entry || entry.used || entry.exp <= Date.now()) {
      return res.status(401).json({ success: false, error: "Ticket SSE inválido ou expirado" });
    }
    entry.used = true;          // single-use: invalida imediatamente
    tickets.delete(token);
    sse.addClient(req, res, { admin_id: entry.adminId });
  });
};
