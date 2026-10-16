const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function configPath() {
  return process.env.ELEVENLABS_CONFIG_PATH || path.join(__dirname, "..", "data", "integrations", "elevenlabs.json");
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    if (typeof data.api_key !== "string") return { apiKey: "", source: "unavailable" };
    return { apiKey: data.api_key, source: "admin" };
  } catch (error) {
    if (error.code !== "ENOENT") return { apiKey: "", source: "unavailable" };
    return { apiKey: process.env.ELEVENLABS_API_KEY || "", source: process.env.ELEVENLABS_API_KEY ? "environment" : "none" };
  }
}

function save(apiKey) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ api_key: apiKey }), { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

module.exports = { read, save };
