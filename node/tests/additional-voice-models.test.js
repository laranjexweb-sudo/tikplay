const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

test("admin controla modelos de voz e streamers só selecionam opções habilitadas", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tikplay-voice-models-"));
  const previous = { DB_PATH: process.env.DB_PATH, ELEVENLABS_CONFIG_PATH: process.env.ELEVENLABS_CONFIG_PATH,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL };
  process.env.DB_PATH = path.join(dir, "test.db");
  process.env.ELEVENLABS_CONFIG_PATH = path.join(dir, "integrations", "elevenlabs.json");
  delete process.env.ELEVENLABS_API_KEY;
  process.env.OPENROUTER_API_KEY = "router-test-secret";
  process.env.PUBLIC_BASE_URL = "https://tikplay.test";
  const db = require("../db");
  db.db.exec(`CREATE TABLE additional_voice_models (
    model_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
    credits_per_100_chars INTEGER NOT NULL DEFAULT 0
  )`);
  db.db.prepare("INSERT INTO additional_voice_models(model_id,enabled,credits_per_100_chars) VALUES(?,?,?)")
    .run("google/gemini-3.8-flash-lite-tts", 1, 1);
  db.db.prepare("INSERT INTO additional_voice_models(model_id,enabled,credits_per_100_chars) VALUES(?,?,?)")
    .run("elevenlabs/eleven-v4-turbo", 1, 3);
  const auth = require("../auth");
  const app = express(); app.use(express.json());
  const commands = [];
  const logs = [];
  require("../routes/elevenlabs")(app, { db, auth, daemonSend: cmd => { commands.push(cmd); return true; },
    log: (_id, entry) => logs.push(entry) });
  let checkoutPayload = null;
  let payment = null;
  const mpFetch = async (route, options = {}) => {
    if (route === "/checkout/preferences") {
      checkoutPayload = JSON.parse(options.body);
      return { status: 201, data: { init_point: "https://mercadopago.test/checkout/123" } };
    }
    if (route.startsWith("/v1/payments/")) return { status: 200, data: payment };
    throw new Error(`Unexpected Mercado Pago request: ${route}`);
  };
  const creditRoutes = require("../routes/tts-credits")(app, { db, auth, mpFetch, mpConfigured: true,
    log: entry => logs.push(entry) });
  const admin = db.createUser({ email: "voice-admin@test.local", name: "Admin", password_hash: "x", role: "admin" });
  const streamer = db.createUser({ email: "voice-streamer@test.local", name: "Streamer", password_hash: "x" });
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = global.fetch;
  let modelFetches = 0;
  global.fetch = async (url, options) => {
    if (String(url).startsWith("https://openrouter.ai/api/v1/models?")) {
      modelFetches++;
      return { ok: true, json: async () => ({ data: [
        { id: "heygen/heygen-voice-1-turbo", supported_voices: ["nadine"] },
        { id: "hexgrad/kokoro-82m", supported_voices: ["pf_dora", "pm_santa", "pm_alex"] },
        { id: "google/gemini-3.8-flash-lite-tts", supported_voices: ["Zephyr"] },
      ] }) };
    }
    if (String(url).startsWith("https://api.elevenlabs.io/"))
      return { ok: true, json: async () => ({ voices: [{ voice_id: "voice_one", name: "Voz personalizada" }], has_more: false }) };
    return originalFetch(url, options);
  };
  const request = async (id, route, method = "GET", body) => {
    const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json",
      ...(id ? { Authorization: `Bearer ${auth.signToken({ id, role: id === admin ? "admin" : "user" })}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const adminRoute = "/api/admin/tts/additional-models";
    assert.equal((await request(streamer, adminRoute)).status, 403);
    let catalog = await request(admin, adminRoute);
    assert.equal(catalog.data.models.find(model => model.id === "elevenlabs/eleven-v4-turbo").enabled, true);
    assert.equal(catalog.data.models.find(model => model.id === "elevenlabs/eleven-v4-turbo").credits_per_150_chars, 5,
      "legacy tariff 3/100 is migrated to 5/150");
    assert.equal(catalog.data.models.find(model => model.id === "google/gemini-3.8-flash-lite-tts").credits_per_150_chars, 2,
      "legacy tariff 1/100 is migrated to 2/150");
    assert.equal((await request(admin, adminRoute, "PUT", { models: [{ id: "not-allowed", enabled: true }] })).status, 400);
    const openRouterModelIds = catalog.data.models.filter(model => model.provider === "openrouter" && model.catalog_available)
      .map(model => model.id);
    const approvedVoices = [
      { model_id: "hexgrad/kokoro-82m", voice_id: "pm_santa" },
      { model_id: "google/gemini-3.8-flash-lite-tts", voice_id: "Zephyr" },
    ];
    catalog = await request(admin, adminRoute, "PUT", { voices: approvedVoices, model_ids: openRouterModelIds });
    assert.equal(catalog.status, 200);
    assert.ok(logs.some(entry => entry.event === "tts.models.config_saved"));

    assert.equal((await request(admin, `/api/admin/users/${streamer}/elevenlabs`, "PUT",
      { enabled: true })).status, 200);
    assert.equal((await request(admin, "/api/admin/integrations/elevenlabs", "PUT",
      { api_key: "eleven-test-secret" })).status, 200);
    const elevenIntegration = await request(admin, "/api/admin/integrations/elevenlabs");
    assert.match(elevenIntegration.data.api_key_masked, /^ele•+cret$/);
    assert.equal(JSON.stringify(elevenIntegration.data).includes("eleven-test-secret"), false);

    const costSave = await request(admin, adminRoute, "PUT", { voices: approvedVoices, model_ids: openRouterModelIds,
      model_costs: openRouterModelIds.map(model_id => ({ model_id, credits_per_150_chars: model_id.includes("gemini") ? 2 : 3 })) });
    assert.equal(costSave.status, 200);
    assert.ok(logs.some(entry => entry.event === "tts.credits.model_cost_saved"));
    let credits = await request(streamer, "/api/tts/credits");
    assert.equal(credits.data.balance, 0);
    assert.equal(credits.data.model_costs.find(item => item.model_id.includes("gemini")).credits_per_150_chars, 2);

    const savedPackages = await request(admin, "/api/admin/tts/credit-packages", "PUT", { packages: [
      { name: "Pacote de teste", credits: 750, price_cents: 1250, enabled: true },
    ] });
    assert.equal(savedPackages.status, 200);
    const packageId = savedPackages.data.packages[0].id;
    assert.equal((await request(streamer, "/api/admin/tts/credit-balances")).status, 403);
    let creditBalances = await request(admin, "/api/admin/tts/credit-balances");
    assert.equal(creditBalances.status, 200);
    assert.deepEqual(creditBalances.data.accounts.map(account => [account.id, account.balance]), [[streamer, 0]]);
    const adjusted = await request(admin, `/api/admin/users/${streamer}/tts-credits`, "POST", { amount: 25 });
    assert.equal(adjusted.data.balance, 25);
    let creditReport = await request(admin, "/api/admin/tts/credit-report?range=all");
    assert.equal(creditReport.status, 200);
    assert.equal(creditReport.data.totals.manual_added_credits, 25);
    assert.equal(creditReport.data.totals.paid_purchase_count, 0, "pending payments are not reported as paid sales");
    assert.equal(creditReport.data.rows[0].source, "manual");
    assert.equal(creditReport.data.rows[0].actor_name, "Admin");
    assert.equal((await request(streamer, "/api/admin/tts/credit-report")).status, 403);
    assert.equal((await request(admin, "/api/admin/tts/credit-report?range=invalid")).status, 400);
    const overRemoval = await request(admin, `/api/admin/users/${streamer}/tts-credits`, "POST", { amount: -26 });
    assert.equal(overRemoval.status, 409, "manual removals cannot make a wallet negative");
    creditBalances = await request(admin, "/api/admin/tts/credit-balances");
    assert.equal(creditBalances.data.accounts[0].balance, 25);
    const checkout = await request(streamer, "/api/tts/credits/checkout", "POST", { package_id: packageId });
    assert.equal(checkout.data.checkout_url, "https://mercadopago.test/checkout/123");
    assert.match(checkoutPayload.external_reference, /^tts-credit:/);
    payment = { id: 987654, status: "approved", currency_id: "BRL", transaction_amount: 12.49,
      external_reference: checkoutPayload.external_reference };
    const mismatchedPayment = await creditRoutes.handlePaymentWebhook(payment.id);
    assert.equal(mismatchedPayment.success, false, "payment amount must match the package snapshot");
    assert.equal((await request(streamer, "/api/tts/credits")).data.balance, 25);
    payment.transaction_amount = 12.5;
    const purchase = await creditRoutes.handlePaymentWebhook(payment.id);
    assert.equal(purchase.success, true);
    assert.equal((await request(streamer, "/api/tts/credits")).data.balance, 775);
    creditReport = await request(admin, "/api/admin/tts/credit-report?range=all");
    assert.equal(creditReport.data.totals.paid_purchase_count, 1);
    assert.equal(creditReport.data.totals.paid_credits, 750);
    assert.equal(creditReport.data.totals.gross_paid_cents, 1250);
    assert.equal(creditReport.data.totals.manual_added_credits, 25);
    assert.ok(creditReport.data.rows.some(row => row.source === "paid" && row.package_name === "Pacote de teste"));
    await creditRoutes.handlePaymentWebhook(payment.id);
    assert.equal((await request(streamer, "/api/tts/credits")).data.balance, 775, "repeated payment webhooks are idempotent");
    assert.equal((await request(admin, `/api/admin/users/${streamer}/tts-credits`, "POST", { amount: -775 })).data.balance, 0);
    payment.status = "refunded";
    const refund = await creditRoutes.handlePaymentWebhook(payment.id);
    assert.equal(refund.refunded, true);
    creditReport = await request(admin, "/api/admin/tts/credit-report?range=all");
    assert.equal(creditReport.data.totals.refund_count, 1);
    assert.equal(creditReport.data.totals.refunded_cents, 1250);
    assert.equal(creditReport.data.totals.net_paid_cents, 0);
    assert.equal(creditReport.data.totals.manual_removed_credits, 775);
    assert.equal((await request(streamer, "/api/tts/credits")).data.balance, -750,
      "refund is recorded as a debt when the purchased credits were already spent");
    await creditRoutes.handlePaymentWebhook(payment.id);
    assert.equal((await request(streamer, "/api/tts/credits")).data.balance, -750, "refund webhook is idempotent");

    const listing = await request(streamer, "/api/tts/elevenlabs");
    assert.equal(listing.data.enabled, true);
    assert.deepEqual(listing.data.models.map(model => model.id), [
      "hexgrad/kokoro-82m", "google/gemini-3.8-flash-lite-tts",
    ]);
    assert.deepEqual(listing.data.models.find(model => model.id === "hexgrad/kokoro-82m").voices.map(voice => voice.key), ["pm_santa"]);
    assert.deepEqual(listing.data.models.find(model => model.id === "google/gemini-3.8-flash-lite-tts").voices.map(voice => voice.key), ["Zephyr"]);
    assert.ok(!JSON.stringify(listing.data).includes("router-test-secret"));
    assert.ok(!JSON.stringify(listing.data).includes("eleven-test-secret"));
    assert.equal((await request(streamer, "/api/tts/elevenlabs", "PUT",
      { model_id: "hexgrad/kokoro-82m", voice_id: "unknown" })).status, 400);
    const saved = await request(streamer, "/api/tts/elevenlabs", "PUT",
      { model_id: "hexgrad/kokoro-82m", voice_id: "pm_santa" });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.model_id, "hexgrad/kokoro-82m");
    assert.equal((await request(streamer, "/api/tts/elevenlabs/test", "POST")).status, 200);
    assert.equal(commands[0].cmd, "elevenlabs_test");
    assert.equal(modelFetches, 1, "OpenRouter voice catalog is cached");

    assert.equal((await request(admin, adminRoute, "PUT", { voices: [approvedVoices[1]], model_ids: openRouterModelIds })).status, 200);
    assert.equal((await request(streamer, "/api/tts/elevenlabs/test", "POST")).status, 400);
    assert.ok(logs.every(entry => !JSON.stringify(entry).includes("test-secret")));
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise(resolve => server.close(resolve));
    db.db.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
