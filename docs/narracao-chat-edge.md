# Narração de chat e charadas — Edge TTS

## Objetivo e estado

O TikTok fornece comentários como texto. O daemon Python deve limpar o texto e
enfileirá-lo no motor Edge TTS; o painel streamer reproduz os MP3 sequencialmente.
O OpenRouter permanece responsável somente pelo texto da charada. A voz da
charada e do chat compartilha `tts_voice` e `tts_rate`, persistidos em
`tenant_settings` e configurados em **Sons → Narração**.

O campo existente `chat_narr_enabled` habilita apenas a fala de comentários.
`chat_narr_mode` e `chat_narr_char` filtram comentários assim:

- `all`: narrar todos os comentários;
- `exclude`: narrar comentários que não começam com `chat_narr_char`;
- `only`: narrar apenas comentários que começam com `chat_narr_char`.

O controle `riddle_auto_narrate` continua independente: regula a reprodução
automática da charada, não a geração de voz nem a leitura do chat.

## Fluxos

### Chat

`on_comment` → filtro de narração → remoção de emoji e limpeza pelo helper
compartilhado de TTS → limite de tamanho → fila limitada por sessão → síntese
Edge com snapshot de voz/velocidade → evento `narrate` já existente → relay
Node `chat_narrate` para os clientes de log do painel → fila sequencial de áudio.
As filas do daemon e do painel aceitam no máximo 10 itens; itens expiram 10 s
após a chegada do comentário. Alterar ativação, filtro, voz ou velocidade limpa
itens pendentes; desconexão/reconexão do painel também limpa sua fila.

Comentários vazios depois da limpeza, comentários rejeitados pelos filtros e
comentários do próprio streamer não geram áudio. Partidas e tratamento de
palpites continuam independentes da fila de voz. O cache mantém no máximo 500
MP3s recentes por conta; áudios mais antigos são removidos para limitar disco.

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
| Resumo de atividade da fila | `chat` / `info` | `chat.tts.batch` | Contagens sintetizadas, filtradas, expiradas, descartadas e falhas; comprimento agregado; voz/taxa; duração; sessão |
| Fila excedeu o limite | `chat` / `warning` | `chat.tts.queue_full` / `TTS_CHAT_QUEUE_FULL` | Contagem descartada, limite e sessão; throttle de 30 s |
| Síntese de comentário falhou | `error` / `error` | `chat.tts.failed` / `TTS_CHAT_SYNTHESIS_FAILED` | Tipo da exceção, voz/taxa, duração e sessão; throttle de 5 s |
| Síntese da charada começou/concluiu | `diagnostic` / `debug` | `palavra.riddle.tts_started` / `palavra.riddle.tts_completed` | `trace_id`, `game_id`, estágio, tamanho do texto, voz/taxa e duração |
| Síntese da charada falhou | `error` / `error` | `tts.riddle_audio.failed` / `TTS_RIDDLE_SYNTHESIS_FAILED` | `trace_id`, estágio, tipo de exceção e duração |

Não emitir evento persistido por comentário nem logar comentário bruto, nome de
usuário, texto integral da charada, palavra secreta, prompt, credencial ou URL de
áudio. Contadores de alto volume são agregados e os avisos/erros têm throttle.
Preservar o payload e nomes dos eventos `narrate`, `chat_narrate` e
`riddle_audio`; os eventos de chat carregam URL de áudio, nunca o texto original.

## Testes e critérios de aceite

- Limpeza de emojis preserva letras acentuadas; emoji-only resulta em texto
  vazio; menções/URLs e textos longos seguem o helper compartilhado.
- Testar modos `all`, `exclude`, `only`, caractere configurado, narrador
  desativado e filtro do streamer.
- Fila é limitada, mantém ordem, não bloqueia o handler de comentários, expira
  mensagens antigas, limpa pendências ao alterar a configuração/desconectar e
  descarta excesso conforme a política definida.
- Mock da síntese confirma snapshot de voz/taxa para chat e charada, cache
  distinto por taxa e recuperação após falha.
- Validar taxa Edge enviada para 0,5x, 1x, 1,5x e 2x; reproduzir a mesma
  charada em cada valor e confirmar que a velocidade audível acompanha o
  controle de Sons.
- Painel reproduz fala serialmente; a charada preserva reprodução automática e
  replay manual no painel, sem duplicação; a página pública só mostra o texto.
  Filtros e configurações persistem por conta.
- Testar `/api/settings` → daemon → fila/síntese → evento WebSocket → áudio no
  painel. Após atualizar Node/daemon, validar logs no armazenamento e na
  interface durante sessão de teste.

## Dependência

Versão verificada em 2026-10-15: ambiente de desenvolvimento atualizado de
`edge-tts 7.2.8` para `7.3.1`, versão mais recente publicada no PyPI na
verificação. A versão está fixada em `python/requirements-tts.txt`. O ambiente
de produção requer a mesma atualização após o deploy. A síntese usa o serviço
online do Edge TTS; os MP3s são gerados e servidos pelo TikPlay.

## Validação executada

- Testes automatizados de filtros, fila limitada, exclusão do streamer, evento
  de entrega, snapshot de charada, privacidade do resumo e taxas Edge.
- Síntese real com `edge-tts 7.3.1` do mesmo texto de teste: 0,5x = 7,944 s;
  1x = 4,008 s; 1,5x = 2,688 s; 2x = 2,040 s (duração medida com `ffprobe`).
  A velocidade aumenta conforme o valor de Sons.
- Ativação na VPS e confirmação do evento na interface ao vivo dependem do
  próximo deploy/restart seguro; o processo de produção não foi reiniciado nesta
  tarefa.
