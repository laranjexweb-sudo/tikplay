// Núcleo do Monitor de Servidor: coleta de seções, derivação de alertas,
// motor de incidentes (sem duplicatas por key) e status de serviços.
//
// Separação de responsabilidades:
//  - funções puras (wsMetrics, platformMetrics, deriveAlerts, overallStatus,
//    planIncidentTransitions) — testáveis sem I/O;
//  - buildSnapshot/collectAlertInputs — agregam dependências, cada seção isolada
//    em try/catch (uma métrica que falha NÃO derruba o snapshot inteiro);
//  - createEngine — laço periódico que persiste transições e emite SSE.

const os = require("os");
const fs = require("fs");
const path = require("path");
const activity = require("./admin-activity");

// Limiares efetivos (fase 1). Editar aqui altera o comportamento global.
const THRESHOLDS = {
  cpu_pct: { warn: 85, crit: 95 },
  ram_pct: { warn: 85, crit: 95 },
  disk_pct: { warn: 80, crit: 90 },
  api_p95_ms: { warn: 400, crit: 800 },
  error_rate: { warn: 0.01, crit: 0.05 }, // janela de 5 min
  db_read_ms: { warn: 100, crit: 500 },
};

const ERROR_RATE_WINDOW_MIN = 5;
const ENGINE_INTERVAL_MS = 20000;

const STATUS_LABELS = {
  healthy: "Saudável",
  attention: "Atenção",
  degraded: "Degradação",
  down: "Indisponível",
  unknown: "Indeterminado",
};

const SEVERITY_RANK = { healthy: 0, warning: 1, critical: 2 };

// ---------------- Funções puras ----------------

function severityFrom(value, { warn, crit }) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= crit) return "critical";
  if (value >= warn) return "warning";
  return null;
}

function wsMetrics(tenants) {
  let panels = 0;
  let overlays = 0;
  if (tenants && typeof tenants.values === "function") {
    for (const t of tenants.values()) {
      panels += activity.openClientCount(t.logClients);
      overlays += activity.openClientCount(t.browserClients);
    }
  }
  return { clients_total: panels + overlays, panels, overlays };
}

function platformMetrics({ tenants, stats }) {
  let streamers_online = 0;
  let lives_connected = 0;
  let reconnecting = 0;
  let games_active = 0;
  if (tenants && typeof tenants.values === "function") {
    for (const t of tenants.values()) {
      if (activity.openClientCount(t.logClients) > 0) streamers_online++;
      const tk = activity.mapTiktokStatus(t);
      if (tk === "connected") lives_connected++;
      else if (tk === "reconnecting") reconnecting++;
      const g = activity.currentGame(t);
      if (g.status === "running" || g.status === "paused") games_active++;
    }
  }
  const s = stats || {};
  return {
    streamers_online,
    lives_connected,
    reconnecting,
    games_active,
    open_tickets: s.open_tickets || 0,
    new_users_today: s.new_users_today || 0,
    users_total: s.users_total || 0,
    users_active: s.users_active || 0,
    games_today: s.games_today || 0,
    plans: s.plans || {},
  };
}

function dbMetrics(dbMod) {
  const baseDir = path.join(__dirname, "..");
  const dbPath = process.env.DB_PATH || path.join(baseDir, "data.db");
  const sizeOf = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };
  const start = process.hrtime.bigint();
  let healthy = false;
  try {
    dbMod.db.prepare("SELECT 1").get();
    healthy = true;
  } catch { /* down */ }
  const readMs = Number(process.hrtime.bigint() - start) / 1e6;
  const count = (sql) => { try { return dbMod.db.prepare(sql).get().c; } catch { return null; } };
  return {
    status: healthy ? "healthy" : "down",
    path: dbPath,
    size_bytes: sizeOf(dbPath),
    wal_bytes: sizeOf(dbPath + "-wal"),
    shm_bytes: sizeOf(dbPath + "-shm"),
    read_latency_ms: Math.round(readMs * 100) / 100,
    rows: {
      users: count("SELECT COUNT(*) c FROM users"),
      games: count("SELECT COUNT(*) c FROM games"),
      log_entries: count("SELECT COUNT(*) c FROM log_entries"),
    },
  };
}

// Entradas necessárias para derivar alertas; cada leitura isolada.
function collectAlertInputs({ db: dbMod, metrics, daemon, host }) {
  const dbInfo = safe(() => dbMetrics(dbMod), null);
  return {
    host: host || null,
    latency: safe(() => metrics.getLatency(), { p95: null, avg: null }),
    rates: safe(() => metrics.getRates(ERROR_RATE_WINDOW_MIN), { error_rate: 0, requests: 0 }),
    database: dbInfo,
    daemon: daemon || { alive: false },
  };
}

function deriveAlerts({ host, latency, rates, database, daemon }) {
  const alerts = [];
  const push = (key, severity, title, detail, source) => {
    if (severity) alerts.push({ key, severity, title, detail: String(detail), source });
  };

  if (host) {
    push("host.cpu_high", severityFrom(host.cpu_pct, THRESHOLDS.cpu_pct), "CPU alta", `${host.cpu_pct}%`, "host");
    const ramPct = host.ram ? host.ram.pct : null;
    push("host.ram_high", severityFrom(ramPct, THRESHOLDS.ram_pct), "RAM alta", `${ramPct}%`, "host");
    const diskPct = host.disk ? host.disk.pct : null;
    push("host.disk_high", severityFrom(diskPct, THRESHOLDS.disk_pct), "Disco quase cheio", `${diskPct}%`, "host");
  }

  if (latency && latency.p95 != null) {
    push("api.latency_high", severityFrom(latency.p95, THRESHOLDS.api_p95_ms), "Latência da API alta", `p95 ${latency.p95}ms`, "api");
  }

  if (rates && rates.requests > 0) {
    push("api.error_rate_high", severityFrom(rates.error_rate, THRESHOLDS.error_rate), "Taxa de erro alta", `${(rates.error_rate * 100).toFixed(2)}% em ${ERROR_RATE_WINDOW_MIN}min`, "api");
  }

  if (daemon && daemon.alive === false) {
    alerts.push({ key: "daemon.down", severity: "critical", title: "Daemon Python indisponível", detail: "processo ausente", source: "daemon" });
  }

  if (database) {
    if (database.status === "down") {
      alerts.push({ key: "db.down", severity: "critical", title: "Banco de dados indisponível", detail: "SELECT 1 falhou", source: "db" });
    } else {
      push("db.read_slow", severityFrom(database.read_latency_ms, THRESHOLDS.db_read_ms), "Banco lento", `${database.read_latency_ms}ms`, "db");
    }
  }

  return alerts;
}

function overallStatus(alerts, services) {
  const coreDown = (services || []).some((s) => s.status === "down");
  if (coreDown) return "down";
  if ((alerts || []).some((a) => a.severity === "critical")) return "degraded";
  const serviceWarn = (services || []).some((s) => s.status === "warning" || s.status === "degraded");
  if ((alerts || []).length > 0 || serviceWarn) return "attention";
  return "healthy";
}

function servicesHealth({ metrics, database, host, ws, daemon, platform, ttsConfigured }) {
  const svc = [];
  const latency = safe(() => metrics.getLatency(), { p95: null, avg: null, p99: null });
  const rates = safe(() => metrics.getRates(ERROR_RATE_WINDOW_MIN), { requests_per_min: 0 });
  const wsEvents = safe(() => metrics.getRates(ERROR_RATE_WINDOW_MIN), { ws_events: 0 });

  // API
  let apiStatus = "healthy";
  const latSev = severityFrom(latency.p95, THRESHOLDS.api_p95_ms);
  if (latSev) apiStatus = latSev === "critical" ? "degraded" : "warning";
  svc.push({
    id: "api", name: "API Principal", status: apiStatus,
    metrics: {
      latency_avg_ms: latency.avg, latency_p95_ms: latency.p95, latency_p99_ms: latency.p99,
      requests_per_min: rates.requests_per_min,
      uptime_s: Math.round(process.uptime()),
    },
    note: null,
  });

  // WebSocket
  svc.push({
    id: "ws", name: "WebSocket / Tempo real", status: "healthy",
    metrics: {
      clients_total: ws.clients_total, panels: ws.panels, overlays: ws.overlays,
      events_per_min: Math.round((wsEvents.ws_events || 0) / ERROR_RATE_WINDOW_MIN),
    },
    note: null,
  });

  // Banco
  let dbStatus = database ? database.status : "down";
  if (dbStatus === "healthy") {
    const sev = severityFrom(database.read_latency_ms, THRESHOLDS.db_read_ms);
    if (sev) dbStatus = sev === "critical" ? "degraded" : "warning";
  }
  svc.push({
    id: "db", name: "Banco de Dados", status: dbStatus,
    metrics: database ? { read_latency_ms: database.read_latency_ms, size_bytes: database.size_bytes, wal_bytes: database.wal_bytes, rows: database.rows } : {},
    note: null,
  });

  // Daemon Python
  svc.push({
    id: "daemon", name: "Daemon Python", status: daemon && daemon.alive ? "healthy" : "down",
    metrics: daemon ? { pid: daemon.pid, backoff_ms: daemon.backoff } : {},
    note: daemon && daemon.alive ? null : "processo ausente",
  });

  // Armazenamento / uploads
  const diskPct = host && host.disk ? host.disk.pct : null;
  let storageStatus = "healthy";
  const diskSev = severityFrom(diskPct, THRESHOLDS.disk_pct);
  if (diskSev) storageStatus = diskSev === "critical" ? "degraded" : "warning";
  svc.push({
    id: "storage", name: "Armazenamento / uploads", status: diskPct == null ? "unknown" : storageStatus,
    metrics: host && host.disk ? { used_bytes: host.disk.used, total_bytes: host.disk.total, pct: host.disk.pct } : {},
    note: diskPct == null ? "disco indisponível" : null,
  });

  // Áudio / TTS (serviço externo opcional)
  svc.push({
    id: "tts", name: "Áudio / TTS", status: ttsConfigured ? "healthy" : "unknown",
    metrics: {},
    note: ttsConfigured ? null : "não configurado",
  });

  // Conexão TikTok (agregado das lives)
  const tkStatus = platform.reconnecting > 0 ? "warning" : "healthy";
  svc.push({
    id: "tiktok", name: "Conexão TikTok", status: tkStatus,
    metrics: { lives_connected: platform.lives_connected, reconnecting: platform.reconnecting },
    note: platform.lives_connected === 0 ? "sem lives conectadas" : null,
  });

  return svc;
}

// Transições de incidentes: no máximo 1 ativo por key; sem duplicatas.
function planIncidentTransitions(currentAlerts, openIncidents, silences, now) {
  const openByKey = new Map();
  for (const inc of openIncidents || []) {
    if (!openByKey.has(inc.key)) openByKey.set(inc.key, inc);
  }
  const silentKeys = new Set((silences || []).map((s) => s.key));
  const currentKeys = new Set((currentAlerts || []).map((a) => a.key));

  const open = [];
  const update = [];
  const resolve = [];

  for (const alert of currentAlerts || []) {
    const existing = openByKey.get(alert.key);
    const silent = silentKeys.has(alert.key);
    if (!existing) {
      open.push({ alert, silent });
    } else {
      update.push({
        incident: existing,
        alert,
        silent,
        severityChanged: existing.severity !== alert.severity,
      });
    }
  }
  for (const inc of openIncidents || []) {
    if (!currentKeys.has(inc.key)) resolve.push({ incident: inc });
  }
  return { open, update, resolve };
}

// ---------------- Coleta com isolamento por seção ----------------

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

function buildSnapshot({ db: dbMod, tenants, metrics, getDaemonStatus, ttsConfigured }) {
  const degraded = [];

  const hostSample = safe(() => metrics.getHost(), null);
  const host = {
    hostname: safe(() => os.hostname(), "unknown"),
    platform: process.platform,
    node_version: process.version,
    uptime_s: Math.round(process.uptime()),
    loadavg: safe(() => os.loadavg(), [0, 0, 0]),
    cores: safe(() => os.cpus().length, null),
    cpu_pct: hostSample ? hostSample.cpu_pct : null,
    ram: hostSample ? hostSample.ram : null,
    disk: hostSample ? hostSample.disk : null,
    sampled_at: hostSample ? hostSample.sampled_at : null,
  };

  const daemon = safe(() => (getDaemonStatus ? getDaemonStatus() : { alive: false }), { alive: false });
  const database = safe(() => dbMetrics(dbMod), null);
  if (!database) degraded.push("database");

  const ws = safe(() => wsMetrics(tenants), { clients_total: 0, panels: 0, overlays: 0 });

  const stats = safe(() => dbMod.getMonitorPlatformStats(), null) || {};
  const platform = safe(() => platformMetrics({ tenants, stats }), {});
  if (!stats) degraded.push("platform");

  const inputs = collectAlertInputs({ db: dbMod, metrics, daemon, host: { cpu_pct: host.cpu_pct, ram: host.ram, disk: host.disk } });
  const allAlerts = safe(() => deriveAlerts(inputs), []);
  const latency = safe(() => metrics.getLatency(), { p50: null, p95: null, p99: null, avg: null, window_min: 15, count: 0 });
  const rates = safe(() => metrics.getRates(ERROR_RATE_WINDOW_MIN), { requests: 0, errors: 0, error_rate: 0, window_min: ERROR_RATE_WINDOW_MIN });

  const silences = safe(() => dbMod.listMonitorSilences({ activeOnly: true }), []);
  const silentKeys = new Set(silences.map((s) => s.key));
  const visibleAlerts = allAlerts.filter((a) => !silentKeys.has(a.key));

  if (!hostSample) degraded.push("host");

  const services = safe(() => servicesHealth({ metrics, database, host, ws, daemon, platform, ttsConfigured }), []);
  const status = overallStatus(allAlerts, services);

  const activeIncidents = safe(() => dbMod.listMonitorIncidents({ status: "open" }), []);

  return {
    generated_at: new Date().toISOString(),
    environment: process.env.MONITOR_ENV || process.env.NODE_ENV || "production",
    overall: { status, label: STATUS_LABELS[status] || status },
    host,
    nodes: [{
      id: host.hostname, role: "app", status,
      cpu_pct: host.cpu_pct,
      ram_pct: host.ram ? host.ram.pct : null,
      disk_pct: host.disk ? host.disk.pct : null,
      network: "unknown",
      uptime_s: host.uptime_s,
    }],
    services,
    websocket: {
      clients_total: ws.clients_total,
      panels: ws.panels,
      overlays: ws.overlays,
      events_per_min: safe(() => Math.round((metrics.getRates(ERROR_RATE_WINDOW_MIN).ws_events || 0) / ERROR_RATE_WINDOW_MIN), null),
    },
    database,
    platform,
    latency: { ...latency, window_min: latency.window_min || metrics.LATENCY_WINDOW_MIN_DEFAULT },
    rates,
    alerts: visibleAlerts,
    silenced_alerts: allAlerts.length - visibleAlerts.length,
    incidents: {
      active: activeIncidents.length,
      items: activeIncidents.map(publicIncident),
    },
    degraded_sections: degraded,
  };
}

function publicIncident(inc) {
  if (!inc) return null;
  return {
    id: inc.id,
    key: inc.key,
    severity: inc.severity,
    title: inc.title,
    detail: inc.detail,
    source: inc.source,
    status: inc.status,
    first_seen: inc.first_seen,
    last_seen: inc.last_seen,
    resolved_at: inc.resolved_at || null,
    ack_by: inc.ack_by || null,
    ack_at: inc.ack_at || null,
  };
}

// ---------------- Motor (persistência + SSE) ----------------

function createEngine({ db: dbMod, metrics, sse, tenants, getDaemonStatus, ttsConfigured, intervalMs = ENGINE_INTERVAL_MS, logger = console }) {
  let running = false;
  let primed = false;
  const prevServiceStatus = new Map();

  function emit(event, data) {
    if (sse && typeof sse.broadcast === "function") sse.broadcast(event, data);
  }

  function runIncidents(snapshotInputs) {
    const now = Date.now();
    const allAlerts = deriveAlerts(snapshotInputs);
    const openIncidents = safe(() => dbMod.listMonitorIncidents({ status: "open" }), []);
    const silences = safe(() => dbMod.listMonitorSilences({ activeOnly: true }), []);
    const plan = planIncidentTransitions(allAlerts, openIncidents, silences, now);

    for (const op of plan.open) {
      const inc = safe(() => dbMod.openMonitorIncident({
        key: op.alert.key, severity: op.alert.severity, title: op.alert.title,
        detail: op.alert.detail, source: op.alert.source, ts: now,
      }), null);
      if (inc && !op.silent) {
        emit("incident", { action: "opened", incident: publicIncident(inc) });
        emit("alert", { level: op.alert.severity, key: op.alert.key, title: op.alert.title, detail: op.alert.detail, source: op.alert.source, since: now });
      }
    }
    for (const op of plan.update) {
      safe(() => dbMod.touchMonitorIncident(op.incident.id, { severity: op.alert.severity, detail: op.alert.detail, ts: now }), null);
      if (op.severityChanged && !op.silent) {
        emit("alert", { level: op.alert.severity, key: op.alert.key, title: op.alert.title, detail: op.alert.detail, source: op.alert.source, since: op.incident.first_seen });
      }
    }
    for (const op of plan.resolve) {
      const inc = safe(() => dbMod.resolveMonitorIncident(op.incident.id, now), null);
      if (inc) emit("incident", { action: "resolved", incident: publicIncident(inc) });
    }
  }

  function runServiceStatus(services) {
    const seen = new Set();
    for (const s of services || []) {
      seen.add(s.id);
      const prev = prevServiceStatus.get(s.id);
      if (prev === undefined) {
        if (primed) emit("service_status", { service: s.id, name: s.name, status: s.status });
      } else if (prev !== s.status) {
        emit("service_status", { service: s.id, name: s.name, status: s.status, previous: prev });
      }
      prevServiceStatus.set(s.id, s.status);
    }
    for (const id of [...prevServiceStatus.keys()]) {
      if (!seen.has(id)) prevServiceStatus.delete(id);
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const daemon = safe(() => (getDaemonStatus ? getDaemonStatus() : { alive: false }), { alive: false });
      const hostSample = safe(() => metrics.getHost(), null);
      const host = hostSample ? { cpu_pct: hostSample.cpu_pct, ram: hostSample.ram, disk: hostSample.disk } : null;
      const inputs = collectAlertInputs({ db: dbMod, metrics, daemon, host });
      runIncidents(inputs);

      const ws = safe(() => wsMetrics(tenants), { clients_total: 0, panels: 0, overlays: 0 });
      const stats = safe(() => dbMod.getMonitorPlatformStats(), null) || {};
      const platform = safe(() => platformMetrics({ tenants, stats }), {});
      const database = inputs.database;
      const services = safe(() => servicesHealth({ metrics, database, host, ws, daemon, platform, ttsConfigured }), []);
      runServiceStatus(services);
      primed = true;
    } catch (e) {
      if (logger && logger.error) logger.error("[Monitor] engine tick falhou:", e && e.message);
    } finally {
      running = false;
    }
  }

  return { tick };
}

module.exports = {
  THRESHOLDS,
  ERROR_RATE_WINDOW_MIN,
  ENGINE_INTERVAL_MS,
  STATUS_LABELS,
  severityFrom,
  wsMetrics,
  platformMetrics,
  dbMetrics,
  deriveAlerts,
  overallStatus,
  servicesHealth,
  planIncidentTransitions,
  buildSnapshot,
  publicIncident,
  createEngine,
  collectAlertInputs,
};
