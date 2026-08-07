# TikPlay

Plataforma de jogos interativos para lives do TikTok. O público participa pelo chat e por presentes, e tudo aparece em tempo real na tela (pronta para captura via OBS).

## Jogos

- **Palavra Secreta** — adivinhe a palavra por similaridade; presente de tamanho, meta de tap, rodada automática, ranking semanal e da live.
- **BATALHA** — rodada de Tap (curtidas) × Moeda (presentes); Top 1 de cada.
- **Caça Palavras** — grade com palavras escondidas; público informa coordenadas.
- **Bichinho Virtual** — mascote que evolui e luta contra boss; modo assistente.
- **Jogo dos 3 Pontinhos** — 3 dicas progressivas; presentes revelam tamanho/letra; ingresso libera chat.

## Stack

- **Backend**: Node.js (Express + WebSocket) + Python (daemon de jogo)
- **IA/Similaridade**: spaCy (`pt_core_news_lg`)
- **TTS**: gTTS / Piper / Edge / Kokoro
- **Banco**: SQLite
- **Pagamentos**: Mercado Pago (assinaturas)

## Estrutura

```
node/     # servidor HTTP + WS (porta única), painel, páginas públicas
python/   # motor dos jogos (service.py, game.py, tts.py, etc.)
```

## Deploy (resumo)

1. Clone o repositório.
2. `cd node && npm install`
3. Python: `python3 -m venv venv && venv/bin/pip install -r <deps>` + `spacy download pt_core_news_lg`
4. Copie `node/.env.example` para `node/.env` e preencha.
5. Banco vazio + seed do admin (script `seed-admin.js` local, apagar depois).
6. Rode com PM2: `pm2 start node/server.js --name tikplay`
7. Configure Nginx (proxy com suporte a WebSocket) e certbot.

## Segurança

- `.env` nunca é versionado.
- Rotas de controle exigem token JWT.
- Webhook do Mercado Pago valida assinatura (HMAC) quando `MP_WEBHOOK_SECRET` está definido.
