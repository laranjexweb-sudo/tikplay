// Fase B-2b — Rotas de autenticação, admin (usuários/convites/contextos) e painel.
// Registrado por server.js com o contexto (db, auth, ws, python).

const path = require("path");
const { spawn } = require("child_process");

module.exports = function registerAuthRoutes(app, ctx = {}) {
  const {
    db,
    auth,
    getTenant,
    PYTHON_BIN,
    activityForUser,
  } = ctx;

  const loginAttempts = new Map();

  function loginRateLimit(ip) {
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (!rec || now > rec.resetAt) {
      loginAttempts.set(ip, { count: 1, resetAt: now + 60000 });
      return true;
    }
    if (rec.count >= 10) return false;
    rec.count++;
    return true;
  }

  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
  }

  const REGISTER_MODE = (process.env.REGISTER_MODE || "public").toLowerCase();
  const REGISTER_INVITE_MSG = "O cadastro na TikPlay está disponível apenas por convite durante o período de testes.";
  const REGISTER_CLOSED_MSG = "Cadastro indisponível no momento.";
  function registerModeMessage() {
    if (REGISTER_MODE === "closed") return REGISTER_CLOSED_MSG;
    if (REGISTER_MODE === "invite") return REGISTER_INVITE_MSG;
    return "";
  }

  app.get("/api/auth/register-mode", (req, res) => {
    res.json({ success: true, mode: REGISTER_MODE, message: registerModeMessage() });
  });

  app.get("/api/auth/invite/:token", (req, res) => {
    if (REGISTER_MODE === "closed") return res.json({ valid: false, closed: true, status: "closed", message: REGISTER_CLOSED_MSG });
    const inv = db.getInviteByToken(String(req.params.token || ""));
    if (!inv) return res.json({ valid: false, status: null, message: REGISTER_INVITE_MSG });
    const st = db.validateInvite(inv);
    res.json({
      valid: st.ok,
      status: st.ok ? "active" : inv.status,
      expires_at: inv.expires_at || null,
      message: st.ok ? "" : (st.error || REGISTER_INVITE_MSG),
    });
  });

  app.post("/api/auth/register", (req, res) => {
    const { name = "", email, password, inviteToken } = req.body;
    if (REGISTER_MODE === "closed") {
      return res.status(403).json({ success: false, error: REGISTER_CLOSED_MSG });
    }
    if (REGISTER_MODE === "invite") {
      if (!inviteToken) {
        return res.status(403).json({ success: false, error: REGISTER_INVITE_MSG });
      }
      const st = db.validateInvite(db.getInviteByToken(String(inviteToken)));
      if (!st.ok) {
        return res.status(403).json({ success: false, error: st.error });
      }
    }
    if (!validEmail(email)) {
      return res.json({ success: false, error: "Email invalido" });
    }
    if (!password || String(password).length < 8) {
      return res.json({ success: false, error: "Senha deve ter no minimo 8 caracteres" });
    }
    if (db.getUserByEmail(email)) {
      return res.json({ success: false, error: "Email ja cadastrado" });
    }
    const role = db.countUsers() === 0 ? "admin" : "user";
    let id;
    try {
      if (REGISTER_MODE === "invite") {
        id = db.registerWithInvite({
          email: String(email).toLowerCase().trim(),
          name: String(name).trim(),
          password_hash: auth.hashPassword(password),
          token: String(inviteToken),
          role,
        });
      } else {
        id = db.createUser({
          email: String(email).toLowerCase().trim(),
          name: String(name).trim(),
          password_hash: auth.hashPassword(password),
          role,
          features: { bichinho: false, duelo: false },
        });
      }
    } catch (e) {
      return res.json({ success: false, error: e.message });
    }
    const user = db.getUserById(id);
    const token = auth.signToken(user);
    res.json({ success: true, role: user.role, token, user: db.publicUser(user) });
  });

  app.post("/api/auth/login", (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || "";
    if (!loginRateLimit(ip)) {
      return res.status(429).json({ success: false, error: "Muitas tentativas. Aguarde 1 minuto." });
    }
    const { email, password } = req.body;
    const user = db.getUserByEmail(email);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      return res.json({ success: false, error: "Email ou senha incorretos" });
    }
    if (user.status !== "active") {
      return res.json({ success: false, error: "Conta desativada" });
    }
    const token = auth.signToken(user);
    res.json({ success: true, token, user: db.publicUser(user) });
  });

  app.get("/api/auth/me", auth.requireAuth, (req, res) => {
    const user = db.getUserById(req.user.id);
    if (!user) return res.status(401).json({ success: false, error: "Usuario nao encontrado" });
    const pub = db.publicUser(user);
    pub.tiktools_api_key_masked = pub.tiktools_api_key;
    pub.tiktools_api_key = user.tiktools_api_key ? true : false;
    pub.has_api_key = !!user.tiktools_api_key;
    res.json({ success: true, user: pub });
  });

  app.post("/api/auth/change-password", auth.requireAuth, (req, res) => {
    const { old_password, new_password } = req.body;
    const user = db.getUserById(req.user.id);
    if (!user) return res.status(401).json({ success: false, error: "Usuario nao encontrado" });
    if (!auth.verifyPassword(old_password, user.password_hash)) {
      return res.json({ success: false, error: "Senha atual incorreta" });
    }
    if (!new_password || String(new_password).length < 8) {
      return res.json({ success: false, error: "Senha deve ter no minimo 8 caracteres" });
    }
    db.updateUser(user.id, { password_hash: auth.hashPassword(new_password) });
    res.json({ success: true });
  });

  // ---------------- Admin ----------------

  app.get("/api/admin/users", auth.requireAdmin, (req, res) => {
    const users = db.listUsers().map((user) => {
      const pub = db.publicUser(user);
      // Objeto opcional `activity` (telemetria de presenca/atividade do cliente).
      // Nunca inclui senha/token/API key; ausencia de dados => valores neutros.
      pub.activity = typeof activityForUser === "function" ? activityForUser(user.id) : null;
      return pub;
    });
    res.json({ success: true, users });
  });

  app.post("/api/admin/users/:id/status", auth.requireAdmin, (req, res) => {
    const { status } = req.body;
    if (!["active", "disabled"].includes(status)) {
      return res.json({ success: false, error: "Status invalido" });
    }
    db.updateUser(Number(req.params.id), { status });
    res.json({ success: true });
  });

  app.post("/api/admin/users/:id/reset-password", auth.requireAdmin, (req, res) => {
    const { new_password } = req.body;
    if (!new_password || String(new_password).length < 8) {
      return res.json({ success: false, error: "Senha deve ter no minimo 8 caracteres" });
    }
    db.updateUser(Number(req.params.id), { password_hash: auth.hashPassword(new_password) });
    res.json({ success: true });
  });

  app.post("/api/admin/users", auth.requireAdmin, (req, res) => {
    const { email, name, password, plan = "free", role = "user", tiktok_username = "", tiktools_api_key = "", features } = req.body;
    if (!validEmail(email)) return res.json({ success: false, error: "Email invalido" });
    if (!password || String(password).length < 8) {
      return res.json({ success: false, error: "Senha deve ter no minimo 8 caracteres" });
    }
    if (db.getUserByEmail(email)) return res.json({ success: false, error: "Email ja cadastrado" });
    if (!["user", "admin"].includes(role)) return res.json({ success: false, error: "Role invalido" });
    const id = db.createUser({
      email: String(email).toLowerCase().trim(),
      name: String(name || "").trim(),
      password_hash: auth.hashPassword(password),
      role,
      plan,
      tiktok_username: String(tiktok_username || "").trim(),
      tiktools_api_key: String(tiktools_api_key || "").trim(),
      features: (features && typeof features === "object") ? features : {},
    });
    res.json({ success: true, user: db.publicUser(db.getUserById(id)) });
  });

  app.put("/api/admin/users/:id", auth.requireAdmin, (req, res) => {
    const { name, plan, role, status, tiktok_username, tiktools_api_key, features } = req.body;
    const fields = {};
    if (typeof name === "string") fields.name = name.trim();
    if (typeof plan === "string") fields.plan = plan.trim();
    if (features && typeof features === "object") fields.features = features;
    if (["user", "admin"].includes(role)) fields.role = role;
    if (["active", "disabled"].includes(status)) fields.status = status;
    if (typeof tiktok_username === "string") fields.tiktok_username = tiktok_username.trim();
    if (typeof tiktools_api_key === "string") fields.tiktools_api_key = tiktools_api_key.trim();
    if (Object.keys(fields).length === 0) return res.json({ success: false, error: "Nada para atualizar" });
    db.updateUser(Number(req.params.id), fields);
    res.json({ success: true, user: db.publicUser(db.getUserById(Number(req.params.id))) });
  });

  // ---------------- Gerar Contextos (super admin) ----------------

  const CONTEXTOS_SCRIPT = path.join(__dirname, "..", "python", "generate_contextos.py");

  let contextosJob = null;

  function spawnContextosJob(interval_min, limit, words) {
    if (contextosJob && contextosJob.running) {
      return { started: false, reason: "ja rodando" };
    }
    const env = {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUNBUFFERED: "1",
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
      LLM_BASE_URL: process.env.LLM_BASE_URL || "http://127.0.0.1:1234/v1",
      LLM_MODEL: process.env.LLM_MODEL || "qwen2.5-coder-7b-instruct",
      INTERVAL_S: String(Math.max(0, Math.round((interval_min || 15) * 60))),
      LIMIT: String(Math.max(0, limit || 0)),
      WORDS_PER_CONTEXT: String(Math.max(100, words || 1000)),
      CORRIGE_TOP: String(Math.max(10, parseInt(process.env.CORRIGE_TOP, 10) || 200)),
    };
    const proc = spawn(PYTHON_BIN, ["-u", CONTEXTOS_SCRIPT], { env });
    contextosJob = {
      proc,
      running: true,
      finished: false,
      done: 0,
      total: 0,
      current: "",
      errors: 0,
      last_error: null,
      started_at: new Date().toISOString(),
      logs: [],
    };
    proc.stdout.on("data", (data) => {
      const lines = data.toString("utf-8").split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (!contextosJob) continue;
          if (typeof msg.done === "number") contextosJob.done = msg.done;
          if (typeof msg.total === "number") contextosJob.total = msg.total;
          if (typeof msg.current === "string") contextosJob.current = msg.current;
          if (typeof msg.errors === "number") contextosJob.errors = msg.errors;
          if (msg.last_error !== undefined) contextosJob.last_error = msg.last_error;
          if (msg.running === false) contextosJob.running = false;
          if (msg.finished === true) contextosJob.finished = true;
          if (typeof msg.log === "string" && msg.log) {
            contextosJob.logs.push({ t: new Date().toISOString(), text: msg.log });
            if (contextosJob.logs.length > 300) contextosJob.logs = contextosJob.logs.slice(-300);
          }
        } catch {}
      }
    });
    proc.stderr.on("data", () => {});
    proc.on("close", (code) => {
      if (contextosJob) {
        contextosJob.running = false;
        contextosJob.finished = true;
      }
    });
    proc.on("error", (err) => {
      if (contextosJob) {
        contextosJob.running = false;
        contextosJob.last_error = err.message;
      }
    });
    return { started: true };
  }

  function killContextosJob() {
    if (contextosJob && contextosJob.proc) {
      try {
        contextosJob.proc.kill();
      } catch (e) {}
    }
  }

  app.post("/api/admin/generate-contexts", auth.requireAdmin, (req, res) => {
    const interval_min = req.body && typeof req.body.interval_min === "number" ? req.body.interval_min : 15;
    const limit = req.body && typeof req.body.limit === "number" ? req.body.limit : 0;
    const words = req.body && typeof req.body.words === "number" ? req.body.words : 1000;
    const r = spawnContextosJob(interval_min, limit, words);
    res.json({ success: true, started: r.started, reason: r.reason || "" });
  });

  app.get("/api/admin/generate-contexts/status", auth.requireAdmin, (req, res) => {
    res.json({
      success: true,
      running: !!(contextosJob && contextosJob.running),
      finished: !!(contextosJob && contextosJob.finished),
      done: contextosJob ? contextosJob.done : 0,
      total: contextosJob ? contextosJob.total : 0,
      current: contextosJob ? contextosJob.current : "",
      errors: contextosJob ? contextosJob.errors : 0,
      last_error: contextosJob ? contextosJob.last_error : null,
      started_at: contextosJob ? contextosJob.started_at : null,
      logs: contextosJob ? contextosJob.logs : [],
    });
  });

  app.post("/api/admin/generate-contexts/stop", auth.requireAdmin, (req, res) => {
    killContextosJob();
    res.json({ success: true });
  });

  // ---------------- Palavras banidas (global, admin super) ----------------

  app.get("/api/admin/banned-words", auth.requireAdmin, (req, res) => {
    res.json({ success: true, words: db.getBannedWords() });
  });

  app.post("/api/admin/banned-words", auth.requireAdmin, (req, res) => {
    const words = (req.body && req.body.words) || [];
    const clean = db.saveBannedWords(words);
    res.json({ success: true, words: clean, count: clean.length });
  });

  // ---------------- Convites de cadastro (Admin) ----------------

  app.post("/api/admin/invites", auth.requireAdmin, (req, res) => {
    const raw = parseInt((req.body && req.body.expires_in_days) ?? 7, 10);
    const expires_in_days = Number.isFinite(raw) ? Math.max(0, Math.min(365, raw)) : 7;
    const inv = db.createInvite({ created_by: req.user.id, expires_in_days });
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    res.json({ success: true, ...inv, link: `${base}/register?invite=${inv.token}` });
  });

  app.get("/api/admin/invites", auth.requireAdmin, (req, res) => {
    res.json({ success: true, invites: db.listInvites(200) });
  });

  app.post("/api/admin/invites/:id/revoke", auth.requireAdmin, (req, res) => {
    const ok = db.revokeInvite(Number(req.params.id));
    res.json({ success: ok, ...(ok ? {} : { error: "Convite nao encontrado ou ja utilizado/revogado" }) });
  });

  // ---------------- Panel config ----------------

  app.get("/api/panel-config", auth.requireAuth, (req, res) => {
    const user = db.getUserById(req.user.id);
    res.json({
      success: true,
      username: user.tiktok_username,
      room_code: user.room_code,
      has_api_key: !!user.tiktools_api_key,
      tiktools_api_key: db.publicUser(user).tiktools_api_key,
      tiktok_engine: user.tiktok_engine || "tiktoklive",
      current_word: getTenant(req.user.id).currentWord,
    });
  });

  app.post("/api/panel-config", auth.requireAuth, (req, res) => {
    const { username, api_key, clear_api_key, clear_username, tiktok_engine } = req.body;
    const fields = {};
    if (typeof username === "string" && username.trim() !== "") {
      fields.tiktok_username = username.trim();
    } else if (clear_username) {
      fields.tiktok_username = "";
    }
    if (typeof api_key === "string" && api_key.trim() !== "") {
      fields.tiktools_api_key = api_key.trim();
    } else if (clear_api_key) {
      fields.tiktools_api_key = "";
    }
    if (tiktok_engine === "tiktoks" || tiktok_engine === "tiktoklive" || tiktok_engine === "tiktools") {
      fields.tiktok_engine = tiktok_engine === "tiktoks" ? "tiktools" : tiktok_engine;
    }
    db.updateUser(req.user.id, fields);
    res.json({ success: true });
  });
};