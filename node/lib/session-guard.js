// Protege o estado de cada tenant contra mensagens atrasadas de uma sessão
// TikTok anterior (ex.: `waiting` de um username que já foi substituído).

const SESSION_BOUND_TYPES = new Set([
  "status", "game", "interaction", "live_session", "viewer_level",
  "panel_word", "narrate",
]);

function shouldAcceptDaemonMessage(tenant, msg) {
  if (!tenant || !msg) return false;
  const active = String(tenant.activeDaemonSessionId || "");
  const incoming = String(msg.session_id || "");

  // Estado/eventos de live exigem a geração atual; mensagens antigas e mensagens
  // sem identidade não podem alterar o estado da sessão atual.
  if (SESSION_BOUND_TYPES.has(msg.type)) return !!active && !!incoming && incoming === active;

  // Logs assíncronos da sessão antiga também são descartados; logs globais e
  // mensagens de comandos fora da sessão (ex.: gifts_synced) continuam aceitos.
  if (incoming) return !!active && incoming === active;
  return true;
}

module.exports = { SESSION_BOUND_TYPES, shouldAcceptDaemonMessage };
