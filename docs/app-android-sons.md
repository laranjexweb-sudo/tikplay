# App Android TikPlay Sons

## Plano de implementação e observabilidade

- Objetivo: abrir a PWA atual dentro do Android e manter a reprodução de alertas/narração em um serviço Android de primeiro plano.
- Fluxo: ativação pelo botão existente inicia o serviço; o serviço busca configurações de alertas com a API autenticada, conecta ao `/logs` autenticado e reproduz URLs permitidas; botões e notificação pausam, retomam ou encerram o serviço.
- Eventos consumidos: `status`, `chat_narrate`, `gift_event`, `action_alert_event`, `riddle_ready`, `riddle_audio`, `tts_test_ready` e `sound_alerts_updated`. Não se cria outro backend nem evento de servidor.
- Resultado visível: notificação contínua de reprodução; a tela continua exibindo status pelo WebSocket que já usa. Erros de conexão de áudio atualizam a notificação e o estado local da página.
- Dados permitidos no cliente: URL base fixa, token em memória do serviço enquanto ativo, caminhos de áudio e tipos de evento. Nunca registrar token, comentários, URL completa com credencial ou payload bruto.
- Volume: sem log por áudio ou comentário. Reconexão do socket limitada a uma tentativa a cada 2,5 s; fila local limitada a 12 itens.
- Validação de entrega: build debug; instalação em aparelho Android; bloquear tela, gerar narração/presente e confirmar reprodução e controles da notificação; confirmar que a sessão de login é do WebView do app.

## Arquitetura

- `node/mobile-android/` é um projeto Android independente do servidor Node.
- A tela visual vem de `https://tikplay.com.br/sons-mobile/`; fora do app, a PWA continua usando o player web normalmente.
- O app habilita a ponte `TikPlayNative` apenas para páginas TikPlay. O serviço nativo abre seu próprio WebSocket autenticado e usa ExoPlayer para tocar áudio.
- Ao confirmar que o WebSocket nativo está conectado, o JavaScript não reproduz os mesmos eventos localmente, evitando áudio duplicado. Testes iniciados na tela são enviados diretamente ao player nativo.
- O serviço usa apenas caminhos `/alert-audio/` e `/tts-audio/` do domínio `tikplay.com.br`; hosts externos e tráfego HTTP sem TLS são rejeitados.
- Token mantido somente em memória enquanto o serviço está ativo; não é escrito em preferências nem incluído em logs.

## Limitações

- O serviço mantém o app tocando em segundo plano; isso não garante que TikTok Live capture o áudio de saída de outro app como áudio da transmissão. Esse roteamento depende do aparelho, da versão do Android e da forma como o TikTok abre a live; precisa de teste real.
- Economia de bateria do fabricante pode interromper conexões de rede, ainda que a reprodução use serviço de primeiro plano.
- O WebView do app tem seu próprio armazenamento. O usuário precisa entrar uma vez no app; a sessão do Chrome/PWA não é compartilhada.
- O APK debug serve para validar em aparelhos. Para distribuição pública, gerar assinatura própria persistente e preparar o registro de desenvolvedor Android indicado para distribuição fora da Play Store.


## Estado do build

- Compilação `assembleDebug` concluída com sucesso em 2026-11-07.
- Arquivo: `node/mobile-android/app/build/outputs/apk/debug/app-debug.apk` (4,2 MB, assinatura debug).
- Ainda precisa instalar e validar num telefone real com a live. O Android Studio não tem um emulador configurado neste ambiente.
