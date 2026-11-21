const crypto = require("crypto");
const providerConfig = require("../lib/elevenlabs-config");
const integrationSecrets = require("../lib/integration-secrets");
const maskSecret = require("../lib/mask-secret");
const voiceModels = require("../lib/additional-voice-models.json");
const creditWallet = require("../lib/tts-credit-wallet");
const apiCosts = require("../lib/api-costs");
const starsgTts = require("../lib/starsg-tts");
const cartesiaTts = require("../lib/cartesia-tts");

module.exports = function registerElevenLabs(app, { db, auth, daemonSend, log, requireFeature }) {
  const chatFeature = typeof requireFeature === "function" ? requireFeature("chat") : (_req, _res, next) => next();
  db.db.exec(`CREATE TABLE IF NOT EXISTS tenant_elevenlabs (
    tenant_id INTEGER PRIMARY KEY REFERENCES users(id),
    enabled INTEGER NOT NULL DEFAULT 0,
    voice_id TEXT NOT NULL DEFAULT '',
    monthly_limit INTEGER NOT NULL DEFAULT 10000
  );
  CREATE TABLE IF NOT EXISTS elevenlabs_usage (
    tenant_id INTEGER NOT NULL, month TEXT NOT NULL, characters INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, month)
  );
  CREATE TABLE IF NOT EXISTS additional_voice_models (
    model_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
    credits_per_150_chars INTEGER NOT NULL DEFAULT 0 CHECK(credits_per_150_chars>=0)
  );
  CREATE TABLE IF NOT EXISTS additional_voice_options (
    model_id TEXT NOT NULL, voice_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(model_id,voice_id)
  );`);
  const modelColumns = new Set(db.db.prepare("PRAGMA table_info(additional_voice_models)").all().map(row => row.name));
  if (!modelColumns.has("credits_per_150_chars")) {
    const migrateTariffs = db.db.transaction(() => {
      db.db.exec("ALTER TABLE additional_voice_models ADD COLUMN credits_per_150_chars INTEGER NOT NULL DEFAULT 0");
      if (modelColumns.has("credits_per_100_chars")) {
        const updateTariff = db.db.prepare("UPDATE additional_voice_models SET credits_per_150_chars=? WHERE model_id=?");
        for (const row of db.db.prepare("SELECT model_id,credits_per_100_chars FROM additional_voice_models").all()) {
          updateTariff.run(Math.max(0, Math.ceil(Number(row.credits_per_100_chars || 0) * 1.5)), row.model_id);
        }
      }
    });
    migrateTariffs.immediate();
  }
  creditWallet.ensureSchema(db);
  const tenantColumns = new Set(db.db.prepare("PRAGMA table_info(tenant_elevenlabs)").all().map(row => row.name));
  if (!tenantColumns.has("model_id")) db.db.exec("ALTER TABLE tenant_elevenlabs ADD COLUMN model_id TEXT NOT NULL DEFAULT 'elevenlabs/eleven-v4-turbo'");
  const seedModel = db.db.prepare("INSERT OR IGNORE INTO additional_voice_models(model_id,enabled) VALUES(?,?)");
  for (const model of voiceModels) seedModel.run(model.id, model.id === "elevenlabs/eleven-v4-turbo" ? 1 : 0);
  db.db.exec(`CREATE TABLE IF NOT EXISTS tts_credit_policy_migrations (
    version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const pricingPolicyVersion = "weighted-characters-v1";
  if (!db.db.prepare("SELECT 1 FROM tts_credit_policy_migrations WHERE version=?").get(pricingPolicyVersion)) {
    const seedRates = db.db.transaction(() => {
      const saveRate = db.db.prepare("UPDATE additional_voice_models SET credits_per_150_chars=? WHERE model_id=?");
      [
        ["hexgrad/kokoro-82m", 15],
        ["google/gemini-3.1-flash-tts-preview", 150],
        ["google/gemini-3.8-flash-lite-tts", 75],
        ["elevenlabs/eleven-v4-turbo", 300],
      ].forEach(([modelId, rate]) => saveRate.run(rate, modelId));
      db.db.prepare("INSERT INTO tts_credit_policy_migrations(version) VALUES(?)").run(pricingPolicyVersion);
    });
    seedRates.immediate();
  }
  const starsgPricingVersion = "starsg-voice-v1";
  if (!db.db.prepare("SELECT 1 FROM tts_credit_policy_migrations WHERE version=?").get(starsgPricingVersion)) {
    const seedStarsgRates = db.db.transaction(() => {
      const saveRate = db.db.prepare("UPDATE additional_voice_models SET credits_per_150_chars=? WHERE model_id=?");
      saveRate.run(120, "starsg/tts-altair-v1-mini");
      saveRate.run(120, "starsg/tts-vega-v1-flash");
      db.db.prepare("INSERT INTO tts_credit_policy_migrations(version) VALUES(?)").run(starsgPricingVersion);
    });
    seedStarsgRates.immediate();
  }
  const get = id => db.db.prepare("SELECT tenant_id,voice_id,model_id FROM tenant_elevenlabs WHERE tenant_id=?").get(id)
    || { tenant_id: id, voice_id: "", model_id: "elevenlabs/eleven-v4-turbo" };
  const configured = () => Boolean(providerConfig.read().apiKey);
  let catalog = [], catalogUntil = 0, catalogKey = "", pendingCatalog = null;
  const lastTest = new Map(), lastAudit = new Map(), lastAdminPreview = new Map(), lastAdminCatalogSync = new Map();
  let openRouterCatalog = [], openRouterCatalogUntil = 0, pendingOpenRouterCatalog = null;
  let starsgCatalog = [], starsgCatalogUntil = 0, starsgCatalogKey = "", starsgCatalogErrorCode = null, pendingStarsgCatalog = null;
  let cartesiaCatalog = [], cartesiaCatalogUntil = 0, cartesiaCatalogKey = "", pendingCartesiaCatalog = null;
  // IDs conferidos manualmente no catálogo oficial da StarsG para tts-altair-v1-mini.
  // Mantemos o catálogo utilizável mesmo quando os endpoints de listagem da API retornam 404.
  const STARSG_ALTAR_VOICES = [
    ["female_ballad", "Ballad · Feminina · Elegante"],
    ["female_coral", "Coral · Feminina · Brilhante"],
    ["female_marin", "Marin · Feminina · Brilhante"],
    ["female_nova", "Nova · Feminina · Animada"],
    ["female_sage", "Sage · Feminina · Calma"],
    ["female_shimmer", "Shimmer · Feminina · Expressiva"],
    ["male_alloy", "Alloy · Masculina · Neutra"],
    ["male_ash", "Ash · Masculina · Amigável"],
    ["male_cedar", "Cedar · Masculina · Acolhedora"],
    ["male_echo", "Echo · Masculina · Natural"],
    ["male_fable", "Fable · Masculina · Narrativa"],
    ["male_onyx", "Onyx · Masculina · Grave"],
    ["male_verse", "Verse · Masculina · Expressiva"],
  ].map(([key, label]) => ({ key, label, language: "Português · pt" }));
  // IDs enviados pelo usuário a partir do catálogo oficial do tts-vega-v1-flash.
  const STARSG_VEGA_VOICES = [
    ["female_achernar", "Achernar · Feminina · Suave"],
    ["female_aoede", "Aoede · Feminina · Leve"],
    ["female_autonoe", "Autonoe · Feminina · Brilhante"],
    ["female_callirrhoe", "Callirrhoe · Feminina · Descontraída"],
    ["female_despina", "Despina · Feminina · Fluida"],
    ["female_erinome", "Erinome · Feminina · Clara"],
    ["female_gacrux", "Gacrux · Feminina · Madura"],
    ["female_kore", "Kore · Feminina · Firme"],
    ["female_laomedeia", "Laomedeia · Feminina · Animada"],
    ["female_leda", "Leda · Feminina · Jovem"],
    ["female_pulcherrima", "Pulcherrima · Feminina · Expressiva"],
    ["female_sulafat", "Sulafat · Feminina · Acolhedora"],
    ["female_vindemiatrix", "Vindemiatrix · Feminina · Gentil"],
    ["female_zephyr", "Zephyr · Feminina · Brilhante"],
    ["male_achird", "Achird · Masculina · Amigável"],
  ].map(([key, label]) => ({ key, label, language: "Português · pt" }));
  const starsgDefaultVoice = () => ({ key: starsgTts.DEFAULT_VOICE_ID,
    label: "Voz padrão do modelo", language: "Padrão StarsG", is_default: true });
  function starsgFallbackCatalog() {
    return voiceModels.filter(item => item.provider === "starsg").map(model => ({
      model_id: model.model_id,
      voices: [starsgDefaultVoice(), ...(model.model_id === "tts-altair-v1-mini" ? STARSG_ALTAR_VOICES
        : model.model_id === "tts-vega-v1-flash" ? STARSG_VEGA_VOICES : [])],
    }));
  }
  function openRouterKey() { return integrationSecrets.read("openrouter").secret; }
  function openRouterConfigured() { return Boolean(openRouterKey()); }
  function starsgKey() { return integrationSecrets.read("starsg").secret; }
  function starsgConfigured() { return Boolean(starsgKey()); }
  function cartesiaKey() { return integrationSecrets.read("cartesia").secret; }
  function cartesiaConfigured() { return Boolean(cartesiaKey()); }
  function getModelStates() {
    const states = new Map(db.db.prepare("SELECT model_id,enabled,credits_per_150_chars FROM additional_voice_models").all()
      .map(row => [row.model_id, { enabled: row.enabled === 1, credits_per_150_chars: row.credits_per_150_chars }]));
    return voiceModels.map(model => {
      const creditsPer150Chars = Number(states.get(model.id)?.credits_per_150_chars || 0);
      return { ...model, enabled: states.get(model.id)?.enabled === true,
        credits_per_150_chars: creditsPer150Chars,
        credit_multiplier: creditsPer150Chars / 150 };
    });
  }
  function selectedVoiceOptions() {
    return db.db.prepare(`SELECT o.model_id,o.voice_id,o.label FROM additional_voice_options o
      JOIN additional_voice_models m ON m.model_id=o.model_id
      WHERE o.enabled=1 AND m.enabled=1 AND m.credits_per_150_chars>0`).all();
  }
  function voiceIsEnabled(modelId, voiceId) {
    return Boolean(db.db.prepare(`SELECT 1 FROM additional_voice_options o
      JOIN additional_voice_models m ON m.model_id=o.model_id
      WHERE o.model_id=? AND o.voice_id=? AND o.enabled=1 AND m.enabled=1 AND m.credits_per_150_chars>0`)
      .get(modelId, voiceId));
  }
  function unpricedVoiceCount() {
    return Number(db.db.prepare(`SELECT count(*) AS count FROM additional_voice_options o
      JOIN additional_voice_models m ON m.model_id=o.model_id
      WHERE o.enabled=1 AND m.enabled=1 AND m.credits_per_150_chars<=0`).get()?.count || 0);
  }
  async function openRouterVoices(forceRefresh = false) {
    if (!forceRefresh && Date.now() < openRouterCatalogUntil) return openRouterCatalog;
    if (pendingOpenRouterCatalog) return pendingOpenRouterCatalog;
    const task = (async () => {
      const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=speech", {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("OPENROUTER_CATALOG_FAILED");
      const body = await response.json();
      if (!Array.isArray(body.data)) throw new Error("OPENROUTER_CATALOG_INVALID");
      const ids = new Set(voiceModels.filter(model => model.provider === "openrouter").map(model => model.model_id));
      openRouterCatalog = body.data.filter(model => ids.has(model.id))
        .map(model => {
          const voiceModel = voiceModels.find(item => item.model_id === model.id);
          const supportedVoices = Array.isArray(model.supported_voices) ? model.supported_voices
            .filter(value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value))
            .filter(value => !Array.isArray(voiceModel?.pt_br_voice_ids)
              || voiceModel.pt_br_voice_ids.includes(value))
            .map(value => ({ key: value, label: value,
              language: voiceModel?.pt_br_voice_ids?.includes(value) ? "Português (Brasil)" : "Multilíngue · teste PT-BR" }))
            : [];
          const voices = supportedVoices.length ? supportedVoices
            : voiceModel?.catalog_voice_id ? [{ key: voiceModel.catalog_voice_id,
              label: voiceModel.catalog_voice_label || voiceModel.catalog_voice_id,
              language: "Multilíngue · teste PT-BR" }] : [];
          return { model_id: model.id, voices };
        });
      openRouterCatalogUntil = Date.now() + 300000;
      return openRouterCatalog;
    })();
    pendingOpenRouterCatalog = task;
    try { return await task; } finally { if (pendingOpenRouterCatalog === task) pendingOpenRouterCatalog = null; }
  }
  async function voicesForModel(id) {
    const model = voiceModels.find(item => item.id === id);
    if (!model) return [];
    if (model.provider === "elevenlabs") return await voices();
    if (model.provider === "starsg") return (await starsgVoices()).find(item => item.model_id === model.model_id)?.voices || [];
    if (model.provider === "cartesia") return (await cartesiaVoices()).find(item => item.model_id === model.model_id)?.voices || [];
    return (await openRouterVoices()).find(item => item.model_id === model.model_id)?.voices || [];
  }
  function modelConfigured(model) {
    if (model.provider === "elevenlabs") return configured();
    if (model.provider === "starsg") return starsgConfigured();
    if (model.provider === "cartesia") return cartesiaConfigured();
    return openRouterConfigured();
  }
  async function cartesiaVoices(forceRefresh = false) {
    const apiKey = cartesiaKey();
    if (!apiKey) throw new Error("CARTESIA_NOT_CONFIGURED");
    const fingerprint = crypto.createHash("sha256").update(apiKey).digest("hex");
    if (!forceRefresh && Date.now() < cartesiaCatalogUntil && cartesiaCatalogKey === fingerprint) return cartesiaCatalog;
    if (pendingCartesiaCatalog?.key === fingerprint) return pendingCartesiaCatalog.promise;
    const task = (async () => {
      const result = [];
      let cursor = "";
      for (let page = 0; page < 20; page++) {
        const query = new URLSearchParams({ is_owner: "true", limit: "100" });
        if (cursor) query.set("starting_after", cursor);
        const response = await fetch(`https://api.cartesia.ai/voices?${query}`, {
          headers: { Authorization: `Bearer ${apiKey}`, "Cartesia-Version": cartesiaTts.API_VERSION },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("CARTESIA_CATALOG_FAILED");
        const body = await response.json();
        if (!Array.isArray(body.data)) throw new Error("CARTESIA_CATALOG_INVALID");
        for (const voice of body.data) {
          const id = voice?.id;
          if (voice?.is_owner === false || voice?.status && voice.status !== "active"
              || typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) continue;
          const name = typeof voice.name === "string" ? voice.name.trim() : "";
          if (!name) continue;
          const language = typeof voice.language === "string" ? voice.language.toLowerCase() : "";
          result.push({ key: id, label: name.slice(0, 120),
            language: language === "pt" ? "Português · teste PT-BR" : language ? language.toUpperCase() : "Idioma não informado" });
        }
        if (!body.has_more) break;
        const lastId = body.data.at(-1)?.id;
        if (!lastId || lastId === cursor) throw new Error("CARTESIA_CATALOG_INVALID");
        cursor = lastId;
      }
      cartesiaCatalog = [{ model_id: "sonic-3.6", voices: result }];
      cartesiaCatalogKey = fingerprint;
      cartesiaCatalogUntil = Date.now() + 300000;
      return cartesiaCatalog;
    })();
    pendingCartesiaCatalog = { key: fingerprint, promise: task };
    try { return await task; } finally { if (pendingCartesiaCatalog?.promise === task) pendingCartesiaCatalog = null; }
  }
  async function starsgVoices(forceRefresh = false) {
    const apiKey = starsgKey();
    if (!apiKey) throw new Error("STARSG_NOT_CONFIGURED");
    const fingerprint = crypto.createHash("sha256").update(apiKey).digest("hex");
    if (!forceRefresh && Date.now() < starsgCatalogUntil && starsgCatalogKey === fingerprint) return starsgCatalog;
    if (pendingStarsgCatalog?.key === fingerprint) return pendingStarsgCatalog.promise;
    const task = (async () => {
      try {
        const modelsResponse = await fetch("https://api.starsg.ai/v1/realtime/models", {
          headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000),
        });
        if (!modelsResponse.ok) throw new Error(modelsResponse.status === 404
          ? "STARSG_MODEL_CATALOG_NOT_FOUND" : "STARSG_MODEL_CATALOG_FAILED");
        const modelBody = await modelsResponse.json();
        const modelRows = Array.isArray(modelBody.data) ? modelBody.data
          : Array.isArray(modelBody.models) ? modelBody.models : [];
        const result = [];
        for (const model of voiceModels.filter(item => item.provider === "starsg")) {
          const advertised = modelRows.length === 0 || modelRows.some(item =>
            [item.id, item.model, item.model_id].includes(model.model_id));
          if (!advertised) { result.push({ model_id: model.model_id, voices: [] }); continue; }
          const response = await fetch(`https://api.starsg.ai/v1/realtime/models/${encodeURIComponent(model.model_id)}/voices`, {
            headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw new Error(response.status === 404
            ? "STARSG_VOICE_CATALOG_NOT_FOUND" : "STARSG_VOICE_CATALOG_FAILED");
          const body = await response.json();
          const rows = Array.isArray(body.voices) ? body.voices : Array.isArray(body.data) ? body.data
            : Array.isArray(body.items) ? body.items : [];
          const voices = rows.map(item => {
            const key = typeof item === "string" ? item : item.voice_id || item.id || item.key;
            if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(key)) return null;
            const label = typeof item === "string" ? item : item.name || item.label || item.display_name || key;
            const language = typeof item === "object" && (item.language || item.locale || item.languages?.[0]);
            return { key, label: String(label).slice(0, 120), language: language ? String(language) : "Multilíngue · teste PT-BR" };
          }).filter(Boolean);
          result.push({ model_id: model.model_id, voices: [
            starsgDefaultVoice(),
            ...voices.filter(voice => voice.key !== starsgTts.DEFAULT_VOICE_ID),
          ] });
        }
        starsgCatalog = result;
        starsgCatalogErrorCode = null;
        starsgCatalogKey = fingerprint;
        starsgCatalogUntil = Date.now() + 300000;
      } catch (error) {
        starsgCatalogErrorCode = ["STARSG_MODEL_CATALOG_NOT_FOUND", "STARSG_MODEL_CATALOG_FAILED", "STARSG_VOICE_CATALOG_NOT_FOUND", "STARSG_VOICE_CATALOG_FAILED"].includes(error?.message)
          ? error.message : "STARSG_CATALOG_FAILED";
        starsgCatalog = starsgFallbackCatalog();
        starsgCatalogKey = fingerprint;
        starsgCatalogUntil = Date.now() + 15000;
      }
      return starsgCatalog;
    })();
    pendingStarsgCatalog = { key: fingerprint, promise: task };
    try { return await task; } finally { if (pendingStarsgCatalog?.promise === task) pendingStarsgCatalog = null; }
  }
  async function modelsForStreamer(tenantId) {
    const states = getModelStates().filter(model => model.enabled && modelConfigured(model));
    const approved = new Map(selectedVoiceOptions().map(item => [`${item.model_id}:${item.voice_id}`, item]));
    let catalog = [], catalogError = false;
    let starsg = [], cartesia = [];
    if (states.some(model => model.provider === "openrouter") && openRouterConfigured()) {
      try { catalog = await openRouterVoices(); }
      catch {
        catalog = []; catalogError = true;
        audit(tenantId, "tts.provider.failed", "error", "error", { operation: "catalog", provider: "openrouter", code: "OPENROUTER_CATALOG_FAILED" });
      }
    }
    let eleven = [];
    if (states.some(model => model.provider === "starsg") && starsgConfigured()) {
      try {
        starsg = await starsgVoices();
        if (starsgCatalogErrorCode) {
          catalogError = true;
          audit(tenantId, "tts.provider.failed", "error", "error", { operation: "catalog", provider: "starsg", code: starsgCatalogErrorCode });
        }
      }
      catch (error) {
        catalogError = true;
        audit(tenantId, "tts.provider.failed", "error", "error", { operation: "catalog", provider: "starsg",
          code: ["STARSG_MODEL_CATALOG_NOT_FOUND", "STARSG_MODEL_CATALOG_FAILED", "STARSG_VOICE_CATALOG_NOT_FOUND", "STARSG_VOICE_CATALOG_FAILED"].includes(error?.message)
            ? error.message : "STARSG_CATALOG_FAILED" });
      }
    }
    if (states.some(model => model.provider === "elevenlabs") && configured()) {
      try { eleven = await voices(); }
      catch {
        catalogError = true;
        audit(tenantId, "tts.provider.failed", "error", "error", { operation: "catalog", provider: "elevenlabs", code: "ELEVENLABS_CATALOG_FAILED" });
      }
    }
    if (states.some(model => model.provider === "cartesia") && cartesiaConfigured()) {
      try { cartesia = await cartesiaVoices(); }
      catch {
        catalogError = true;
        audit(tenantId, "tts.provider.failed", "error", "error", { operation: "catalog", provider: "cartesia", code: "CARTESIA_CATALOG_FAILED" });
      }
    }
    const models = states.map(model => ({
      id: model.id, label: model.label, type: model.voice_type, provider: model.provider,
      credits_per_150_chars: model.credits_per_150_chars, credit_multiplier: model.credit_multiplier,
      configured: modelConfigured(model),
      voices: (model.provider === "elevenlabs" ? eleven : model.provider === "starsg"
        ? (starsg.find(item => item.model_id === model.model_id)?.voices || [])
        : model.provider === "cartesia" ? (cartesia.find(item => item.model_id === model.model_id)?.voices || [])
          : (catalog.find(item => item.model_id === model.model_id)?.voices || []))
        .filter(voice => approved.has(`${model.id}:${voice.key}`))
        .map(voice => ({ ...voice, credits_per_150_chars: model.credits_per_150_chars,
          credit_multiplier: model.credit_multiplier })),
    })).filter(model => model.voices.length > 0);
    return { models, catalog_error: catalogError };
  }
  async function adminVoiceCatalog(forceRefresh = false) {
    const approved = new Map(db.db.prepare("SELECT model_id,voice_id,label,enabled FROM additional_voice_options").all()
      .map(item => [`${item.model_id}:${item.voice_id}`, item]));
    const models = getModelStates();
    let eleven = [], openRouter = [], starsg = [], cartesia = [], catalogError = false;
    const catalogErrors = {};
    let elevenAvailable = false, openRouterAvailable = false, starsgAvailable = false, cartesiaAvailable = false;
    if (configured()) try { eleven = await voices(forceRefresh); elevenAvailable = true; }
    catch { catalogError = true; catalogErrors.elevenlabs = "ELEVENLABS_CATALOG_FAILED"; }
    if (openRouterConfigured()) try { openRouter = await openRouterVoices(forceRefresh); openRouterAvailable = true; }
    catch { catalogError = true; catalogErrors.openrouter = "OPENROUTER_CATALOG_FAILED"; }
    if (starsgConfigured()) try {
      starsg = await starsgVoices(forceRefresh); starsgAvailable = true;
      if (starsgCatalogErrorCode) { catalogError = true; catalogErrors.starsg = starsgCatalogErrorCode; }
    } catch (error) {
      catalogError = true;
      catalogErrors.starsg = ["STARSG_MODEL_CATALOG_NOT_FOUND", "STARSG_MODEL_CATALOG_FAILED", "STARSG_VOICE_CATALOG_NOT_FOUND", "STARSG_VOICE_CATALOG_FAILED"].includes(error?.message)
        ? error.message : "STARSG_CATALOG_FAILED";
    }
    if (cartesiaConfigured()) try { cartesia = await cartesiaVoices(forceRefresh); cartesiaAvailable = true; }
    catch { catalogError = true; catalogErrors.cartesia = "CARTESIA_CATALOG_FAILED"; }
    const result = models.map(model => {
      const available = model.provider === "elevenlabs" ? eleven : model.provider === "starsg"
        ? (starsg.find(item => item.model_id === model.model_id)?.voices || [])
        : model.provider === "cartesia" ? (cartesia.find(item => item.model_id === model.model_id)?.voices || [])
        : (openRouter.find(item => item.model_id === model.model_id)?.voices || []);
      const voiceMap = new Map(available.map(voice => [voice.key, { ...voice, enabled: false, stale: false }]));
      for (const [key, item] of approved) {
        if (item.model_id !== model.id) continue;
        const voice = voiceMap.get(item.voice_id);
        if (voice) voice.enabled = item.enabled === 1;
        else voiceMap.set(item.voice_id, { key: item.voice_id, label: item.label || item.voice_id, enabled: item.enabled === 1, stale: true });
      }
      const catalogAvailable = model.provider === "elevenlabs" ? elevenAvailable
        : model.provider === "starsg" ? starsgAvailable : model.provider === "cartesia" ? cartesiaAvailable : openRouterAvailable;
      return { ...model, configured: modelConfigured(model), catalog_available: catalogAvailable,
        catalog_error_code: catalogErrors[model.provider] || null, voices: [...voiceMap.values()] };
    });
    return { models: result, catalog_error: catalogError, catalog_errors: catalogErrors };
  }
  async function voices(forceRefresh = false) {
    const apiKey = providerConfig.read().apiKey;
    if (!apiKey) throw new Error("ELEVENLABS_NOT_CONFIGURED");
    const fingerprint = crypto.createHash("sha256").update(apiKey).digest("hex");
    if (!forceRefresh && Date.now() < catalogUntil && catalogKey === fingerprint) return catalog;
    if (pendingCatalog?.key === fingerprint) return pendingCatalog.promise;
    const task = (async () => {
      const result = [];
      let page = "";
      for (let i = 0; i < 20; i++) {
        // Fetch account voices first: the upstream `accent=brazilian` filter omits
        // owned voices tagged `pt-brazilian` (for example account clones).
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
          const accents = [voice.labels?.accent, ...(Array.isArray(voice.verified_languages)
            ? voice.verified_languages.filter(item => String(item.language || "").toLowerCase() === "pt")
              .flatMap(item => [item.accent, item.locale]) : [])]
            .filter(value => typeof value === "string").map(value => value.normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "").toLowerCase());
          const isBrazilian = accents.some(value => value.includes("brazil") || value.includes("brasil") || value === "pt-br");
          const accountVoice = voice.is_owner === true;
          if ((isBrazilian || accountVoice) && /^[a-zA-Z0-9_-]{1,128}$/.test(voice.voice_id) && typeof voice.name === "string")
            result.push({ key: voice.voice_id, label: voice.name.slice(0, 120),
              language: isBrazilian ? "pt-BR" : "Idioma não identificado · voz da conta" });
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
    const user = db.getUserById(id);
    return { enabled: Boolean(active(id)), configured: configured(), openrouter_configured: openRouterConfigured(), voice_id: row.voice_id,
      model_id: row.model_id || "elevenlabs/eleven-v4-turbo",
      credit_balance: creditWallet.getBalance(db, id),
      credits_unlimited: user?.role === "admin" && user?.status === "active" };
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
    if (!active(req.user.id)) {
      audit(req.user.id, "tts.provider.rejected", "notice", "warning", { code: "ACCOUNT_INACTIVE" });
      return res.status(403).json({ success: false, error: "Conta inativa." });
    }
    next();
  }
  app.get("/api/admin/tts/additional-models", auth.requireAdmin, async (req, res) => {
    const catalog = await adminVoiceCatalog();
    res.set("Cache-Control", "no-store").json({ success: true,
      openrouter_configured: openRouterConfigured(), starsg_configured: starsgConfigured(),
      cartesia_configured: cartesiaConfigured(), elevenlabs_configured: configured(), ...catalog });
  });
  app.post("/api/admin/tts/additional-models/sync", auth.requireAdmin, async (req, res) => {
    const trace_id = crypto.randomUUID();
    const now = Date.now();
    if (now - (lastAdminCatalogSync.get(req.user.id) || 0) < 10000) {
      audit(req.user.id, "tts.voice_catalog.sync.rejected", "notice", "warning", { code: "SYNC_RATE_LIMITED" });
      return res.status(429).json({ success: false, error: "Aguarde alguns segundos antes de sincronizar novamente." });
    }
    lastAdminCatalogSync.set(req.user.id, now);
    const startedAt = Date.now();
    log(req.user.id, { event: "tts.voice_catalog.sync.requested", category: "connection", level: "info",
      game: "tts", trace_id, message: "Sincronização manual do catálogo de vozes solicitada." });
    try {
      const catalog = await adminVoiceCatalog(true);
      const configuredByProvider = {
        openrouter: openRouterConfigured(), starsg: starsgConfigured(),
        cartesia: cartesiaConfigured(), elevenlabs: configured(),
      };
      const providers = Object.fromEntries(Object.entries(configuredByProvider).map(([provider, isConfigured]) => {
        const models = catalog.models.filter(model => model.provider === provider);
        const code = catalog.catalog_errors?.[provider] || null;
        const status = !isConfigured ? "not_configured" : code
          ? (provider === "starsg" && models.some(model => model.catalog_available) ? "fallback" : "failed")
          : "synced";
        return [provider, { status, code, model_count: models.length,
          voice_count: models.reduce((total, model) => total + model.voices.filter(voice => !voice.stale).length, 0) }];
      }));
      const hasIssues = Object.values(providers).some(item => item.status === "failed" || item.status === "fallback");
      const duration_ms = Date.now() - startedAt;
      log(req.user.id, { event: hasIssues ? "tts.voice_catalog.sync.partial" : "tts.voice_catalog.sync.completed",
        category: hasIssues ? "notice" : "connection", level: hasIssues ? "warning" : "info",
        game: "tts", trace_id, duration_ms,
        code: hasIssues ? "VOICE_CATALOG_PARTIAL" : "VOICE_CATALOG_SYNCED",
        message: hasIssues ? "Catálogo de vozes atualizado parcialmente." : "Catálogo de vozes sincronizado.",
        details: { providers } });
      res.set("Cache-Control", "no-store").json({ success: true, ...catalog, providers, duration_ms });
    } catch (error) {
      log(req.user.id, { event: "tts.voice_catalog.sync.failed", category: "error", level: "error",
        game: "tts", trace_id, duration_ms: Date.now() - startedAt, code: "VOICE_CATALOG_SYNC_FAILED",
        message: "Não foi possível sincronizar o catálogo de vozes.",
        details: { error_type: error?.name || "Error" } });
      res.status(500).json({ success: false, error: "Não foi possível sincronizar o catálogo de vozes." });
    }
  });
  app.post("/api/admin/tts/voice-preview", auth.requireAdmin, async (req, res) => {
    const model = voiceModels.find(item => item.id === req.body?.model_id);
    const voiceId = req.body?.voice_id;
    if (!model || typeof voiceId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(voiceId)) {
      audit(req.user.id, "tts.admin_voice_preview.rejected", "notice", "warning", { code: "INVALID_VOICE" });
      return res.status(400).json({ success: false, error: "Voz ou modelo inválido." });
    }
    if (!modelConfigured(model)) return res.status(503).json({ success: false, error: "Integração deste modelo não está configurada." });
    const now = Date.now();
    if (now - (lastAdminPreview.get(req.user.id) || 0) < 1500) {
      audit(req.user.id, "tts.admin_voice_preview.rejected", "notice", "warning", { code: "PREVIEW_RATE_LIMITED", model_id: model.id });
      return res.status(429).json({ success: false, error: "Aguarde um instante antes de testar outra voz." });
    }
    lastAdminPreview.set(req.user.id, now);
    const traceId = crypto.randomUUID();
    const providerStartedAt = Date.now();
    let providerUsageRecorded = false;
    const previewText = "Olá! Aqui no Brasil, o número do TikPlay é vinte e três. Esta é uma prévia em português brasileiro.";
    try {
      if (!(await voicesForModel(model.id)).some(voice => voice.key === voiceId)) {
        audit(req.user.id, "tts.admin_voice_preview.rejected", "notice", "warning", { code: "VOICE_NOT_IN_CATALOG", model_id: model.id });
        return res.status(400).json({ success: false, error: "Esta voz não está disponível no catálogo do provedor." });
      }
      let audio, audioType;
      if (model.provider === "cartesia") {
        const generated = await cartesiaTts.synthesize({ apiKey: cartesiaKey(), modelId: model.model_id,
          voiceId, text: previewText, timeoutMs: 15000 });
        audio = generated.audio;
        audioType = generated.contentType;
        apiCosts.record(db.db, { provider: "cartesia", model: model.model_id, resource: "admin_voice_preview",
          unit: "character", quantity: previewText.length, status: "success",
          duration_ms: Date.now() - providerStartedAt, request_id: traceId, provider_request_id: generated.requestId });
        providerUsageRecorded = true;
      } else if (model.provider === "starsg") {
        const generated = await starsgTts.synthesize({ modelId: model.model_id, voiceId, text: previewText,
          apiKey: starsgKey(), sampleRate: Number(model.pcm_sample_rate) || 24000 });
        audio = generated.audio; audioType = generated.contentType;
        apiCosts.record(db.db, { provider: "starsg", model: model.model_id, resource: "admin_voice_preview",
          unit: "character", quantity: previewText.length, status: "success",
          duration_ms: Date.now() - providerStartedAt, request_id: traceId,
          provider_request_id: generated.requestId, actual_cost_usd: generated.actualCostUsd });
        providerUsageRecorded = true;
      } else {
        const url = model.provider === "elevenlabs"
          ? `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`
          : "https://openrouter.ai/api/v1/audio/speech";
        const headers = model.provider === "elevenlabs"
          ? { "xi-api-key": providerConfig.read().apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" }
          : { Authorization: `Bearer ${openRouterKey()}`,
              "Content-Type": "application/json", Accept: "audio/mpeg, audio/wav, audio/pcm" };
        const body = model.provider === "elevenlabs"
          ? { text: previewText, model_id: model.model_id, language_code: "pt" }
          : { model: model.model_id, input: previewText, ...(model.omit_voice_parameter ? {} : { voice: voiceId }),
              response_format: model.response_format || (model.id === "heygen/heygen-voice-1-turbo" ? "pcm" : "mp3") };
        const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        apiCosts.record(db.db, { provider: model.provider, model: model.model_id, resource: "admin_voice_preview",
          unit: "character", quantity: previewText.length, status: response.ok ? "success" : "failed",
          duration_ms: Date.now() - providerStartedAt, request_id: traceId,
          provider_request_id: response.headers.get("x-request-id") || response.headers.get("request-id") });
        providerUsageRecorded = true;
        if (!response.ok) throw new Error("VOICE_PREVIEW_PROVIDER_FAILED");
        audioType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!["audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/pcm"].includes(audioType))
          throw new Error("VOICE_PREVIEW_INVALID_AUDIO");
        if (Number(response.headers.get("content-length")) > 5 * 1024 * 1024) throw new Error("VOICE_PREVIEW_AUDIO_TOO_LARGE");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("VOICE_PREVIEW_INVALID_AUDIO");
        const chunks = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > 5 * 1024 * 1024) { await reader.cancel(); throw new Error("VOICE_PREVIEW_AUDIO_TOO_LARGE"); }
          chunks.push(Buffer.from(value));
        }
        if (!total) throw new Error("VOICE_PREVIEW_INVALID_AUDIO");
        audio = Buffer.concat(chunks, total);
        if (audioType === "audio/pcm") {
          audio = starsgTts.wavFromPcm(audio, Number(model.pcm_sample_rate) || 24000);
          audioType = "audio/wav";
        }
      }
      audit(req.user.id, "tts.admin_voice_preview.completed", "diagnostic", "info", { model_id: model.id, provider: model.provider, trace_id: traceId });
      res.set({ "Cache-Control": "no-store", "Content-Type": audioType, "X-Content-Type-Options": "nosniff" }).send(audio);
    } catch (error) {
      if (!providerUsageRecorded) apiCosts.record(db.db, { provider: model.provider, model: model.model_id,
        resource: "admin_voice_preview", unit: "character", quantity: previewText.length,
        status: error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "failed",
        duration_ms: Date.now() - providerStartedAt, request_id: traceId });
      const code = ["VOICE_PREVIEW_INVALID_AUDIO", "VOICE_PREVIEW_AUDIO_TOO_LARGE"].includes(error?.message)
        || String(error?.message || "").startsWith("STARS_TTS_")
        ? error.message : "VOICE_PREVIEW_PROVIDER_FAILED";
      audit(req.user.id, "tts.admin_voice_preview.failed", "error", "error", { model_id: model.id, provider: model.provider, code, trace_id: traceId });
      res.status(502).json({ success: false, error: "Não foi possível gerar a prévia desta voz agora." });
    }
  });
  app.put("/api/admin/tts/additional-models", auth.requireAdmin, async (req, res) => {
    const submitted = req.body?.voices;
    const submittedModels = req.body?.model_ids;
    const submittedCosts = req.body?.model_costs;
    if (!Array.isArray(submitted) || submitted.length > 5000 || !Array.isArray(submittedModels)
        || submittedModels.length > voiceModels.length
        || submittedModels.some(id => !voiceModels.some(model => model.id === id))
        || new Set(submittedModels).size !== submittedModels.length
        || submitted.some(item => !voiceModels.some(model => model.id === item?.model_id)
          || !submittedModels.includes(item.model_id)
          || typeof item.voice_id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.voice_id))
        || new Set(submitted.map(item => `${item.model_id}:${item.voice_id}`)).size !== submitted.length
        || (submittedCosts !== undefined && (!Array.isArray(submittedCosts) || submittedCosts.length > voiceModels.length
          || submittedCosts.some(item => !voiceModels.some(model => model.id === item?.model_id)
            || !Number.isSafeInteger(item.credits_per_150_chars) || item.credits_per_150_chars < 0 || item.credits_per_150_chars > 100000)
          || new Set(submittedCosts.map(item => item.model_id)).size !== submittedCosts.length))) {
      audit(req.user.id, "tts.models.config_rejected", "notice", "warning", { code: "INVALID_VOICE_CONFIG" });
      return res.status(400).json({ success: false, error: "Seleção de vozes inválida." });
    }
    const catalogs = new Map();
    try {
      for (const modelId of submittedModels) {
        const model = voiceModels.find(item => item.id === modelId);
        if (!modelConfigured(model)) throw new Error("VOICE_PROVIDER_NOT_CONFIGURED");
        const available = await voicesForModel(modelId);
        catalogs.set(modelId, available);
        if (submitted.filter(item => item.model_id === modelId).some(item => !available.some(voice => voice.key === item.voice_id))) {
          audit(req.user.id, "tts.models.config_rejected", "notice", "warning", { code: "VOICE_NOT_IN_CATALOG" });
          return res.status(400).json({ success: false, error: "Uma voz selecionada não está disponível no catálogo atual." });
        }
      }
    } catch {
      audit(req.user.id, "tts.models.config_rejected", "notice", "warning", { code: "VOICE_CATALOG_UNAVAILABLE" });
      return res.status(503).json({ success: false, error: "Não foi possível validar o catálogo de vozes. Tente novamente." });
    }
    const saveOption = db.db.prepare(`INSERT INTO additional_voice_options(model_id,voice_id,label,enabled) VALUES(?,?,?,?)
      ON CONFLICT(model_id,voice_id) DO UPDATE SET label=excluded.label,enabled=excluded.enabled`);
    const disableModel = db.db.prepare("UPDATE additional_voice_options SET enabled=0 WHERE model_id=?");
    const saveModel = db.db.prepare("UPDATE additional_voice_models SET enabled=? WHERE model_id=?");
    const saveCost = db.db.prepare("UPDATE additional_voice_models SET credits_per_150_chars=? WHERE model_id=?");
    const previousCosts = new Map(db.db.prepare("SELECT model_id,credits_per_150_chars FROM additional_voice_models").all()
      .map(row => [row.model_id, row.credits_per_150_chars]));
    const transaction = db.db.transaction(({ items, costs }) => {
      for (const modelId of submittedModels) disableModel.run(modelId);
      for (const item of items.filter(value => submittedModels.includes(value.model_id))) {
        const label = catalogs.get(item.model_id)?.find(voice => voice.key === item.voice_id)?.label
          || db.db.prepare("SELECT label FROM additional_voice_options WHERE model_id=? AND voice_id=?").get(item.model_id, item.voice_id)?.label
          || item.voice_id;
        saveOption.run(item.model_id, item.voice_id, label, 1);
      }
      for (const model of voiceModels.filter(value => submittedModels.includes(value.id))) {
        const hasEnabled = db.db.prepare("SELECT 1 FROM additional_voice_options WHERE model_id=? AND enabled=1 LIMIT 1").get(model.id);
        saveModel.run(hasEnabled ? 1 : 0, model.id);
      }
      for (const item of costs || []) saveCost.run(item.credits_per_150_chars, item.model_id);
    });
    transaction({ items: submitted, costs: submittedCosts });
    for (const item of submittedCosts || []) {
      const previous = previousCosts.get(item.model_id) || 0;
      if (previous !== item.credits_per_150_chars) {
        audit(req.user.id, "tts.credits.model_cost_saved", "billing", "info", {
          model_id: item.model_id, previous_credits_per_150_chars: previous,
          credits_per_150_chars: item.credits_per_150_chars, actor_id: req.user.id,
        });
      }
    }
    audit(req.user.id, "tts.models.config_saved", "diagnostic", "info", {
      enabled_voice_count: submitted.length,
      enabled_models: [...new Set(submitted.map(item => item.model_id))], actor_id: req.user.id,
    });
    const catalog = await adminVoiceCatalog();
    res.set("Cache-Control", "no-store").json({ success: true, ...catalog });
  });
  function globalStatus() {
    const config = providerConfig.read();
    return { success: true, configured: Boolean(config.apiKey), source: config.source,
      api_key_masked: maskSecret(config.apiKey) };
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
    if (clear !== true && !key.startsWith("sk_")) {
      audit(req.user.id, "tts.provider.config_rejected", "notice", "warning", { code: "API_KEY_ID_INSTEAD_OF_SECRET" });
      return res.status(400).json({ success: false,
        error: "Esse valor não começa com sk_ e parece ser o ID da chave. Cole o segredo completo da API, exibido ao criar ou girar a chave." });
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
  app.get("/api/tts/elevenlabs", auth.requireAuth, chatFeature, async (req, res) => {
    const state = view(req.user.id);
    if (!active(req.user.id)) return res.json({ success: true, ...state, voices: [] });
    try {
      const catalog = await modelsForStreamer(req.user.id);
      const currentModel = catalog.models.find(model => model.id === state.model_id);
      res.json({ success: true, ...state, models: catalog.models, catalog_error: catalog.catalog_error,
        unpriced_voice_count: unpricedVoiceCount(),
        voices: currentModel?.voices || [] });
    }
    catch {
      audit(req.user.id, "tts.provider.failed", "error", "error", { operation: "catalog", code: "VOICE_CATALOG_FAILED" });
      res.json({ success: true, ...state, voices: [], catalog_error: true });
    }
  });
  app.put("/api/tts/elevenlabs", auth.requireAuth, chatFeature, allowed, async (req, res) => {
    const voice = req.body?.voice_id;
    const current = get(req.user.id);
    const selectedModel = typeof req.body?.model_id === "string" ? req.body.model_id : (current.model_id || "elevenlabs/eleven-v4-turbo");
    const model = getModelStates().find(item => item.id === selectedModel);
    if (!model) return res.status(400).json({ success: false, error: "Modelo de voz inválido." });
    if (typeof voice !== "string" || voice.length > 128) return res.status(400).json({ success: false });
    try {
      if (voice && (!voiceIsEnabled(selectedModel, voice) || !modelConfigured(model)
          || !(await voicesForModel(selectedModel)).some(v => v.key === voice)))
        return res.status(400).json({ success: false, error: "Voz não liberada pelo administrador." });
      // Recheck after the asynchronous catalog request in case the admin revoked access.
      if (!active(req.user.id)) return res.status(403).json({ success: false, error: "Conta inativa." });
      if (voice && !voiceIsEnabled(selectedModel, voice))
        return res.status(400).json({ success: false, error: "Voz sem tarifa em TikCoins ou não liberada pelo administrador." });
      db.db.prepare(`INSERT INTO tenant_elevenlabs(tenant_id,model_id,voice_id) VALUES(?,?,?)
        ON CONFLICT(tenant_id) DO UPDATE SET model_id=excluded.model_id,voice_id=excluded.voice_id`).run(req.user.id, selectedModel, voice);
      audit(req.user.id, "tts.provider.preference_saved", "diagnostic", "debug", { model_id: selectedModel, voice_type: model.voice_type });
      res.json({ success: true, ...view(req.user.id) });
    } catch { res.status(502).json({ success: false, error: "Não foi possível salvar a voz." }); }
  });
  app.post("/api/tts/elevenlabs/test", auth.requireAuth, chatFeature, allowed, (req, res) => {
    const selection = get(req.user.id);
    const model = getModelStates().find(item => item.id === (selection.model_id || "elevenlabs/eleven-v4-turbo"));
    if (!selection.voice_id || !model || !voiceIsEnabled(model.id, selection.voice_id)) return res.status(400).json({ success: false, error: "Selecione uma voz adicional disponível primeiro." });
    if (!modelConfigured(model)) return res.status(503).json({ success: false, error: "Integração do modelo ainda não configurada." });
    if (Date.now() - (lastTest.get(req.user.id) || 0) < 10000)
      return res.status(429).json({ success: false, error: "Aguarde alguns segundos antes de testar novamente." });
    const ok = daemonSend({ cmd: "elevenlabs_test", tenant_id: req.user.id, trace_id: crypto.randomUUID() });
    if (ok) lastTest.set(req.user.id, Date.now());
    res.status(ok ? 200 : 503).json({ success: ok, ...(ok ? {} : { error: "Serviço de voz indisponível." }) });
  });
};
