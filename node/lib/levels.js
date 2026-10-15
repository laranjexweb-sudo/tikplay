// Detecção de subida de nível (presenteador "gifter" / fã-clube "fanclub") por live.
//
// O daemon apenas observa/EMITE os níveis atuais do usuário; o Node é a fonte da
// verdade: guarda o baseline por (tenant, sala, usuário) e o nível global conhecido.
//
// Regras (decisões de produto):
//  - Entrada na live = sincronização SILENCIOSA (sem evento), mesmo que o usuário
//    já esteja num nível alto vindo de outra live.
//  - Conta-se apenas subida ocorrida DURANTE a live.
//  - Sem baseline confiável na live, o `before` é `null` (não inventamos).
//  - Dedupe por (live, usuário, eixo, nível alcançado) e por `event_id` quando houver
//    (robusto a eventos atrasados e reinício do processo).

const db = require("../db");

const AXES = new Set(["gifter", "fanclub"]);

function toLevel(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Retorna { events: [{ axis, before|null, after, user, nickname, avatar, room_id }] }.
function handleViewerLevel(tenant, payload) {
  const p = payload || {};
  const room_id = String(p.room_id || (tenant && tenant.currentRoomId) || "");
  const user_id = String(p.user_id || p.username || "");
  if (!tenant || !room_id || !user_id) return { events: [] };

  const ts = Number(p.ts) || Date.now();
  const username = String(p.username || user_id);
  const nickname = String(p.nickname || "");
  const avatar = String(p.avatar || "");
  const gifter = toLevel(p.gifter_level);
  const fan = toLevel(p.fan_club_level);
  const explicitAxis = AXES.has(p.level_up_axis) ? p.level_up_axis : null;
  if (!gifter && !fan) return { events: [] };

  const base = db.getLiveViewerLevel(tenant.id, room_id, user_id);
  const baseG = base ? toLevel(base.gifter_level) : 0;
  const baseF = base ? toLevel(base.fan_club_level) : 0;

  const candidates = [];
  // Diff: só quando já havia baseline confiável (>0) na própria live e o nível subiu.
  if (gifter && baseG > 0 && gifter > baseG) candidates.push({ axis: "gifter", before: baseG, after: gifter });
  if (fan && baseF > 0 && fan > baseF) candidates.push({ axis: "fanclub", before: baseF, after: fan });

  // Sinal explícito (barrage) é autoritativo durante a live. Sem baseline confiável
  // => before null. Só não repete o que o diff já capturou.
  if (explicitAxis && !candidates.some((c) => c.axis === explicitAxis)) {
    const after = explicitAxis === "gifter" ? gifter : fan;
    const baseV = explicitAxis === "gifter" ? baseG : baseF;
    if (after > 0 && after > baseV) {
      candidates.push({ axis: explicitAxis, before: baseV > 0 ? baseV : null, after });
    }
  }

  // Atualiza baseline da live + nível global conhecido (ausentes mantêm o valor).
  const newG = gifter || baseG;
  const newF = fan || baseF;
  db.upsertLiveViewerLevel({
    tenant_id: tenant.id, room_id, user_id, nickname, avatar,
    gifter_level: newG, fan_club_level: newF, ts,
  });
  db.upsertViewerLevel({
    tenant_id: tenant.id, user_id, nickname, avatar,
    gifter_level: newG, gifter_grade: p.gifter_grade,
    fan_club_level: newF, fan_club_name: p.fan_club_name, ts,
  });

  const events = [];
  for (const c of candidates) {
    const inserted = db.insertLevelUp({
      tenant_id: tenant.id, room_id, session_id: tenant.currentSessionId || null,
      user_id, username, nickname, avatar, axis: c.axis,
      level_before: c.before, level_after: c.after,
      event_id: p.event_id || "", ts,
    });
    if (inserted) {
      events.push({ axis: c.axis, before: c.before, after: c.after, user: username, nickname, avatar, room_id });
    }
  }
  return { events };
}

module.exports = { toLevel, handleViewerLevel };
