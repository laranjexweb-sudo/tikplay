# Migração do Catálogo de Presentes — TikPlay

**Status:** Em implementação (Fase 1) · **Origem dos IDs:** TikTokLive `gift_info` · **Data:** out/2026
**Documento vivo.** Ao concluir cada fase, marque o progresso em §11.

---

## 1. Objetivo

Eliminar o cadastro manual de presentes nos jogos **Palavra Secreta**, **3 Dicas** e **Duelo 1x1**
(e demais usos de gift), passando a usar um **catálogo centralizado, sincronizado automaticamente**
com o TikTok, identificado por **ID do presente** (string), com **fallback por nome** para configs legadas.

## 2. Situação atual (antes) — verificado no código

- Catálogo em `node/gift-tags.json`: 527 gifts `{name, diamond_count}` **sem ID**.
- `node/public/gift-image-map.json`: `{name → arquivo.webp}`.
- Ambos gerados manualmente por `python/parse_gift_images.py` a partir do HTML salvo
  `pagina/TikTok gifts list for Brazil.html`.
- Configs dos jogos guardam **nomes**:
  - `tenant_gift_config` → `hint_gifts`, `riddle_gifts` (python `db.py:62`), e também
    `size_gift`, `letter_gift`, `tres_gifts`, `sound_alerts` (colunas adicionadas por **`node/db.js`**
    via `ALTER`, ver `db.js:29-38`).
  - `duelo_config` (`duelo.py`) → `gifts[]` e settings `main_gifts`/`extra_gifts`/`supporters`/
    `special_attacks` — **já guardam `gift_id`**.
- **Casamento por nome (precisa virar ID-first):**
  - Palavra Secreta: `JogoContexto.process_gift` em **`game.py:508`** (não recebe `gift_id`);
    chamada em **`service.py:1286`** (sem `gift_id`).
  - Charada/revelador: `JogoContexto.process_riddle_gift` em **`game.py:414`** (por nome),
    chamado em `service.py:1408` e `service.py:1586`.
  - 3 Dicas: `TresPontinhos._gift_matches` em **`game.py:2053`** e `process_gift` em
    **`game.py:2057`** (recebe `gift_id` mas ignora); chamada em **`service.py:1230`** com
    `gift_id=None`.
- Handlers já entregam `gift_id`: `tiktools_handler.py:133` (`data.giftId`) e
  `tiktoklive_handler.py:148` (`gift.id`).
- Chave Tik.Tools atual retorna **403 em `/webcast/*`** → descartada como fonte.

## 3. Situação alvo (depois)

- Catálogo central em SQLite (`node/data.db`, tabela `gifts`) compartilhado por node e python, **ID-first**.
- Fonte primária: `TikTokLiveClient.start(fetch_gift_info=True)` → `client.gift_info`
  (`TikTokLive 6.6.6` já instalado). O fetch (`fetch_gift_list.py:23`) bate em `GET /gift/list/`
  **sem `room_id`** → catálogo **global**; a API pública só o expõe via `connect()`, mas a rota
  pode ser chamada direto (ver §5.1).
- Ícones baixados localmente em `node/public/gift-images/<id>.<ext>`.
- Frequência: a cada 24h + ao conectar numa LIVE + botão manual "Sincronizar agora".
- Configs migradas para IDs, com **fallback por nome** (nada quebra).

## 4. Modelo de dados

> **Ajuste vs. rascunho:** `id` (TikTok) é **NULLABLE + UNIQUE**, com chave surrogate `gid`.
> Motivo: o seed inicial (527 gifts sem ID) precisa de linhas sem `id`; com `id` como PK única isso
> seria impossível. `id` continua sendo o identificador canônico para o match.

Tabela `gifts` (em `node/data.db`):

| coluna | tipo | nota |
|---|---|---|
| `gid` | INTEGER PK AUTOINCREMENT | surrogate |
| `id` | TEXT UNIQUE NULL | ID do gift TikTok (string) — NULL até a 1ª sync |
| `name` | TEXT | nome canônico (EN) |
| `name_pt` | TEXT NULL | alias PT quando conhecido |
| `diamond_count` | INTEGER | valor em moedas |
| `icon_url` | TEXT | URL da CDN do TikTok |
| `icon_local` | TEXT | arquivo em `public/gift-images/` |
| `status` | TEXT | `'active'` \| `'unavailable'` |
| `first_seen` | INTEGER | unix ts |
| `last_seen` | INTEGER | unix ts (preservado quando ausente na sync) |

Índice: `idx_gifts_name` em `name`.

Tabela `gift_meta` (single-row): `id INTEGER PK CHECK(id=1)`, `last_sync INTEGER`,
`last_sync_result TEXT`.

## 5. Mudanças por camada

### 5.1 Python — sincronizador (`python/sync_gifts.py`, leitura/catálogo em `python/gifts_catalog.py`)
- `fetch_gift_info(username=None)`:
  1. **Direto (sem live):** `TikTokWebClient().fetch_gift_list()` (rota global).
  2. **Fallback (com live):** `TikTokLiveClient(username).start(fetch_gift_info=True,
     process_connect_events=False)` → lê `client.gift_info` → `disconnect()`.
- `normalize()`: `id`→str, ícone = 1ª URL de `image.urls`/`icon`, extensão preservada; parse defensivo
  (`data.get("gifts")`), tolerante a variações de chave.
- `diff()`: novos→`active`; alterados→update; ausentes→`status='unavailable'` (preserva `last_seen`).
- `download()`: ícone em `public/gift-images/<id>.<ext>` (dedupe por id).
- Regenera `gift-tags.json` e `gift-image-map.json` (derivados, compat).
- Módulo standalone: `python sync_gifts.py --once [--user X]`.
- Seed inicial: `gifts_catalog.seed_from_files()` a partir de `gift-tags.json`/`gift-image-map.json`
  (linhas sem `id`, casadas por nome na 1ª sync). `parse_gift_images.py` vira fallback/seed.

### 5.2 Python — resolver e motores *(Fase 2)*
- `gifts_catalog.py`: `resolve(ref)` e `match(incoming_id, incoming_name, ref)` (ID primeiro, nomes depois).
- `service.py on_gift`: repassar `gift_id` a `game.process_gift` (`service.py:1286`) e
  `tres.process_gift` (`service.py:1230`, hoje `None`).
- `game.py`: `JogoContexto.process_gift` (508), `process_riddle_gift` (414) e
  `TresPontinhos._gift_matches` (2053) passam a casar por ID → fallback nome.
- `duelo.py`: já ID-first; validar.
- Batalha/Bichinho: apenas moedas/diamantes — sem mudança.

### 5.3 Node (`db.js`, `server.js`)
- Tabelas `gifts`/`gift_meta` (**DDL owner: `node/db.js`**) + helpers.
- `GET /api/gifts` → catálogo (com `icon_local`, `status`, `synced_at`).
- `POST /api/gifts/sync` (auth) → `daemonSend({cmd:"sync_gifts"})`.
- `readGiftTags()` passa a ler do DB (fallback arquivo); `/api/gift-tags` e `/api/gift-image-map`
  continuam (DB-backed) p/ `duelo.html`, `web-game.html`, `tres-pontinhos.html`.
- `normalizeHintGifts`: aceita ID ou nome, resolve p/ ID canônico.
- `dueloGiftsPayload`/`dueloClientSettings`: enriquecimento por ID (fallback nome).
- `/api/sound-alerts`: chave passa a ser ID (aceita nome legado).

### 5.4 Painel (`control-panel.html`) *(Fase 3)*
- Seletor usa `/api/gifts`: valor=ID, nome PT/EN + 💎 + miniatura local, badge "indisponível".
- Busca por nome ou ID; filtro por valor min/max.
- Botão "Sincronizar agora" com contadores (novos/alterados/sumidos) e `synced_at`.
- Aplica-se a: dicas/revelador/tamanho/letra, 3 Dicas, Duelo, alertas sonoros.

## 6. Migração de configs existentes (nomes → IDs)

- No load/save de qualquer gift config (node e python): converte nomes para IDs quando o catálogo
  reconhece o nome (EN/PT). Sem correspondência → mantém nome (fallback ativo).
- **Backfill inicial:** seed do catálogo com `gift-tags.json` + `gift-image-map.json` (`id` vazio) e
  match por nome na 1ª sincronização, preservando continuidade de imagens.

## 7. Script de migração (execução única)

1. Criar tabelas `gifts`/`gift_meta` (idempotente).
2. Seed inicial a partir de `gift-tags.json`/`gift-image-map.json`.
3. Percorrer `tenant_gift_config`, `tres_gifts`, `duelo_config`, `sound_alerts`: para cada gift-name
   legado, resolve p/ ID via catálogo; salva referência canônica (ID) quando resolvida; preserva o
   valor original quando não.
4. Regenerar derivados (`gift-tags.json`, `gift-image-map.json`).
5. Gravar `gift_meta.last_sync` base.

## 8. Rollback

- `git revert` das mudanças/scripts retorna a leitura a `gift-tags.json` (o arquivo continua sendo regenerado).
- Configs migradas ainda são válidas por nome (fallback) → nada quebra se a tabela for limpa.
- O seletor antigo seguia os endpoints `/api/gift-tags` + `/api/gift-image-map`, preservados.

## 9. Testes

1. `python sync_gifts.py --once` (com live ou rota direta) → catálogo populado (ids, nomes, moedas, ícones locais).
2. Rerun → diff sem duplicidades; gift removido do TikTok vira `unavailable`.
3. Config de dica/revelador/3 Dicas/Duelo salva por ID → jogo reage ao enviar o gift na live.
4. Config antiga (por nome) continua funcionando.
5. Painel: busca por ID, filtro por valor, botão sync, badge indisponível.
6. `web-game.html`, `duelo.html`, `tres-pontinhos.html` seguem exibindo imagens.

## 10. Riscos

- Endpoint global `/gift/list/` pode exigir assinatura/região; fallback para conexão com live.
- Rate-limit/captcha do signer público (EulerStream) → manter cadência de 24h.
- Nomes/preços variam por região (catalogado global, foco BR).
- **Concorrência SQLite**: node (`better-sqlite3`) e python (`sqlite3`) escrevem no mesmo
  `node/data.db`. Ambos usam WAL + `busy_timeout`. Evitar rodar `sync_gifts.py --once` com o server
  ativo; preferir o comando `sync_gifts` (via daemon). *(python já faz `PRAGMA busy_timeout=5000`.)*

## 11. Fases / Progresso

- [x] **Fase 1** — Modelo de dados + sincronizador + endpoints (`gifts`/`gift_meta`, `sync_gifts.py`,
  `/api/gifts`, `/api/gifts/sync`, comando `sync_gifts`). *(configs/matching ainda por nome)*
- [x] **Fase 2** — Resolver ID-first nos motores: `JogoContexto.process_gift`/`process_riddle_gift`,
  `TresPontinhos.process_gift`/`_gift_matches` + repasse de `gift_id` em `service.py:1286`/`:1230`.
  Fallback por nome (EN/PT) preservado; `duelo.py` já era ID-first (validado).
- [x] **Fase 3** — Painel: seletor consome `/api/gifts` (ID como valor quando sincronizado), busca por
  nome/PT/ID, badge "indisponível", 💎 no autocomplete, filtro por valor (min/max), botão
  "Sincronizar agora" + última sync + refresh via WS `gifts_synced`. `normalizeHintGifts` aceita ID ou nome.
- [ ] **Fase 4** — Migração/backfill das configs existentes (nomes → IDs) + regenerar derivados.
- [ ] **Fase 5** — Validação por jogo + limpeza (fallback pode virar definitivo).

---

## 12. Decisões (confirmadas)

1. **Executor do sync:** cliente efêmero, tentando a **rota global** (`fetch_gift_list` sem `room_id`)
   e caindo para conexão com LIVE quando necessário.
2. **Dono do DDL:** `node/db.js` (python faz `CREATE TABLE IF NOT EXISTS` idêntico apenas para
   robustez standalone).
3. **Ícones:** `node/public/gift-images/<id>.<ext>`; `gift-image-map.json` vira derivado `nome→arquivo`.
4. **IDs como TEXT** em todo lugar (IDs do TikTok são inteiros grandes).
