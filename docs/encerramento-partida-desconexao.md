# Encerramento da Palavra Secreta ao desconectar

## Fluxo e observabilidade

- Ao receber `offline` ou `disconnected`, se houver uma partida da Palavra Secreta ainda ativa, o Node marca a partida como finalizada e transmite `game_over` com `reason: session_disconnected`, preservando os palpites recebidos e sem preencher ou revelar a palavra secreta.
- O evento é emitido uma única vez por partida. Partidas já finalizadas não são alteradas.
- No encerramento manual, o estado final é publicado antes de invalidar o `session_id`. Depois disso, o guard continua rejeitando mensagens daquela geração. Uma nova sessão só aceita mensagens com seu próprio identificador.
- O mesmo fechamento local é aplicado quando o processo do daemon cai. Um evento estruturado `game.session.finalized_on_disconnect` registra somente `game_id` e quantidade de palpites; não registra conteúdo secreto nem dados pessoais.

## Curtidas: atividade e elegibilidade

- `likes_activity` e a interação agregada de atividade são emitidas antes dos filtros de acesso e incluem curtidas de todos os espectadores.
- `likes_ranking_delta`, o ranking de curtidas, o acumulador `self.likes` e o progresso da meta de TAP incluem curtidas de todos, mesmo com `apenas_seguidores` ativado.
- O filtro de seguidores/Heart Me continua valendo para efeitos de jogo como Batalha, Corda e Duelo. A política de ranking/meta não altera esses acessos.
- O processamento por curtida não cria novos logs; preserva agregação e controle de volume existentes.

## Testes

- `node node/tests/session-game-state.test.js` cobre encerramento único, preservação de palpites, ausência de palavra secreta e não alteração de partidas concluídas.
- `node node/tests/session-guard.test.js` continua cobrindo rejeição de mensagens de sessões antigas.
- `python -m unittest tests.test_corda_service` confirma que uma curtida de não seguidor atualiza ranking/meta, enquanto efeitos de jogo seguem bloqueados.
