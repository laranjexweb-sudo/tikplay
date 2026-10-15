const { sanitizeText, sanitizeDetails } = require("./log-sanitize");

function processLog({ category = "system", level = "info", event, message, source = "node", code, details } = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    category,
    level,
    event: String(event || "process.message").slice(0, 96),
    source,
    message: sanitizeText(String(message || "").slice(0, 500)),
  };
  if (code) entry.code = String(code).slice(0, 64);
  if (details && typeof details === "object") {
    try { entry.details = JSON.parse(sanitizeDetails(details)); } catch { entry.details = { detail: "[oculto]" }; }
  }
  const line = JSON.stringify(entry);
  if (level === "error" || level === "critical") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

module.exports = { processLog };
