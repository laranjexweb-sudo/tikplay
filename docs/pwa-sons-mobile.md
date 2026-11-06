# PWA TikPlay — Live e sons no celular

> 2026-11-02: Área de conexão reorganizada com espaçamento vertical uniforme entre instrução, status, usuário, botões e mensagem de estado. Alteração somente visual; rotas, eventos, telemetria e comportamento de conexão não mudaram.

> 2026-11-02: App mobile agora diferencia liberar reprodução local de pausar a fila; inclui ativação da narração do chat, seleção/teste de vozes expressivas autorizadas e amplificação da narração até 300%. Preferências são compartilhadas com o painel web pelos endpoints existentes; nenhum evento novo foi adicionado. Cache do shell atualizado.

> 2026-11-06: Configuração da narração do chat ganhou estratégia compartilhada entre painel e PWA: voz padrão, expressiva ou ambas; com ambas, o prefixo direciona à expressiva e mensagens sem prefixo usam a padrão. Nas estratégias de voz única, é possível narrar todas ou somente mensagens com prefixo. Cache do shell atualizado.

## Escopo

Página instalável em Android (`/sons-mobile`) para o streamer conectar/desconectar a TikTok Live, liberar e pausar reprodução no celular, ajustar volume, voz, velocidade da narração e testar sons de presentes/ações. O cadastro e a troca de arquivos de sons permanecem no painel para computador. Credenciais, configuração, ingestão do chat e TTS continuam sob responsabilidade dos endpoints e eventos já existentes; o cliente PWA não persiste username nem conteúdo de chat localmente.

## Fluxo e contratos reutilizados

- Login: `localStorage.token` existente; API autenticada com Bearer e WebSocket `/logs?token=…`.
- Estado inicial: `GET /api/panel-config`, `/api/settings`, `/api/game-state`, `/api/sound-alerts`, `/api/action-sound-alerts`.
- Conectar: salvar username via `POST /api/panel-config`, ativar áudio em gesto explícito e chamar `POST /start-game`.
- Desconectar: `POST /stop-game`.
- Preferências de voz: `GET /api/settings` e `POST /api/settings` atualizam voz padrão, taxa, estratégia (`chat_narr_voice_strategy`), escopo (`chat_narr_expressive_mode`), prefixo (`chat_narr_expressive_prefix`) e, quando alterado, volume; o servidor mescla os demais campos já salvos.
- Narração do chat: `chat_narr_enabled` salvo em `POST /api/settings`, compartilhado com o painel web. `tts_volume` suporta o ganho já existente de 0 a 300% e a saída local usa Web Audio acima de 100% quando disponível.
- Voz expressiva: catálogo e preferência via `GET`/`PUT /api/tts/elevenlabs`; teste via `POST /api/tts/elevenlabs/test`. O backend continua validando vozes liberadas e tarifas; a PWA não expõe vozes bloqueadas. O streamer pode usar apenas a voz padrão, apenas a expressiva (em todas as mensagens ou somente com prefixo), ou ambas; no modo ambas, prefixo usa expressiva e sem prefixo usa Edge TTS gratuito.
- Estado/eventos: mensagens existentes `status`, `chat_narrate`, `gift_event`, `action_alert_event`, `riddle_ready`, `riddle_audio`, `tts_test_ready`, `sound_alerts_updated` no WebSocket autenticado `/logs`.
- `/sons-mobile` redireciona para a URL canônica `/sons-mobile/`, que está dentro do escopo do manifesto e do service worker. Ícones PNG de 192×192 e 512×512 ficam em `/assets/pwa/`; iOS usa `apple-touch-icon` 180×180 para o atalho da tela inicial. A página mantém o fundo escuro também na raiz do documento e usa rolagem sem fundo fixo; botões de teste usam indicador CSS em vez de emoji. O service worker armazena somente o shell da PWA. Respostas da API, WebSocket, `/tts-audio/` e `/alert-audio/` ficam explicitamente fora do cache.

## Mapa de observabilidade

| Transição | Evidência/resultado | Categoria/nível/evento |
| --- | --- | --- |
| Solicitação para conectar | Rotas atuais registram início/aceite/rejeição e trace no backend | `connection` conforme contrato existente |
| Mudança de status recebida | Atualização visual a partir do evento `status` atual | Nenhum log novo; evento já existente |
| Desconectar | Rota atual emite resultado e atualiza estado compartilhado | `connection` conforme contrato existente |
| Socket fecha/reconecta | Indicador local e retry de 2,5 s; sem persistência de URL/ticket | Apenas estado local, sem log técnico persistido |
| Áudio reproduz ou falha | Estado local mostra disponibilidade/falha; fila limitada a 12 e throttle de feedback de erro | Sem adicionar eventos por áudio/chat ao histórico |
| API retorna 401 | Token local removido e redirecionamento para login | Evento/autenticação existente |
| Preferências da narração mudam | Configuração mesclada pelo endpoint existente | Nenhum evento novo; mesma configuração usada no painel |
| Voz expressiva selecionada/testada | Endpoints existentes validam o catálogo liberado e registram auditoria de TTS | Eventos de TTS já existentes |
| Estratégia/escopo da voz alterado | Estratégia/modo/prefixo persistidos via `/api/settings`; fila do daemon limpa após a mudança | `chat.tts.batch` agrega contagens por rota, sem log por comentário |

Dados proibidos em logs novos: token, username, URL de áudio assinada, conteúdo de comentário e payload bruto do TikTok. Volume: nenhum novo evento de servidor, log por chat, por gift, ou por reprodução. Não há mudança de correlação nem de taxonomia; todos os comandos de live permanecem no fluxo atual.

## Limitações conhecidas

- O Android exige HTTPS para instalação PWA e Service Worker; em HTTP a página ainda pode funcionar sem instalação.
- A tela deve permanecer aberta e o áudio deve ser liberado com interação do usuário. O sistema pode suspender uma PWA com a tela bloqueada; não é um serviço nativo Android em segundo plano.
- O áudio do próprio aplicativo pode não ser incorporado pelo TikTok em todos os aparelhos/modos de transmissão. A PWA controla a reprodução local, mas não controla o roteamento interno de áudio do TikTok.
- O cache offline cobre somente a casca visual. Conectar, receber eventos e buscar arquivos requer rede.

## Validação da funcionalidade

- Abrir `/sons-mobile` sem token e confirmar redirecionamento para login.
- Com login ativo, validar username, estado inicial e lista de sons configurados.
- Conectar e desconectar; confirmar que o painel existente recebe o mesmo status.
- Validar narração, gift normal/combos, alertas por ação, fila, volume, pausa, reconexão do WebSocket e 401.
- No Android com HTTPS, instalar pelo Chrome, reabrir e verificar manifesto; checar que `/api`, eventos e arquivos de áudio não são servidos do cache.
- Durante uma live de teste, verificar separadamente se o TikTok captura o áudio de saída da PWA junto ao microfone.
