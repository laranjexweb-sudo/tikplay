const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tikplay-admin-integrations-"));
process.env.INTEGRATIONS_CONFIG_DIR = dir;
process.env.CHECKOUT_CONFIG_PATH = path.join(dir, "checkout.json");
for (const name of ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET"]) delete process.env[name];
const secrets = require("../lib/integration-secrets");
const checkoutConfig = require("../lib/checkout-config");
const routes = new Map();
const logs = [];
const app = { get: (route, ...handlers) => routes.set(`GET ${route}`, handlers.at(-1)),
  put: (route, ...handlers) => routes.set(`PUT ${route}`, handlers.at(-1)),
  post: (route, ...handlers) => routes.set(`POST ${route}`, handlers.at(-1)) };
const auth = { requireAdmin: (_req, _res, next) => next() };
const providerConfig = { read: () => ({ apiKey: "", source: "none" }) };
let daemonKey = "";
require("../routes/admin-integrations")(app, { auth, integrationSecrets: secrets, providerConfig, checkoutConfig,
  mpFetch: async () => ({ status: 200, data: {} }), getDaemonOpenRouterKey: () => daemonKey,
  log: entry => logs.push(entry) });

function response() {
  return { statusCode: 200, headers: {}, status(value) { this.statusCode = value; return this; },
    set(name, value) { this.headers[name] = value; return this; }, json(value) { this.body = value; return this; } };
}
async function call(method, route, body = {}, params = {}) {
  const res = response();
  await routes.get(`${method} ${route}`)({ user: { id: 7 }, body, params }, res);
  return res;
}

(async () => {
  const originalFetch = global.fetch;
  try {
    let fetchOptions;
    global.fetch = async (_url, options) => {
      fetchOptions = options;
      return { ok: true, status: 200, headers: { get: () => "application/json" },
        json: async () => ({ data: { label: "sk-or-…", limit_remaining: 12 } }) };
    };
    let result = await call("PUT", "/api/admin/integrations/openrouter", { api_key: "openrouter-test-secret" });
    assert.equal(result.body.integrations.openrouter.configured, true);
    assert.equal(result.body.integrations.openrouter.daemon_restart_required, true);
    assert.equal(result.body.integrations.openrouter.api_key_masked.startsWith("ope"), true);
    assert.equal(result.body.integrations.openrouter.api_key_masked.endsWith("cret"), true);
    assert.equal(result.body.integrations.openrouter.api_key_masked.includes("openrouter-test-secret"), false);
    result = await call("GET", "/api/admin/integrations");
    assert.equal(JSON.stringify(result.body).includes("openrouter-test-secret"), false);
    assert.match(result.body.integrations.openrouter.api_key_masked, /^ope•+cret$/);
    result = await call("POST", "/api/admin/integrations/:provider/test", { api_key: "openrouter-draft-secret" }, { provider: "openrouter" });
    assert.equal(result.body.success, true);
    assert.equal(fetchOptions.headers.Authorization, "Bearer openrouter-draft-secret");
    assert.equal(JSON.stringify(result.body).includes("openrouter-draft-secret"), false);

    result = await call("PUT", "/api/admin/integrations/mercadopago", {
      access_token: "mercadopago-test-secret", webhook_secret: "webhook-test-secret",
      public_base_url: "https://checkout.tikplay.test/path" });
    assert.equal(result.body.integrations.mercadopago.configured, true);
    assert.equal(result.body.integrations.mercadopago.webhook_secret_configured, true);
    assert.equal(result.body.integrations.mercadopago.public_base_url, "https://checkout.tikplay.test");
    assert.match(result.body.integrations.mercadopago.access_token_masked, /^mer•+cret$/);
    assert.match(result.body.integrations.mercadopago.webhook_secret_masked, /^web•+cret$/);
    assert.equal(JSON.stringify(result.body).includes("mercadopago-test-secret"), false);

    global.fetch = async () => ({ ok: false, status: 401, headers: { get: () => "application/json" }, json: async () => ({}) });
    result = await call("POST", "/api/admin/integrations/:provider/test", { access_token: "mercadopago-draft-secret" }, { provider: "mercadopago" });
    assert.equal(result.statusCode, 502);
    assert.match(result.body.error, /recusou a credencial/);
    assert.equal(logs.some(entry => JSON.stringify(entry).includes("mercadopago-draft-secret")), false);

    result = await call("PUT", "/api/admin/integrations/openrouter", { api_key: "x" });
    assert.equal(result.statusCode, 400);
    result = await call("PUT", "/api/admin/integrations/mercadopago", { public_base_url: "http://insecure.tikplay.test" });
    assert.equal(result.statusCode, 400);
    result = await call("POST", "/api/admin/integrations/:provider/test", {}, { provider: "unknown" });
    assert.equal(result.statusCode, 404);
    console.log("admin-integrations.test.js passou (4 cenários).");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
