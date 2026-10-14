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

## 5. Dependências de front-end (não alterei a interface)

1. **Relatórios:** consumir `/api/live-sessions` e `/api/reports/*` (resumo, série,
   ranking, eventos paginados) com filtros por live/período/tipo. Exibir datas no
   fuso local (o backend entrega UTC).
2. **Overlay de curtidas:** exibir os novos controles usando os `options` do GET
   (posição da foto, cor da fonte, sombra, animação e cores dos corações) e
   enviá-los no POST; aplicar via a config `likes_overlay_layout`.

## 6. Testes

`node tests/interactions-reports.test.js` (47 casos): sessões por sala,
ingestão/agregados, deduplicação, isolamento entre contas, filtro por sala,
série, ranking, paginação por cursor, retenção (detalhe/comentário/agregado),
normalização de meta, validação/round-trip do overlay, e integração das rotas
(401/200). `tests/likes-overlay-layout.db.test.js` atualizado para o default
estendido. Validação Python do shape dos eventos e do reset por sala.
