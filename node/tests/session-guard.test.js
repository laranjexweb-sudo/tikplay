const assert = require("node:assert/strict");
const { shouldAcceptDaemonMessage } = require("../lib/session-guard");

const tenant = { id: 7, activeDaemonSessionId: "session-current" };

assert.equal(shouldAcceptDaemonMessage(tenant, { type: "status", session_id: "session-current" }), true);
assert.equal(shouldAcceptDaemonMessage(tenant, { type: "game", session_id: "session-current" }), true);
assert.equal(shouldAcceptDaemonMessage(tenant, { type: "interaction", session_id: "session-current" }), true);
assert.equal(shouldAcceptDaemonMessage(tenant, { type: "status", session_id: "session-old" }), false);
assert.equal(shouldAcceptDaemonMessage(tenant, { type: "game", session_id: "session-old" }), false);
assert.equal(shouldAcceptDaemonMessage(tenant, { type: "status" }), false);
assert.equal(shouldAcceptDaemonMessage({ id: 7, activeDaemonSessionId: null }, { type: "status", session_id: "session-old" }), false);
assert.equal(shouldAcceptDaemonMessage(tenant, { type: "log", text: "operational, sem sessão" }), true);
assert.equal(shouldAcceptDaemonMessage(tenant, { type: "log", session_id: "session-old" }), false);
assert.equal(shouldAcceptDaemonMessage(tenant, { type: "gifts_synced", text: {} }), true);

console.log("PASS session guard: atual aceita, antiga/sem id rejeita, mensagens globais preservadas");
