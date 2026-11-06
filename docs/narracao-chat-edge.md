# Narração de chat e charadas — Edge TTS

## Objetivo e estado

O TikTok fornece comentários como texto. O daemon Python deve limpar o texto e
enfileirá-lo no motor Edge TTS; o painel streamer reproduz os MP3 sequencialmente.
O OpenRouter permanece responsável somente pelo texto da charada. A voz da
charada e do chat compartilha `tts_voice`, `tts_rate` e `tts_volume`, persistidos em
`tenant_settings` e configurados em **Sons → Narração**.

O campo existente `chat_narr_enabled` habilita apenas a fala de comentários.
Os campos legados `chat_narr_mode` e `chat_narr_char` permanecem no contrato por
compatibilidade, mas o painel não os expõe: a regra única de seleção usa
`chat_narr_expressive_mode` e `chat_narr_expressive_prefix`. Ao carregar as
preferências existentes, o painel normaliza os campos legados para `all` e `#`
para evitar que um filtro antigo se sobreponha à opção de prefixo. Os valores
legados significam:

- `all`: narrar todos os comentários;
- `exclude`: narrar comentários que não começam com `chat_narr_char`;
- `only`: narrar apenas comentários que começam com `chat_narr_char`.

`chat_narr_voice_strategy` escolhe a voz e `chat_narr_expressive_mode` define o
escopo nas estratégias de uma única voz. Essa é a única regra de seleção exposta
no painel:

- `standard`: usa somente a voz Edge gratuita. Com `chat_narr_expressive_mode=all`,
  narra todas as mensagens que passaram pelos filtros; com `prefix`, narra apenas
  as que começam com `chat_narr_expressive_prefix` (padrão `!`). O prefixo é
  removido antes da fala.
- `expressive` (padrão): usa somente a voz expressiva selecionada. Com modo `all`,
  narra todas as mensagens; com `prefix`, narra apenas as iniciadas pelo prefixo.
- `both`: narra todas as mensagens; as iniciadas pelo prefixo usam a voz
  expressiva e têm o prefixo removido, e as demais usam diretamente a voz Edge
  gratuita, sem consumir TikCoins.
- A ausência de uma voz expressiva habilitada não altera o roteamento solicitado;
  a interface informa que a opção não está disponível, e o serviço de voz mantém
  o fallback de provedor já existente.
- O prefixo expressivo aceita qualquer caractere não branco, inclusive `#`.
  Prefixo no início e tag de emoção reconhecida no fim são tratados em posições
  distintas; as tags de emoção continuam sendo removidas antes da fala.
- Se a voz expressiva falhar ou ficar indisponível, mantém-se o fallback Edge
  existente. A cobrança segue o modelo escolhido e os caracteres efetivamente
  falados; mensagens encaminhadas diretamente ao Edge não passam pela carteira.

O controle `riddle_auto_narrate` continua independente: regula a reprodução
automática da charada, não a geração de voz nem a leitura do chat.

O volume fica entre 0% e 300% em **Sons → Narração** (padrão 100%) e se aplica
às narrações TTS reproduzidas no painel, incluindo chat, charadas e prévias de
voz. Web Audio aplica o ganho depois de decodificar/reproduzir o MP3; valores
acima de 100% podem causar clipping conforme a gravação e a saída de áudio.
Alertas sonoros por presente mantêm o volume próprio deles.

## Fluxos

### Chat

`on_comment` → filtro de narração → remoção de emoji e limpeza pelo helper
compartilhado de TTS → limite de tamanho → fila limitada por sessão → síntese
Edge com snapshot de voz/velocidade → evento `narrate` já existente → relay
Node `chat_narrate` para os clientes de log do painel → fila sequencial de áudio.
As filas do daemon e do painel aceitam no máximo 10 itens; itens expiram 10 s
após a chegada do comentário. Alterar ativação, filtro, voz, velocidade ou rota
expressiva limpa itens pendentes; desconexão/reconexão do painel também limpa
sua fila.

Comentários vazios depois da limpeza e comentários de espectadores rejeitados
pelos filtros de seguidor/Heart Me não geram áudio. Comentários enviados pela
própria conta streamer podem ser narrados mesmo quando os metadados de seguidor
ou fã-clube não vêm no evento, permitindo testar a fala; esse bypass vale somente
para narração e não libera participação nos jogos. Partidas e tratamento de
palpites continuam independentes da fila de voz. O cache mantém no máximo 500
MP3s recentes por conta; áudios mais antigos são removidos para limitar disco.

Para TikTokLive, a extração de seguidor prioriza `user.follow_info.follow_status`
sobre o possível `user.follow_status` padrão do protobuf. Assim, um zero default
no campo superior não sobrescreve o status positivo informado no relacionamento
aninhado. A elegibilidade continua fail-closed quando ambos estão ausentes; o
evento agregado `chat.tts.batch` distingue `access_filtered`, `queued`,
`standard_routed`/`expressive_routed`, `synthesized` e `failed`, sem registrar
texto ou identidade do comentarista.

No filtro Heart Me, `FansClubData.user_fans_club_status` usa `0=NOTJOINED`,
`1=ACTIVE` e `2=INACTIVE`. Se o status `NOTJOINED` for apenas o valor default,
mas o mesmo evento trouxer `FansClubInfo.fans_level > 0` e `is_sleeping=false`,
o sinal legado de membro ativo é aceito. O estado `INACTIVE` explícito continua
bloqueando. O adaptador TikTools aplica a mesma precedência.

### Charada

OpenRouter gera somente o texto → snapshot da configuração TTS no início da
narração → mesmo helper Edge usado pelo chat → evento existente `riddle_audio`
→ somente o painel streamer. A página pública/OBS mantém a charada em texto e
nunca recebe nem reproduz o áudio.

O snapshot impede uma alteração de preferência durante a geração assíncrona de
fazer a fala usar outra taxa. A chave do cache de áudio inclui texto, voz e taxa.

## Mapa de observabilidade

| Transição | Categoria / nível | Evento / código | Campos permitidos |
|---|---|---|---|
| Resumo de atividade da fila | `chat` / `info` | `chat.tts.batch` | Contagens sintetizadas, filtradas, expiradas, descartadas e falhas; contagens agregadas roteadas à voz padrão/expressiva; comprimento agregado; voz/taxa/modo; duração; sessão |
| Fila excedeu o limite | `chat` / `warning` | `chat.tts.queue_full` / `TTS_CHAT_QUEUE_FULL` | Contagem descartada, limite e sessão; throttle de 30 s |
| Síntese de comentário falhou | `error` / `error` | `chat.tts.failed` / `TTS_CHAT_SYNTHESIS_FAILED` | Tipo da exceção, voz/taxa, duração e sessão; throttle de 5 s |
| Síntese da charada começou/concluiu | `diagnostic` / `debug` | `palavra.riddle.tts_started` / `palavra.riddle.tts_completed` | `trace_id`, `game_id`, estágio, tamanho do texto, voz/taxa e duração |
| Síntese da charada falhou | `error` / `error` | `tts.riddle_audio.failed` / `TTS_RIDDLE_SYNTHESIS_FAILED` | `trace_id`, estágio, tipo de exceção e duração |
| Preferência de volume salva | fluxo existente de configurações | `POST /api/settings` → `update_settings` | `tenant_id` autenticado e preferência numérica entre 0 e 3; sem novo log por movimento do slider |

Não emitir evento persistido por comentário nem logar comentário bruto, nome de
usuário, texto integral da charada, palavra secreta, prompt, credencial ou URL de
áudio. Contadores de alto volume são agregados e os avisos/erros têm throttle.
Preservar o payload e nomes dos eventos `narrate`, `chat_narrate` e
`riddle_audio`; os eventos de chat carregam URL de áudio, nunca o texto original.

## Testes e critérios de aceite

- Limpeza de emojis preserva letras acentuadas; emoji-only resulta em texto
  vazio; menções/URLs e textos longos seguem o helper compartilhado.
- Testar modos `all`, `exclude`, `only`, caractere configurado, narrador
  desativado, comentários enviados pelo streamer com filtros ligados e bloqueio
  de espectadores sem os requisitos de seguidor/Heart Me.
- Testar as estratégias `standard`, `expressive` e `both`, combinadas com os
  escopos `all` e `prefix` quando aplicáveis. Em `both`, sem prefixo usa Edge e
  com prefixo usa a voz expressiva; em estratégia única, o escopo selecionado
  determina quais mensagens são narradas. Confirmar remoção do prefixo antes da
  fala e que a rota Edge não consulta nem debita a carteira.
- Testar prefixo inválido/reservado, emoção final, voz não selecionada/desabilitada
  e fallback do provedor; validar preferência no painel web, PWA e após hidratação
  de uma sessão do daemon.
- Fila é limitada, mantém ordem, não bloqueia o handler de comentários, expira
  mensagens antigas, limpa pendências ao alterar a configuração/desconectar e
  descarta excesso conforme a política definida.
- Mock da síntese confirma snapshot de voz/taxa para chat e charada, cache
  distinto por taxa e recuperação após falha.
- Validar taxa Edge enviada para 0,5x, 1x, 1,5x e 2x; reproduzir a mesma
  charada em cada valor e confirmar que a velocidade audível acompanha o
  controle de Sons.
- Validar volume em 0%, 100% e 300% em narração Edge e voz adicional, persistência
  por conta e atualização do ganho durante reprodução; confirmar que alertas de
  presentes não herdam o ganho de TTS.
- Painel reproduz fala serialmente; a charada preserva reprodução automática e
  replay manual no painel, sem duplicação; a página pública só mostra o texto.
  Filtros e configurações persistem por conta.
- Testar `/api/settings` → daemon → fila/síntese → evento WebSocket → áudio no
  painel. Após atualizar Node/daemon, validar logs no armazenamento e na
  interface durante sessão de teste.

### Mapa de observabilidade do roteamento de vozes

- A decisão de rota é agregada nos campos `standard_routed` e `expressive_routed`
  do evento periódico existente `chat.tts.batch` (`chat`/`info`); não há evento
  por comentário.
- Falhas de síntese usam `chat.tts.failed` (`error`/`error`) com o código atual;
  a indisponibilidade recuperável da voz mantém o aviso throttled
  `tts.provider.fallback` (`notice`/`warning`).
- Correlação usa a sessão do tenant. Logs não incluem comentário, usuário,
  prefixo digitado nem URL de áudio; somente o modo agregado pode aparecer em
  `details.configurations`.
- Configurações agregadas podem incluir estratégia e escopo, sem armazenar o
  caractere de prefixo nem texto de comentário. Alterar estratégia, modo ou
  prefixo limpa itens pendentes via reset existente. Não são
  criados eventos WebSocket nem tabelas de histórico.

## Dependência

Versão verificada em 2026-10-15: ambiente de desenvolvimento atualizado de
`edge-tts 7.2.8` para `7.3.1`, versão mais recente publicada no PyPI na
verificação. A versão está fixada em `python/requirements-tts.txt`. O ambiente
de produção requer a mesma atualização após o deploy. A síntese usa o serviço
online do Edge TTS; os MP3s são gerados e servidos pelo TikPlay.

## Validação executada

- Testes automatizados de filtros, fila limitada, inclusão do streamer, evento
  de entrega, snapshot de charada, privacidade do resumo e taxas Edge.
- Síntese real com `edge-tts 7.3.1` do mesmo texto de teste: 0,5x = 7,944 s;
  1x = 4,008 s; 1,5x = 2,688 s; 2x = 2,040 s (duração medida com `ffprobe`).
  A velocidade aumenta conforme o valor de Sons.
- Ativação na VPS e confirmação do evento na interface ao vivo dependem do
  próximo deploy/restart seguro; o processo de produção não foi reiniciado nesta
  tarefa.
