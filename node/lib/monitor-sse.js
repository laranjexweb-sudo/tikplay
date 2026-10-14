// Hub de Server-Sent Events do Monitor de Servidor.
//
// Usado apenas para eventos importantes (alertas, incidentes, status de serviço).
// As métricas pesadas continuam por polling REST. Headers anti-buffering e
// heartbeat periódico evitam que proxies/PM2 encerrem a conexão ociosa.

const HEARTBEAT_MS = 25000;
const clients = new Set();
let heartbeat = null;

function write(res, event, data) {
  try {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) { /* cliente caiu; será removido */ }
}

function stopHeartbeat() {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
}

function ensureHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    if (clients.size === 0) { stopHeartbeat(); return; }
    for (const client of [...clients]) {
      try { client.res.write(`: ping ${Date.now()}\n\n`); }
      catch { clients.delete(client); }
    }
  }, HEARTBEAT_MS);
  if (heartbeat.unref) heartbeat.unref();
}

function addClient(req, res, meta = {}) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 5000\n\n");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const client = { res, meta };
  clients.add(client);
  write(res, "hello", { connected_at: Date.now(), ...meta });
  ensureHeartbeat();

  req.on("close", () => {
    clients.delete(client);
    if (clients.size === 0) stopHeartbeat();
  });
  return client;
}

function broadcast(event, data) {
  if (clients.size === 0) return;
  for (const client of [...clients]) {
    try {
      write(client.res, event, data);
    } catch {
      clients.delete(client);
    }
  }
}

function size() {
  return clients.size;
}

module.exports = { addClient, broadcast, size, HEARTBEAT_MS };
