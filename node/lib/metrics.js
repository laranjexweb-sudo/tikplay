// Instrumentação em memória do Monitor de Servidor.
//
// Coleta e agrega métricas leves em buckets de 1 minuto (ring buffer), sem I/O
// no caminho quente e sem dependências externas. Reinicia no boot (sem persistência).
//
// Janela documentada dos percentis (p50/p95/p99): os últimos
// LATENCY_WINDOW_MIN_DEFAULT minutos (15), configurável por requisição.
// Percentis usam amostragem com reservatório (limite por bucket) para manter o
// custo O(1) mesmo sob tráfego alto.

const os = require("os");
const fs = require("fs");
const path = require("path");

const BUCKET_MS = 60_000;
const MAX_BUCKETS = 180;                 // retenção bruta de 3h
const LATENCY_SAMPLE_CAP = 1000;         // amostras de latência por bucket
const LATENCY_WINDOW_MIN_DEFAULT = 15;   // janela padrão dos percentis

const buckets = new Map(); // key (epoch minuto) -> bucket
const totals = { requests: 0, errors: 0, ws_events: 0, process_errors: 0, started_at: Date.now() };

let lastHost = null;
let lastCpuTimes = null;

function bucketKey(ts) {
  return Math.floor(ts / BUCKET_MS);
}

function emptyBucket(ts) {
  return {
    t: Math.floor(ts / BUCKET_MS) * BUCKET_MS,
    requests: 0,
    errors: 0,        // respostas 5xx (erro de servidor)
    client_errors: 0, // respostas 4xx
    latency_sum: 0,
    latency_count: 0,
    latency_seen: 0,
    latency: [],
    ws_events: 0,
    process_errors: 0,
    cpu: null,
    ram: null,
    disk: null,
  };
}

function getBucket(ts, create = false) {
  const key = bucketKey(ts);
  let b = buckets.get(key);
  if (!b && create) {
    b = emptyBucket(ts);
    buckets.set(key, b);
  }
  return b || null;
}

function prune() {
  const cutoff = bucketKey(Date.now()) - MAX_BUCKETS;
  for (const key of buckets.keys()) {
    if (key < cutoff) buckets.delete(key);
  }
}

function recordRequest(ms, statusCode) {
  const now = Date.now();
  const b = getBucket(now, true);
  const ok = Number.isFinite(ms) ? ms : 0;
  b.requests++;
  b.latency_sum += ok;
  b.latency_count++;
  b.latency_seen++;
  if (b.latency.length < LATENCY_SAMPLE_CAP) b.latency.push(ok);
  else {
    const j = Math.floor(Math.random() * b.latency_seen);
    if (j < LATENCY_SAMPLE_CAP) b.latency[j] = ok;
  }
  const status = parseInt(statusCode, 10) || 0;
  if (status >= 500) { b.errors++; totals.errors++; }
  else if (status >= 400) b.client_errors++;
  totals.requests++;
  prune();
}

function recordWsEvent(n = 1) {
  const count = Number(n) || 0;
  if (count <= 0) return;
  const b = getBucket(Date.now(), true);
  b.ws_events += count;
  totals.ws_events += count;
}

function recordProcessError() {
  const b = getBucket(Date.now(), true);
  b.process_errors++;
  totals.process_errors++;
}

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.idle + c.times.user + c.times.nice + c.times.sys + c.times.irq;
  }
  return { idle, total };
}

// Lê CPU/RAM/disco uma vez e grava no bucket atual. Nunca lança.
async function sampleHost() {
  const now = Date.now();
  const b = getBucket(now, true);
  let cpu = null;
  try {
    const t = cpuTimes();
    if (t.total > 0) {
      if (lastCpuTimes) {
        const idleDelta = t.idle - lastCpuTimes.idle;
        const totalDelta = t.total - lastCpuTimes.total;
        if (totalDelta > 0) cpu = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
      }
      lastCpuTimes = t;
    }
  } catch { /* os indisponível */ }

  let ram = null;
  try {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    ram = { total, used, free, pct: total > 0 ? Math.round((used / total) * 100) : 0 };
  } catch { /* ignora */ }

  let disk = null;
  try {
    const target = path.join(__dirname, "..", "..");
    const st = await fs.promises.statfs(target);
    const size = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    const used = Math.max(0, size - free);
    disk = { total: size, used, free, pct: size > 0 ? Math.round((used / size) * 100) : 0, path: target };
  } catch { /* statfs indisponível */ }

  if (cpu != null) b.cpu = cpu;
  if (ram) b.ram = ram.pct;
  if (disk) b.disk = disk.pct;

  lastHost = {
    cpu_pct: cpu != null ? cpu : (lastHost ? lastHost.cpu_pct : null),
    ram: ram || (lastHost ? lastHost.ram : null),
    disk: disk || (lastHost ? lastHost.disk : null),
    sampled_at: now,
  };
  return lastHost;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

function collectBuckets(windowMin) {
  const now = Date.now();
  const from = bucketKey(now - windowMin * BUCKET_MS);
  const out = [];
  for (const [key, b] of buckets) {
    if (key >= from) out.push(b);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// Percentis na janela documentada (default 15 min). Retorna null quando sem amostras.
function getLatency(windowMin = LATENCY_WINDOW_MIN_DEFAULT) {
  const list = [];
  let sum = 0;
  let count = 0;
  for (const b of collectBuckets(windowMin)) {
    for (const v of b.latency) list.push(v);
    sum += b.latency_sum;
    count += b.latency_count;
  }
  if (!count) return { window_min: windowMin, count: 0, avg: null, p50: null, p95: null, p99: null };
  list.sort((a, b) => a - b);
  return {
    window_min: windowMin,
    count,
    avg: Math.round(sum / count),
    p50: Math.round(quantile(list, 0.5)),
    p95: Math.round(quantile(list, 0.95)),
    p99: Math.round(quantile(list, 0.99)),
  };
}

function getRates(windowMin = 5) {
  const bs = collectBuckets(windowMin);
  let requests = 0;
  let errors = 0;
  let wsEvents = 0;
  for (const b of bs) {
    requests += b.requests;
    errors += b.errors;
    wsEvents += b.ws_events;
  }
  const minutes = Math.max(1, windowMin);
  return {
    window_min: windowMin,
    requests,
    errors,
    ws_events: wsEvents,
    requests_per_min: Math.round(requests / minutes),
    errors_per_min: Math.round((errors / minutes) * 100) / 100,
    error_rate: requests > 0 ? Math.round((errors / requests) * 10000) / 10000 : 0,
  };
}

// Séries para os gráficos. Buckets ausentes voltam como zero (previsível),
// mesmo sem 1h de histórico.
function getSeries({ windowMin = 60, bucketSec = 60 } = {}) {
  const win = Math.max(1, Math.min(180, parseInt(windowMin, 10) || 60));
  const bucket = Math.max(60, Math.min(3600, parseInt(bucketSec, 10) || 60));
  const stepMs = bucket * 1000;
  const now = Date.now();
  const start = Math.floor((now - win * BUCKET_MS) / stepMs) * stepMs;
  const src = collectBuckets(win + 1);
  const points = [];

  for (let t = start; t <= now; t += stepMs) {
    const inWindow = src.filter((b) => b.t >= t && b.t < t + stepMs);
    let requests = 0, errors = 0, wsEvents = 0, sum = 0, count = 0;
    const lat = [];
    let cpu = null, ram = null, disk = null;
    for (const b of inWindow) {
      requests += b.requests;
      errors += b.errors;
      wsEvents += b.ws_events;
      sum += b.latency_sum;
      count += b.latency_count;
      for (const v of b.latency) lat.push(v);
      if (b.cpu != null) cpu = b.cpu;
      if (b.ram != null) ram = b.ram;
      if (b.disk != null) disk = b.disk;
    }
    lat.sort((a, b) => a - b);
    points.push({
      t,
      bucket_sec: bucket,
      cpu,
      ram,
      disk,
      requests,
      errors,
      ws_events: wsEvents,
      latency_avg: count ? Math.round(sum / count) : null,
      latency_p95: lat.length ? Math.round(quantile(lat, 0.95)) : null,
    });
    if (points.length > 1000) break; // trava de segurança
  }
  return { window_min: win, bucket_sec: bucket, points };
}

function getHost() {
  return lastHost;
}

function getTotals() {
  return { ...totals };
}

module.exports = {
  BUCKET_MS,
  LATENCY_WINDOW_MIN_DEFAULT,
  recordRequest,
  recordWsEvent,
  recordProcessError,
  sampleHost,
  getLatency,
  getRates,
  getSeries,
  getHost,
  getTotals,
  _internal: { buckets, emptyBucket, getBucket, quantile },
};
