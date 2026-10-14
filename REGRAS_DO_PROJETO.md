# Regras e Diretrizes do Projeto - Jogo TikTok (Contexto)

Este documento contém todas as regras de negócio, convenções de código, correções de bugs e decisões arquiteturais estabelecidas no desenvolvimento do **Jogo TikTok (Contexto)**.

---

## 1. Regras de Negócio e Processamento de Palpites

### 1.1 Acentuação e Busca Accent-Insensitive
- As palavras secretas do dicionário (`words.json`) possuem **acentuação em português correto** (ex: `coração`, `água`, `árvore`, `atenção`, `sentença`).
- O processamento de palpites é **accent-insensitive** (normalizado via `unicodedata.normalize('NFD')` em Python e normalização em JS).
- Chutes sem acento (ex: `!atencao`) casam perfeitamente com a palavra secreta acentuada (`atenção`), sendo exibidos com a grafia correta do dicionário.

### 1.2 Formatação e Extração de Chutes do Chat
- **Apenas a primeira palavra**: Entradas com múltiplas palavras (ex: `@bolo de chocolate`) consideram apenas o primeiro token (`bolo`), ignorando o restante da frase.
- **Limpeza de Pontuação e Símbolos**: Pontuações e erros de digitação comuns de teclados móbile (`-`, `,`, `.`, `!`, `?`) são removidos automaticamente via regex (`re.sub(r"[^\w]", "", word)`).
- **Formato Customizado de Atribuição**: Suporte a palpites no formato `@palavra@usuario` ou `!palavra@usuario`, atribuindo a pontuação da palavra ao usuário especificado após o segundo `@`.

### 1.3 Bloqueio Estrito de Múltiplos Vencedores (Single-Winner Guarantee)
- A partida encerra **imediatamente** quando o palpite atinge o **Rank #1**.
- O handler de comentários em `service.py` e `game.py` valida `if self.game.finished: return None`.
- A função de salvamento em histórico (`save_result`) e emissão de evento `game_over` executa **exclusivamente uma única vez** para o acerto do Rank #1. Palpites recebidos nos segundos posteriores não declaram novos vencedores.

---

## 2. Sistema de Dicas por Presentes (Gift Config)

### 2.1 Mapeamento Bilíngue (EN <-> PT-BR)
- **Frontend**: Apresenta os nomes traduzidos dos presentes para português (ex: `Rose` ➔ `Rosa`, `Finger Heart` ➔ `Coração com os Dedos`, `Ice Cream` ➔ `Sorvete`, `Doughnut` ➔ `Rosquinha`).
- **Busca Flexível**: O campo de busca no painel de controle permite filtrar tanto pelo nome em Português quanto pelo nome em Inglês.
- **Backend (Persistência)**: Salva os identificadores originais esperados pela API TikTools no arquivo de configuração (`"Rose"`, `"Finger Heart"`).
- **Backend (Reconhecimento)**: No Python (`game.py`), o método `process_gift` compara os presentes recebidos na live de forma bilíngue (aceita tanto o nome enviado em inglês quanto em português).

### 2.2 Sincronização de Estado dos Presentes
- Ao salvar a configuração de presentes (`POST /api/gift-config`), a lista em memória (`tenant.gameState.hint_gifts`) é atualizada instantaneamente.
- Na rota `/api/game-state`, a lista salva do usuário tem prioridade para evitar que sincronizações secundárias sobrescrevam os presentes selecionados.
- O mapeamento de presentes no frontend utiliza fallback (`giftByName(n)?.name || n`) para evitar o descarte acidental de itens.

### 2.3 Final Boss (Modo Boss) — opcional
- Configuração **`boss_mode`** (bool, padrão **`true`**, via GET/POST `/api/settings`). O streamer escolhe na configuração da Palavra Secreta.
- **Com `boss_mode = true` (padrão/atual):** ao atingir **melhor rank <= 3** o **Final Boss** é ativado (`is_final_boss`), o presente ativo vira o **presente revelador** (`riddle_gifts[0]`, ou último `hint_gifts`, ou `"TikTok"`), outros gifts são rejeitados, enviar o revelador decretar **vitória instantânea** e a **meta de tap congela** (exibida como concluída).
- **Com `boss_mode = false`:** não há Final Boss (nenhum gift encerra a partida; o fim é apenas pelo palpite Rank #1). Ao chegar no mesmo nível de proximidade (melhor rank <= 3), a **zona protegida** entra em vigor:
  - A **meta de tap dobra (x2)** mantendo o progresso atual — disparada uma única vez por partida (evento `game/type=tap_meta_x2`; estado contínuo em `likes_ranking.tap_meta_multiplier`). O prêmio segue a roleta **dica/charada**.
  - **Dicas não podem revelar rank 1 e 2** (posições 1 = palavra secreta, 2 = segunda mais próxima); apenas rank **3+**. Vale para roleta de presentes, meta de tap e dica manual.
- Sessão nova hidrata `boss_mode` do banco (`tenant_settings`); mudança em runtime é propagada via comando `update_settings` (reavalia zona/x2).

---

## 3. Interface do Usuário (Frontend & UI)

### 3.1 Painel de Controle - Tela de Logs
- A caixa de logs (`.log-area`) possui barra de rolagem dedicada (`overflow-y: scroll`), `height` flexível e estilização de scrollbar customizada.
- Possui o botão **Copiar Logs** que copia todo o histórico formatado para a área de transferência via `navigator.clipboard`.
- Possui o botão **Limpar** para resetar a visualização da tela quando necessário.

### 3.2 Overlay de Dica Ativada (`dica-overlay`)
- Card centralizado via Flexbox (`align-items: center; justify-content: center;`).
- Imagem do presente definida com `display: block; margin: 0 auto 15px auto;` para centralização geométrica perfeita.
- Compensação de margem negativa (`margin-right` negativo) para anular o deslocamento de espaço extra gerado pela propriedade CSS `letter-spacing`.

### 3.3 Modal Pós-Partida ("Ver Palavras Próximas")
- **Botão Oculto no Jogo Active**: O botão `🔍 Ver Palavras Próximas (Pós-Partida)` permanece invisível durante a partida e é exibido **logo abaixo do painel da palavra secreta** (`.secret-display`) quando o jogo encerra.
- **Modal Overlay**: Exibe um modal responsivo (`width: 94%; max-width: 580px; height: 82vh;`) sobre a tela com fundo escuro borrado (`backdrop-filter: blur(4px)`).
- **Controles de Fechamento**: Suporta botão `×` no topo, botão "Fechar" no rodapé, clique fora no backdrop e tecla `ESC`.

---

## 4. Arquitetura e Execução de Processos

- **Servidor Web (Node.js/Express)**: Rodando na porta `3100`, gerenciando sessões WebSockets (`/browser`, `/logs`), persistência SQLite e rotas REST.
- **Daemon de NLP (Python `service.py`)**: Executado como filho do processo Node (`PYTHON_BIN`). Respawn automático com backoff exponencial se desconectado.
- **Modelo SpaCy**: Utiliza o modelo `pt_core_news_lg` para calcular a similaridade semântica por vetores entre palpites e a palavra secreta.

---

## 5. Design System / Tema Oficial TikPlay (visual)

Toda alteração **visual** (Painel Streamer, Super Admin, overlays e jogos) deve seguir o
documento **`docs/DESIGN_SYSTEM.md`** (documento vivo com diagnóstico, tokens, componentes e
o checklist de progresso).

Regras obrigatórias:

- **Antes de codar visual**, consultar `docs/DESIGN_SYSTEM.md` (§2 Diagnóstico e §10 Status).
- Usar **apenas tokens** de `ui/tikplay-theme.css` (proibido hex/px solto no CSS novo).
- Usar **apenas componentes** `.tp-*` (proibido criar botão/card/tabela por página).
- Identidade oficial: **PRETO + OFF-WHITE + AMARELO TikPlay** (`#111315`, `#fdfaf3`, `#fec90f`),
  com verde=positivo, vermelho/coral=destrutivo, azul=informação. Não trocar a paleta.
- Cada jogo pode ter **acento próprio** (Duelo azul/vermelho etc.) via override de escopo,
  sem sair da plataforma.
- **Preservar** IDs, classes usadas por JS, rotas, eventos, WebSockets, OBS, ranking, API,
  auth e permissões. Trocar classe só depois de atualizar **todas** as referências no JS.
- Ordem de implementação: tokens → componentes → header/nav → layout do Painel (LOG fixo à
  esquerda) → Duelo → demais jogos → Super Admin → limpeza (ver §9 do doc).
- Ao concluir uma etapa, atualizar o **Status/Progresso** em `docs/DESIGN_SYSTEM.md`.

---

## 6. Ajuda e Suporte (API backend)

Implementado em `node/routes/support.js` (registrado por `server.js`) com persistência em
`node/db.js`. Contrato completo em **`docs/suporte-contrato-api.md`**.

- **Escopo do backend:** apenas API/banco. Telas (`/suporte`, `/ajuda`), HTML/CSS/JS de
  interface e o registro das rotas amigáveis em `FRIENDLY_PAGES` são responsabilidade do
  agente de front-end.
- **Anexos:** somente **imagens** (png/jpg/jpeg/gif/webp/bmp/heic/heif), até **5 MB**; gravados
  em `node/data/support-files/<user_id>/` (fora de `public/`, ignorado pelo git) e entregues
  **apenas** por `GET /api/support/attachments/:id`, autenticado (dono do chamado ou admin).
- **Propriedade:** o streamer só acessa/responder/fecha os próprios chamados; o admin opera
  todos. `fechado` grava `closed_at`; reabrir (qualquer status ≠ `fechado`) limpa `closed_at`.
  `updated_at` do chamado muda em nova mensagem, mudança de status e novo anexo.
- **Enums e `game_id`** são validados no backend: `game_id` é slug
  (`palavra-secreta`, `tres`, `duelo`, `caca`, `batalha`, `bichinho`, `corda`). Statuses,
  prioridades e tipos de sugestão seguem o contrato e não devem divergir no front.
- **Central de Ajuda:** `GET /api/help/*` é leitura pública e só expõe artigos com
  `published = true`; o CRUD administrativo permite rascunho sem exposição pública.

---

## 7. Monitor de Servidor (API backend)

Implementado em `node/routes/monitor.js` + `node/lib/{metrics,monitor,monitor-sse}.js`, com
persistência em `node/db.js` (`monitor_incidents`, `monitor_silences`). Contrato completo em
**`docs/monitor-contrato-api.md`**. Escopo backend; telas/wallboard são do front.

- **Modelo híbrido:** polling REST para métricas (snapshot/series/widget) e **SSE** só para
  alertas/incidentes/status de serviço. O SSE usa **ticket de uso único** (60s) via
  `POST /api/admin/monitor/events-ticket` — nunca JWT na URL.
- **Falha isolada:** `snapshot`/`widget` nunca caem por uma métrica; seções que falham vão em
  `degraded_sections`. `series` preenche buckets vazios com zero.
- **Incidentes:** no máximo 1 ativo por `key` (sem duplicatas); `last_seen`/`detail`/`severity`
  são atualizados enquanto a condição persiste; `acknowledged` **não** impede resolução
  automática; silêncio suprime evento visível mas **não apaga histórico** e expira sozinho.
- **Medição:** 1 nó (VPS/PM2) + daemon Python; SQLite é conexão única (sem "nº de conexões");
  percentis p50/p95/p99 na janela documentada de **15 min**; taxa de erro (5xx) na janela de **5 min**.
- **Instrumentação:** o middleware ignora `req.path` que comece com `/api/admin/monitor`
  (inclui o stream SSE) para não distorcer a própria medição. Limiares vivem em
  `lib/monitor.js` (`THRESHOLDS`) e são expostos em `GET /api/admin/monitor/thresholds`.

---
*Documento exportado automaticamente para referência e governança do projeto.*
