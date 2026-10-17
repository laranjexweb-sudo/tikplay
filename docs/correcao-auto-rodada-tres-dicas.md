# Correção do auto-início do 3 Dicas após desconexão

**Data:** 17/10/2026
**Status:** correção implementada no working tree; o daemon em execução ainda precisa carregar a versão atualizada.

## Diagnóstico

O timer de 3 Dicas pertence a `GameSession.tres.task`. A limpeza da sessão tentava cancelar `GameSession._tres_task`, que não era associado ao timer, e não chamava `tres.stop()`. Além disso, ao fim de uma rodada o motor criava uma tarefa independente de auto-início. Essa tarefa podia sortear uma palavra e chamar `generate_tres_dicas` sem confirmar que a live continuava conectada.

Esse fluxo é compatível com chamadas ao OpenRouter depois da desconexão. O registro do provedor identifica função, modelo e aplicação, mas sem metadados de tenant não prova qual conta originou cada chamada.

## Comportamento corrigido

- A sessão fornece ao motor 3 Dicas uma verificação do estado conectado do handler.
- O auto-início não chama o provider quando a live está desconectada e revalida a sessão depois da preparação, antes de abrir a rodada.
- A tarefa de auto-início fica retida pelo motor, evitando tarefas duplicadas; `stop()` cancela tanto o relógio quanto a preparação automática.
- `disconnected`/`offline` param o 3 Dicas. A finalização da sessão captura e drena suas tarefas reais antes de sair.
- Uma requisição ao provedor que já começou pode ainda concluir/billing mesmo se a rede desconectar durante a chamada; a proteção impede novas requisições e impede que a rodada seja iniciada com resultado obsoleto.

## Mapa de observabilidade

| Transição | Evento existente | Categoria / nível | Dados permitidos |
| --- | --- | --- | --- |
| Live desconecta e uma rodada está ativa | `tres.game.stopped` + `connection.status.changed` | `game`/`info` + `connection`/`info` | `session_id`, `game_id`, trace, estado anterior/novo; sem palavra ou dica |
| Auto-início encontra live inativa antes do provider | `tres.round.auto_start_rejected` | `notice`/`warning` | `code=TRES_SESSION_INACTIVE`, rodada, trace; sem texto gerado |
| Live cai durante preparação e rodada é descartada | `tres.round.auto_start_rejected` | `notice`/`warning` | `code=TRES_SESSION_INACTIVE`, rodada, trace; sem texto gerado |
| Sessão termina com tarefas pendentes | `connection.session.tasks_pending` / `connection.session.tasks_unconfirmed` já existentes | `diagnostic`/`warning` e `notice`/`warning` | quantidade de tarefas e trace; sem payload de dicas |

Não foi introduzido log por tentativa repetida nem texto de resposta da IA. As tarefas canceladas são limitadas às pertencentes ao 3 Dicas; o restante da telemetria existente da sessão foi preservado.

## Validação

Executado: `python -m unittest python.tests.test_tres_logging python.tests.test_session_lifecycle` — 10 testes aprovados. Os novos testes verificam rejeição sem chamada ao provider quando desconectado, descarte quando a conexão muda durante a preparação e cancelamento do timer ao receber desconexão.

Pendente: carregar o Python atualizado no processo do servidor e conferir evento de parada no armazenamento/interface. O listener Node está ativo em `localhost:3100`; reinício pode interromper uma live e exige uma janela segura.
