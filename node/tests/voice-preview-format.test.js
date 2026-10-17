const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

test("PT-BR catalog keeps verified Brazilian voices, account clones, and drops unverified model voices", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tikplay-voice-catalog-"));
  const envKeys = ["DB_PATH", "ELEVENLABS_CONFIG_PATH", "ELEVENLABS_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY"];
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  process.env.DB_PATH = path.join(dir, "test.db");
  process.env.ELEVENLABS_CONFIG_PATH = path.join(dir, "integrations", "elevenlabs.json");
  process.env.ELEVENLABS_API_KEY = "eleven-test-key";
  process.env.OPENROUTER_API_KEY = "openrouter-test-key";
  delete process.env.OPENAI_API_KEY;

  const db = require("../db");
  const auth = require("../auth");
  const app = express();
  app.use(express.json());
  const logs = [];
  require("../routes/elevenlabs")(app, { db, auth, daemonSend: () => true, log: (_id, entry) => logs.push(entry) });
  const adminIds = ["catalog", "heygen", "kokoro", "eleven"].map(name => db.createUser({
    email: `${name}@voice-catalog.test`, name, password_hash: "unused", role: "admin",
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = global.fetch;
  const speechRequests = [];
  let elevenCatalogQuery = "";
  global.fetch = async (url, options = {}) => {
    if (String(url).startsWith("https://openrouter.ai/api/v1/models?")) {
      return new Response(JSON.stringify({ data: [
        { id: "heygen/heygen-voice-1-turbo", supported_voices: ["nadine", "tabitha"] },
        { id: "hexgrad/kokoro-82m", supported_voices: ["pf_dora", "pm_santa", "bf_alice"] },
        { id: "google/gemini-3.8-flash-lite-tts", supported_voices: ["Zephyr", "Puck", "Kore"] },
      ] }), { headers: { "Content-Type": "application/json" } });
    }
    if (String(url).startsWith("https://api.elevenlabs.io/v2/voices?")) {
      elevenCatalogQuery = String(url);
      return new Response(JSON.stringify({ has_more: false, voices: [
        { voice_id: "inez-clone", name: "Inêz", is_owner: true, category: "cloned", labels: { accent: "pt-brazilian" } },
        { voice_id: "custom-no-label", name: "Voz própria", is_owner: true, category: "cloned", labels: {} },
        { voice_id: "brazil-library", name: "Voz brasileira", is_owner: false, category: "professional",
          verified_languages: [{ language: "pt", accent: "brazilian", locale: "pt-BR" }] },
        { voice_id: "portugal-library", name: "Voz portuguesa", is_owner: false, category: "professional",
          verified_languages: [{ language: "pt", accent: "portuguese", locale: "pt-PT" }] },
      ] }), { headers: { "Content-Type": "application/json" } });
    }
    if (String(url) === "https://openrouter.ai/api/v1/audio/speech") {
      const request = JSON.parse(options.body);
      speechRequests.push({ provider: "openrouter", request });
      if (request.response_format === "pcm")
        return new Response(Buffer.from([1, 2, 3, 4]), { headers: { "Content-Type": "audio/pcm" } });
      return new Response(Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    }
    if (String(url).startsWith("https://api.elevenlabs.io/v1/text-to-speech/")) {
      speechRequests.push({ provider: "elevenlabs", request: JSON.parse(options.body) });
      return new Response(Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    }
    return originalFetch(url, options);
  };
  t.after(async () => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise(resolve => server.close(resolve));
    db.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const request = async (adminId, route, method = "GET", body) => {
    const response = await originalFetch(`${base}${route}`, {
      method,
      headers: { Authorization: `Bearer ${auth.signToken({ id: adminId, role: "admin" })}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { response, data: response.headers.get("content-type")?.startsWith("application/json") ? await response.json() : null,
      audio: response.headers.get("content-type")?.startsWith("audio/") ? Buffer.from(await response.arrayBuffer()) : null };
  };

  const catalog = await request(adminIds[0], "/api/admin/tts/additional-models");
  assert.equal(catalog.response.status, 200);
  assert.ok(!new URL(elevenCatalogQuery).searchParams.has("accent"), "upstream accent filter must not hide pt-brazilian account voices");
  const eleven = catalog.data.models.find(model => model.id === "elevenlabs/eleven-v4-turbo");
  assert.deepEqual(eleven.voices.map(voice => voice.key), ["inez-clone", "custom-no-label", "brazil-library"]);
  assert.equal(eleven.voices.find(voice => voice.key === "inez-clone").language, "pt-BR");
  assert.match(eleven.voices.find(voice => voice.key === "custom-no-label").language, /não identificado/i);
  const heygen = catalog.data.models.find(model => model.id === "heygen/heygen-voice-1-turbo");
  assert.equal(heygen.voices.length, 0, "unverified HeyGen voices must not enter the PT-BR catalog");
  assert.match(heygen.pt_br_note, /sotaque brasileiro/i);
  const kokoro = catalog.data.models.find(model => model.id === "hexgrad/kokoro-82m");
  assert.deepEqual(kokoro.voices.map(voice => voice.key), ["pm_santa"]);
  const gemini = catalog.data.models.find(model => model.id === "google/gemini-3.8-flash-lite-tts");
  assert.deepEqual(gemini.voices.map(voice => voice.key), ["Zephyr", "Puck", "Kore"]);
  assert.equal(gemini.voices[0].language, "Multilíngue · teste PT-BR",
    "Gemini voice IDs do not identify a Brazilian accent and require manual preview");
  assert.match(gemini.admin_note, /teste cada prévia em português brasileiro/i);

  const rejectedHeygen = await request(adminIds[1], "/api/admin/tts/voice-preview", "POST", {
    model_id: "heygen/heygen-voice-1-turbo", voice_id: "nadine",
  });
  assert.equal(rejectedHeygen.response.status, 400);
  assert.equal(speechRequests.length, 0, "unsupported voice is rejected before a paid provider request");

  const kokoroPreview = await request(adminIds[2], "/api/admin/tts/voice-preview", "POST", {
    model_id: "hexgrad/kokoro-82m", voice_id: "pm_santa",
  });
  assert.equal(kokoroPreview.response.status, 200);
  assert.equal(speechRequests[0].request.voice, "pm_santa");

  const ownVoicePreview = await request(adminIds[3], "/api/admin/tts/voice-preview", "POST", {
    model_id: "elevenlabs/eleven-v4-turbo", voice_id: "inez-clone",
  });
  assert.equal(ownVoicePreview.response.status, 200);
  assert.equal(speechRequests[1].provider, "elevenlabs");
  assert.equal(speechRequests[1].request.language_code, "pt");
  const geminiPreview = await request(adminIds[0], "/api/admin/tts/voice-preview", "POST", {
    model_id: "google/gemini-3.8-flash-lite-tts", voice_id: "Zephyr",
  });
  assert.equal(geminiPreview.response.status, 200);
  assert.equal(speechRequests[2].provider, "openrouter");
  assert.deepEqual(speechRequests[2].request, {
    model: "google/gemini-3.8-flash-lite-tts",
    input: "Olá! Aqui no Brasil, o número do TikPlay é vinte e três. Esta é uma prévia em português brasileiro.",
    voice: "Zephyr", response_format: "pcm",
  });
  assert.equal(geminiPreview.response.headers.get("content-type"), "audio/wav");
  assert.equal(geminiPreview.audio.subarray(0, 4).toString(), "RIFF");
  assert.ok(logs.some(entry => entry.event === "tts.admin_voice_preview.completed"));
  assert.ok(logs.every(entry => !JSON.stringify(entry).includes("test-key")));
});
