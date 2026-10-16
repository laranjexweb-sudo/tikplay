const crypto = require("crypto");
const providerConfig = require("../lib/elevenlabs-config");

module.exports = function registerElevenLabs(app, { db, auth, daemonSend, log }) {
  db.db.exec(`CREATE TABLE IF NOT EXISTS tenant_elevenlabs (
    tenant_id INTEGER PRIMARY KEY REFERENCES users(id),
    enabled INTEGER NOT NULL DEFAULT 0,
    voice_id TEXT NOT NULL DEFAULT '',
    monthly_limit INTEGER NOT NULL DEFAULT 10000
  );
  CREATE TABLE IF NOT EXISTS elevenlabs_usage (
    tenant_id INTEGER NOT NULL, month TEXT NOT NULL, characters INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, month)
  );`);
  const get = id => db.db.prepare("SELECT * FROM tenant_elevenlabs WHERE tenant_id=?").get(id)
    || { tenant_id: id, enabled: 0, voice_id: "", monthly_limit: 10000 };
  const configured = () => Boolean(providerConfig.read().apiKey);
  let catalog = [], catalogUntil = 0, catalogKey = "", pendingCatalog = null;
  const lastTest = new Map(), lastAudit = new Map();
  async function voices() {
    const apiKey = providerConfig.read().apiKey;
    if (!apiKey) throw new Error("ELEVENLABS_NOT_CONFIGURED");
    const fingerprint = crypto.createHash("sha256").update(apiKey).digest("hex");
    if (Date.now() < catalogUntil && catalogKey === fingerprint) return catalog;
    if (pendingCatalog?.key === fingerprint) return pendingCatalog.promise;
    const task = (async () => {
      const result = [];
      let page = "";
      for (let i = 0; i < 20; i++) {
        const query = new URLSearchParams({ page_size: "100" });
        if (page) query.set("next_page_token", page);
        const response = await fetch(`https://api.elevenlabs.io/v2/voices?${query}`, {
          headers: { "xi-api-key": apiKey },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("ELEVENLABS_CATALOG_FAILED");
        const body = await response.json();
        if (!Array.isArray(body.voices)) throw new Error("ELEVENLABS_CATALOG_INVALID");
        for (const voice of body.voices) {
          if (/^[a-zA-Z0-9_-]{1,128}$/.test(voice.voice_id) && typeof voice.name === "string")
            result.push({ key: voice.voice_id, label: voice.name.slice(0, 120) });
        }
        if (!body.has_more) break;
        if (!body.next_page_token) throw new Error("ELEVENLABS_CATALOG_INVALID");
        page = body.next_page_token;
      }
      catalog = result;
      catalogKey = fingerprint;
      catalogUntil = Date.now() + 300000;
      return catalog;
    })();
    pendingCatalog = { key: fingerprint, promise: task };
    try { return await task; } finally { if (pendingCatalog?.promise === task) pendingCatalog = null; }
  }
  function active(id) {
    const user = db.getUserById(id);
    return user && user.status === "active";
  }
  function view(id) {
    const row = get(id);
    const month = new Date().toISOString().slice(0, 7);
    const usage = db.db.prepare("SELECT characters FROM elevenlabs_usage WHERE tenant_id=? AND month=?").get(id, month);
    return { enabled: row.enabled === 1, configured: configured(), voice_id: row.voice_id,
      monthly_limit: row.monthly_limit, used_characters: usage?.characters || 0, month };
  }
  function audit(id, event, category, level, details = {}) {
    const key = `${id}:${event}`;
    if (level === "warning" || level === "error") {
      if (Date.now() - (lastAudit.get(key) || 0) < 30000) return;
      lastAudit.set(key, Date.now());
    }
    log(id, { event, category, level, game: "tts", trace_id: crypto.randomUUID(),
      message: "Configuração de voz adicional.", details });
  }
  function allowed(req, res, next) {
    if (!active(req.user.id) || get(req.user.id).enabled !== 1) {
      audit(req.user.id, "tts.provider.rejected", "notice", "warning", { code: "ACCESS_DENIED" });
      return res.status(403).json({ success: false, error: "Vozes adicionais não liberadas para esta conta." });
    }
    if (!configured()) return res.status(503).json({ success: false, error: "ElevenLabs ainda não configurada no servidor." });
    next();
  }
  function globalStatus() {
    const config = providerConfig.read();
    return { success: true, configured: Boolean(config.apiKey), source: config.source };
  }
  app.get("/api/admin/integrations/elevenlabs", auth.requireAdmin, (req, res) => {
    res.set("Cache-Control", "no-store").json(globalStatus());
  });
  app.put("/api/admin/integrations/elevenlabs", auth.requireAdmin, (req, res) => {
    const { api_key, clear } = req.body || {};
    const key = typeof api_key === "string" ? api_key.trim() : "";
    if ((clear !== undefined && typeof clear !== "boolean") || (clear === true && key)
        || (clear !== true && (!/^[\x21-\x7e]{10,1024}$/.test(key)))) {
      audit(req.user.id, "tts.provider.config_rejected", "notice", "warning", { code: "INVALID_CONFIG" });
      return res.status(400).json({ success: false, error: "Informe uma chave válida ou escolha remover a chave." });
    }
    try {
      providerConfig.save(clear === true ? "" : key);
      catalogUntil = 0;
      audit(req.user.id, "tts.provider.config_saved", "system", "info", { operation: clear === true ? "clear" : "replace", source: "admin" });
      res.set("Cache-Control", "no-store").json(globalStatus());
    } catch {
      audit(req.user.id, "tts.provider.config_failed", "error", "error", { code: "CONFIG_SAVE_FAILED" });
      res.status(500).json({ success: false, error: "Não foi possível salvar a configuração da integração." });
    }
  });
  app.get("/api/admin/users/:id/elevenlabs", auth.requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!db.getUserById(id)) return res.status(404).json({ success: false });
    res.json({ success: true, ...view(id) });
  });
  app.put("/api/admin/users/:id/elevenlabs", auth.requireAdmin, (req, res) => {
    const id = Number(req.params.id), { enabled, monthly_limit } = req.body || {};
    if (!db.getUserById(id)) return res.status(404).json({ success: false });
    if (typeof enabled !== "boolean" || !Number.isInteger(monthly_limit) || monthly_limit < 0 || monthly_limit > 1000000)
      return res.status(400).json({ success: false, error: "Informe um limite entre 0 e 1.000.000 caracteres." });
    db.db.prepare(`INSERT INTO tenant_elevenlabs(tenant_id,enabled,monthly_limit) VALUES(?,?,?)
      ON CONFLICT(tenant_id) DO UPDATE SET enabled=excluded.enabled,monthly_limit=excluded.monthly_limit`)
      .run(id, enabled ? 1 : 0, monthly_limit);
    audit(id, "tts.provider.access_changed", "system", "info", { enabled, monthly_limit, actor_id: req.user.id });
    res.json({ success: true, ...view(id) });
  });
  app.get("/api/tts/elevenlabs", auth.requireAuth, async (req, res) => {
    const state = view(req.user.id);
    if (!active(req.user.id) || !state.enabled) return res.json({ success: true, enabled: false, voices: [] });
    if (!state.configured) return res.json({ success: true, ...state, voices: [] });
    try { res.json({ success: true, ...state, voices: await voices() }); }
    catch {
      audit(req.user.id, "tts.provider.failed", "error", "error", { operation: "catalog", code: "ELEVENLABS_CATALOG_FAILED" });
      res.json({ success: true, ...state, voices: [], catalog_error: true });
    }
  });
  app.put("/api/tts/elevenlabs", auth.requireAuth, allowed, async (req, res) => {
    const voice = req.body?.voice_id;
    if (typeof voice !== "string" || voice.length > 128) return res.status(400).json({ success: false });
    try {
      if (voice && !(await voices()).some(v => v.key === voice)) return res.status(400).json({ success: false, error: "Voz indisponível." });
      // Recheck after the asynchronous catalog request in case the admin revoked access.
      if (!active(req.user.id) || get(req.user.id).enabled !== 1) return res.status(403).json({ success: false });
      db.db.prepare("UPDATE tenant_elevenlabs SET voice_id=? WHERE tenant_id=?").run(voice, req.user.id);
      audit(req.user.id, "tts.provider.preference_saved", "diagnostic", "debug", { voice_id: voice });
      res.json({ success: true, ...view(req.user.id) });
    } catch { res.status(502).json({ success: false, error: "Não foi possível salvar a voz." }); }
  });
  app.post("/api/tts/elevenlabs/test", auth.requireAuth, allowed, (req, res) => {
    if (!get(req.user.id).voice_id) return res.status(400).json({ success: false, error: "Selecione uma voz ElevenLabs primeiro." });
    if (Date.now() - (lastTest.get(req.user.id) || 0) < 10000)
      return res.status(429).json({ success: false, error: "Aguarde alguns segundos antes de testar novamente." });
    const ok = daemonSend({ cmd: "elevenlabs_test", tenant_id: req.user.id, trace_id: crypto.randomUUID() });
    if (ok) lastTest.set(req.user.id, Date.now());
    res.status(ok ? 200 : 503).json({ success: ok, ...(ok ? {} : { error: "Serviço de voz indisponível." }) });
  });
};
