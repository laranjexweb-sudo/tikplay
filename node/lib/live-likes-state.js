// Estado do ranking de likes por room_id, mantido no Node para sobreviver a
// reinicializações do daemon Python durante a mesma live.
function ensureRoomState(tenant, roomId) {
  const room = String(roomId || "").trim();
  if (!room) return false;
  if (tenant.currentRoomId === room) return false;
  tenant.currentRoomId = room;
  tenant.likesByUser = new Map();
  tenant.likeEventIds = new Set();
  return true;
}

function ensureCollections(tenant) {
  if (!(tenant.likesByUser instanceof Map)) tenant.likesByUser = new Map();
  if (!(tenant.likeEventIds instanceof Set)) tenant.likeEventIds = new Set();
}

function applyLikeDelta(tenant, payload) {
  const p = payload || {};
  ensureCollections(tenant);
  if (p.room_id) ensureRoomState(tenant, p.room_id);
  const delta = Math.max(0, Math.floor(Number(p.like_count) || 0));
  const user = String(p.user || p.user_id || "").trim();
  if (!delta || !user) return false;
  const eventId = String(p.event_id || "").trim();
  if (eventId && tenant.likeEventIds.has(eventId)) return false;
  if (eventId) {
    tenant.likeEventIds.add(eventId);
    if (tenant.likeEventIds.size > 2000) tenant.likeEventIds.delete(tenant.likeEventIds.values().next().value);
  }
  const current = tenant.likesByUser.get(user) || { user, nickname: user, avatar: "", likes: 0 };
  current.likes += delta;
  if (p.nickname) current.nickname = String(p.nickname);
  if (p.avatar) current.avatar = String(p.avatar);
  tenant.likesByUser.set(user, current);
  return true;
}

function ranking(tenant, limit = 10) {
  ensureCollections(tenant);
  return [...tenant.likesByUser.values()]
    .sort((a, b) => b.likes - a.likes || a.user.localeCompare(b.user))
    .slice(0, Math.max(0, Number(limit) || 0));
}

module.exports = { ensureRoomState, applyLikeDelta, ranking };
