const assert = require("node:assert/strict");
const { ensureRoomState, applyLikeDelta, ranking } = require("../lib/live-likes-state");

const tenant = { currentRoomId: null, gameState: { likes_ranking: [], likes_ranking_all: [] } };
assert.equal(ensureRoomState(tenant, "room-1"), true);
assert.equal(applyLikeDelta(tenant, { room_id: "room-1", event_id: "like-1", user: "ana", nickname: "Ana", like_count: 4 }), true);
assert.equal(applyLikeDelta(tenant, { room_id: "room-1", event_id: "like-1", user: "ana", like_count: 4 }), false, "eventos repetidos são ignorados");
assert.equal(applyLikeDelta(tenant, { room_id: "room-1", event_id: "like-2", user: "bia", nickname: "Bia", like_count: 7 }), true);
assert.equal(ranking(tenant, 5)[0].user, "bia");
assert.equal(ranking(tenant, 5)[1].likes, 4);

assert.equal(ensureRoomState(tenant, "room-1"), false, "reconectar na mesma room preserva o ranking");
assert.equal(ranking(tenant, 5).length, 2);
assert.equal(ensureRoomState(tenant, "room-2"), true, "uma room nova começa um ranking novo");
assert.deepEqual(ranking(tenant, 5), []);
assert.equal(applyLikeDelta(tenant, { room_id: "room-2", user: "ana", like_count: 2 }), true);
assert.equal(ranking(tenant, 5)[0].likes, 2);

// Uma queda do daemon não muda o room id: novo processo continua acumulando.
assert.equal(ensureRoomState(tenant, "room-2"), false);
assert.equal(applyLikeDelta(tenant, { room_id: "room-2", user: "ana", like_count: 3 }), true);
assert.equal(ranking(tenant, 5)[0].likes, 5);

console.log("live-likes-state: OK");
