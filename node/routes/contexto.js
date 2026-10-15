// API pública do jogo Contexto (site). Sem autenticação.
// Reencaminha comandos `public_*` ao daemon Python (service.py) por req_id e
// resolve a Promise quando chega {type:"public_result", req_id, ok, data}.
//
// Registrado em server.js:
//   const contextoPublic = require("./routes/contexto");
//   contextoPublic.register(app, { daemonSend });
//   ... em handleDaemonMessage: if (contextoPublic.handleDaemonMessage(msg)) return;

const crypto = require("crypto");

const pending = new Map();

// Rate-limit simples por IP (janela deslizante em memória).
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 90;
const rateBuckets = new Map();

function rateLimit(req, res, next) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { start: now, count: 0 };
  if (now - bucket.start > RATE_WINDOW_MS) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  if (bucket.count > RATE_MAX) {
    return res.status(429).json({ ok: false, error: "Muitas requisições. Aguarde um instante." });
  }
  next();
}

function callDaemon(daemonSend, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const reqId = crypto.randomBytes(8).toString("hex");
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error("tempo esgotado no motor"));
    }, timeoutMs || 30000);
    pending.set(reqId, { resolve, reject, timer });
    const ok = daemonSend(Object.assign({}, payload, { req_id: reqId }));
    if (!ok) {
      clearTimeout(timer);
      pending.delete(reqId);
      reject(new Error("motor indisponível"));
    }
  });
}

// Chamado por server.js a cada mensagem do daemon. Retorna true se consumiu.
function handleDaemonMessage(msg) {
  if (!msg || msg.type !== "public_result" || !msg.req_id) return false;
  const p = pending.get(msg.req_id);
  if (!p) return true; // resposta tardia/desconhecida: ignora silenciosamente
  pending.delete(msg.req_id);
  clearTimeout(p.timer);
  if (msg.ok) p.resolve(msg.data || {});
  else p.reject(new Error((msg.data && msg.data.error) || "erro no motor"));
  return true;
}

function clampWord(w) {
  if (typeof w !== "string") return "";
  return w.slice(0, 40);
}

function requireClientId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(id)) {
    throw new Error("identificador do navegador inválido");
  }
  return id;
}

function register(app, deps) {
  const { daemonSend } = deps;

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      res.status(400).json({ ok: false, error: err.message || "erro" });
    });
  };

  app.get(
    "/api/contexto/daily",
    rateLimit,
    wrap(async (req, res) => {
      const data = await callDaemon(daemonSend, { cmd: "public_daily" }, 15000);
      res.json({ ok: true, date: data.date, maxHints: 3 });
    })
  );

  app.post(
    "/api/contexto/guess",
    rateLimit,
    wrap(async (req, res) => {
      const mode = req.body && req.body.mode === "unlimited" ? "unlimited" : "daily";
      const word = clampWord(req.body && req.body.word);
      if (!word.trim()) return res.status(400).json({ ok: false, error: "palpite vazio" });
      const clientId = mode === "daily" ? requireClientId(req.body && req.body.clientId) : "";
      const data = await callDaemon(daemonSend, {
        cmd: "public_guess",
        mode,
        client_id: clientId,
        round_id: (req.body && req.body.roundId) || "",
        word,
      });
      res.json(Object.assign({ ok: true }, data));
    })
  );

  app.post(
    "/api/contexto/hint",
    rateLimit,
    wrap(async (req, res) => {
      const mode = req.body && req.body.mode === "unlimited" ? "unlimited" : "daily";
      const index = req.body && req.body.index;
      const avoid = Array.isArray(req.body && req.body.avoid) ? req.body.avoid.slice(0, 60) : [];
      const clientId = mode === "daily" ? requireClientId(req.body && req.body.clientId) : "";
      const data = await callDaemon(daemonSend, {
        cmd: "public_hint",
        mode,
        client_id: clientId,
        round_id: (req.body && req.body.roundId) || "",
        index,
        avoid,
      });
      res.json(Object.assign({ ok: true }, data));
    })
  );

  app.post(
    "/api/contexto/new-round",
    rateLimit,
    wrap(async (req, res) => {
      const exclude = Array.isArray(req.body && req.body.exclude)
        ? req.body.exclude.slice(0, 1500).map(clampWord).filter(Boolean)
        : [];
      const data = await callDaemon(daemonSend, { cmd: "public_new_round", exclude }, 30000);
      res.json(Object.assign({ ok: true }, data));
    })
  );

}

module.exports = { register, handleDaemonMessage };
