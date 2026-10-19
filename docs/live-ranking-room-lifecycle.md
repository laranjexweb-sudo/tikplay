# Ciclo de vida do ranking de curtidas por live

## Comportamento

- `room_id` identifica a sala à qual TikTokLive está conectado; não deve ser usado sozinho para decidir se uma conexão encerrou uma transmissão.
- `DisconnectEvent` representa a desconexão do websocket e não limpa o ranking. Ao reconectar à mesma sala, o ranking e o baseline de curtidas acumuladas continuam.
- `LiveEndEvent` confirma que a transmissão terminou. Se uma nova conexão chegar com o mesmo `room_id`, o daemon emite `live_session.start` com `new_live: true`; o Node limpa o ranking em memória e a lista de IDs deduplicados.
- Uma sala diferente também limpa o ranking pelo caminho existente. Partidas ativas não são encerradas por essa transição.
- A consulta/histórico dos relatórios permanece com a chave atual por `room_id`; esta alteração trata o ranking visual de curtidas e não migra agregados históricos.

## Mapa de observabilidade

| Transição | Evento | Categoria / nível | Código | Dados permitidos |
|---|---|---|---|---|
| Encerramento confirmado | `live.session.ended` | `connection` / `info` | `LIVE_SESSION_ENDED` | `room_id`, `engine` |
| Ranking iniciado/trocado | `live.session.started` | `connection` / `info` | `LIVE_SESSION_STARTED` | `room_id`, `previous_room_id`, booleano `same_room_restart`, `engine` |
| Queda transitória | `connection.status.changed` existente | `connection` / `info` | existente | origem/destino e engine; sem payload bruto |

Os eventos são emitidos apenas em transições, não por curtida. IDs de sala são metadados de correlação; não são incluídos comentários, credenciais ou objetos brutos do TikTok.

## Validação

- Teste Python: reconexão após `DisconnectEvent` mantém a sessão; reconexão após `LiveEndEvent` ao mesmo ID inicia outra; sala diferente inicia outra.
- Teste Node: ranking é preservado no mesmo ID sem sinal de fim e limpo com `new_live: true` ou troca de sala.
