const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFINITIONS = Object.freeze({
  openrouter: { env: "OPENROUTER_API_KEY", fallbackEnv: "OPENAI_API_KEY", file: "openrouter.json" },
  mercadopago: { env: "MP_ACCESS_TOKEN", file: "mercadopago.json" },
  mercadopago_webhook: { env: "MP_WEBHOOK_SECRET", file: "mercadopago-webhook.json" },
});

function configPath(id) {
  const definition = DEFINITIONS[id];
  if (!definition) throw new Error("UNKNOWN_INTEGRATION_SECRET");
  const directory = process.env.INTEGRATIONS_CONFIG_DIR || path.join(__dirname, "..", "data", "integrations");
  return path.join(directory, definition.file);
}

function read(id) {
  const definition = DEFINITIONS[id];
  if (!definition) throw new Error("UNKNOWN_INTEGRATION_SECRET");
  try {
    const data = JSON.parse(fs.readFileSync(configPath(id), "utf8"));
    if (typeof data.secret !== "string") return { secret: "", source: "unavailable" };
    return { secret: data.secret, source: "admin" };
  } catch (error) {
    if (error.code !== "ENOENT") return { secret: "", source: "unavailable" };
    const secret = process.env[definition.env] || (definition.fallbackEnv && process.env[definition.fallbackEnv]) || "";
    return { secret, source: secret ? "environment" : "none" };
  }
}

function save(id, secret) {
  if (typeof secret !== "string") throw new Error("INVALID_INTEGRATION_SECRET");
  const file = configPath(id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ secret }), { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

module.exports = { read, save };
