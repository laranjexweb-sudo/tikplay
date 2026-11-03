function finalizeActiveGameOnDisconnect(tenant) {
  const state = tenant && tenant.gameState;
  if (!state || !state.active || state.finished) return null;

  state.active = false;
  state.finished = true;
  state.winner = null;

  return {
    type: "game_over",
    game_id: state.game_id || null,
    winner: "Ninguém",
    secret_word: "",
    guesses: Array.isArray(state.guesses) ? state.guesses : [],
    reason: "session_disconnected",
  };
}

module.exports = { finalizeActiveGameOnDisconnect };
