const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function configPath() {
  return process.env.CHECKOUT_CONFIG_PATH || path.join(__dirname, "..", "data", "integrations", "checkout.json");
}

function normalizePublicBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.host || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const publicBaseUrl = normalizePublicBaseUrl(data.public_base_url);
    return publicBaseUrl ? { publicBaseUrl, source: "admin" } : { publicBaseUrl: "", source: "unavailable" };
  } catch (error) {
    if (error.code !== "ENOENT") return { publicBaseUrl: "", source: "unavailable" };
    const envUrl = normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL || "");
    return envUrl ? { publicBaseUrl: envUrl, source: "environment" }
      : { publicBaseUrl: "https://painel.tikplay.com.br", source: "default" };
  }
}

function save(publicBaseUrl) {
  const normalized = normalizePublicBaseUrl(publicBaseUrl);
  if (!normalized) throw new Error("INVALID_PUBLIC_BASE_URL");
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ public_base_url: normalized }), { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function clear() {
  try { fs.unlinkSync(configPath()); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

module.exports = { read, save, clear, normalizePublicBaseUrl };
