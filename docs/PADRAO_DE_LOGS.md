# Padrão oficial de logs e diagnóstico — TikPlay

**Status:** norma obrigatória para toda implementação nova ou alterada que gere eventos, ações operacionais ou falhas.

**Responsáveis:** agentes de front-end e back-end, conforme o escopo de cada tarefa.

**Documento complementar:** `docs/logs-persistencia-backend-recomendacoes.md` mantém o inventário técnico e as dependências de replay/persistência.

Este documento distingue o contrato desejado do que já está ativo. Uma implementação no working tree não é considerada observabilidade disponível até que o evento apareça no processo em execução e passe pelos critérios de validação.

## 1. Regra de trabalho obrigatória

Antes de implementar uma funcionalidade, adicionar ao plano da tarefa um **mapa de observabilidade** com:

1. Ações e transições importantes do fluxo.
2. Eventos de início, conclusão, rejeição esperada, falha e timeout necessários para reconstruir o fluxo.
3. Categoria, nível, nome do evento e código de resultado/falha.
4. Campos de correlação e detalhes permitidos, com dados proibidos explicitados.
5. Eventos repetitivos que precisam de throttle, agregação ou amostragem.
6. Testes para caminho normal, erros e classificação no painel/histórico.

O mapa deve ficar no documento da funcionalidade ou na tarefa técnica correspondente; alterações na taxonomia ou no contrato central atualizam este padrão. Não adicionar logs sem decidir sua categoria, nível, utilidade diagnóstica, volume e privacidade. Não deixar uma funcionalidade sem logs só porque existe um `console.log`, `print` ou texto livre.

### Definition of Done de observabilidade

- Cada transição relevante produz evento estruturado e verificável.
- Falhas têm código estável e uma mensagem segura para o usuário; detalhes técnicos são correlacionáveis.
- O backend armazena e o painel apresenta a categoria canônica correta.
- Nenhum segredo, palavra secreta, charada integral ou comentário bruto é adicionado aos logs técnicos.
- Logs frequentes são limitados/agregados e têm teste de volume ou throttle.
- O evento aparece em teste e, quando a mudança depende de processo/daemon, em validação de execução após carregar a versão nova.
- A documentação da funcionalidade registra seu mapa de eventos e limitações conhecidas.

## 2. Categorias canônicas

IDs são estáveis e independentes do idioma. O painel pode exibir os rótulos em português.

| ID | Rótulo no painel | Usar para |
| --- | --- | --- |
| `connection` | Conexão | Estado da live, TikTok, sessão, daemon, conexão e reconexão. |
| `game` | Eventos dos jogos | Ações e transições de jogo, palpites, presentes, dicas, charadas, ranking e resultado. Informar `game` quando conhecido (`palavra`, `duelo`, `caca`, etc.). |
| `chat` | Chat | Eventos de chat. Não incluir comentário bruto em `diagnostic`; conteúdo bruto segue política própria de retenção e exposição. |
| `notice` | Avisos | Situações esperadas que precisam de atenção, sem caracterizar falha do sistema. |
| `error` | Erros | Uma ação ou operação falhou, não pôde concluir ou perdeu uma dependência necessária. |
| `diagnostic` | Diagnóstico detalhado | Contexto técnico, etapas internas, decisões e durações usados para investigar. Não substituir o evento `error` voltado ao usuário quando uma operação falhar. |

`system` não é categoria canônica para novos eventos. É um fallback temporário para registros legados realmente sem origem conhecida; não classificar automaticamente como `connection`. `audit` também não é categoria: registrar ator/ação como evento e metadados, respeitando a categoria do domínio (`game`, `connection`, etc.).

O nível descreve severidade, não área:

| Nível | Uso |
| --- | --- |
| `debug` | Detalhe opcional para diagnóstico; não é mensagem de erro. |
| `info` | Operação ou transição normal. |
| `warning` | Condição inesperada recuperável, tentativa rejeitada ou degradação sem falha terminal. |
| `error` | Operação falhou e precisa de investigação ou ação. |
| `critical` | Falha que compromete o serviço/sessão ou exige resposta operacional imediata. |

Mapeamento legado ao normalizar: `err` → `error`, `warn` → `warning`, `ok` → `info`, `trace` → `debug`; `chat` legado deve virar categoria `chat` e nível `info`. Níveis desconhecidos não devem ser convertidos silenciosamente em sucesso.

## 3. Contrato estruturado

Todo produtor novo deve enviar um objeto estruturado, preservando compatibilidade com consumidores antigos enquanto a migração estiver incompleta. O formato lógico recomendado é:

```json
{
  "category": "game",
  "level": "info",
  "event": "game.start.completed",
  "message": "Partida iniciada.",
  "source": "python",
  "game": "palavra",
  "session_id": "sessão atual, se houver",
  "game_id": "partida atual, se houver",
  "trace_id": "correlação da ação, se houver",
  "code": "GAME_STARTED",
  "duration_ms": 420,
  "details": { "pool_ready": true }
}
```

Regras do contrato:

- O servidor cria `id` e timestamp persistentes; manter a ordenação atual e a compatibilidade do transporte WebSocket.
- `tenant_id` vem da autenticação/sessão no servidor, nunca de um campo arbitrário fornecido pelo cliente.
- `session_id` e `trace_id` são diferentes: sessão agrupa uma conexão/live; trace agrupa uma ação ponta a ponta. Propagar trace do clique/rota ao comando daemon e ao resultado.
- `event`, `category`, `level`, `source`, `game`, `code` e nomes de estados devem ser enums/strings estáveis, não mensagens livres usadas como chave de análise.
- `details` é pequeno, limitado e allowlist por produtor. Não serializar corpo inteiro da requisição, objeto TikTok ou exceção sem filtragem.
- `message` é uma descrição legível, curta, sem dados secretos; detalhes úteis para engenharia ficam em campos tipados.
- A representação física (colunas ou JSON adicional) deve ser definida após auditar `log_entries`, o fluxo `/logs` e `GET /api/logs`. Qualquer migração é aditiva, com rollback e compatibilidade explícitos.

### Exemplo de cobertura de uma ação

Para iniciar uma partida, uma sequência útil seria:

1. `game.start.requested` — clique/rota; registrar estado anterior e `trace_id`.
2. `game.start.rejected` ou `game.start.queued` — motivo estável, ou comando enviado.
3. `game.start.received` — daemon aceitou o comando e informa `session_id`/`game_id`.
4. `game.start.preparation_completed` — pool preparado, duração e resultado.
5. `game.start.completed` ou `game.start.failed` — resultado final.

Aplicar o mesmo princípio a dica, charada, fechamento, replay, ranking, presentes e encerramento. Não gerar eventos redundantes para cada chamada interna se um evento de transição suficiente reconstrói o fluxo.

## 4. Privacidade, visibilidade e volume

- **Nunca** registrar em eventos técnicos: palavra secreta, texto completo de charada, comentário bruto, credenciais, tokens, API keys, URL assinada, payload completo de presentes ou exceção não sanitizada.
- Em erros técnicos, registrar código, tipo de exceção, origem, etapa, duração e `trace_id`. Stack trace, quando necessário, fica somente em log operacional protegido do servidor; nunca na resposta ao streamer ou no histórico acessível pelo tenant.
- A mensagem de `error`/`notice` deve explicar o que ocorreu e a ação segura seguinte, sem revelar internals.
- Categoria `diagnostic` só aparece no filtro avançado e apenas dentro do escopo autenticado do tenant. Detalhes adicionais para suporte interno exigem autorização própria; não ampliar o escopo de `/api/logs` para outras contas.
- Logs operacionais sem tenant (Node/daemon) são linhas JSON estruturadas em stdout/stderr; o console do navegador é canal local separado. Não afirmar que um `console.error` foi persistido no histórico do streamer.
- A categoria `chat` preserva o comentário real para o streamer, truncado a 130 caracteres e limitado por throttle de 1 segundo, com retenção geral de 7 dias/teto por tenant. Não copiar comentário para outras categorias ou `diagnostic`; manter mascaramento de credenciais também em Chat.
- Preservar os limites atuais de persistência (`7` dias e teto por tenant conforme `db.js`) até aprovação explícita de uma política diferente. Throttle e retenção não substituem mascaramento.
- Não emitir um evento por curtida, frame, tick ou comentário irrelevante. Usar transições, contagens agregadas e resumo periódico; suprimir repetição e incluir `suppressed_count` quando for útil.
- Diagnóstico opcional de níveis TikTok agrupa observações por tenant em janelas de 10 segundos; não emitir um log por espectador/atualização.

## 5. Metodologia para apurar erros

1. **Delimitar:** anotar horário, tenant, sessão, jogo, ação, resultado esperado e resultado observado.
2. **Correlacionar:** localizar pelo `trace_id`; na ausência, combinar `session_id`, `game_id`, evento e janela temporal. Nunca procurar por palavra secreta ou conteúdo bruto de chat.
3. **Ordenar o fluxo:** verificar primeiro `error`/`critical`, depois `warning`, e então `diagnostic` da mesma correlação. Conferir fronteiras: painel → rota → fila/comando → daemon → integração → evento de retorno → persistência/UI.
4. **Identificar a primeira divergência:** encontrar o último evento concluído e o primeiro evento ausente, rejeitado ou falho. Distinguir falha real de rejeição esperada e de processo desatualizado.
5. **Reproduzir com segurança:** usar dados sintéticos e reproduzir os caminhos de sucesso, rejeição, timeout e dependência indisponível.
6. **Corrigir e provar:** criar teste de regressão, confirmar categoria/nível/correlação e validar que os logs chegam ao histórico e à interface.
7. **Fechar:** registrar causa raiz, `code`/`event` relevante, correção e prevenção na tarefa/documentação. Não encerrar com “resolvido” baseado apenas em mensagem de sucesso do cliente.

Eventos repetidos devem indicar supressão/throttle. Uma ausência de debug no histórico é diagnóstico em si: conferir versão/código carregado no Node e no daemon, tenant/sessão ativa, fila e persistência, sem reiniciar uma live ativa sem janela segura.

## 6. Inventário mínimo por tipo de funcionalidade

- **Rotas/ações de painel:** solicitada, validada/rejeitada, enviada à fila, confirmação/falha de execução; registrar motivo estável e resultado.
- **Preferências do ranking de diamantes:** `overlay.gift_ranking_layout.rejected` (`notice`/`warning`), `overlay.gift_ranking_layout.saved` (`diagnostic`/`debug`, agregado por 2 s) e `overlay.gift_ranking_layout.failed` (`error`/`error`). Permitir somente `x`, `y`, `scale`, `count` em `details`; nunca registrar token, URL ou identidade. Testar validação, persistência por tenant e atualização do cliente público via WebSocket.
- **Fluxo assíncrono/daemon:** recebimento, início da etapa longa, fim/duração ou falha/timeout; propagar `trace_id`.
- **Jogo:** transições de estado, alterações de ranking, presente aceito/ignorado com motivo, dica/charada solicitada e resultado, fechamento e encerramento. Valores secretos são proibidos.
- **3 Dicas:** solicitação/filas, preparação e geração de dicas (sucesso/fallback/duração), rodada iniciada, etapa liberada, presentes que revelam tamanho/letra, vitória, timeout, pausa, retomada, parada, reset e auto-rodada. Correlacionar por `trace_id` da ação e `game_id` da rodada. Contabilizar palpites errados por etapa, sem registrar comentário, resposta ou texto das dicas.
- **Integrações externas:** operação, resultado/status, duração, retry/timeout e código; ocultar credenciais e resposta bruta.
- **Persistência:** sucesso ou falha quando afeta a funcionalidade; não registrar conteúdo de linhas nem dados pessoais sem necessidade.
- **Frontend:** apresentar erro de forma clara; não inventar sucesso. Logs de navegador enviados ao servidor exigem contrato, limite de taxa, sanitização e isolamento próprios; não criar endpoint genérico de ingestão sem aprovação.

### Catálogo de eventos do 3 Dicas

| Evento(s) | Categoria / nível | Campos permitidos úteis |
| --- | --- | --- |
| `tres.start.requested`, `tres.start.queued`, `tres.start.command_received`, `tres.start.accepted`, `tres.start.failed`, `tres.start.rejected` | `game` / `info`, `notice` / `warning` ou `error` / `error` | `trace_id`, `session_id`, `game_id` (round id), palavra personalizada fornecida (boolean), `code`, duração e tipo da exceção. |
| `tres.round.preparation_started`, `tres.generation.completed`, `tres.generation.fallback`, `tres.round.clues_replaced` | `diagnostic` / `debug` para sucesso técnico; `notice` / `warning` para fallback | `trace_id`, `game_id`, motivo enumerado, tentativas, duração, quantidade de dicas recebidas e tamanho da resposta. Nunca guardar texto das dicas. |
| `tres.round.started`, `tres.clue.revealed` | `game` / `info` | `game_id`, `trace_id`, etapa, countdown/duração, pontos e contagem agregada de erros da etapa. |
| `tres.gift.revealed_size`, `tres.gift.revealed_first_letter`, `tres.gift.ignored`, `tres.ticket.granted` | `game` / `info` ou `warning` | usuário quando necessário, motivo enumerado, `word_length` após a revelação. Nunca registrar a letra revelada, resposta ou comentário. |
| `tres.round.won`, `tres.round.timed_out`, `tres.game.paused`, `tres.game.resumed`, `tres.game.stopped`, `tres.round.reset`, `tres.round.auto_started`, `tres.round.auto_start_rejected`, `tres.round.auto_start_failed` | `game`, `notice` ou `error` conforme o resultado | `game_id`, `trace_id`, usuário vencedor, etapa, pontos, multiplicador, contagem agregada de erros e `code`. Nunca registrar a resposta. |

## 7. Plano de evolução do sistema atual

### Fase 0 — documentação e regra de governança (**concluída em 2026-10-15**)

- Manter este arquivo como padrão normativo.
- Referenciá-lo no `AGENTS.md` da raiz e em `REGRAS_DO_PROJETO.md`.
- Atualizar o inventário complementar `docs/logs-persistencia-backend-recomendacoes.md` para separar implementado, pendente e legado.

### Fase 1 — contrato e classificação (**código atualizado; ativação de runtime pendente**)

- IDs canônicos já alinhados no `logstore`, DB, WebSocket e checkboxes do painel; a API aceita filtros por categoria, jogo, nível, evento, código, origem, sessão, partida e trace.
- O painel já prioriza a categoria recebida; classificador textual fica apenas como compatibilidade de eventos legados.
- Mapear prefixos legados confiáveis (`[Jogo]`, `[Guess]`, `[Tap]`, `[3 Dicas]`) para `game`; `[Gift]` e `[Access]` genéricos para `notice`; fallback desconhecido permanece `system`.
- Migrar aliases do `localStorage` (`conexao`, `jogos`, `avisos`, `erros`, `diagnostico`) sem apagar a preferência do usuário.
- Não reclassificar histórico ambíguo. Backfill somente quando houver evidência confiável.

### Fase 2 — produtores e correlação (**fluxos centrais padronizados; ativação de runtime pendente**)

- Criar/usar helpers estruturados em Node e Python e padronizar `category`, `level`, `event`, `source` e códigos. A normalização central e os campos persistíveis já estão no working tree.
- Propagar `trace_id` da rota ao daemon e retorno; conexão live, Palavra Secreta e 3 Dicas correlacionam as ações principais. Estender a ações e callbacks restantes dos outros jogos que ainda carregam apenas `session_id`/`event_id`.
- Logs de processo Node (daemon, persistência, billing e inicialização) usam o mesmo vocabulário estruturado, em stdout/stderr protegido.
- Novos logs técnicos não gravam palavra secreta, conteúdo integral de dica/charada ou resposta de 3 Dicas. O texto real do comentário fica somente na categoria `chat`, com limite/throttle definidos acima; a migração mascara comentários históricos legados quando ainda não foram redigidos.
- A normalização cobre produtores legados conhecidos, que passam a receber categoria, nível, origem e evento legado; adicionar nomes de evento específicos ao ampliar cada jogo.

### Fase 3 — histórico e experiência do usuário (**pendente**)

- Integrar o painel ao `GET /api/logs` existente; não criar endpoint duplicado.
- Carregar histórico e conectar o WebSocket com reconciliação/deduplicação por `id`/cursor, sem lacunas após reconexão.
- Exibir categorias canônicas com rótulos claros, mensagens de usuário em `notice`/`error` e diagnóstico técnico sob filtro avançado.
- Preservar **Limpar** como ação local; filtros não apagam nem alteram registros persistidos.

### Fase 4 — testes e ativação (**pendente**)

- Cobrir derivação/normalização de categoria, níveis inválidos, campos ausentes e aliases antigos.
- Testar ponta a ponta: request → daemon → log persistido → replay/WebSocket → filtro no painel.
- Testar isolamento de tenant, retenção, sanitização, limite de payload, throttle, erros e falha de persistência.
- Após deploy/restart em janela segura, conferir uma ação real e verificar presença dos eventos esperados. Não marcar logging como concluído se o código está apenas no disco.

## 8. Critérios de aceite

1. Um evento estruturado conserva a mesma categoria, nível e correlação desde o produtor até DB, API, WebSocket e painel.
2. Categorias de jogo não aparecem como Conexão/Sistema quando sua origem é conhecida.
3. Cada ação operacional crítica tem resultado explícito: concluída, rejeitada, falha ou timeout.
4. Um erro pode ser reconstruído por `trace_id` sem coletar segredo, palavra secreta, charada integral ou comentário bruto.
5. Logs de alto volume não inundam o histórico; supressões são testadas.
6. `/api/logs` continua isolado por identidade autenticada; replay e realtime não duplicam registros.
7. Categorias legadas e preferências antigas continuam funcionando durante a migração.
8. A validação final confirma tanto sintaxe/testes quanto presença dos eventos no processo atualizado.

## 9. Estado verificado em 2026-10-15

- Implementados antes desta rodada: tabela `log_entries`, sanitização, retenção de 7 dias/limite por tenant, persistência via `broadcastLog`, `GET /api/logs` autenticado e filtros locais no painel.
- Adicionado nesta rodada ao código: categorias/níveis canônicos, aliases legados, filtros canônicos na UI, `event`, `source`, `code`, `trace_id`, `game_id`, `duration_ms`, `details` e `session_id` na persistência; stdout/stderr operacional também usa linhas JSON estruturadas. No próximo boot, migrações aditivas redigem conteúdo privado legado e reclassificam somente mensagens com origem inferível por metadados/prefixos conhecidos.
- 3 Dicas: eventos estruturados cobrem rota/daemon, preparação/fallback das dicas, início e transições de etapa, presentes, vitória, timeout, pause/resume/stop/reset e auto-rodada. Não registram resposta, texto integral de dica ou palpite bruto; erros agregam apenas contagem por etapa.
- Testes unitários de normalização, migração/redação, emissão Python, UI de categorias e eventos de 3 Dicas passaram (11 testes Node focados, 58 testes Python e 26 verificações TAP). Pendente: replay de `/api/logs` no painel e validar migrações/redação/WS/DB depois de carregar a versão atualizada em janela segura.
- A sessão observada em 2026-10-15 antecede esta rodada e não tinha `level=debug`; logs apenas no working tree não contam como ativação. A primeira migração executada nesta máquina já redigiu comentários históricos do Chat, que não são recuperáveis desta tabela sem backup; os novos comentários voltam a ser gravados em `chat`. Não reiniciar live ativa sem janela segura.
