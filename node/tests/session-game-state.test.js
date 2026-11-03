const assert = require("node:assert/strict");
const { finalizeActiveGameOnDisconnect } = require("../lib/session-game-state");

const guesses = [{ word: "mar", rank: 17, user: "viewer" }];
const tenant = { gameState: { active: true, finished: false, game_id: "g-1", guesses, winner: null } };
const event = finalizeActiveGameOnDisconnect(tenant);

assert.equal(tenant.gameState.active, false, "a rodada não pode permanecer ativa após a desconexão");
assert.equal(tenant.gameState.finished, true);
assert.equal(event.type, "game_over");
assert.equal(event.reason, "session_disconnected");
assert.equal(event.winner, "Ninguém");
assert.equal(event.secret_word, "", "o encerramento local não inventa nem revela a palavra secreta");
assert.equal(event.guesses, guesses, "preserva os palpites já recebidos");
assert.equal(finalizeActiveGameOnDisconnect(tenant), null, "evento repetido não finaliza duas vezes");

const completed = { gameState: { active: true, finished: true, game_id: "g-2" } };
assert.equal(finalizeActiveGameOnDisconnect(completed), null, "não altera partidas finalizadas normalmente");
assert.equal(completed.gameState.active, true);
assert.equal(finalizeActiveGameOnDisconnect({ gameState: { active: false, finished: false } }), null);

console.log("PASS session game state: desconexão encerra partida ativa uma vez e preserva partidas concluídas");
