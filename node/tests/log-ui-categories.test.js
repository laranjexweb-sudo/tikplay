const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "../public/control-panel.html"), "utf8");
const start = html.indexOf("function classifyLog(");
const end = html.indexOf("\nfunction setLogCategories", start);
assert.notEqual(start, -1, "classifyLog must exist");
assert.notEqual(end, -1, "category function boundary must exist");

const sandbox = {
  LOG_GAMES: ["palavra", "batalha", "caca", "bichinho", "tres", "duelo", "corda"],
  normLogGame(value) {
    const game = String(value || "").toLowerCase();
    return game === "vpet" ? "bichinho" : (game || "system");
  },
};
vm.createContext(sandbox);
new vm.Script(`${html.slice(start, end)}\nthis.classifyLog = classifyLog;`).runInContext(sandbox);

test("panel uses canonical backend categories and legacy game prefixes", () => {
  assert.equal(sandbox.classifyLog("[3 Dicas] Rodada iniciada", "tres", "info"), "game");
  assert.equal(sandbox.classifyLog("[3 Dicas] Rodada iniciada", "tres", "warning", "game"), "game");
  assert.equal(sandbox.classifyLog("[debug][Palavra] start", "palavra", "debug", "diagnostic"), "diagnostic");
  assert.equal(sandbox.classifyLog("[Painel] falha de configuração", "", "warning"), "notice");
  assert.equal(sandbox.classifyLog("[Mensagem antiga] sem origem", "", "info"), "system");
});
