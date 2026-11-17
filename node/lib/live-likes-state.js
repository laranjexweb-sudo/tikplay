// Estado do ranking de likes por room_id, mantido no Node para sobreviver a
// reinicializações do daemon Python durante a mesma live.
function ensureRoomState(tenant, roomId, forceReset = false) {
  const room = String(roomId || "").trim();
  if (!room) return false;
  if (tenant.currentRoomId === room && !forceReset) return false;
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

function restoreState(tenant, state) {
  if (!tenant || !state || !String(state.room_id || "").trim()) return false;
  const roomId = String(state.room_id).trim();
  const rankingEntries = Array.isArray(state.ranking) ? state.ranking : [];
  const eventIds = Array.isArray(state.event_ids) ? state.event_ids : [];
  tenant.currentRoomId = roomId;
  tenant.likesByUser = new Map();
  for (const entry of rankingEntries) {
    const user = String(entry && entry.user || "").trim();
    const likes = Math.max(0, Math.floor(Number(entry && entry.likes) || 0));
    if (!user || !likes) continue;
    tenant.likesByUser.set(user, {
      user,
      nickname: String(entry.nickname || user),
      avatar: String(entry.avatar || ""),
      likes,
    });
  }
  tenant.likeEventIds = new Set(eventIds.map(value => String(value || "")).filter(Boolean).slice(-2000));
  return true;
}

function serializeState(tenant) {
  ensureCollections(tenant);
  if (!tenant || !String(tenant.currentRoomId || "").trim()) return null;
  return {
    room_id: String(tenant.currentRoomId),
    ranking: [...tenant.likesByUser.values()],
    event_ids: [...tenant.likeEventIds],
  };
}

module.exports = { ensureRoomState, applyLikeDelta, ranking, restoreState, serializeState };
