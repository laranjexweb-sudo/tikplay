// Testes do Monitor de Servidor.
//
//   node tests/monitor.test.js
//
// Funcoes puras (alertas, status geral, transicoes de incidente), metricas
// (percentis/series/taxas) e persistencia de incidentes em DB temporario.

const path = require("path");
const fs = require("fs");

const TMP_DB = path.join(require("os").tmpdir(), `monitor-test-${process.pid}.db`);
for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"]) { try { fs.unlinkSync(f); } catch {} }
process.env.DB_PATH = TMP_DB;

const db = require("../db");
const metrics = require("../lib/metrics");
const monitor = require("../lib/monitor");

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("  PASS " + name); }
  else { failed++; console.log("  FAIL " + name + (extra ? " :: " + extra : "")); }
}

console.log("== alertas ==");
{
  const high = { cpu_pct: 96, ram: { pct: 86 }, disk: { pct: 50 } };
  const alerts = monitor.deriveAlerts({
    host: high, latency: { p95: 900 }, rates: { requests: 100, error_rate: 0.06 },
    database: { status: "healthy", read_latency_ms: 20 }, daemon: { alive: true },
  });
  const byKey = Object.fromEntries(alerts.map((a) => [a.key, a.severity]));
  check("cpu critical", byKey["host.cpu_high"] === "critical", JSON.stringify(byKey));
  check("ram warning", byKey["host.ram_high"] === "warning");
  check("latency critical", byKey["api.latency_high"] === "critical");
  check("error rate critical", byKey["api.error_rate_high"] === "critical");
  check("sem alerta de disco saudavel", byKey["host.disk_high"] === undefined);
  check("sem alerta de daemon", byKey["daemon.down"] === undefined);
}
{
  const alerts = monitor.deriveAlerts({
    host: { cpu_pct: 10, ram: { pct: 10 }, disk: { pct: 10 } },
    latency: { p95: 30 }, rates: { requests: 0, error_rate: 0 },
    database: { status: "down" }, daemon: { alive: false },
  });
  const byKey = Object.fromEntries(alerts.map((a) => [a.key, a.severity]));
  check("db down critical", byKey["db.down"] === "critical");
  check("daemon down critical", byKey["daemon.down"] === "critical");
  check("taxa de erro ignorada sem requests", byKey["api.error_rate_high"] === undefined);
}

console.log("== status geral ==");
{
  check("healthy", monitor.overallStatus([], [{ status: "healthy" }]) === "healthy");
  check("attention por warning", monitor.overallStatus([{ severity: "warning" }], [{ status: "healthy" }]) === "attention");
  check("degraded por critical", monitor.overallStatus([{ severity: "critical" }], [{ status: "healthy" }]) === "degraded");
  check("down por servico down", monitor.overallStatus([], [{ status: "down" }]) === "down");
}

console.log("== transicoes de incidentes ==");
{
  const now = Date.now();
  // novo incidente
  let plan = monitor.planIncidentTransitions([{ key: "a", severity: "warning" }], [], [], now);
  check("abre novo", plan.open.length === 1 && plan.update.length === 0 && plan.resolve.length === 0);
  check("nao silenciado por padrao", plan.open[0].silent === false);

  // sem duplicata: key ja aberta vira update
  plan = monitor.planIncidentTransitions([{ key: "a", severity: "warning" }], [{ id: 1, key: "a", severity: "warning", status: "open" }], [], now);
  check("nao duplica (update)", plan.open.length === 0 && plan.update.length === 1 && plan.update[0].severityChanged === false);
  check("nao resolve enquanto ativo", plan.resolve.length === 0);

  // escalonamento de severidade
  plan = monitor.planIncidentTransitions([{ key: "a", severity: "critical" }], [{ id: 1, key: "a", severity: "warning", status: "open" }], [], now);
  check("detecta escalonamento", plan.update[0].severityChanged === true);

  // resolve quando condicao some
  plan = monitor.planIncidentTransitions([], [{ id: 1, key: "a", severity: "warning", status: "open" }], [], now);
  check("resolve quando some", plan.resolve.length === 1);

  // acknowledged ainda pode ser resolvido automaticamente
  plan = monitor.planIncidentTransitions([], [{ id: 2, key: "b", severity: "warning", status: "acknowledged" }], [], now);
  check("acknowledged resolve automaticamente", plan.resolve.length === 1);

  // silencio suprime evento (flag), mas abre/atualiza historico
  plan = monitor.planIncidentTransitions([{ key: "a", severity: "warning" }], [], [{ key: "a" }], now);
  check("silencio marca silent", plan.open.length === 1 && plan.open[0].silent === true);
  plan = monitor.planIncidentTransitions([{ key: "a", severity: "warning" }], [{ id: 3, key: "a", severity: "warning", status: "open" }], [{ key: "a" }], now);
  check("silencio em update", plan.update.length === 1 && plan.update[0].silent === true);
}

console.log("== metricas ==");
{
  for (let i = 1; i <= 100; i++) metrics.recordRequest(i, 200);
  const lat = metrics.getLatency();
  check("latencia p50 ~50", lat.p50 >= 45 && lat.p50 <= 55, String(lat.p50));
  check("latencia p95 ~95", lat.p95 >= 90 && lat.p95 <= 99, String(lat.p95));
  check("latencia p99 ~99", lat.p99 >= 96 && lat.p99 <= 100, String(lat.p99));
  check("janela documentada = 15", lat.window_min === metrics.LATENCY_WINDOW_MIN_DEFAULT);

  check("erro 5xx conta", metrics.getRates(5).errors === 0);
  metrics.recordRequest(200, 500);
  metrics.recordRequest(200, 500);
  const rates = metrics.getRates(5);
  check("erros 5xx contados", rates.errors === 2, JSON.stringify(rates));
  check("error_rate calculado", rates.error_rate > 0 && rates.error_rate <= 1, String(rates.error_rate));

  metrics.recordWsEvent(10);
  check("eventos ws contados", metrics.getRates(5).ws_events === 10);

  const series = metrics.getSeries({ windowMin: 60, bucketSec: 60 });
  check("series tem pontos", series.points.length > 0);
  check("series preenche zeros (bucket antigo)", series.points[0].requests === 0, JSON.stringify(series.points[0]));
  check("series bucket atual tem requests", series.points[series.points.length - 1].requests >= 100);
  check("series bucket_sec", series.bucket_sec === 60);
}

console.log("== persistencia de incidentes ==");
{
  const userId = db.createUser({ email: "monitor@t.com", name: "M", password_hash: "x", role: "admin" });
  const inc = db.openMonitorIncident({ key: "host.cpu_high", severity: "warning", title: "CPU", detail: "90%", source: "host", ts: Date.now() });
  check("abre incidente", inc.id > 0 && inc.status === "open");
  check("busca ativo por key", !!db.getActiveMonitorIncidentByKey("host.cpu_high"));
  const acked = db.ackMonitorIncident(inc.id, userId);
  check("ack grava admin", acked.status === "acknowledged" && acked.ack_by === userId);
  const resolved = db.resolveMonitorIncident(inc.id);
  check("resolve acknowledged", resolved && resolved.status === "resolved" && resolved.resolved_at != null);
  check("sem ativos apos resolver", db.countActiveMonitorIncidents() === 0);
  check("historico preservado", db.listMonitorIncidents({ status: "all" }).length === 1);

  db.setMonitorSilence("host.cpu_high", Date.now() + 60000, userId);
  check("silencio ativo listado", db.listMonitorSilences({ activeOnly: true }).length === 1);
  check("silencio por key", !!db.getMonitorSilence("host.cpu_high"));
  db.deleteMonitorSilence("host.cpu_high");
  check("silencio removido", db.listMonitorSilences({ activeOnly: true }).length === 0);
}

console.log("== snapshot ==");
{
  const snap = monitor.buildSnapshot({
    db,
    tenants: new Map(),
    metrics,
    getDaemonStatus: () => ({ alive: true, pid: 123, backoff: 0 }),
    ttsConfigured: false,
  });
  check("snapshot tem overall", !!snap.overall && !!snap.overall.status, JSON.stringify(snap.overall));
  check("snapshot tem host", !!snap.host && typeof snap.host.hostname === "string");
  check("snapshot tem servicos", Array.isArray(snap.services) && snap.services.length >= 6, String(snap.services.length));
  check("snapshot tem 1 no", snap.nodes.length === 1);
  check("snapshot tem secoes de degradacao", Array.isArray(snap.degraded_sections));
  check("snapshot incidents", !!snap.incidents && typeof snap.incidents.active === "number");
}

console.log(`\nRESULT pass=${passed} fail=${failed}`);
for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"]) { try { fs.unlinkSync(f); } catch {} }
process.exit(failed ? 1 : 0);
