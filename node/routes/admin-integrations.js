const crypto = require("crypto");
const maskSecret = require("../lib/mask-secret");

const PROVIDERS = new Set(["elevenlabs", "openrouter", "mercadopago"]);

module.exports = function registerAdminIntegrationRoutes(app, {
  auth, integrationSecrets, providerConfig, checkoutConfig, getDaemonOpenRouterKey, log,
}) {
  const testState = new Map();
  const trace = () => crypto.randomUUID();
  const report = (actorId, event, level, message, details = {}, code) => log({
    category: level === "error" ? "error" : "system", level,
    event, message, code, source: "node", trace_id: trace(),
    details: { actor_id: actorId, ...details },
  });
  const status = () => {
    const openrouter = integrationSecrets.read("openrouter");
    const mercadopago = integrationSecrets.read("mercadopago");
    const webhook = integrationSecrets.read("mercadopago_webhook");
    const checkout = checkoutConfig.read();
    const elevenlabs = providerConfig.read();
    return {
      success: true,
      integrations: {
        elevenlabs: { configured: Boolean(elevenlabs.apiKey), source: elevenlabs.source,
          api_key_masked: maskSecret(elevenlabs.apiKey) },
        openrouter: { configured: Boolean(openrouter.secret), source: openrouter.source,
          api_key_masked: maskSecret(openrouter.secret),
          daemon_restart_required: openrouter.secret !== getDaemonOpenRouterKey() },
        mercadopago: { configured: Boolean(mercadopago.secret), source: mercadopago.source,
          access_token_masked: maskSecret(mercadopago.secret),
          webhook_secret_configured: Boolean(webhook.secret), webhook_secret_masked: maskSecret(webhook.secret), webhook_source: webhook.source,
          public_base_url: checkout.publicBaseUrl, public_base_url_source: checkout.source },
      },
    };
  };
  app.get("/api/admin/integrations", auth.requireAdmin, (req, res) => {
    res.set("Cache-Control", "no-store").json(status());
  });

  app.put("/api/admin/integrations/openrouter", auth.requireAdmin, (req, res) => {
    const { api_key: apiKey, clear } = req.body || {};
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if ((clear !== undefined && typeof clear !== "boolean") || (clear === true && key)
        || (clear !== true && !/^[\x21-\x7e]{10,4096}$/.test(key)))
      return res.status(400).json({ success: false, error: "Informe uma chave válida ou escolha remover a chave." });
    try {
      integrationSecrets.save("openrouter", clear === true ? "" : key);
      report(req.user.id, "integrations.openrouter.saved", "info", "Configuração do OpenRouter atualizada.",
        { operation: clear === true ? "clear" : "replace" });
      res.set("Cache-Control", "no-store").json(status());
    } catch {
      report(req.user.id, "integrations.openrouter.save_failed", "error", "Falha ao salvar o OpenRouter.",
        { code: "CONFIG_SAVE_FAILED" }, "CONFIG_SAVE_FAILED");
      res.status(500).json({ success: false, error: "Não foi possível salvar a configuração do OpenRouter." });
    }
  });

  app.put("/api/admin/integrations/mercadopago", auth.requireAdmin, (req, res) => {
    const body = req.body || {};
    const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
    const webhookSecret = typeof body.webhook_secret === "string" ? body.webhook_secret.trim() : "";
    const publicBaseUrl = typeof body.public_base_url === "string" ? body.public_base_url.trim() : "";
    const clearAccess = body.clear_access_token === true;
    const clearWebhook = body.clear_webhook_secret === true;
    const clearBaseUrl = body.clear_public_base_url === true;
    if ((body.clear_access_token !== undefined && typeof body.clear_access_token !== "boolean")
        || (body.clear_webhook_secret !== undefined && typeof body.clear_webhook_secret !== "boolean")
        || (body.clear_public_base_url !== undefined && typeof body.clear_public_base_url !== "boolean")
        || (clearAccess && accessToken) || (clearWebhook && webhookSecret) || (clearBaseUrl && publicBaseUrl)
        || (accessToken && !/^[\x21-\x7e]{10,4096}$/.test(accessToken))
        || (webhookSecret && !/^[\x21-\x7e]{10,1024}$/.test(webhookSecret))
        || (publicBaseUrl && !checkoutConfig.normalizePublicBaseUrl(publicBaseUrl))
        || (!accessToken && !webhookSecret && !publicBaseUrl && !clearAccess && !clearWebhook && !clearBaseUrl))
      return res.status(400).json({ success: false, error: "Informe uma credencial válida ou marque qual deseja remover." });
    try {
      if (accessToken || clearAccess) integrationSecrets.save("mercadopago", clearAccess ? "" : accessToken);
      if (webhookSecret || clearWebhook) integrationSecrets.save("mercadopago_webhook", clearWebhook ? "" : webhookSecret);
      if (clearBaseUrl) checkoutConfig.clear();
      else if (publicBaseUrl) checkoutConfig.save(publicBaseUrl);
      report(req.user.id, "integrations.mercadopago.saved", "info", "Configuração do Mercado Pago atualizada.",
        { access_token_changed: Boolean(accessToken || clearAccess), webhook_secret_changed: Boolean(webhookSecret || clearWebhook),
          public_base_url_changed: Boolean(publicBaseUrl || clearBaseUrl) });
      res.set("Cache-Control", "no-store").json(status());
    } catch {
      report(req.user.id, "integrations.mercadopago.save_failed", "error", "Falha ao salvar o Mercado Pago.",
        { code: "CONFIG_SAVE_FAILED" }, "CONFIG_SAVE_FAILED");
      res.status(500).json({ success: false, error: "Não foi possível salvar a configuração do Mercado Pago." });
    }
  });

  app.post("/api/admin/integrations/:provider/test", auth.requireAdmin, async (req, res) => {
    const provider = String(req.params.provider || "");
    if (!PROVIDERS.has(provider)) return res.status(404).json({ success: false, error: "Integração desconhecida." });
    const draft = req.body?.api_key ?? req.body?.access_token;
    const key = typeof draft === "string" ? draft.trim()
      : provider === "elevenlabs" ? providerConfig.read().apiKey
        : integrationSecrets.read(provider === "mercadopago" ? "mercadopago" : "openrouter").secret;
    if (!key) return res.status(400).json({ success: false, error: "Configure a chave da API antes de testar." });
    if (!/^[\x21-\x7e]{10,4096}$/.test(key))
      return res.status(400).json({ success: false, error: "A chave informada tem formato inválido." });
    const testKey = `${req.user.id}:${provider}`;
    const now = Date.now();
    const previousTest = testState.get(testKey);
    if (previousTest?.inFlight || (previousTest && now - previousTest.startedAt < 3000))
      return res.status(429).json({ success: false, error: "Aguarde um instante antes de testar esta integração novamente." });
    testState.set(testKey, { startedAt: now, inFlight: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      if (provider === "elevenlabs") response = await fetch("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": key }, signal: controller.signal,
      });
      else if (provider === "openrouter") response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${key}` }, signal: controller.signal,
      });
      else response = await fetch("https://api.mercadolibre.com/users/me", {
        headers: { Authorization: `Bearer ${key}` }, signal: controller.signal,
      });
      const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 ? "INVALID_CREDENTIALS"
          : response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_TEST_FAILED";
        report(req.user.id, "integrations.test.failed", "warning", "Teste de integração recusado pelo provedor.",
          { provider, http_status: response.status, code }, code);
        return res.status(502).json({ success: false, error: code === "INVALID_CREDENTIALS"
          ? "O provedor recusou a credencial. Confira se ela está correta e ativa."
          : code === "PROVIDER_RATE_LIMITED" ? "O provedor limitou os testes. Tente novamente em instantes."
            : "O provedor não concluiu o teste. Tente novamente mais tarde." });
      }
      let account = "Conexão validada";
      if (provider === "elevenlabs") account = payload?.subscription?.tier || "Conta autenticada";
      if (provider === "openrouter") account = "Chave OpenRouter validada";
      if (provider === "mercadopago") account = payload?.nickname || "Conta autenticada";
      report(req.user.id, "integrations.test.succeeded", "info", "Teste de integração concluído.",
        { provider, http_status: response.status });
      res.set("Cache-Control", "no-store").json({ success: true, provider, account });
    } catch (error) {
      const code = error?.name === "AbortError" ? "PROVIDER_TEST_TIMEOUT" : "PROVIDER_UNAVAILABLE";
      report(req.user.id, "integrations.test.failed", "warning", "Não foi possível concluir o teste da integração.",
        { provider, code }, code);
      res.status(502).json({ success: false, error: code === "PROVIDER_TEST_TIMEOUT"
        ? "O teste excedeu o tempo limite. Tente novamente."
        : "Não foi possível alcançar o provedor neste momento." });
    } finally {
      clearTimeout(timer);
      const current = testState.get(testKey);
      if (current) current.inFlight = false;
    }
  });
};
