# Ciclo de vida do ranking de curtidas por live

## Comportamento

- `room_id` identifica a sala à qual TikTokLive está conectado; não deve ser usado sozinho para decidir se uma conexão encerrou uma transmissão.
- `DisconnectEvent` representa a desconexão do websocket e não limpa o ranking. Ao reconectar à mesma sala, o ranking e o baseline de curtidas acumuladas continuam.
- `LiveEndEvent` confirma que a transmissão terminou. Se uma nova conexão chegar com o mesmo `room_id`, o daemon emite `live_session.start` com `new_live: true`; o Node limpa o ranking em memória e a lista de IDs deduplicados.
- Uma sala diferente também limpa o ranking pelo caminho existente. Partidas ativas não são encerradas por essa transição.
- A detecção da troca de sala usa o campo próprio `tenant.likesRoomId`, mantido por `lib/live-likes-state.js` (`ensureRoomState`/`restoreState`). `tenant.currentRoomId` continua sendo atualizado pelo servidor para status, relatórios e recuperação de partida; não serve mais como chave do ranking, porque handlers de `status` e `live_session` o sobrescreviam antes da comparação e anulavam o reset.
- Restaurar o snapshot no boot (`lib/ws.js`) não dispara reset: se o `room_id` salvo é o da live atual, o ranking é preservado e as curtidas novas somam sobre ele. O reset só aparece em troca de sala ou em novo `live_session` com `new_live: true`.
- A consulta/histórico dos relatórios permanece com a chave atual por `room_id`; esta alteração trata o ranking visual de curtidas e não migra agregados históricos.

## Mapa de observabilidade

| Transição | Evento | Categoria / nível | Código | Dados permitidos |
|---|---|---|---|---|
| Encerramento confirmado | `live.session.ended` | `connection` / `info` | `LIVE_SESSION_ENDED` | `room_id`, `engine` |
| Ranking iniciado/trocado | `live.session.started` | `connection` / `info` | `LIVE_SESSION_STARTED` | `room_id`, `previous_room_id`, booleano `same_room_restart`, `engine` |
| Ranking limpo no Node | `likes.ranking.reset` | `game` / `info` | `LIVE_LIKES_RANKING_RESET` | `room_id`, `previous_room_id`, `cause` (`new_room`/`same_room_restart`/`restore_mismatch`), `entries_before`, `entries_after` |
| Queda transitória | `connection.status.changed` existente | `connection` / `info` | existente | origem/destino e engine; sem payload bruto |

Os eventos são emitidos apenas em transições, não por curtida. IDs de sala são metadados de correlação; não são incluídos comentários, credenciais ou objetos brutos do TikTok. `likes.ranking.reset` carrega somente contagens e identificadores de sala — nunca nomes de usuário.

## Reconstrução do snapshot

Quando o ranking já estiver contaminado (soma de lives anteriores), o snapshot pode ser reconstruído a partir de `interactions` da sala atual, agrupando por `username` (mesma chave de `likes_ranking_delta`) e conferindo o total com `interaction_aggregates` (`type='like'`, `SUM(value_sum)`). O processo precisa estar parado: o encerramento gracioso grava o snapshot em memória no banco. Use `/root/tikplay-maintenance/rebuild-likes-ranking.py` (sem `--apply` é dry-run somente leitura).


## Validação

- Teste Python: reconexão após `DisconnectEvent` mantém a sessão; reconexão após `LiveEndEvent` ao mesmo ID inicia outra; sala diferente inicia outra.
- Teste Node: ranking é preservado no mesmo ID sem sinal de fim e limpo com `new_live: true` ou troca de sala — inclusive quando a mensagem `status` com o novo `room_id` chega antes de `live_session.start` (regressão corrigida em 21/11/2026).
