// Relatórios do streamer: resumo, série, ranking e eventos por live (room_id).
//
// Todas as rotas são autenticadas e SEMPRE escopadas por `req.user.id` (tenant da
// sessão). NUNCA aceitam `tenant_id` do navegador. Datas em UTC (epoch ms).

function parseTime(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function bucketMs(value) {
  const v = String(value || "").toLowerCase();
  if (v === "hour" || v === "hora") return 3600000;
  if (v === "day" || v === "dia") return 86400000;
  return 60000; // minute
}

function parseLimit(value, def, max) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : def;
}

module.exports = function registerReportRoutes(app, ctx = {}) {
  const { db, auth } = ctx;

  app.get("/api/live-sessions", auth.requireAuth, (req, res) => {
    const from = parseTime(req.query.from);
    const to = parseTime(req.query.to);
    const limit = parseLimit(req.query.limit, 100, 500);
    const sessions = db.getLiveSessions(req.user.id, { from, to, limit });
    res.json({ success: true, sessions });
  });

  app.get("/api/reports/summary", auth.requireAuth, (req, res) => {
    const summary = db.summaryInteractions({
      tenantId: req.user.id,
      from: parseTime(req.query.from),
      to: parseTime(req.query.to),
      room_id: req.query.room_id ? String(req.query.room_id) : null,
    });
    res.json({ success: true, ...summary });
  });

  app.get("/api/reports/series", auth.requireAuth, (req, res) => {
    const series = db.seriesInteractions({
      tenantId: req.user.id,
      from: parseTime(req.query.from),
      to: parseTime(req.query.to),
      room_id: req.query.room_id ? String(req.query.room_id) : null,
      type: req.query.type ? String(req.query.type) : null,
      bucketMs: bucketMs(req.query.bucket),
    });
    res.json({ success: true, ...series });
  });

  app.get("/api/reports/ranking", auth.requireAuth, (req, res) => {
    const ranking = db.rankingInteractions({
      tenantId: req.user.id,
      from: parseTime(req.query.from),
      to: parseTime(req.query.to),
      room_id: req.query.room_id ? String(req.query.room_id) : null,
      type: req.query.type ? String(req.query.type) : null,
      limit: parseLimit(req.query.limit, 20, 200),
    });
    res.json({ success: true, ...ranking });
  });

  app.get("/api/reports/events", auth.requireAuth, (req, res) => {
    const result = db.queryInteractions({
      tenantId: req.user.id,
      from: parseTime(req.query.from),
      to: parseTime(req.query.to),
      room_id: req.query.room_id ? String(req.query.room_id) : null,
      type: req.query.type ? String(req.query.type) : null,
      cursor: req.query.cursor ? Number(req.query.cursor) : null,
      limit: parseLimit(req.query.limit, 50, 200),
    });
    res.json({ success: true, events: result.events, next_cursor: result.next_cursor });
  });

  // Níveis atuais (presenteador / fã-clube) por usuário. Com room_id usa o baseline
  // da live; sem, o nível global conhecido.
  app.get("/api/reports/levels", auth.requireAuth, (req, res) => {
    const levels = db.listViewerLevels(req.user.id, {
      room_id: req.query.room_id ? String(req.query.room_id) : null,
      limit: parseLimit(req.query.limit, 100, 500),
    });
    res.json({ success: true, room_id: req.query.room_id ? String(req.query.room_id) : null, levels });
  });
};
