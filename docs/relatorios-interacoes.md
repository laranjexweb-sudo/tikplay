# Relatórios de interação por live + personalização de overlays

Backend implementado em 13/10/2026. Cobre ingestão persistente de interações
por live (`room_id`), relatórios do streamer, configuração persistente dos
overlays de curtidas e isolamento de dados por live.

## 1. Conceitos

- **Live / sessão:** cada `room_id` do TikTok é uma **live**. A tabela
  `live_sessions` (`tenant_id, room_id, engine, username, started_at, ended_at`)
  agrupa eventos e relatórios. Reconectar à **mesma** sala reaproveita a sessão;
  sala **diferente** encerra a anterior (`ended_at`) e abre uma nova.
- **Interação:** evento persistido em `interactions` (detalhe) e agregado em
  `interaction_aggregates` por `(tenant, sala, minuto, tipo, usuário)`.
- **Isolamento por sala:** o daemon detecta a troca de `room_id`, **zera o
  ranking/acumulador de curtidas** e publica ranking vazio. **Não encerra
  partidas** ao desconectar/trocar de sala.

## 2. Ingestão

- O daemon Python **apenas emite** eventos normalizados; o **Node grava em lote**
  (`node/lib/interactions.js` → `db.insertInteractionsBatch`), evitando dois
  processos escrevendo no SQLite. Flush a cada ~250 ms ou 400 eventos.
- Tipos: `like, gift, comment, follow, share, join, guess, hint, winner`
  (e `size_reveal`/`letter_reveal` reservados). Valores: curtidas = nº de likes;
  gift = diamantes × repetições; guess/hint = rank; winner = 1.
- **Idempotência:** `event_id` (ex.: `msg_id` do Webhook) com índice único parcial
  + `INSERT OR IGNORE`. Duplicatas **não** inflam agregados.
- **Motores:** `TikTokLive` fornece `room_id` e `event_id` por evento
  (`common.room_id`/`common.msg_id`) → dedupe/descarte exatos. No **TikTools**
  isso é **best-effort** (a sala vem do `live_status`; não há `event_id` por evento).

### Retenção (configurável por env — antes de produção)
| Dado | Retenção | Env | Default |
|---|---|---|---|
| Eventos detalhados | 90 dias | `INTERACTIONS_DETAIL_RETENTION_DAYS` | 90 |
| Texto de comentários | 7 dias (texto limpo; a linha/contagem permanece até 90d) | `INTERACTIONS_COMMENT_TEXT_RETENTION_DAYS` | 7 |
| Agregados | 24 meses | `INTERACTIONS_AGG_RETENTION_DAYS` | 730 |

Comentários guardam texto truncado em 300 caracteres; não se guarda payload bruto.
Poda no boot e a cada 6 h.

## 3. APIs (autenticadas; SEMPRE escopadas por `req.user.id`)

Nunca aceitam `tenant_id` do navegador. Datas em **UTC (epoch ms ou ISO 8601)**.

| Rota | Parâmetros | Retorno |
|---|---|---|
| `GET /api/live-sessions` | `from,to,limit` | lives (room_id, iniciada/encerrada) |
| `GET /api/reports/summary` | `from,to,room_id` | `events`, `people`, `by_type{type:{count,value_sum}}` |
| `GET /api/reports/series` | `from,to,room_id,type,bucket=minute\|hour\|day` | `points[{t,count,value_sum,by_type}]` |
| `GET /api/reports/ranking` | `from,to,room_id,type,limit` | `ranking[{user_id,count,value_sum}]` |
| `GET /api/reports/events` | `from,to,room_id,type,cursor,limit` | `events[]`, `next_cursor` |

## 4. Personalização dos overlays (curtidas)

Contrato **aditivo** ao layout v2/v3 existente (`x,y,scale,count` preservados).
Armazenado por versão (`likes_overlay_v2_layout` / `likes_overlay_layout`),
distribuído por WS `likes_overlay_layout` (mesmo evento/versão) e relido ao abrir
o overlay. Valores validados — **sem CSS arbitrário**.

| Campo | Valores |
|---|---|
| `photo_position` | `left` \| `right` \| `top` \| `bottom` |
| `font_color` | hex `#rrggbb` |
| `shadow` | `none` \| `soft` \| `medium` \| `strong` |
| `animation` | `float` \| `rise` \| `pop` \| `sway` |
| `heart_colors` | lista de hex `#rrggbb` (até 5) |

- `GET /api/likes-overlay/layout?version=v3` agora retorna também `options`
  (enums) e `defaults` — para o painel montar os controles.
- `POST` valida: campos ausentes → default; presentes e inválidos → **400**.
- Defaults: `photo_position:"left"`, `font_color:"#ffffff"`, `shadow:"soft"`,
  `animation:"float"`, `heart_colors:["#ff4d6d"]`.

## 5. Integração de front-end

- **Relatórios:** a aba do streamer consome `/api/live-sessions` e `/api/reports/*`
  com filtros por live, período e tipo, resumo, série temporal, ranking e eventos
  paginados. Datas são enviadas como epoch ms e exibidas no fuso local.
- **Overlay de curtidas:** a área de sobreposições monta os controles a partir de
  `options`/`defaults` do GET, salva a configuração pelo POST e aplica as mudanças
  na prévia e nos overlays ativos via broadcast. Curtidas flutuantes usam a
  configuração v3 para animação e paleta de cor.

## 6. Testes

`node tests/interactions-reports.test.js` (47 casos): sessões por sala,
ingestão/agregados, deduplicação, isolamento entre contas, filtro por sala,
série, ranking, paginação por cursor, retenção (detalhe/comentário/agregado),
normalização de meta, validação/round-trip do overlay, e integração das rotas
(401/200). `tests/likes-overlay-layout.db.test.js` atualizado para o default
estendido. Validação Python do shape dos eventos e do reset por sala.

## 7. Níveis do usuário (presenteador / membro da comunidade)

Coleta **subidas de nível** por live, em **dois eixos explícitos** (nunca misturados):
- **Presenteador** (`axis: "gifter"`): nível de gasto — `user.pay_grade.level` (`gifter_grade`),
  com fallback ao helper `ExtendedUser.gifter_level`.
- **Membro/comunidade** (`axis: "fanclub"`): nível de fã-clube — `fans_club_info.fans_level`
  (fallback `fans_club.data.level` / `ExtendedUser.member_level`), com `fan_club_name`.

**Regras (definidas com o produto):**
- **Entrada na live = sincronização silenciosa** (baseline + nível global), **sem evento**,
  mesmo que o usuário já esteja num nível alto vindo de outra live.
- **Conta-se apenas subida ocorrida durante a live.**
- **`before: null` quando não há baseline confiável na live** — não inventamos `after-1` nem
  usamos um nível global possivelmente antigo. A subida ainda é registrada com o novo nível.
- Sinais: **explícito** (barrage) + **diff** (observação). O daemon trata os barrages
  `USER_UPGRADE` (presenteador) e `FANS_LEVEL_UPGRADE` (comunidade) — `FANS_LEVEL_ENTRANCE`
  não é subida.

**Armazenamento (dedicado, com retenção maior que os detalhes):**
- `viewer_levels` — nível global conhecido por usuário `(tenant_id, user_id)`.
- `live_viewer_levels` — baseline por live `(tenant_id, room_id, user_id)`.
- **`level_ups`** — uma linha por subida: `tenant_id, room_id, session_id, user_id, username,
  nickname, avatar, axis, level_before (nullable), level_after, event_id, ts`.
  - **Dedupe** por `UNIQUE(tenant_id, room_id, user_id, axis, level_after)` e por
    `UNIQUE(tenant_id, event_id) WHERE event_id <> ''` (robusto a evento atrasado/reinício).
  - Retenção própria: `LEVEL_UPS_RETENTION_DAYS` (default **730** = 24 meses), maior que os
    90d dos detalhes de `interactions`.

**Fluxo:** o daemon emite `viewer_level` (com `level_up_axis` e `event_id` quando for barrage);
o **Node** (`lib/levels.js`) compara com o baseline (ou usa a promoção explícita), grava em
`level_ups` (dedupe) e **difunde** aos clientes só o que for novo.

**Tempo real (WS):** `{"type":"level_up","axis":"gifter"|"fanclub","before":N|null,"after":N,
"user","nickname","avatar","room_id"}` para overlays (`browserClients`) e painel (`logClients`).

**APIs (autenticadas, escopadas por `req.user.id`):**
- `GET /api/reports/events?type=level_up&axis=gifter|fanclub&from&to&room_id&cursor&limit`
  (serve de `level_ups`, com filtro por eixo).
- `GET /api/reports/summary` agora inclui `level_up: { total, gifter, fanclub, by_axis }`.
- `GET /api/reports/levels?room_id=` — níveis atuais (baseline da live ou global).

**Painel do streamer:** mostrar data/hora, usuário, live, eixo e **antes → depois**; quando
`before` for `null`, exibir **“nível anterior não identificado”**.

**Limites:** só ao vivo; nível ausente/`0` ignorado (não sobrescreve); TikTools é best-effort.

## 8. Geração de sessão daemon e eventos atrasados

Cada `/start-game` cria `session_id` único por tenant. O daemon o anexa às mensagens
emitidas durante a sessão (ContextVar herdado pelas tasks). O Node mantém
`activeDaemonSessionId` e descarta mensagens de sessão antiga ou sem identidade
que alterariam estado (status/game/interactions/live). Assim, um `waiting` atrasado
de um username anterior não sobrescreve o `connected` atual.

- Início repetido com o mesmo username/motor enquanto a sessão está armada é
  idempotente (não cria outro handler).
- Troca de username substitui a geração; mensagens atrasadas da geração anterior
  são ignoradas.
- `/stop-game` invalida a geração imediatamente; Python recebe stop cooperativo,
  encerra/aguarda handlers filhos e só então libera a sessão para outra conexão.
- `TIKTOK_LEVEL_DIAGNOSTICS=1` é opcional para log throttled de status atrasado.

Testes: `node/tests/session-guard.test.js`, `python/tests/test_session_emission.py`
e `python/tests/test_session_lifecycle.py`.

### Diagnóstico temporário de níveis

Para investigar uma live sem captura, definir `TIKTOK_LEVEL_DIAGNOSTICS=1` no
`node/.env` e reiniciar Node/daemon **entre lives**. O handler registra (throttle
20s por usuário) os níveis extraídos de eventos de usuário e (throttle 10s por
tipo) barrages de upgrade/entrada; o Node registra cada `viewer_level` recebido
e cada `level_up` persistido/difundido. Os logs permitem distinguir: (1) barrage
ausente; (2) barrage sem `current_grade`/usuário; (3) níveis ausentes no objeto
`user`; (4) observação recebida, mas subida descartada por baseline/dedupe.
Desativar removendo a variável ou usando `TIKTOK_LEVEL_DIAGNOSTICS=0` após o
diagnóstico; o processo atual só lê a variável no boot.
