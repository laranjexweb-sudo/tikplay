# Deploy VPS — TikPlay

Documento de referência do ambiente de produção.

## Resumo do ambiente

| Item | Valor |
|---|---|
| Servidor | VPS (`root@VPS-BR-20025`, Linux) |
| Pasta do projeto | `/var/www/tikplay` (equivale ao `jogo-contexto/` local, contém `node/` e `python/`) |
| Processo PM2 | `tikplay` (id `3`, modo `fork`, status `online`) |
| Script PM2 | `/var/www/tikplay/node/server.js` |
| cwd do PM2 | `/var/www/tikplay/node` |
| Logs PM2 (out) | `/root/.pm2/logs/tikplay-out.log` |
| Logs PM2 (err) | `/root/.pm2/logs/tikplay-error.log` |
| PID file | `/root/.pm2/pids/tikplay-3.pid` |
| Node.js | v22.23.2 |
| Porta | `3100` (HTTP + WebSocket na mesma porta) |

## Repositório Git

- Remote: `https://github.com/laranjexweb-sudo/tikplay.git`
- Branch: `main`
- Estrutura no repositório: `node/` (servidor HTTP/WS, painel, páginas) + `python/` (daemon do jogo)

## Como atualizar na VPS

```bash
cd /var/www/tikplay
git pull origin main
pm2 restart tikplay
```

Se a pasta ainda não for um clone git (cópia manual), primeiro:

```bash
cp -r /var/www/tikplay /var/www/tikplay.bak.$(date +%F)   # backup

cd /var/www/tikplay
git init -b main
git remote add origin https://github.com/laranjexweb-sudo/tikplay.git
git fetch origin
git checkout -f -B main origin/main
pm2 restart tikplay
```

### Dicas
- Reiniciar fora da live (o restart derruba a conexão por alguns segundos).
- Não há novas dependências na maioria das atualizações → normalmente **não** precisa `npm install`.
- O restart do Node relança o daemon Python (`python/service.py`) e roda as migrações idempotentes do `db.js`.

### Atualizar o motor Edge TTS

O daemon usa `edge-tts` na mesma instalação Python indicada por `PYTHON_BIN`.
Após atualizar `jogo-contexto`, atualize essa dependência no ambiente usado pelo
PM2 antes de reiniciar:

```bash
cd /var/www/tikplay
python3 -m pip install -r python/requirements-tts.txt
pm2 restart tikplay
python3 -c "import importlib.metadata as m; print(m.version('edge-tts'))"
```

Se `PYTHON_BIN` apontar para outro interpretador/virtualenv, use esse mesmo
interpretador no comando `-m pip` e na verificação da versão.

## Arquivos preservados (fora do Git)

O `.gitignore` do repositório garante que estes **ficam intactos** na VPS após `pull`/`checkout`:

| Tipo | Arquivos/Pastas |
|---|---|
| Segredos | `node/.env`, `python/tiktools_key.txt`, `node/seed-admin.js` |
| Banco | `node/data.db` (+ `-wal`/`-shm`), `python/game.db` |
| Config local | `node/gift-config.json`, `node/panel-config.json`, `node/public/history.json` |
| Mídia gerada | `node/public/tts-audio/`, `node/public/alert-audio/`, `python/tts_models/` |
| Dependências | `node_modules/` |

## Dados do jogo (onde ficam)

- **Banco principal (Node):** `/var/www/tikplay/node/data.db` — usuários, config por tenant, rankings, histórico, batalha, caça, 3 Dicas, V-Pet, assinaturas.
- **Daemon Python** usa o mesmo `../node/data.db` (via `python/db.py`).
- **Config do jogo** fica no banco (`tenant_settings`, `tenant_gift_config`), não em arquivo.
- **Áudios TTS gerados:** `/var/www/tikplay/node/public/tts-audio/<tenant>/`.
- **Alertas sonoros enviados:** `/var/www/tikplay/node/public/alert-audio/<userId>/`.

## Validar depois do deploy

```bash
curl -I http://localhost:3100/jogo        # 200
curl -I http://localhost:3100/contexto    # 200 (jogo publico)
curl -s  http://localhost:3100/api/contexto/daily | head -c 120
curl -I http://localhost:3100/overlay     # 404 (página removida)
curl -s http://localhost:3100/api/plans | head -c 120
pm2 logs tikplay --lines 30
```

## Site institucional + jogo público (apex)

O apex **`tikplay.com.br`** passa a ser servido pelo próprio Node (mesmo app/porta `3100`):

- A raiz `/` mostra o site institucional (`node/public/site/index.html`) quando o `Host` é
  `tikplay.com.br`/`www.tikplay.com.br`; no painel (`painel.tikplay.com.br`) `/` continua
  redirecionando para `/login` (diferenciado por `Host` no `server.js`).
- O jogo público fica em `/contexto` e a API em `/api/contexto/*`, ambos no mesmo app
  (sem autenticação; sem novo processo PM2 nem 2º spaCy).
- **nginx:** o vhost `tikplay.com.br` (que hoje só faz `return 301` para o login) deve passar
  a **proxiar para `http://127.0.0.1:3100`**, igual ao bloco de `painel.tikplay.com.br`
  (mesmos `proxy_set_header`, inclusive `Host $host`). O certificado existente já cobre o apex.
- Deploy: `cd /var/www/tikplay && git pull origin main && pm2 restart tikplay` (sem `npm install`).

## Links públicos para OBS/TikTok (`?tk=`)

As telas públicas (`/jogo`, `/ranking`, `/batalha`, `/caca-palavra`, `/bichinho`, `/tres-pontinhos`) podem ser abertas **sem login** usando o token no link:

- No painel, cada jogo tem o botão **"Link público"** que chama `POST /api/game/room-link` e copia algo como: `/jogo?room=CODIGO&tk=<jwt-365d>`.
- O frontend usa `?tk=` (ou o token do `localStorage` se existir).

**IMPORTANTE (segurança):** o `tk` é um JWT com validade de **1 ano** da conta do streamer. Trate o link como segredo da sala:
- Se o link vazar, quem o tiver terá acesso à sessão → revogar = trocar o `JWT_SECRET` (derruba todas as sessões) ou gerar novos links com expiração menor.
- Não incluir o link em repositórios públicos/prints.
