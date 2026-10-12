# Auditoria: persistência de preferências do TikPlay

Data: 2026-10-12 · Escopo: **somente back-end**. Evidências coletadas do código em `node/`, `python/` (não do comportamento simulado do front-end).

## Método

Para cada área de preferência: rastreei o contrato (endpoint de leitura/gravação), a função de banco, o caminho até o daemon e o que sobrevive a **refresh, logout, reinício do servidor/daemon e outro dispositivo**. Distingo **gravação no banco** (confirmado por `success:true` no endpoint) de **aplicação no daemon** (efeito ao vivo, assíncrono e dependente da sessão).

## Matriz de persistência

| Área / campo | Onde grava (tabela/coluna) | Refresh/logout | Reinício (Node+daemon) | Contrato leitura/escrita | Evidência |
|---|---|---|---|---|---|
| Preferências (voz/velocidade/filtro/prefixo/meta/auto) | `tenant_settings` (todas as colunas) | ✔ | ✔ (sessão carrega em `start`; `GameSession.__init__` tb lê do banco) | GET `/api/settings`; POST grava **substituindo todas as colunas** | `db.js: getTenantSettings/saveTenantSettings`; `server.js /api/settings`; `service.py _start` |
| Voz/velocidade na narração | `tenant_settings.tts_voice/tts_rate` | ✔ | ✔ (hidratado no `GameSession.__init__` e no `start`) | POST `/api/settings` (full-replace) | commits TTS; `service._tts_url` |
| Credenciais TikTools/username/engine | `users.tiktools_api_key/username/tiktok_engine/room_code` | ✔ | ✔ | POST `/api/panel-config` (por campo) — key mascarada no GET (`publicUser`/`maskKey`) | `panel-config`; `db.publicUser` |
| Gifts Palavra (dica/revelador/tamanho/letra) | `tenant_gift_config.hint_gifts/riddle_gifts/size_gift/letter_gift` | ✔ | ✔ (re-aplicado no próximo `/new-game`) | GET/POST `/api/gift-config` — **merge por campo no servidor** | `routes/gifts.js` |
| Alertas sonoros por gift | `tenant_gift_config.sound_alerts` + arquivos em `public/alert-audio/` | ✔ | ✔ | POST/GET/DELETE `/api/sound-alerts` | `routes/gifts.js` |
| **Caça-Palavras: prefixo** | **ANTES: nenhum (só `daemonSend`) — LACUNA** → **agora: `tenant_caca_config`** | **ANTES ✖** → **✔** | **ANTES ✖** → **✔ (aplicado no `start`)** | GET/POST `/api/caca/config` (POST agora persiste) | `server.js`, `db.js`, `service.py` |
| 3 Dicas (size/letter/ticket/tempos/pontos) | `tenant_gift_config.tres_gifts` | ✔ | ✔ (enviado no `start` e via `tres_config`) | GET/POST `/api/tres/config` (POST grava + aplica) | `server.js /api/tres/config`; `db.js get/saveTresGiftConfig` |
| V-Pet (estado + assistant_mode) | `vpet_state` | ✔ | ✔ (load + decaimento offline) | cmd `vpet_*`; `set_assistant_mode` chama `_save()` | `vpet.py` |
| Duelo (layout/gifts/settings) | `duelo_config` | ✔ | ✔ | GET/POST `/api/duelo/config` | `db.js get/saveDueloConfig` |
| Áudio do Duelo | arquivos `public/duelo-audio/` | ✔ | ✔ | POST `/api/duelo/audio` | `server.js` |
| Batalha (rodada) | `batalha_rounds`/players (histórico); rodada ativa em memória | parcial | ✖ (rodada ativa é efêmera por design) | cmds `battle_*` | `db.js` |
| Banidas/convites/admin | `banned_words`, `registration_invites`, `users.plan/features` | ✔ | ✔ | `/api/admin/*` | `db.js` |
| Filtros de logs (categorias) | **local do navegador (não persiste)** | ✖ (por design, o front não afirma persistência) | ✖ | — | doc `logs-persistencia-backend-recomendacoes.md` |
| Histórico de logs (registros) | `log_entries` (recém-implementado) | ✔ (via `GET /api/logs`) | ✔ | GET `/api/logs` (cursor `before`); painel ainda não consome o replay | `db.js`, `lib/logstore.js`, `server.js` |
| Som de conexão | **não existe estado de backend** (é vocabulário do front) | n/a | n/a | preservado por decisão; não tocado | grep `som de conexão` → só strings no painel |

## Problemas comprovados e correções aplicadas (somente back-end)

1. **Caça-Palavras: config não persistia (prioridade)** — `/api/caca/config` (POST) apenas enviava `caca_config` ao daemon; prefixo era `s.caca_prefix` em memória, perdido em reinício. **Corrigido**: tabela `tenant_caca_config`, POST persiste (valida/saneia `prefix` ≤ 8), novo `GET /api/caca/config` recupera, e `/start-game` envia `caca_config` ao daemon que aplica no `start`.
2. **`POST /api/settings` podia resetar campos a defaults** — `normalizeSettings(payload)` partia de `DEFAULT_SETTINGS`; um payload parcial zerava voz/prefixo/etc. **Corrigido**: merge sobre o estado atual do banco (`{...current, ...body.settings}`). Ainda **não** resolve perda de atualização entre dispositivos (ver contrato proposto abaixo).
3. **Credenciais**: `publicUser` mascara `tiktools_api_key` (get). Confirmado que não há vazamento no GET. Log de panel config não registra o valor (auditar se necessário — ver dependência).
4. **Logs**: sanitização (tokens/API keys/URLs `?tk=`) implementada em `lib/logstore.js` (armazenar e expor). Painel ainda não integra `GET /api/logs` — **dependência de front-end**.

## Contratos propostos (dependências de front-end — NÃO implementados por mim)

1. **Grav. granular p/ evitar update-loss entre abas/dispositivos**: substituir POST `/api/settings` full-snapshot por **PATCH parcial** (cliente envia apenas chaves alteradas). Backend já tolera payload parcial (merge). Sem isso, dois painéis editando campos diferentes resultam em *last-write-wins* por objeto inteiro.
2. **Restaurar prefixo Caça-Palavras na UI**: o painel deve chamar `GET /api/caca/config` ao carregar (contrato já disponível) e preencher o campo.
3. **Replay de logs no painel**: integrar `GET /api/logs` (páginas/cursor `before`) + deduplicar por `id` com eventos `type:"log"` ao vivo (que já carregam `id/ts/category`).

## Concorrência / atualização perdida

- **`tenant_settings` (POST):** full-replace por objeto → dois dispositivos se sobrescrevem (LWW). Provado no contrato; mitigação parcial aplicada (merge), solução real depende do PATCH (item 1 acima).
- **`gift-config`:** merge por campo no servidor; concorrência no mesmo campo ainda é LWW (aceitável).
- **Daemon indisponível:** endpoints de config gravam no banco primeiro; se `daemonSend` retorna false, alguns respondem "Servico Python indisponivel" (ex.: caca/config) embora já esteja persistido — a aplicação ao vivo ocorre no próximo `start`/comando. Distinção entre **gravar** (banco, confirma) e **aplicar** (daemon, assíncrono) documentada acima.

## Isolamento e autorização

- Tenant/streamer sempre de `req.user.id` (JWT). Configs (settings/gift/tres/caca/duelo/vpet/logs) filtram por esse id; nenhum endpoint aceita `tenant_id` do cliente. Confirmado: tenant inexistente vê defaults vazios (teste abaixo).

## Não declarado

Não declaro garantia de persistência baseada em testes simulados de front-end. Restam validações em ambiente real (VPS/live) e o fechamento das dependências do painel.

## Testes executados

- POST/GET `/api/caca/config` (200; `{"prefix":"@caca","count":10}`) → confirmado na tabela; GET de outro tenant → `{"prefix":"","count":10}` (isolamento). ✔
- `POST /api/settings {pct_dica:55}` (payload parcial) → `tts_voice` preservada (`edge_francisca`), `tts_rate` 1, `pct_charada` 45. ✔
- `/api/logs`: 401 sem token; 200 autenticado com registros sanitizados (Bearer/token=?tk mascarados). ✔
- `node --check` (db.js/server.js/routes) e `python -m py_compile service.py` OK; boot do servidor limpo.