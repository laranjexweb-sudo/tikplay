# Quiz Live — Perguntas e Respostas

## Escopo e integração

Quiz Live é um jogo isolado no servidor Node, usando a sessão TikTok já mantida pelo daemon Python. O Node recebe somente o evento normalizado `interaction` que o daemon já emite para cada comentário; não abre outra conexão TikTok. A lógica de respostas, relógio, pontuação, partidas e rankings fica no servidor. A persistência usa tabelas próprias no SQLite compartilhado. As páginas públicas não aceitam comandos de jogo e são identificadas pelo código público da sala, sem token administrativo; quando há narração, a fonte envia apenas uma confirmação de reprodução concluída para iniciar o cronômetro.

O painel do streamer terá Controle, Configurações, Banco de perguntas e Histórico. A página pública `/quiz-live` recupera a partida atual por HTTP e atualiza pelo WebSocket dedicado da sala. O WebSocket não aceita comandos; mudanças são autenticadas nas rotas do painel e sempre escopadas por `req.user.id`.

## Mapa de observabilidade

| Fluxo | Eventos | Categoria / nível | Correlação e detalhes permitidos |
| --- | --- | --- | --- |
| Preferências e biblioteca | `quiz.config.saved`, `quiz.question.saved`, `quiz.question.rejected` | `game` / `info` ou `notice` / `warning` | `trace_id`, `game_id`, contagens, tema, dificuldade, código de validação; sem resposta correta nem texto integral |
| Partida | `quiz.match.start.requested`, `.started`, `.rejected`, `.finished`, `.failed` | `game` / `info`, `notice` / `warning`, `error` / `error` | `trace_id`, `game_id`, `session_id`, tema(s), tamanho do lote, `code`, duração |
| Pergunta e controles | `quiz.question.opened`, `.closed`, `quiz.match.paused`, `.resumed`, `quiz.match.stopped`, `quiz.answer.revealed` | `game` / `info` | `game_id`, índice, modo, duração, agregados; nunca a resposta correta antes do fechamento |
| Comentários | sem log individual; uma resposta aceita atualiza estado e agrega contagem | — | mensagem e resposta são usadas apenas para validar e persistir o token de resposta; nunca copiadas a logs técnicos |
| Persistência e timer | `quiz.persistence.failed`, `quiz.timer.recovered` | `error` / `error` ou `diagnostic` / `info` | `game_id`, etapa, código, duração restante; sem dados pessoais ou resposta |
| Narração | `quiz.narration.requested`, `.completed`, `.failed`; depois `quiz.question.opened` | `game` / `info`, `notice` / `warning` | `trace_id`, `game_id`, pergunta, duração de geração/reprodução estimada; sem texto integral ou credenciais. Usa o TTS Edge padrão já configurado no streamer, e envia somente o URL do áudio à fonte pública |

Comentários são de alto volume: não gerar log por tentativa, resposta inválida, tick ou participante. Contadores são enviados em atualizações agregadas, limitadas por janela. Correlação usa `trace_id` por ação, `game_id` por partida, `question_no` e `event_id` do TikTok para deduplicação. `tenant_id` vem da sessão autenticada, nunca do corpo. Nenhum segredo, token, comentário bruto, gabarito prévio ou explicação privada entra em logs técnicos. Os testes cobrem sucesso, rejeição, isolamento, duplicação, restauração de prazo, narração, pontuação e sanitização de estado público.

## Estado de implementação

- [x] Arquitetura atual e contrato do evento de comentário mapeados; a captura é compartilhada, sem nova conexão.
- [x] Banco, ciclo de partida, geradores matemáticos e API isolados implementados.
- [x] Painel do streamer e tela pública com layouts adaptáveis implementados.
- [x] Testes automatizados dos fluxos principais, isolamento por conta e sala, deduplicação, recuperação do prazo, temporização, narração, pontuação, ranking semanal e resposta pública.
- [ ] Validação da tela OBS nos quatro tamanhos do pedido e operação com uma live real, dependente de janela de teste do streamer.

## Verificações concluídas

- `node --check` em `server.js`, `lib/quiz-live.js` e `lib/quiz-math.js`.
- `node --test tests/quiz-live.test.js`: 7 testes passando.
- `python -m unittest tests.test_quiz_narration`: 2 testes passando.
- O armazenamento estruturado dos eventos usa o ponto comum `broadcastLog` do servidor; validar a exibição no histórico e o overlay OBS requer carregar esta versão no processo, sem interromper uma live ativa.

## Limitações conhecidas

O tempo de chegada do comentário depende do evento recebido do TikTok; bônus considera o horário processado pelo servidor e, portanto, pode variar com latência de rede. A narração usa o TTS Edge padrão já configurado para o streamer e inicia o cronômetro após a fonte pública confirmar a reprodução; há um limite de espera para que a partida continue mesmo sem uma fonte conectada. Se a síntese falhar, a pergunta continua sem áudio. A atualização ao vivo requer que o painel e a fonte mantenham conexão de rede.

## Refatoração da interface do painel (2026-10-17)

- O Quiz Live apresenta quatro abas independentes: Controle, Configurações, Banco de perguntas e Histórico.
- A configuração mantém o salvamento explícito existente; alterações ficam sinalizadas como pendentes até a confirmação. Presets de margem preenchem os mesmos quatro valores já persistidos. A seleção de cálculo direto é liberada somente quando Matemática é o único tema selecionado, de acordo com a validação já existente no servidor.
- O banco carrega as páginas existentes do endpoint sem alterar a rota ou o contrato, agrega os totais e aplica busca/filtros no navegador. Inclui tema, dificuldade, modo, origem e status; paginação local mantém blocos de 25 perguntas.
- Cadastro e edição usam um diálogo recolhível. O diálogo deixa claro que perguntas próprias aceitam alternativas A–D; cálculo direto continua disponível no modo de jogo para perguntas matemáticas geradas pelo motor. Questões globais permanecem somente leitura e sem gabarito exposto.
- Observabilidade: nenhuma ação de domínio nova foi criada. Salvamento, importação e desativação continuam usando as rotas e eventos já descritos no mapa acima; a navegação, busca e abertura do editor não emitem logs.
- Validação: scripts inline e IDs do HTML conferidos; `node --test tests/quiz-live.test.js` passou (7 testes). Nenhuma regra de jogo, API, persistência, pontuação ou geração foi alterada.

## Refatoração da tela pública (2026-10-17)

- A página pública distingue espera, pergunta ativa, resposta revelada, placar parcial e encerramento, com identidade TikPlay em tema escuro, acentos ciano/roxo e destaque dourado para gabarito/pódio.
- A revelação mantém contagem de respostas e participantes e, em seguida, mostra o top 3 acumulado. O encerramento destaca o pódio final, perguntas e participantes. Safe areas configuráveis, layout vertical/horizontal e movimento reduzido continuam atendidos por CSS.
- Limite do contrato público: ele não envia contagem de acertos da rodada, respostas individuais, nomes de quem acertou ou ordem de rapidez. A interface não afirma esses dados; exibí-los exigiria alterar e revisar a API pública, fora do escopo visual solicitado.
- Observabilidade: nenhuma rota, ação de domínio, evento ou log foi adicionado ou alterado.
- Validação: `node --check` do JavaScript embutido, IDs referenciados e `node --test tests/quiz-live.test.js`; conferir a fonte no OBS/Live Studio requer testar os quatro tamanhos em uma sessão de transmissão.

### Ajuste de legibilidade da tela pública

- Card da pergunta usa superfície clara uniforme, texto escuro sem sombra e largura de leitura limitada; o tamanho mínimo do enunciado foi elevado para manter leitura em 9:16.
- Alternativas usam fundo claro, texto escuro e letras azuis de alto contraste; o estado correto usa texto escuro sobre amarelo suave. O cronômetro ficou visualmente secundário e a contagem de respostas ganhou contraste.
- Apenas CSS, tamanho tipográfico e versão de cache foram alterados; regras, respostas, temporização, pontuação, API e observabilidade permanecem iguais.

### Correção de contraste dos demais estados

- Superfícies claras ficaram restritas à pergunta e às alternativas. Revelação, ranking, espera, selo da rodada e rodapé usam fundo escuro com texto claro, corrigindo a herança de estilos compartilhados que deixava textos brancos sobre fundo claro.

## Banco global e perguntas particulares (2026-10-17)

- `quiz_questions` identifica cada registro com `scope` e `owner_user_id`. A migração preserva perguntas legadas do streamer e classifica registros sem `tenant_id` como globais; o catálogo inicial é semeado como global. Temas ficam em `quiz_themes`, com identificador estável e unicidade pelo rótulo normalizado sem acentos, caixa ou espaços repetidos.
- Super Admin administra catálogo e temas por rotas exclusivas protegidas por `auth.requireAdmin`; remoção de perguntas e temas é desativação para preservar histórico. O painel oferece busca, filtros, contagens por status/tema/dificuldade, uso agregado e importação com prévia, validação de nove campos, detecção de duplicadas e seleção explícita das linhas a gravar.
- O streamer consulta o catálogo global sem receber gabarito nem explicação, e edita/desativa apenas perguntas próprias. Rotas filtram proprietário no servidor; consultas e operações não aceitam `owner_user_id` vindo do cliente. O histórico de uso global fica agregado; o particular fica restrito à conta autenticada.
- `question_source` é salvo por conta e filtra a seleção em `all`, `global` ou `streamer`. A disponibilidade é verificada com os mesmos temas/dificuldade/quantidade antes do início; falta de perguntas retorna aviso e não completa com outra origem. Matemática sintética continua disponível como mecanismo global existente; no modo particular, apenas perguntas matemáticas do proprietário contam.
- Cada partida copia pergunta, alternativas, resposta e explicação para `quiz_rounds` na abertura. Alterações posteriores no banco não modificam rodada ativa nem histórico.
- Observabilidade: configuração e abertura registram a origem escolhida. Importações e alterações do catálogo global geram eventos administrativos agregados, sem enunciados ou gabaritos; operações de leitura, paginação e filtros não geram eventos. Prévia não grava dados. Os eventos relevantes são `quiz.config.saved`, `quiz.match.started`, `quiz.question.saved`, `quiz.question.import.previewed`, `quiz.question.imported`, `quiz.catalog.question.saved`, `quiz.catalog.question.disabled`, `quiz.catalog.questions.imported`, `quiz.catalog.theme.saved` e `quiz.catalog.theme.disabled`.
- Validação automatizada: isolamento global/particular e entre contas, filtro de origem/dificuldade, Matemática particular, ausência de fallback, importação idempotente/validada, temas normalizados, acesso de admin e snapshot de rodada após edição.
