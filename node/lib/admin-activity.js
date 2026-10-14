// Telemetria de atividade do cliente para o Dashboard do Super Admin.
// Funcoes puras sobre o estado em memoria do tenant (node/lib/ws) — sem I/O,
// portanto testaveis isoladamente (node/tests/admin-activity.test.js).

// Endpoints POST que representam ACAO OPERACIONAL do cliente (conectar/
// desconectar a live ou iniciar/pausar/encerrar uma partida). Consultas (GET),
// configuracao e testes NAO entram: abrir/atualizar o dashboard nao gera atividade.
const ACTIVITY_TOUCH_PATHS = new Set([
  "/start-game", "/stop-game",
  "/api/new-game", "/api/end-game", "/api/game/manual-action", "/api/play-riddle",
  "/api/battle/start", "/api/battle/stop", "/api/battle/reset",
  "/api/caca/start", "/api/caca/stop", "/api/caca/reveal",
  "/api/tres/start", "/api/tres/stop", "/api/tres/pause", "/api/tres/resume", "/api/tres/reset",
  "/api/vpet/start", "/api/vpet/stop", "/api/vpet/battle/start",
  "/api/duelo/start", "/api/duelo/stop", "/api/duelo/reset-round", "/api/duelo/new-match",
  "/api/corda/start", "/api/corda/stop", "/api/corda/new-match",
]);

function isActivityTouchPath(path) {
  return ACTIVITY_TOUCH_PATHS.has(String(path || ""));
}

// Painel online = cliente autenticado na pagina do Painel (WS /logs).
// Overlays/OBS usam /browser e NAO contam. Conta apenas sockets abertos,
// suportando multiplas abas.
function openClientCount(clients) {
  let n = 0;
  if (Array.isArray(clients)) {
    for (const ws of clients) if (ws && ws.readyState === 1) n++;
  }
  return n;
}

// Estado real da conexao TikTok a partir do status do daemon + flag de sessao.
// Sem sessao iniciada => offline (nao herda status residual de uma sessao anterior).
function mapTiktokStatus(tenant) {
  if (!tenant || !tenant.sessionStarted) return "offline";
  const state = tenant.currentStatus && tenant.currentStatus.state;
  if (state === "connected") return "connected";
  if (state === "waiting") return "reconnecting";
  if (state === "disconnected") return "disconnected";
  if (state === "offline") return "offline";
  return "connecting";
}

// Jogo "primario" em execucao. Jogos simultaneos sao possiveis (ex.: Palavra
// Secreta + Batalha + Duelo). Reportamos UM: prioriza running > paused > finished
// e, em empate, a ordem de insercao (Palavra, 3 Dicas, Caca, Bichinho, Batalha,
// Duelo, Corda). Sem partida => { name: null, status: "idle" }.
function currentGame(tenant) {
  const games = [];
  const push = (name, status) => { if (status) games.push({ name, status }); };
  if (!tenant) return { name: null, status: "idle" };
  const gs = tenant.gameState || {};

  if (gs.active) push("Palavra Secreta", gs.finished ? "finished" : "running");

  const tres = tenant.tresState;
  if (tres && (tres.active || tres.finished)) {
    push("3 Dicas", tres.finished ? "finished" : (tres.paused ? "paused" : "running"));
  }

  const caca = tenant.cacaState;
  if (caca && (caca.active || caca.finished)) {
    push("Caça Palavras", caca.finished ? "finished" : "running");
  }

  const vpet = tenant.vpetState;
  if (vpet && vpet.active) push("Bichinho Virtual", "running");

  const battle = gs.battle;
  if (battle && battle.active) push("Batalha", "running");

  const duelo = tenant.dueloState;
  if (duelo && duelo.active) {
    push("Duelo 1x1", (duelo.final && duelo.winner) ? "finished" : "running");
  }

  const corda = tenant.cordaState;
  if (corda && corda.active) {
    push("Corda", corda.match_winner ? "finished" : "running");
  }

  if (!games.length) return { name: null, status: "idle" };
  const rank = { running: 0, paused: 1, finished: 2 };
  games.sort((a, b) => rank[a.status] - rank[b.status]);
  return games[0];
}

// Objeto `activity` do contrato do dashboard. Tenant ausente => dados neutros
// (nao inferimos uso por plano/permissao/conta ativa/username cadastrado).
function computeActivity(tenant) {
  if (!tenant) {
    return {
      panel_online: false,
      tiktok_status: "offline",
      game_name: null,
      game_status: "idle",
      last_activity_at: null,
    };
  }
  const game = currentGame(tenant);
  return {
    panel_online: openClientCount(tenant.logClients) > 0,
    tiktok_status: mapTiktokStatus(tenant),
    game_name: game.name,
    game_status: game.status,
    last_activity_at: tenant.lastActivityAt ? new Date(tenant.lastActivityAt).toISOString() : null,
  };
}

module.exports = {
  ACTIVITY_TOUCH_PATHS,
  isActivityTouchPath,
  openClientCount,
  mapTiktokStatus,
  currentGame,
  computeActivity,
};
