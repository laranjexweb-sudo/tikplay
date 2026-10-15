const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const publicDir = path.join(__dirname, "../public");
const pages = ["control-panel.html", "web-game.html", "duelo.html"];

test("inline scripts modified for logging compile", () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicDir, page), "utf8");
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1])
      .filter((source) => source.trim());
    assert.ok(scripts.length > 0, `${page} has an inline script`);
    scripts.forEach((source, index) => {
      assert.doesNotThrow(() => new vm.Script(source, { filename: `${page}#script-${index}` }));
    });
  }
});
