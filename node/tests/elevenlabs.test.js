const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

test("ElevenLabs tenant authorization, catalog, persistence and delivery", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tikplay-eleven-"));
  process.env.DB_PATH = path.join(dir, "test.db");
  process.env.ELEVENLABS_CONFIG_PATH = path.join(dir, "integrations", "elevenlabs.json");
  process.env.ELEVENLABS_API_KEY = "test-secret";
  const db = require("../db");
  const auth = require("../auth");
  const app = express();
  app.use(express.json());
  const commands = [];
  const logs = [];
  require("../routes/elevenlabs")(app, { db, auth,
    daemonSend: cmd => { commands.push(cmd); return true; },
    log: (id, entry) => {
      logs.push(entry);
      db.appendLogEntry(id, null, { ...entry, ts: Date.now(), details: JSON.stringify(entry.details), message: entry.message });
    },
  });
  const admin = db.createUser({ email: "admin@test.local", name: "Admin", password_hash: "x", role: "admin" });
  const first = db.createUser({ email: "one@test.local", name: "One", password_hash: "x" });
  const second = db.createUser({ email: "two@test.local", name: "Two", password_hash: "x" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = global.fetch;
  let upstreamCalls = 0;
  let expectedKey = "test-secret";
  global.fetch = async (url, opts) => {
    if (String(url).startsWith("https://api.elevenlabs.io/")) {
      upstreamCalls++;
      assert.equal(opts.headers["xi-api-key"], expectedKey);
      return { ok: true, json: async () => ({ voices: [{ voice_id: "voice_one", name: "Voz BR", secret: "never-return",
        is_owner: true, labels: { accent: "brazilian" } }], has_more: false }) };
    }
    return originalFetch(url, opts);
  };
  const request = async (id, route, method = "GET", body) => {
    const response = await fetch(base + route, { method, headers: {
      "Content-Type": "application/json",
      ...(id ? { Authorization: `Bearer ${auth.signToken({ id, role: id === admin ? "admin" : "user" })}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await request(null, "/api/tts/elevenlabs")).status, 401);
    assert.equal((await request(first, `/api/admin/users/${first}/elevenlabs`)).status, 403);
    assert.equal((await request(first, "/api/tts/elevenlabs")).data.enabled, false);
    assert.equal(upstreamCalls, 0);
    assert.equal((await request(first, "/api/tts/elevenlabs", "PUT", { voice_id: "voice_one" })).status, 403);
    assert.equal((await request(admin, `/api/admin/users/${first}/elevenlabs`, "PUT", { enabled: true, monthly_limit: -1 })).status, 400);
    assert.equal((await request(admin, `/api/admin/users/${first}/elevenlabs`, "PUT", { enabled: true })).status, 200);
    db.db.prepare("UPDATE additional_voice_models SET credits_per_150_chars=3 WHERE model_id=?")
      .run("elevenlabs/eleven-v4-turbo");
    db.db.prepare("INSERT INTO additional_voice_options(model_id,voice_id,label,enabled) VALUES(?,?,?,1)")
      .run("elevenlabs/eleven-v4-turbo", "voice_one", "Voz BR");
    const listing = await request(first, "/api/tts/elevenlabs");
    assert.deepEqual(listing.data.voices, [{ key: "voice_one", label: "Voz BR", language: "pt-BR" }]);
    assert.ok(!JSON.stringify(listing.data).includes("test-secret"));
    assert.equal((await request(first, "/api/tts/elevenlabs", "PUT", { voice_id: "forged" })).status, 400);
    assert.equal((await request(first, "/api/tts/elevenlabs", "PUT", { voice_id: "voice_one", tenant_id: second })).status, 200);
    assert.equal((await request(second, "/api/tts/elevenlabs")).data.enabled, false);
    assert.equal((await request(first, "/api/tts/elevenlabs")).data.voice_id, "voice_one");
    assert.equal(upstreamCalls, 1, "catalog cached across requests");
    assert.equal((await request(first, "/api/tts/elevenlabs/test", "POST")).status, 200);
    assert.equal(commands[0].tenant_id, first);
    assert.equal(commands[0].cmd, "elevenlabs_test");
    assert.equal((await request(first, "/api/tts/elevenlabs/test", "POST")).status, 429);
    assert.equal((await request(admin, `/api/admin/users/${first}/elevenlabs`, "PUT", { enabled: false })).status, 200);
    assert.equal((await request(first, "/api/tts/elevenlabs/test", "POST")).status, 403);
    assert.equal((await request(first, "/api/tts/elevenlabs")).data.enabled, false);
    assert.ok(db.getLogEntries({ tenantId: first, event: "tts.provider.access_changed" }).length > 0);
    assert.ok(!JSON.stringify(logs).includes("test-secret"));
    delete process.env.ELEVENLABS_API_KEY;
    await request(admin, `/api/admin/users/${first}/elevenlabs`, "PUT", { enabled: true });
    assert.equal((await request(first, "/api/tts/elevenlabs")).data.configured, false);
    assert.equal((await request(first, "/api/tts/elevenlabs/test", "POST")).status, 503);
    const configRoute = "/api/admin/integrations/elevenlabs";
    assert.equal((await request(null, configRoute)).status, 401);
    assert.equal((await request(first, configRoute)).status, 403);
    assert.equal((await request(first, configRoute, "PUT", { api_key: "another-secret" })).status, 403);
    assert.equal((await request(admin, configRoute, "PUT", { api_key: "" })).status, 400);
    assert.equal((await request(admin, configRoute, "PUT", { api_key: "bad\nsecret" })).status, 400);
    expectedKey = "another-secret";
    const saved = await request(admin, configRoute, "PUT", { api_key: expectedKey });
    assert.deepEqual(saved.data, { success: true, configured: true, source: "admin", api_key_masked: "ano•••••••cret" });
    assert.equal(require("../lib/elevenlabs-config").read().apiKey, expectedKey);
    assert.equal((await request(first, "/api/tts/elevenlabs")).data.configured, true);
    assert.equal(upstreamCalls, 2, "catalog reloads after changing the key");
    assert.ok(!JSON.stringify((await request(admin, configRoute)).data).includes(expectedKey));
    assert.equal((await request(admin, configRoute, "PUT", { api_key: "" })).status, 400);
    assert.equal(require("../lib/elevenlabs-config").read().apiKey, expectedKey);
    process.env.ELEVENLABS_API_KEY = "environment-secret";
    assert.equal((await request(admin, configRoute, "PUT", { clear: true })).data.configured, false);
    assert.equal((await request(first, "/api/tts/elevenlabs")).data.configured, false);
    assert.equal((await request(first, "/api/tts/elevenlabs/test", "POST")).status, 503);
    assert.ok(!JSON.stringify(logs).includes("another-secret"));
    assert.ok(db.getLogEntries({ tenantId: admin, event: "tts.provider.config_saved" }).length > 0);
  } finally {
    global.fetch = originalFetch;
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_CONFIG_PATH;
    await new Promise(resolve => server.close(resolve));
    db.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
