# Separação Estrutural — TikPlay

> **Documento vivo.** Baseado no `tikplay-prompt-continuidade.md`. Evidências conferidas em
> **2026-10-12** (linhas atuais). Distingue: ✅ concluído · ⬜ pendente · ❓ não verificado.

---

## 1. Estado atual (evidência)

### Python (`jogo-contexto/python`)
| Arquivo | Conteúdo | Observação |
|---|---|---|
| `service.py` (~46 + main) | Orquestração: `BatalhaEngine` embutido (`:275`), `GameSession` (`:396`, instancia game/battle/caca/vpet/tres/duelo), handlers (`on_comment :1052`, `on_gift :1218`, `on_like :652`, `on_member :1047`), `_command_loop :1649`, `run :1777`, `stop_session_task :1823`, `process_commands :1854` | Utilitários puros (get_rank_color/DEFAULT_SETTINGS/normalize_settings/emit) **extraídos** p/ `service_common.py` (Fase A-1). |
| `service_common.py` | `emit`, `normalize_settings`, `DEFAULT_SETTINGS`, `get_rank_color` | ✅ Fase A-1 (compat: importado por `service.py`). |
| `game.py` (~2.2k) | `strip_accents :39`, `ALIAS_MAP :54`, `GIFT_PT_MAP :184`; `JogoContexto :211`, `CacaPalavras :828`, `xp_to_next_level :1281`, `phase_for_level :1290`, `VPetEngine :1299`, `TresPontinhos :1902` | **4 jogos num arquivo**. |
| `duelo.py` (802) | `DueloEngine` | Já isolado (bom modelo). |
| `gifts_catalog.py`, `sync_gifts.py`, `migrate_gift_configs.py` | Catálogo ID-first | ✅ já modulares. |
| `tiktoklive_handler.py`, `tiktools_handler.py`, `tts.py`, `db.py` | Conexão/TTS/banco | Compartilhados. |

### Node (`jogo-contexto/node`)
- `server.js` (~2.4k) concentra: aliases de página + `NO_CACHE_ROUTES` (§25–49), spawn do daemon (`:452`), `handleDaemonMessage` (`:532`), `daemonSend` (`:579`), e **todas** as rotas: auth (`:709+`), admin (`:820+`), panel (`:1019`), gifts (`:1054+`), sound-alerts (`:1196`), billing MP (`:1268–1315`), settings (`:1379`), tts (`:1407`), game-state (`:1442`), batalha (`:1456–1521`), palavra/history (`:1524–1615`), caca (`:1621–1665`), tres (`:1675–1758`), vpet (`:1797–1843`), play-riddle/display-action/room-link (`:1856–1929`), duelo (`:2220–2378`), start/stop-game (`:2380+`).
- `db.js` (node) é o dono do DDL (users, duelo_config, gifts/gift_meta…).

### Front (`node/public`)
- 12 HTMLs, cada um com **1 bloco `<script>` inline** (sem `<script src>`). Regra do repo: **JS embutido**.
- `control-panel.html` **237 KB** (os outros 11 somam ~330 KB inline).
- `control-panel`/`admin`/`login` carregam Bootstrap (`/vendor/brite/bootstrap.min.css`); `web-game.html` carrega `style.css` (57 KB). Demais usam CSS inline.

## 2. Fluxos mapeados (ordem de dispatch) — preservar

### Comentário — `service.py on_comment :1052`
1. broadcast `chat` → narração → `_duelo_comment_team`.
2. **3 Pontinhos ativo**: palpite (ingresso/gates). **Consumo exclusivo** se ativo (`return`). `:1068–1091`.
3. **Bichinho ativo**: `!falar`/comandos. `return` se consumir. `:1096–1111`.
4. Caça Palavras (prefixo) → depois Palavra Secreta (`process_guess`).

### Presente — `service.py on_gift :1218` (NÃO é consumo exclusivo; um gift reage em vários)
1. broadcast `gift_event` + log.
2. `tres.process_gift` (se ativo). `:1231`
3. Passe Livre/ticket 3 Pontinhos. `:1234`
4. `vpet.on_gift` (se ativo). `:1248`
5. **Duelo**: se gift cadastrado/área ativa → `duelo.on_gift` (+ agendamentos reset/match). **Não retorna**; segue. `:1251–1276`
6. `_check_access` (filtros) → bloqueio pode `return`. `:1278`
7. `battle.add_coins` (sempre of same). `:1282`
8. Se jogo Palavra Secreta ativo: `game.process_gift` (tamanho/letra/hints/roleta/charada). `:1283+`

### Curtida — `on_like :652`
1. Duelo (tap se `hp_new` ativo). 2. `vpet.on_like`. 3. `battle.add_taps`. 4. Palavra Secreta (likes/meta de tap).

> **Consequência para o plano:** um contrato de plugins **não deve** assumir consumo exclusivo de presente; ordem e não-exclusividade do Duelo devem ser reproduzidas. Comentário tem consumos exclusivos (tres/vpet) que devem ser preservados em ordem.

## 3. Estado compartilhado / timers / ciclo de vida (por motor)

- `GameSession` agrega: `game`, `battle`, `caca`, `vpet`, `tres`, `duelo`, `likes`, `tap_meta_*`, `_tres_allowed`, filas de narração, settings, handler (TikTools/TikTokLive).
- Tasks no `run :1777`: `handler.run`, `_command_loop`, `_likes_loop`, `_narrate_loop`, `vpet.run`. Battle cria `_loop` por rodada. Duelo: `_duelo_reset/match/timer/round_result` tasks. Tres: próprias tasks.
- Persistência via `db.py` (node/data.db) e configs JSON; ciclo de vida `start/stop/new_game/end_game` em `_command_loop :1649` e `process_commands :1854`.
- Isolamento por sessão: `sessions[tid]` em `process_commands`.

## 4. Endpoints / WS / front / regra de scripts

- WS `/logs` e `/browser`; `handleDaemonMessage :532` roteia `status|game|log|panel_word|tts_test_ready|narrate|gifts_synced`.
- `handleDaemonMessage` com `tenant_id==null` só loga; sem tenant, eventos são ignorados (ex.: `sync_gifts` global emitiu `gifts_synced` com tenant).
- Front consume `/api/*` por fetch/`apiFetch`; **regra**: JS embutido (não extrair para arquivos sem decisão do usuário).
- IDs/classes usados por JS devem ser preservados (Design System usa prefixo `tp-*` aditivo).

## 5. Riscos de refatoração × defeitos existentes

| Risco estrutural | Defeito pré-existente (não tratar aqui) |
|---|---|
| Ordem/não-exclusividade do Duelo em `on_gift` (mudar pode duplicar/duplicar golpes) | Duplo-broadcast `riddle_started/riddle_ready` (PLANO_MELHORIAS C-02) |
| `game.py` com 4 motores (cache de índice, ALIAS_MAP, GIFT_PT_MAP compartilhados) | `M-04` gift fora do catálogo (log), `M-03` avatar @menção |
| `server.js` monolítico e `handleDaemonMessage` sem tenant ignora eventos | Chaves expostas (`C-01`) |
| Front `control-panel.html` 237 KB com JS inline | CSS/IDs duplicados (Design System §2) |

> Correções funcionais devem ser **separadas** da extração estrutural.

## 6. Fases (execução incremental)

- **A — Python**: A-1 ✅ utils (`service_common.py`). A-2 ⬜ extrair motores (candidato: `BatalhaEngine` → `python/batalha.py`, depois cada classe de `game.py` → `python/jogos/*`.py com shims de import). Contrato de plugins **só depois** de mapear ciclos (acima).
- **B — Node**: ⬜ `lib/daemon.js` + `lib/ws.js`; `routes/*.js` por grupo (tabela §1). Preservar métodos/URLs/middleware/contratos.
- **C — Design System**: ⬜ `public/ui/*` (tokens+componentes) aplicado ao painel (seletores/IDs preservados, log fixo à esquerda).
- **D — Front por jogo**: ❓ exigiria quebrar regra de JS embutido → **aguardar decisão**; demais etapas seguem independentes.
- **E — Assets Duelo + limpeza**: ❓ consolidar `corrida-eleitoral`→`public/duelo` só após verificar origem/caminhos/referências.

## 7. Progresso

- ✅ Fase A-1: `python/service_common.py` (emit/settings/rank_color) — extração neutra; `service.py` importa (compat). `py_compile` e `import service` OK.
- ⬜ A-2, B, C. ❓ D, E (dependem de decisões).
- ❓ Validação com LIVE real (sem acesso no ambiente atual — não simular como concluída).

## 8. Como validar cada etapa (sem LIVE)

- Evento direcionado ao jogo certo · presente/combos conforme semântica atual · áudio sem perda/duplicação · estado e broadcast iguais · reconexão e reinício · rotas e auth · dois streamers sem misturar estado · seletores/IDs preservados. Fallback: testes offline + sample de eventos anonimizados.

## 9. Limitações declaradas

- Sem acesso a LIVE neste ambiente → validação funcional de fluxos reais (gift da live, combo, áudio) é **não verificada**.
- `gift_diamonds`/matching ID-first dependem do catálogo sincronizado (já aplicado; `game.py` atualizado).

## 10. Progresso — atualização (2026-10-12)

- Fase A-1 concluída: `python/service_common.py` (emit, normalize_settings, DEFAULT_SETTINGS, get_rank_color) + doc.
- **Fase A-2 concluída:** `BatalhaEngine` extraído para `python/batalha.py` (importa `emit` de `service_common` e `db`); `service.py` agora usa `from batalha import BatalhaEngine` (classe removida do `service.py`). Equivalência verificada offline: `battle_state`/`battle_action` (payload type tap/coin)/`battle_round_end`/`battle_ranking`; `service.BatalhaEngine is batalha.BatalhaEngine`; `import service` OK.
- **Fase A-3 (motor 1) concluída:** `CacaPalavras` extraído para `python/jogos/caca.py` (extração byte-a-byte); `strip_accents` movido para `service_common.py`; `game.py` re-exporta (`from jogos.caca import CacaPalavras`) e `service.CacaPalavras is jogos.caca.CacaPalavras`. Verificado: `py_compile` + geração de grade + `find_word` + `import service`.
- **Fase A-3 (motor 2) concluída:** `VPetEngine` extraído para `python/jogos/vpet.py` junto às constantes `VPET_*`/`PHASE_*`/`BOSS_POOL` (sem refs externas à classe; `service.py` usa só `self.vpet.*`). `game.py` re-exporta (`from jogos.vpet import VPetEngine`; constantes saíram de `game`). Verificado: construção + `set_assistant_mode` + `public_state` + `import service`.
- **Caso/regressão corrigida:** a extração do VPet havia removido acidentalmente as constantes `TRES_*` (foram parar em `jogos/vpet.py`). Corrigido na A-3(3): `TRES_*` movidas para `jogos/tres.py` e removidas do vpet.
- **Fase A-3 (motor 4) concluída:** `JogoContexto` extraído para `python/jogos/palavra.py` (com `ALIAS_MAP`, `_INDEX_CACHE`, `DEFAULT_HISTORY_PATH`/`DEFAULT_GIFT_TAGS_PATH` e ajuste de caminhos via `_PYROOT`; usa `similarity.nlp`/`db`/`service_common`/`gifts_catalog.get_catalog`). `game.py` virou **fachada de re-exports** (`service`/`simular` continuam importando do mesmo lugar). Verificado: caminhos (words.json/gift-tags.json), `start_new_game` + `process_guess` (vitória), gift ID-first, `import service`, `simular`.
- **Fase A concluída** (extração Python completa): `service_common` (utils+strip_accents+GIFT_PT_MAP), `batalha`, `jogos/{caca,vpet,tres,palavra}`, `gifts_catalog.get_catalog`. `game.py` = fachada.
- **Fase B-1 (Node/daemon) concluída:** `node/lib/daemon.js` (classe `Daemon`: spawn/IO stdout→`onMessage`, stderr→`onStderr`, backoff/respawn, `send`, `kill`). `server.js` passou a usar o `Daemon` e manteve `handleDaemonMessage`/`msgTenant`/`daemonSend` (33 usos); sem refs antigas (`spawnDaemon`/`daemonPid`/`daemonBackoff`/`daemonRespawnTimer`). Verificado: `node --check` + restart ("Daemon ... iniciado" roteado) + `/api/gifts` 200.
- Pendente: **B-2+ (Node): `lib/ws.js` e `routes/*.js` por grupo**, C (Design System), D/E (aguardam decisões). Validação LIVE não verificada.