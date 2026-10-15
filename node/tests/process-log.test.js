const assert = require("node:assert/strict");
const test = require("node:test");
const { processLog } = require("../lib/process-log");

test("operator process logs are structured and redact sensitive details", () => {
  let captured = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = function (chunk) { captured += String(chunk); return true; };
  try {
    processLog({ category: "connection", level: "info", event: "connection.started",
      message: "Connected", details: { session_id: "safe", secret_word: "hidden" } });
  } finally {
    process.stdout.write = originalWrite;
  }
  const row = JSON.parse(captured.trim());
  assert.equal(row.category, "connection");
  assert.equal(row.level, "info");
  assert.equal(row.event, "connection.started");
  assert.equal(row.details.session_id, "safe");
  assert.equal(row.details.secret_word, "***");
});
