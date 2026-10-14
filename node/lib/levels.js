// Detecção de subida de nível (presenteador / fã-clube) por live.
//
// O daemon apenas observa/EMITE os níveis atuais do usuário; o Node é a fonte da
// verdade: guarda o baseline por (tenant, sala, usuário) e o nível global conhecido.
//
// Regra (decisão de produto): na 1ª aparição do usuário na live apenas SINCRONIZA
// o nível (baseline + global), SEM evento/animacao — mesmo que ele tenha subido
// em outra live. A subida só gera evento/animacao quando acontece DURANTE a nossa
// live (observado > nível conhecido na própria sala, já com baseline > 0).

const db = require("../db");

function toLevel(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Retorna { events: [{ axis, before, after, user, nickname, avatar, room_id }] }.
function handleViewerLevel(tenant, payload) {
  const p = payload || {};
  const room_id = String(p.room_id || (tenant && tenant.currentRoomId) || "");
  const user_id = String(p.user_id || p.username || "");
  if (!tenant || !room_id || !user_id) return { events: [] };

  const ts = Number(p.ts) || Date.now();
  const nickname = String(p.nickname || "");
  const avatar = String(p.avatar || "");
  const gifter = toLevel(p.gifter_level);
  const fan = toLevel(p.fan_club_level);
  if (!gifter && !fan) return { events: [] };

  const base = db.getLiveViewerLevel(tenant.id, room_id, user_id);
  if (!base) {
    // Entrada na live: baseline silencioso + sincroniza o global (sem animação).
    db.upsertLiveViewerLevel({ tenant_id: tenant.id, room_id, user_id, nickname, avatar, gifter_level: gifter, fan_club_level: fan, ts });
    db.upsertViewerLevel({
      tenant_id: tenant.id, user_id, nickname, avatar,
      gifter_level: gifter, gifter_grade: p.gifter_grade,
      fan_club_level: fan, fan_club_name: p.fan_club_name, ts,
    });
    return { events: [] };
  }

  const events = [];
  // Ausente (0) => mantém; baseline desconhecido (0) => silent set; maior => evento.
  const consider = (axis, obs, baseV) => {
    if (!obs) return baseV;
    if (baseV === 0) return obs;
    if (obs > baseV) {
      events.push({
        axis, before: baseV, after: obs,
        user: String(p.username || user_id), nickname, avatar, room_id,
      });
    }
    return obs;
  };
  const newG = consider("gifter", gifter, toLevel(base.gifter_level));
  const newF = consider("fanclub", fan, toLevel(base.fan_club_level));

  db.upsertLiveViewerLevel({ tenant_id: tenant.id, room_id, user_id, nickname, avatar, gifter_level: newG, fan_club_level: newF, ts });
  db.upsertViewerLevel({
    tenant_id: tenant.id, user_id, nickname, avatar,
    gifter_level: newG, gifter_grade: p.gifter_grade,
    fan_club_level: newF, fan_club_name: p.fan_club_name, ts,
  });

  for (const e of events) {
    db.insertInteractionsBatch([{
      tenant_id: tenant.id, room_id, session_id: tenant.currentSessionId || null, ts,
      type: "level_up", user_id, username: String(p.username || user_id), nickname, avatar,
      value: e.after, meta: JSON.stringify({ axis: e.axis, before: e.before, after: e.after }), event_id: "",
    }]);
  }
  return { events };
}

module.exports = { toLevel, handleViewerLevel };
