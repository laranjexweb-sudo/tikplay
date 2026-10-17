// Fase B-2b — Rotas de autenticação, admin (usuários/convites/contextos) e painel.
// Registrado por server.js com o contexto (db, auth, ws, python).

const path = require("path");
const crypto = require("crypto");
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

  const { createContextGenerator } = require("../lib/context-generation");
  const contextGenerator = createContextGenerator({ db: db.db, pythonBin: PYTHON_BIN,
    ...(ctx.contextSpawn ? { spawnProcess: ctx.contextSpawn } : {}),
    log: ctx.contextLog || ((actorId, entry) => require("../lib/ws").broadcastLog(getTenant(actorId), { ...entry, text: entry.message })) });

  app.post("/api/admin/generate-contexts", auth.requireAdmin, (req, res) => {
    const body = req.body || {};
    const interval_min = body.interval_min === undefined ? 0 : body.interval_min;
    const limit = body.limit === undefined ? 10 : body.limit;
    if (!Number.isFinite(interval_min) || interval_min < 0 || interval_min > 1440 ||
        !Number.isInteger(limit) || limit < 0 || limit > 2000 ||
        (body.regenerate !== undefined && typeof body.regenerate !== "boolean")) {
      return res.status(400).json({ success: false, error: "Volume ou intervalo inválido." });
    }
    const result = contextGenerator.start(req.user.id, { interval_min, limit, regenerate: body.regenerate === true });
    res.json({ success: true, ...result });
  });

  app.get("/api/admin/generate-contexts/status", auth.requireAdmin, (req, res) => {
    res.json(contextGenerator.status());
  });

  app.post("/api/admin/generate-contexts/stop", auth.requireAdmin, (req, res) => {
    res.json(contextGenerator.stop());
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

  // ---------------- Catálogo e sorteio de palavras ----------------
  const wordCatalogEvent = (req, event, level, code, details = {}) => {
    try {
      const requestedTrace = String(req.headers["x-trace-id"] || "");
      require("../lib/process-log").processLog({ category: level === "warning" ? "notice" : level === "error" ? "error" : "diagnostic",
        level, event, message: level === "error" ? "Falha ao atualizar o catálogo de palavras." : "Operação do catálogo de palavras concluída.",
        source: "node", code, trace_id: /^[a-zA-Z0-9_-]{1,64}$/.test(requestedTrace) ? requestedTrace : crypto.randomUUID(),
        details: { actor_id: req.user.id, ...details } });
    } catch (_) {}
  };
  const catalogText = value => String(value || "").trim().replace(/\s+/g, " ");
  const catalogKey = value => catalogText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const validCatalogWord = value => value.length >= 2 && value.length <= 60 && /^[\p{L}]+(?:[-'][\p{L}]+)*$/u.test(value);

  app.get("/api/admin/word-catalog", auth.requireAdmin, (req, res) => {
    const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
    const pageSize = Math.max(10, Math.min(100, parseInt(req.query.page_size, 10) || 50));
    res.json({ success: true, ...db.listWordCatalog({ search: catalogText(req.query.search).slice(0, 60),
      status: String(req.query.status || ""), page, pageSize }) });
  });

  app.post("/api/admin/word-catalog/import", auth.requireAdmin, (req, res) => {
    const rawWords = Array.isArray(req.body?.words) ? req.body.words : String(req.body?.text || "").split(/[\n,;]+/);
    if (rawWords.length > 2000) return res.status(400).json({ success: false, error: "Importe no máximo 2.000 palavras por vez." });
    const status = "active";
    const unique = new Map(), invalidKeys = new Set();
    for (const item of rawWords) {
      const word = catalogText(item);
      if (!validCatalogWord(word)) { if (word) invalidKeys.add(word.slice(0, 60)); continue; }
      const word_key = catalogKey(word);
      if (!unique.has(word_key)) unique.set(word_key, { word, word_key, category: "geral", difficulty: "media", status });
    }
    const invalid = rawWords.filter(item => catalogText(item) && !validCatalogWord(catalogText(item))).length;
    try {
      const items = [...unique.values()];
      const inserted = db.importWordCatalogWords(items);
      const duplicates = items.length - inserted + (rawWords.filter(item => validCatalogWord(catalogText(item))).length - items.length);
      wordCatalogEvent(req, "word_catalog.import.completed", "info", undefined,
        { inserted_count: inserted, duplicate_count: duplicates, invalid_count: invalid });
      res.json({ success: true, inserted, duplicates, invalid, invalid_examples: [...invalidKeys].slice(0, 10) });
    } catch (error) {
      wordCatalogEvent(req, "word_catalog.change.failed", "error", "WORD_CATALOG_IMPORT_FAILED", { error_type: error.name });
      res.status(500).json({ success: false, error: "Não foi possível importar as palavras." });
    }
  });

  app.put("/api/admin/word-catalog/:id", auth.requireAdmin, (req, res) => {
    const id = Number(req.params.id), status = String(req.body?.status || "");
    if (!Number.isSafeInteger(id) || id < 1 || !db.WORD_STATUSES.includes(status)) {
      wordCatalogEvent(req, "word_catalog.change.rejected", "warning", "INVALID_WORD_METADATA");
      return res.status(400).json({ success: false, error: "Confira o status." });
    }
    try {
      const item = db.updateWordCatalogWord(id, { status });
      if (!item) return res.status(404).json({ success: false, error: "Palavra não encontrada." });
      wordCatalogEvent(req, "word_catalog.word.updated", "info", undefined, { word_id: id, status });
      res.json({ success: true, item });
    } catch (error) {
      const code = error.code === "LAST_ACTIVE_WORD" ? error.code : "WORD_CATALOG_UPDATE_FAILED";
      wordCatalogEvent(req, "word_catalog.change.rejected", "warning", code, { word_id: id });
      res.status(error.code === "LAST_ACTIVE_WORD" ? 409 : 500).json({ success: false,
        error: error.code === "LAST_ACTIVE_WORD" ? "Mantenha ao menos uma palavra ativa." : "Não foi possível atualizar a palavra." });
    }
  });

  app.get("/api/admin/word-usage", auth.requireAdmin, (req, res) => {
    const rawTenant = req.query.tenant_id == null || req.query.tenant_id === "" ? null : Number(req.query.tenant_id);
    if (rawTenant !== null && (!Number.isSafeInteger(rawTenant) || rawTenant < 1))
      return res.status(400).json({ success: false, error: "Streamer inválido." });
    const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
    const pageSize = Math.max(10, Math.min(100, parseInt(req.query.page_size, 10) || 50));
    res.json({ success: true, streamers: db.listWordUsageStreamers(),
      history: db.listWordUsageEntries({ tenantId: rawTenant, search: catalogText(req.query.search).slice(0, 80), page, pageSize }),
      catalog: db.getWordCatalogEligibleStats() });
  });

  app.put("/api/admin/word-usage/:tenantId/settings", auth.requireAdmin, (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isSafeInteger(tenantId) || tenantId < 1 || !db.getUserById(tenantId))
      return res.status(404).json({ success: false, error: "Streamer não encontrado." });
    db.saveWordDrawSettings(tenantId);
    wordCatalogEvent(req, "word_draw.filters.cleared", "info", undefined, { tenant_id: tenantId });
    res.json({ success: true, settings: {} });
  });

  app.post("/api/admin/word-usage/:tenantId/reset-cycle", auth.requireAdmin, (req, res) => {
    const tenantId = Number(req.params.tenantId);
    if (!Number.isSafeInteger(tenantId) || tenantId < 1 || !db.getUserById(tenantId))
      return res.status(404).json({ success: false, error: "Streamer não encontrado." });
    try {
      const cycle = db.resetWordUsageCycle(tenantId);
      wordCatalogEvent(req, "word_usage.cycle.reset", "info", undefined, { tenant_id: tenantId, ...cycle });
      res.json({ success: true, ...cycle });
    } catch (error) {
      wordCatalogEvent(req, "word_catalog.change.failed", "error", "WORD_CYCLE_RESET_FAILED", { tenant_id: tenantId, error_type: error.name });
      res.status(500).json({ success: false, error: "Não foi possível iniciar um novo ciclo." });
    }
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
