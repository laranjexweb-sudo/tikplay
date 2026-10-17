# UX de Integrações — Super Admin

## Escopo

A seção `#adminRules` organiza os serviços externos, credenciais, catálogo de vozes e sincronização global de presentes. A alteração é de interface: os mesmos endpoints e handlers continuam responsáveis por testes, configuração, autosave das vozes e sincronização. Pacotes e créditos continuam na seção própria.

## Contratos preservados

- OpenRouter: `GET/PUT /api/admin/integrations`, `PUT /api/admin/integrations/openrouter` e `POST /api/admin/integrations/openrouter/test`.
- ElevenLabs: `GET/PUT /api/admin/integrations/elevenlabs` e `POST /api/admin/integrations/elevenlabs/test`.
- Mercado Pago: estado, salvamento e teste nas rotas `/api/admin/integrations` e `/api/admin/integrations/mercadopago`.
- Vozes: `GET/PUT /api/admin/tts/additional-models`; campos de voz e tarifa permanecem no DOM mesmo quando a busca apenas oculta linhas.
- Presentes: `GET /api/gifts?all=1` e `POST /api/gifts/sync`.

As credenciais continuam sendo inputs `password`; a interface apresenta exclusivamente as máscaras devolvidas pelo backend. A edição usa `<details>` fechado por padrão. O estado “Conectado” representa credencial configurada; resultado de teste é exibido em área própria e não troca o estado salvo. Data e resultado do teste ficam somente em memória enquanto a tela está aberta; nenhum segredo é persistido pelo frontend.

Filtros por fornecedor, modelo, idioma e estado, além da busca textual, ocultam visualmente as linhas sem removê-las. “Liberar filtradas” e “Bloquear filtradas” atuam sobre as linhas visíveis e invocam uma única vez o autosave existente; vozes indisponíveis não podem ser liberadas em massa. Os filtros e a busca são preservados quando o servidor confirma o autosave.

O status do catálogo de presentes apresenta última sincronização, contagem atual e resumo seguro do resultado da rotina. Os campos históricos `last_sync_result` podem estar em formato de representação de dicionário Python e não JSON; nesse caso, mostrar horário e contagem continua possível e o texto bruto não é interpretado como erro.

## Mapa de observabilidade

Essa mudança não cria ação operacional nova: apenas reorganiza controles existentes. Portanto, não adiciona categorias, níveis ou eventos persistidos, telemetria de navegador ou logs de segredo. As ações continuam produzindo exatamente os eventos/logs dos endpoints e serviços existentes. A confirmação visual de teste usa estado transitório em memória no navegador; erros são apresentados inline pela resposta existente, sem marcar a credencial salva como não configurada.

Dados permitidos na interface: estado configurado, origem de configuração, máscara parcial, nome da conta retornado pelo teste, horário/result do teste em memória, tarifa, estado de voz e contagens agregadas. Segredos completos, payloads de requisição e respostas brutas de fornecedores não são armazenados nem logados pela tela.

Validação: JavaScript embutido passa `node --check`; `node/tests/additional-voice-models.test.js` e `node/tests/admin-integrations.test.js` passam; inspeção do painel autenticado local confirmou estados, credenciais mascaradas, 53 vozes carregadas e catálogo com 767 presentes.
