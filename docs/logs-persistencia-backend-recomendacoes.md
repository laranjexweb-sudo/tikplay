# Logs do TikPlay — inventário de persistência e dependências

O padrão obrigatório de produção e diagnóstico está em **`docs/PADRAO_DE_LOGS.md`**. Este documento é complementar: registra o inventário técnico, dependências e estado do replay/persistência. Em caso de divergência, prevalece o padrão oficial; recomendações abaixo não significam que a funcionalidade já esteja implementada.

## Comportamento e contrato atuais

- O painel recebe mensagens `type: "log"` pelo WebSocket `/logs`. O transporte ainda aceita string legada ou objeto `{ text, game, level }`; o contrato estruturado mais amplo está definido em `PADRAO_DE_LOGS.md`.
- O backend persiste logs via `node/lib/logstore.js`/`broadcastLog` e oferece `GET /api/logs` autenticado, paginado por `before`/`since`/`limit`. O painel ainda não integra o replay ao vivo; **não criar outro endpoint**. A reconexão ao WebSocket não recupera por si só as linhas perdidas.
- Logs operacionais Node/daemon sem tenant são JSON em stdout/stderr e não entram em `log_entries`; `console` do navegador também não é persistido nem enviado ao backend.
- O navegador cria uma linha DOM por mensagem em `addLog`; não há persistência local das linhas. Recarregar perde a lista. A limpeza atual só substitui a lista visível do navegador.
- O frontend entrega filtros de apresentação por categoria, sem remover nós do DOM: desmarcar oculta linhas; marcar novamente as mostra; `Limpar` continua como ação local separada. `Copiar` ainda copia as linhas presentes no DOM, inclusive as ocultas por filtro. Preferências dos checkboxes são salvas em `localStorage` (`tikplay.logCategories`), somente neste navegador, sem chamada ao backend.
- A categoria `chat` mantém o comentário real, limitado a 130 caracteres e throttle de 1 segundo. O texto não deve ser duplicado em Diagnóstico ou em logs técnicos.
- A normalização agora usa as categorias canônicas `connection`, `chat`, `game`, `notice` e `error`, além de `diagnostic`; `system` permanece apenas como fallback legado. No próximo boot, uma migração redação/normalização corrige conteúdo privado e classifica somente registros antigos com origem confiável. O painel consome a categoria recebida e mantém a opção **Sistema (legado)**; aliases antigos de filtro são migrados no `localStorage`.
- O daemon ainda aceita mensagens legadas; níveis `err`, `warn`, `ok` e `chat` são normalizados ao persistir. Na validação anterior da sessão de 2026-10-15 não foi encontrado `level=debug` nem `[debug][Palavra]`; a normalização, migração do schema e redação do histórico exigem o próximo boot do Node para validação em execução.

## Contrato e dependências pendentes

Os nomes canônicos e a política obrigatória estão em `PADRAO_DE_LOGS.md`. O schema estruturado e o adaptador de compatibilidade já estão no working tree; replay do painel e validação após o processo atualizado continuam pendentes.

### Registro estruturado

Formato lógico persistido/transportado por novos eventos estruturados, mantendo compatibilidade com o transporte legado:

```json
{
  "id": "identificador-estavel",
  "tenant_id": "derivado da autenticação no servidor",
  "session_id": "id-da-sessao-live-ou-da-sessao-de-painel",
  "timestamp": "2026-10-12T15:14:27.123Z",
  "category": "chat",
  "level": "info",
  "event": "chat.message.received",
  "source": "python",
  "game": "batalha",
  "game_id": "rodada-ou-partida",
  "trace_id": "correlacao-da-acao",
  "code": null,
  "duration_ms": null,
  "details": {},
  "message": "Mensagem segura e legível"
}
```

- `id` deve ser único e estável entre replay e entrega ao vivo, permitindo deduplicação. A persistência já armazena os campos do esquema lógico acima, incluindo contexto/correlação e detalhes redigidos.
- `timestamp` deve ser atribuído no servidor em UTC; o cliente pode formatá-lo para o horário local.
- `tenant_id` define o escopo de isolamento e deve ser derivado da autenticação no servidor. `session_id` separa lives/sessões; novos registros o recebem do daemon ou da sessão ativa do tenant.
- `category`: usar os IDs canônicos `connection`, `chat`, `game`, `notice`, `error`, `diagnostic`. `level`: `debug`, `info`, `warning`, `error` ou `critical`. Ver detalhes e normalização legada no padrão oficial.
- `message` deve ser texto seguro, sem credenciais, tokens, chaves de API ou URLs assinadas com segredo. Sanitizar antes de gravar e também antes de expor a clientes.
- Eventos legados `{text, game, level}` são normalizados no servidor; produtores novos devem enviar metadados explícitos. Os campos adicionais no WebSocket são aditivos e preservam consumidores antigos.

### Recuperação e entrega ao vivo

Integrar o painel ao `GET /api/logs` existente. Carregar uma página recente e reconciliar com o WebSocket por `id`/cursor para evitar lacunas e duplicatas; não duplicar a rota. Manter paginação limitada, ordenação estável e escopo pelo tenant autenticado.

O WebSocket `/logs` não recebe parâmetros de replay. O hook acrescenta `id`, `ts` e metadados normalizados quando a persistência funciona; em falha, continua transmitindo o evento legado, sem esses metadados. A reconciliação e deduplicação no cliente permanecem pendentes de implementação.

### Preferências, retenção e autorização

- Se as categorias marcadas precisarem sobreviver ao refresh, gravar preferências explícitas vinculadas ao usuário autenticado e ao streamer/tenant, de acordo com o modelo de permissões atual. Definir precedência para usuário que acessa mais de um streamer e valor padrão para novos usuários. O frontend já persiste filtros localmente; sincronização entre dispositivos é uma proposta separada.
- A retenção implementada no momento é de 7 dias, com teto de 20.000 linhas por tenant e poda periódica (`node/db.js`). Preservar limites até decisão documentada; validar volume real, índices e janela antes de alterá-los.
- Derivar o streamer/tenant da identidade autenticada no servidor; não confiar em `streamer_id` arbitrário enviado pelo cliente. Verificar autorização em cada leitura e gravação, e cobrir isolamento contra acesso cruzado entre tenants.
- Aplicar limites de taxa, tamanho de mensagem e volume por sessão. Excluir ou mascarar tokens, API keys, dados pessoais desnecessários, conteúdo privado e URLs com assinaturas.

### Semântica das ações da interface

- **Ocultar por categoria:** filtro somente de apresentação no cliente; não altera DOM subjacente nem registros persistidos.
- **Limpar:** limpa somente as linhas atualmente carregadas na tela local. Não exclui registros do servidor e não deve afetar outro painel/cliente. Após implementar replay, esclarecer se a tela vazia continua vazia até nova sessão/recarregamento ou se o cursor local é reiniciado; não converter silenciosamente Limpar em exclusão remota.
- **Apagar persistidos:** não existe ação no frontend e não deve ser introduzida como efeito de Limpar. Se o produto precisar dessa capacidade, criar uma ação separada, autorização explícita, confirmação clara e auditoria adequada.

## Critérios verificáveis para a implementação de backend

1. Após refresh, o cliente autorizado recupera os registros recentes da sessão/streamer correto, em ordem estável; sem endpoint/replay habilitado, o comportamento atual continua sendo lista nova com saudação e eventos futuros.
2. Após queda e reconexão do WebSocket, nenhum evento dentro da janela de recuperação é perdido; eventos repetidos entre replay e stream aparecem uma única vez por `id`.
3. Filtros ocultam/mostram categorias sem apagar registros carregados. “Limpar” afeta apenas a lista local. Nenhuma chamada de exclusão remota é feita por essas ações.
4. Cada categoria tem casos para metadados válidos, campos ausentes e nível desconhecido. Logs legados não são rotulados com confiança inventada; ficam em fallback documentado.
5. Um usuário/streamer não consegue ler logs de outro tenant alterando parâmetros, cursor ou `session_id`; registros e preferências também permanecem isolados.
6. Limites de página, retenção e tamanho de mensagem são exercitados; segredos de teste não aparecem na resposta nem no armazenamento de logs.

## Arquivos do frontend relacionados

- `node/public/control-panel.html`: controles acessíveis, categorização local, filtragem, cópia e limpeza local.
- `node/public/ui/tikplay-panels.css`: tema e layout compacto do painel de categorias.

## Autosave de preferências: implementação front-end e matriz

Revisão em 12/10/2026 no repositório `F:\Programação\Jogo TikTok\jogo-contexto`. Não foram alterados backend, banco, contratos, produtores de eventos ou reprodução automática de sons. O estado de backend acima foi reconfirmado após alterações concorrentes; recomendações não substituem leitura do código atual.

| Menu / campos | Endpoint | Escopo e envio | Falha / dependência |
| --- | --- | --- | --- |
| Conectar Live: usuário, API key, motor | GET/POST `/api/panel-config` | Usuário autenticado; POST parcial; input 600 ms, change/blur envia pela fila | Valores em tela; chave vazia não apaga chave salva. Remover chave continua ação explícita. |
| Sons: seguidores, Heart-me, voz, velocidade | GET/POST `/api/settings` | Configuração completa hidratada + campos visíveis; fila compartilhada com Palavra Secreta | POST substitui; GET deve concluir antes de habilitar controles. Erro HTTP/rede/`success:false` nunca confirma sucesso. |
| Palavra Secreta: prefixo, proporção dica/charada, rodada automática, pausa, meta TAP, narração | GET/POST `/api/settings` | Mesma fila; preserva campos não expostos, inclusive `chat_narr_*` | Não mandar objeto parcial; valida números antes do envio. Percentual zero é preservado. |
| Palavra Secreta: presentes de dica, revelador, tamanho e primeira letra | GET/POST `/api/gift-config` | POST parcial por usuário; seleção/remoção de chips dispara fila | Não reescrever chips com resposta antiga; preservar campos de outros jogos no merge do backend. |
| 3 Dicas: presentes tamanho/letra/ingresso, três tempos e pontuações | GET/POST `/api/tres/config` | Snapshot completo hidratado; seleção imediata, números 500 ms/change | O backend grava DB antes de mandar ao daemon; erro pode significar salvo mas não aplicado. Não mostrar sucesso nesse caso; investigar confirmação separada. |
| Caça-Palavras: formato e prefixo | GET/POST `/api/caca/config` | GET lê configuração do tenant; POST valida prefixo até 8 caracteres e grava antes de enviar ao daemon. `/start-game` reaplica a configuração persistida ao iniciar a sessão. | Persistência está implementada no backend. O painel ainda não hidrata a configuração pelo GET; Emoji e coordenadas enviam ambos prefixo vazio. Quantidade da grade permanece parâmetro da ação Iniciar. |
| Duelo: modos, HP/escudo/dano/metas, tempos, cenas, volumes, música, idle, presentes, apoiadores, especiais, layout | GET/POST `/api/duelo/config` | Fila única, 300–500 ms e change; listeners delegados incluem campos dinâmicos; seleção, adição, remoção e arraste também agendam | Hidratar antes de habilitar; resposta antiga não sincroniza estado por cima de edição nova. Ações iniciar/parar/reset/testar e upload/remoção continuam explícitas. |
| Logs: categorias marcadas | Sem endpoint | `localStorage` por navegador | Falha de armazenamento não apaga linhas. Não sincroniza usuário/dispositivos; filtros não excluem logs persistidos. |
| Super Admin: palavras banidas | GET/POST `/api/admin/banned-words` | Lista global, acesso superadmin; completa após GET, fila serial e debounce 600 ms | Valores permanecem em erro; editar tenta novamente. CRUD de usuários, convites e geração de conteúdos permanecem operações explícitas. |
| Sons: áudio normal/combo por presente | GET/POST/DELETE `/api/sound-alerts` | Envio e remoção explícitos; botão abre seleção e a escolha envia | `Áudio enviado` somente com `success:true`; manter seleção em falha e permitir novo envio. Sem nome/caminho de arquivo visível. |

Cada escopo tem feedback `role=status`/`aria-live=polite`, com alteração pendente, salvamento e erro. Uma fila não envia duas gravações simultâneas do mesmo endpoint. Durante um envio, novas edições geram uma revisão e outro snapshot; a resposta anterior não restaura os valores em tela. Em falha, não há repetição automática infinita: a próxima edição dispara tentativa. Fechar a página durante debounce ou request pode perder alterações ainda pendentes; não há garantia de flush em unload. Autosave não deve ser apresentado como garantia transacional.

### Sons e identidade de presentes

As chaves de alertas podem ser IDs numéricos. O frontend consulta o catálogo já existente (`/api/gifts?all=1`, com fallback `/api/gift-tags`), resolve `id` para `name` e usa `getGiftPtName`, que depende do mapeamento português disponível. Sem metadados, exibe `Presente ID <id>`; nomes desconhecidos permanecem como recebidos, sem tradução inventada. A lista é redesenhada após carregar o catálogo. Recomenda-se ao backend fornecer identidade estável e nome/localização confiáveis, mantendo compatibilidade com chaves antigas por nome e por ID.

A prévia manual usa `Audio` com um botão Reproduzir/Parar, reage a fim e erro e interrompe a prévia ao redesenhar a lista. Não interfere com a fila de efeitos da live. Inputs de arquivo ficam ocultos e são acionados por botões acessíveis de teclado. URLs permanecem no estado necessário à reprodução, sem texto de arquivo, player nativo, duração, seek, volume ou menus. Upload/remoção são ações de mídia, não preferências a salvar silenciosamente.

### Regra obrigatória do som de conexão

Manter `playConnectSound`, chave reservada `__connect__`, configurações antigas e fallback de beep. Remover somente a personalização visual. `getSoundAlertGiftKeys` exclui a chave reservada da lista e dos índices de edição; nenhuma ação de presente deve gravar/remover `__connect__`. Não alterar reprodução ao conectar nem o caminho de `gift_event`/`sound_alerts_updated`.

### Riscos e recomendações para backend

- Serialização do navegador não resolve duas abas ou dois clientes. `/api/settings` e `/api/tres/config` substituem snapshots; avaliar revisão/ETag e controle otimista para impedir perda de atualização concorrente. Não implementar PATCH ou mudar semântica sem migrar consumidores.
- Separar confirmação de persistência e aplicação ao daemon. Especialmente 3 Dicas pode gravar e depois retornar falha; Preferências pode confirmar DB sem daemon disponível. Auditar os demais endpoints pelo código atual.
- Caça-Palavras já tem armazenamento por tenant, GET autenticado e aplicação do prefixo persistido no início da sessão. O frontend ainda precisa hidratar a resposta de `/api/caca/config`; não implemente isso nesta revisão de UI.
- Validar limites, números, strings e IDs no servidor; preservar isolamento por identidade autenticada. O navegador não é fronteira de segurança.
- Logs já têm persistência e GET adicionados em trabalho concorrente; verificar retenção, mascaramento, índices e isolamento antes de projetar integração de replay. Eventos com falha de persistência podem não ter ID; documentar essa lacuna.

## Prompt completo para auditoria por outra IA

Copie o texto abaixo para a IA responsável pelo backend:

> Você está auditando o TikPlay no repositório `F:\Programação\Jogo TikTok\jogo-contexto`. Leia AGENTS.md, Git status/diffs e o código atual antes de concluir qualquer coisa. Existem alterações concorrentes; preserve-as. Esta solicitação é uma auditoria e proposta: não implemente backend, banco ou migração sem autorização específica.
>
> Analise os painéis `node/public/control-panel.html`, `admin.html`, `docs.html`, o tema `node/public/ui/tikplay-panels.css`, este documento e as rotas, DB, WebSocket e daemon Python reais. Liste com arquivos e linhas verificadas todos os campos e ações, endpoint/método/payload/resposta, autorização, escopo de tenant/usuário/navegador, semântica de merge/substituição, validações, persistência e momento de aplicação ao serviço. Inclua controles gerados dinamicamente, pickers de gifts, layout arrastável, áudio normal/combo e botões operacionais.
>
> Confira `/api/settings` (substituição completa e defaults), `/api/gift-config` (merge parcial), `/api/panel-config` (credenciais parciais), `/api/tres/config` (configuração completa e DB antes do daemon), `/api/duelo/config`, `/api/caca/config` e `/api/admin/banned-words`. Verifique o que sobrevive a refresh, logout, reinício Node/Python e acesso em outro navegador. A configuração de Caça-Palavras já persiste; confirme também que o frontend ainda hidrata o GET. Filtros de logs estão em localStorage e o frontend ainda não consome o replay nem deduplica registros históricos contra eventos ao vivo.
>
> O som de conexão deve continuar como antes: preserve chave `__connect__`, config antiga, `playConnectSound` e beep fallback. A remoção foi somente da UI de personalização. Audite índices de edição para que gifts não alcancem a chave reservada. Não desative sons ou mude eventos da live.
>
> Para alertas, investigue IDs numéricos, catálogo e nomes em português. Recomende metadados estáveis se faltarem; não invente traduções. O frontend usa Enviar áudio e Reproduzir/Parar, sem exibir arquivos/URLs ou player nativo. Upload e remoção permanecem explícitos; sucesso visual depende da resposta real. Valide erro de upload, remoção, reprodução, fim e seleção cancelada.
>
> Confirme o estado atual de `node/lib/logstore.js`, hooks em `node/lib/ws.js`, DB e `GET /api/logs`, inclusive autenticação, limites, before/since, ordenação, IDs, categoria, retenção e falha de gravação. Proponha replay/reconciliação/deduplicação sem duplicar endpoints já existentes. Limpar continua local e não pode apagar registros remotos.
>
> Entregue: (1) inventário com evidências e matriz campo/menu/endpoint/escopo/falha/gap; (2) problemas comprovados separados de hipóteses; (3) recomendações priorizadas e compatíveis, com plano de migração/rollback quando necessário; (4) contratos propostos explicitamente rotulados; (5) roteiro de testes com resultados esperados. Cubra edição rápida durante request lento, retorno ao valor anterior, resposta fora de ordem, HTTP 4xx/5xx, success:false, rede offline, GET inicial com falha, números inválidos/zero, duas abas, dois tenants, campos não expostos preservados, daemon indisponível após DB gravado, refresh/reinício e mídia antiga. Teste que botões conectar/iniciar/parar/reset/testar e upload/remoção continuam operacionais, e que nenhum falso sucesso é exibido. Não trate fila/debounce local como solução para concorrência entre clientes. Informe lacunas que exigem decisão de produto; não atribua capacidades ao backend sem confirmação no código.

## Verificações desta rodada

- Scripts inline de `control-panel.html`, `admin.html` e `docs.html` compilados com `vm.Script` (Node), sem erro de sintaxe.
- Fila exercitada com envio controlado/lento: uma requisição ativa por vez, edição durante envio, retorno ao valor anterior, preservação de campos não expostos, `success:false` sem commit e hidratação incompleta sem POST.
- Prévia de áudio exercitada com `Audio` simulado: reproduzir, parar, fim e erro. Markup gerado mantém IDs dos slots, não expõe URL/arquivo e contém handlers válidos.
- Comparação de IDs com HEAD confirma controles operacionais existentes; exceções intencionais são filtros antigos, UI de personalização de conexão e botões de salvar. IDs dinâmicos de áudio são conferidos no HTML gerado.
- `playConnectSound` comparado ao HEAD: função idêntica, incluindo configuração legacy e fallback. Catálogo testado para ID conhecido, mapeamento português e ID desconhecido.
- Inicialização completa do script executada com DOM/rede simulados, sem erro síncrono. `git diff --check` sem erro.
- Não houve teste com servidor/daemon autenticado nem inspeção visual em navegador. Upload real, reprodução real, aplicação no Python, persistência após refresh/reinício e concorrência entre abas continuam itens do roteiro de integração; testes simulados não confirmam esses comportamentos externos.
