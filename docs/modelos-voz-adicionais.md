# Gestão de modelos de voz adicionais

## Escopo e contrato

Super Admin controla individualmente quais vozes aparecem no painel dos streamers,
agrupadas por tipo e modelo. O streamer escolhe uma voz aprovada em uma única lista;
ele não escolhe o modelo. O acesso individual e o saldo de créditos são controlados
por streamer. O modelo padrão da conta permanece inalterado até o streamer selecionar
uma voz adicional.

Catálogo inicial:

- Personalizada: ElevenLabs v4 Turbo, vozes da conta ElevenLabs global existente.
- Padrão: HeyGen Voice Turbo, Kokoro 82M e Gemini 3.8 Flash Lite TTS via OpenRouter.

O catálogo destinado a clientes só expõe vozes que o administrador aprovou. No Kokoro,
o único ID atualmente confirmado por audição como português brasileiro é `pm_santa`;
prefixos `pf_*`/`pm_*` só identificam a família de idioma, não distinguem sotaque do
Brasil e de Portugal. No HeyGen, o catálogo OpenRouter fornece IDs sem metadados de
idioma/sotaque por voz. Após teste auditivo do administrador, as dez vozes padrão não
soaram brasileiras, portanto o modelo não fornece opções para PT-BR até haver uma voz
confirmada. Detectar português no texto não garante sotaque brasileiro.

Gemini 3.8 Flash Lite TTS lista 30 nomes de vozes sem metadados de idioma por voz.
O catálogo administrativo mostra todas para prévia, marcadas como multilíngues com
PT-BR pendente de confirmação auditiva. Só liberar uma voz aos clientes depois de
ouvir sua prévia com a amostra fixa brasileira. A cobrança depende da tarifa definida
no admin para cada modelo e do número de caracteres efetivamente enviados; cache hit
não gera nova cobrança.

ElevenLabs busca as vozes da conta sem filtro upstream de sotaque e classifica pelos
metadados locais, reconhecendo valores como `brazilian`, `pt-brazilian` e `pt-BR`.
Vozes próprias da conta sem metadados de idioma continuam visíveis somente no painel
admin, com indicação de idioma não identificado, para teste manual. A síntese usa
`language_code: "pt"`; o administrador decide quais opções aprovadas oferece aos
streamers. A prévia fixa contém texto em português brasileiro para facilitar a audição.

O catálogo de provedores/modelos tem IDs fixos em `node/lib/additional-voice-models.json`;
o admin seleciona as vozes individuais do catálogo atual e essa lista fica em
`additional_voice_options`. Clientes não podem fornecer endpoints, provedores, modelos
ou vozes arbitrários. Opções do OpenRouter são validadas contra
`GET /api/v1/models?output_modalities=speech`; OpenRouter usa a chave
`OPENROUTER_API_KEY` já configurada no servidor. Nenhuma credencial vai ao navegador.
HeyGen disponibiliza apenas vozes padrão com a chave da plataforma; clonagem HeyGen
exige credencial própria e não faz parte desta integração.

## Emoção no fim da mensagem

Na narração do chat, uma hashtag de emoção reconhecida no fim da mensagem é removida
do texto falado e enviada como orientação de interpretação à voz adicional quando o
provedor/modelo oferece suporte. Por exemplo, `Eu tô doida pra ir embora #grito` fala
somente a frase e pede uma interpretação gritada. O Gemini recebe uma instrução de
estilo em português; ElevenLabs recebe a tag de áudio correspondente, nos modelos v3/v4
compatíveis. A lista é permitida pelo servidor (inclui `#grito`, `#feliz`, `#animado`,
`#triste`, `#raiva`, `#sussurro`, `#medo`, `#surpresa`, `#rindo`, `#sarcasmo`, `#calmo`,
`#curioso` e `#chorando`, além de alguns sinônimos em português). Hashtags desconhecidas
ou que não estejam no final permanecem texto normal; conteúdo do chat nunca é usado como
instrução livre ao provedor. A emoção não altera a contagem de caracteres falados.

O Gemini 3.8 Flash Lite aceita somente PCM no endpoint de fala (MP3 retorna HTTP 400).
Prévia administrativa e síntese do chat solicitam PCM e o convertem para WAV mono de
24 kHz antes de reproduzir/servir o áudio.

## Mapa de observabilidade

| Ação/transição | Evento | Categoria/nível | Correlação/detalhes permitidos |
|---|---|---|---|
| Admin libera ou revoga vozes individuais | `tts.models.config_saved` / `tts.models.config_rejected` | `diagnostic`/`info`; `notice`/`warning` | `trace_id`, ator admin, IDs de modelos e quantidade de vozes; nunca chave ou corpo bruto |
| Admin ouve uma prévia | `tts.admin_voice_preview.completed` / `tts.admin_voice_preview.failed` / `tts.admin_voice_preview.rejected` | `diagnostic`/`info`; `error`/`error`; `notice`/`warning` | `trace_id`, ID do modelo, provedor e código; amostra fixa, limite de 1 chamada a cada 1,5 s por admin; nunca texto de chat, chave ou resposta do provedor |
| Streamer salva uma voz aprovada | `tts.provider.preference_saved` | `diagnostic`/`debug` | tenant autenticado, ID do modelo e tipo; sem texto de chat |
| Teste ou síntese falha | `tts.provider.failed` / `tts.provider.fallback` | `error`/`error`; `notice`/`warning` | `trace_id`, código estável, operação/modelo; sem mensagem, credencial ou resposta do provedor |
| Admin define a tarifa de um modelo | `tts.credits.model_cost_saved` | `billing`/`info` | modelo, tarifa anterior/nova e ator admin; sem texto de chat |
| Admin salva pacotes | `tts.credits.packages_saved` / `tts.credits.packages_rejected` | `diagnostic`/`info`; `notice`/`warning` | ator e quantidade/IDs; sem dados de pagamento |
| Admin ajusta saldo | `tts.credits.adjusted` / `tts.credits.adjustment_rejected` | `system`/`info`; `notice`/`warning` | tenant, ator, valor e saldo final |
| Compra por Mercado Pago | `tts.credits.checkout_created` / `tts.credits.purchase_approved` / `tts.credits.purchase_rejected` | `billing`/`info`; `notice`/`warning` | tenant, pacote, valor em centavos, ID do pagamento e créditos; sem dados de cartão |
| Uso agregado da narração | `chat.tts.batch` existente | `chat`/`info` | contagem agregada por janela existente; nenhum evento por mensagem |

## Carteira de créditos

As regras de carteira, tarifa por 100 caracteres, histórico, ajustes, compras avulsas
no Mercado Pago, confirmação idempotente do webhook e limites de segurança estão em
`creditos-voz.md`. Super Admin configura créditos por 100 caracteres em cada modelo e
pacotes de créditos; o painel streamer mostra saldo, preço da voz selecionada, pacotes
e as cinco movimentações mais recentes. Uma síntese paga debita antes da chamada ao
provedor, somente após verificar cache e permissão. O preço é `ceil(caracteres × tarifa
/ 100)`, com mínimo de um crédito; falhas depois do início da chamada não são estornadas,
pois o provedor pode ter cobrado. O esquema de caracteres mensal é preservado apenas
para compatibilidade histórica; o fluxo de produção não o consulta.

Falhas de catálogo são limitadas pelo cache de cinco minutos e falhas repetidas de
provedor mantêm o throttle de 30 segundos já usado. A API e o daemon conferem a
aprovação por voz; uma revogação bloqueia a síntese e remove a seleção da lista do cliente.
Não logar áudio, comentário bruto,
chave, URL autenticada, payload ou corpo de erro do provedor.

## Validação

O checklist funcional cobre autenticação admin, seleção de vozes específicas, catálogo
dinâmico, seleção PT-BR auditada, rejeição de voz fora do catálogo filtrado, revogação e
síntese no daemon sem chamadas pagas. Não inferir sotaque brasileiro apenas pelo código
de idioma do Kokoro ou pela capacidade multilíngue do HeyGen. Vozes ElevenLabs de terceiros
sem sotaque brasileiro ficam ocultas; vozes próprias sem metadados ficam visíveis ao admin
com indicação explícita para teste manual.
O primeiro uso real de cada modelo requer prévia manual na conta OpenRouter, pois
provedores podem alterar catálogo, formato e preço.

## Gemini TTS no catálogo admin — 2026-10-16

Adicionado `google/gemini-3.8-flash-lite-tts` ao catálogo. O Super Admin carrega as
vozes suportadas em `GET /api/v1/models?output_modalities=speech` e testa cada uma
por `POST /api/admin/tts/voice-preview`; o salvamento automático da allowlist existente
permite, depois da audição, disponibilizar individualmente as aprovadas aos streamers.
O preview usa a mesma amostra em português brasileiro. O catálogo lista todas as 30
vozes porque o endpoint não identifica localidade individual; cada card mostra que o
teste de sotaque PT-BR é manual.

Mapa de observabilidade: usa `tts.admin_voice_preview.completed`, `failed` e `rejected`
existentes (com `trace_id`, modelo, provedor e código seguro); a aprovação usa
`tts.models.config_saved`/`tts.models.config_rejected`. Sem novos eventos nem conteúdo
de áudio ou texto de narração nos logs. Teste da rota cobre catálogo, idioma pendente e
pedido de áudio no modelo Gemini com resposta mockada; síntese ao vivo depende da chave
OpenRouter configurada e deve ser confirmada pelo admin no painel.

## Estado do preview administrativo — 2026-10-16

Os cards do Super Admin usam grade responsiva, nomes em maiúsculas, botão circular
de play com rótulos acessíveis e chave liga/desliga com contraste legível. O cliente
prepara o contexto de áudio no clique antes da requisição, permite interromper a
reprodução e descarta respostas de chamadas anteriores.

Diagnóstico desta execução: `POST /api/admin/tts/voice-preview` no servidor local
retornou HTTP 404 até sem autenticação, ou seja, o processo ativo não conhece a rota
presente no código. O navegador pode validar a falha e orientar o operador, mas a
reprodução real só pode ser confirmada depois de carregar a versão atual do servidor;
reiniciar o processo durante uma live não foi feito por segurança operacional.

Correção do 502 no preview do HeyGen: OpenRouter retornou HTTP 400 ao receber
`response_format: "mp3"`, informando que HeyGen aceita somente `pcm`. O preview desse
modelo agora solicita PCM e o servidor o envolve em WAV mono de 44,1 kHz; Kokoro e os
demais modelos continuam pedindo MP3. Teste da rota mockado e uma síntese curta real
com HeyGen confirmaram status 200 e áudio PCM não vazio.

Correção de catálogo PT-BR — 2026-10-16: HeyGen não fica disponível aos clientes até
confirmar sotaque brasileiro; Kokoro fica em allowlist somente com `pm_santa`. Na
ElevenLabs, `accent=brazilian` retornava 13 vozes da biblioteca e omitira a voz própria
Inêz (`pt-brazilian`). A chave configurada lista uma voz própria no momento; a consulta
sem filtro upstream reconhece Inêz e preserva vozes próprias sem metadados para audição
no admin. Coberto por teste de rota mockado; clientes continuam vendo somente vozes
aprovadas pelo administrador.

Diagnóstico do preview Gemini — 2026-10-16: o endpoint real do OpenRouter rejeitou
`response_format: "mp3"` com HTTP 400 (“only supports ... pcm”). A prévia admin e a
síntese de chat agora solicitam PCM e encapsulam o resultado em WAV mono 24 kHz. Teste
real curto retornou HTTP 200, `audio/pcm` e 117120 bytes; teste de rota verifica o WAV.
O servidor Node/Python foi reiniciado para carregar a correção.
