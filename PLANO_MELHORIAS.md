# Plano de Melhorias — Jogo Contexto TikTok LIVE

**Data:** 2026-01-31  
**Escopo:** Backend (Python), Frontend (HTML/JS), Servidor (Node.js), CSS  
**Total de orientações:** 23  
**Status geral:** 🔄 Em análise

---

## Seção 1: CRÍTICO

### C-01: Chaves de API expostas em texto plano

**Severidade:** 🔴 CRÍTICO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `python/service.py:44` — `DEFAULT_OPENROUTER_KEY = "sk-or-v1-..."`
- `python/tiktools_key.txt` — chave Tik.Tools em arquivo texto

**Descrição:**  
Duas chaves de API reais estão hardcoded no código-fonte e em arquivo texto. Qualquer pessoa com acesso ao repositório pode usar essas chaves, gerando custos e risco de abuso.

**Correção proposta:**
1. Remover `DEFAULT_OPENROUTER_KEY` de `service.py`
2. Mover ambas as chaves para variáveis de ambiente:
   ```python
   import os
   OPENROUTER_KEY = os.environ.get("OPENROUTER_KEY")
   if not OPENROUTER_KEY:
       raise ValueError("OPENROUTER_KEY não configurada")
   ```
3. Adicionar `.env` ao `.gitignore`
4. **Rotacionar as chaves imediatamente** (as atuais já foram expostas)
5. Documentar no README como configurar as variáveis

**Dependências:** Nenhuma

---

### C-02: Duplo-broadcast de `riddle_started`/`riddle_ready`

**Severidade:** 🔴 CRÍTICO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/server.js:112-118` — side-effect broadcast dentro de `updateGameState`
- `node/server.js:235` — broadcast em `handleDaemonMessage`

**Descrição:**  
Os eventos `riddle_started` e `riddle_ready` são broadcastados **2x** para browser clients:
1. Dentro de `updateGameState` (linhas 112-118) → broadcast para `browserClients`
2. Em `handleDaemonMessage` (linha 235) → broadcast para `browserClients` **E** `logClients`

Resultado: browser recebe 2x, log recebe 1x. Isso causa duplicação de eventos no frontend.

**Correção proposta:**
```javascript
// REMOVER estas linhas de dentro do updateGameState:
// case "riddle_started":
//   broadcastToClients(tenant.browserClients, msg);  // ← REMOVER
//   break;
// case "riddle_ready":
//   broadcastToClients(tenant.browserClients, msg);  // ← REMOVER
//   break;

// Manter apenas o broadcast em handleDaemonMessage:
} else if (msg.type === "game") {
  updateGameState(tenant, msg.msg || {});
  broadcastToClients(tenant.browserClients, msg.msg || {});
  broadcastToClients(tenant.logClients, msg.msg || {});
}
```

**Dependências:** Testar fluxo de enigmas após correção

---

## Seção 2: ALTO

### A-01: HTML inválido — `</div>` não fechado no `#postGameModal`

**Severidade:** 🟠 ALTO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/web-game.html:114`
- `node/public/obs-overlay.html:131`

**Descrição:**  
O `<div id="postGameModal">` nunca é fechado. O navegador fecha automaticamente, mas é HTML inválido e pode causar problemas de parsing em ferramentas de análise.

**Correção proposta:**
```html
<!-- Adicionar </div> após o fechamento de .pg-modal-card -->
<div id="postGameModal" class="pg-modal-overlay" style="display:none">
  <div class="pg-modal-backdrop" onclick="closePostGameModal()"></div>
  <div class="pg-modal-card">
    <!-- ... conteúdo ... -->
  </div>
</div>  <!-- ← ADICIONAR ESTE FECHAMENTO -->
```

**Dependências:** Nenhuma

---

### A-02: Inconsistência @username vs nickname em toda interface

**Severidade:** 🟠 ALTO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/web-game.html` — `renderGuesses`, `renderNewGuessAtTop`, `renderWinners`
- `node/public/obs-overlay.html` — `renderGuesses`, `renderNewGuessAtTop`, `renderWinners`

**Descrição:**  
Diferentes funções usam diferentes campos para exibir o usuário:
- `renderGuesses` (web-game): `g.user` (com `@`)
- `renderGuesses` (obs-overlay): `g.nickname` (sem `@`)
- `renderNewGuessAtTop` (ambos): `@nickname`
- `renderWinners` (web-game): `@username`
- `renderWinners` (obs-overlay): `nickname` puro

Isso causa inconsistência visual entre as páginas e dentro da mesma página.

**Correção proposta:**
Padronizar **todas** as funções para usar:
```javascript
const displayName = "@" + (g.user || g.nickname || "?");
```

Aplicar em:
- `renderGuesses` (ambos os arquivos)
- `renderNewGuessAtTop` (ambos)
- `renderWinners` (ambos)

**Dependências:** Testar com usuários reais do TikTok (verificar se `user` sempre existe)

---

### A-03: Ordem do DOM da guess-row diferente entre páginas

**Severidade:** 🟠 ALTO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/web-game.html` — `renderGuesses`, `renderNewGuessAtTop`
- `node/public/obs-overlay.html` — `renderGuesses`, `renderNewGuessAtTop`

**Descrição:**  
A ordem dos elementos no DOM é diferente:
- **web-game**: `#rank → palavra → #DICA → linha → avatar → @user`
- **obs-overlay**: `avatar → #rank → palavra → #DICA → linha → nickname`

Isso causa layout visual diferente entre as duas páginas.

**Correção proposta:**
Padronizar **ambas** as páginas na ordem do web-game:
```javascript
row.appendChild(rank);
row.appendChild(word);
if (g.is_hint) row.appendChild(dica);
row.appendChild(line);
row.appendChild(avatar);
row.appendChild(nickname);
```

Aplicar em `renderGuesses` e `renderNewGuessAtTop` de ambos os arquivos.

**Dependências:** Testar layout visual após correção

---

## Seção 3: MÉDIO

### M-01: Sem rate-limit em `/api/auth/register`

**Severidade:** 🟡 MÉDIO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/server.js:318-342` — rota `/api/auth/register`

**Descrição:**  
A rota de login tem limite de 10 tentativas/minuto por IP, mas a rota de registro não tem nenhum limite. Se `REGISTER_ENABLED !== "false"`, um atacante pode floodar o sistema com registros.

**Correção proposta:**
```javascript
const registerRateLimit = new Map();

app.post("/api/auth/register", (req, res) => {
  if (process.env.REGISTER_ENABLED === "false") {
    return res.status(403).json({ success: false, error: "Registro desabilitado" });
  }
  
  const ip = req.ip;
  const now = Date.now();
  const attempts = registerRateLimit.get(ip) || [];
  const recent = attempts.filter(t => now - t < 60000);
  
  if (recent.length >= 5) {  // 5 registros/minuto
    return res.status(429).json({ success: false, error: "Muitos registros. Tente novamente em 1 minuto." });
  }
  
  recent.push(now);
  registerRateLimit.set(ip, recent);
  
  // ... resto do código de registro ...
});
```

**Dependências:** Nenhuma

---

### M-02: `clear_api_key` aceita qualquer valor truthy

**Severidade:** 🟡 MÉDIO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/server.js:428` — `if (clear_api_key)`
- `node/server.js:433` — `if (clear_username)`

**Descrição:**  
O código usa `if (clear_api_key)` que aceita qualquer valor truthy. Enviar `{"clear_api_key": "false"}` (string) é truthy e **limpa** a chave, comportamento inesperado.

**Correção proposta:**
```javascript
// Substituir:
if (clear_api_key) {
  fields.tiktools_api_key = "";
}

// Por:
if (clear_api_key === true) {
  fields.tiktools_api_key = "";
}
```

Aplicar também para `clear_username`.

**Dependências:** Nenhuma

---

### M-03: Bug @menção — avatar fica com o avatar de quem enviou, não de quem foi mencionado

**Severidade:** 🟡 MÉDIO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `python/service.py:191-196` — lógica de @menção em `on_comment`
- `python/game.py:117` — `process_guess` não seta `winner_nickname`/`winner_avatar`

**Descrição:**  
Quando alguém chuta com `!palavra @outraPessoa`:
1. O palpite é atribuído à `@outraPessoa` (correto)
2. Mas o avatar usado é o **do comentarista** (errado)
3. `winner_nickname` e `winner_avatar` só são setados em `save_result()`, não em `process_guess()` — podem conter valores stale entre jogos

**Correção proposta:**
```python
# Em service.py:on_comment, após detectar @menção:
# Opção 1: Buscar avatar do usuário mencionado (requer chamada à API do TikTok)
# Opção 2: Usar avatar do comentarista mas logar aviso
# Opção 3: Desabilitar @menção completamente (mais simples)

# Em game.py:process_guess, ao detectar winner:
if word == self.secret_word:
    self.finished = True
    self.winner = user
    self.winner_nickname = nickname  # ← ADICIONAR
    self.winner_avatar = avatar      # ← ADICIONAR
```

**Dependências:** Decidir se @menção deve ser mantida ou removida

---

### M-04: Gift não encontrado no catálogo = falha silenciosa

**Severidade:** 🟡 MÉDIO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `python/game.py:279-288` — lógica de `gift_diamonds` em `process_gift`

**Descrição:**  
Se `hint_gifts` contém um nome que **não existe** em `_gift_tags`, `gift_diamonds` fica vazio e a função retorna `None` **sem log**. O gift do usuário é consumido mas nenhuma dica é gerada, sem feedback.

**Correção proposta:**
```python
gift_diamonds = []
for g in self.hint_gifts:
    g_lower = g.lower()
    for tag in self._gift_tags:
        if tag["name"].lower() == g_lower:
            gift_diamonds.append(tag["diamond_count"])
            break

if not gift_diamonds:
    # ADICIONAR LOG:
    print(f"[WARN] Gift '{gift_name}' não encontrado no catálogo. hint_gifts={self.hint_gifts}", file=sys.stderr)
    return {"user": user, "gift": gift_name, "hint": None, "rank": None}
```

**Dependências:** Nenhuma

---

### M-05: CSS — breakpoints de responsivo diferentes

**Severidade:** 🟡 MÉDIO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/style.css:580px` — `.gifts-wrapper`
- `node/public/style.css:600px` — `.game-layout`

**Descrição:**  
`.gifts-wrapper` quebra em 580px, `.game-layout` quebra em 600px. Entre 581-600px, o layout fica inconsistente (gifts em 2 colunas, game-layout em 1 coluna).

**Correção proposta:**
```css
/* Unificar em 600px: */
@media (max-width: 600px) {
  .gifts-wrapper {
    grid-template-columns: 1fr;
  }
  .compact .game-layout {
    grid-template-columns: 1fr;
  }
}
```

**Dependências:** Testar em dispositivos móveis

---

### M-06: `likes_ranking` não reseta entre partidas

**Severidade:** 🟡 MÉDIO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `python/service.py` — `self.likes` em `GameSession`

**Descrição:**  
`self.likes` acumula durante toda a sessão (da live). Se a intenção fosse resetar por partida, está errado. Atualmente é **por design** (ranking da live inteira), mas não está documentado.

**Correção proposta:**
```python
# Opção 1: Manter como está (ranking da live) e documentar:
# Em service.py:start_game(), adicionar comentário:
# "likes_ranking acumula durante toda a sessão (não reseta por partida)"

# Opção 2: Resetar por partida:
async def start_game(self, hint_gifts=None):
    self.game.start_new_game(hint_gifts=hint_gifts)
    self.likes = {}  # ← ADICIONAR SE QUISER RESETAR
    # ... resto do código ...
```

**Dependências:** Decidir comportamento desejado (ranking da live vs por partida)

---

### M-07: `startShakeInterval()` ausente no obs-overlay

**Severidade:** 🟡 MÉDIO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/obs-overlay.html` — handler de `game_start`

**Descrição:**  
web-game chama `startShakeInterval()` no `game_start`, mas obs-overlay não. A animação de shake do gift de enigma nunca roda no overlay.

**Correção proposta:**
```javascript
// Em obs-overlay.html, no handler de game_start:
case "game_start":
  applyGameStart(msg);
  startShakeInterval();  // ← ADICIONAR
  break;
```

**Dependências:** Verificar se `startShakeInterval` está definida no obs-overlay (se não estiver, copiar do web-game)

---

## Seção 4: BAIXO

### B-01: CSS morto — `.guess-user`

**Severidade:** 🟢 BAIXO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/style.css:153-156`

**Descrição:**  
Classe `.guess-user` nunca é usada. O código sempre usa `.guess-nickname`.

**Correção proposta:**
```css
/* REMOVER estas linhas: */
.guess-user {
  font-size: 0.7em;
  color: #9CA3AF;
}
```

**Dependências:** Nenhuma

---

### B-02: CSS morto — `.winner-sep` e `.winner-word`

**Severidade:** 🟢 BAIXO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/style.css` — regras para `.winner-sep` e `.winner-word`

**Descrição:**  
Essas classes são órfãs no web-game (não são renderizadas pelo JS). Podem ser usadas pelo obs-overlay, mas estão inconsistentes.

**Correção proposta:**
Verificar se obs-overlay usa essas classes. Se não usar, remover. Se usar, padronizar.

**Dependências:** Verificar obs-overlay

---

### B-03: CSS morto — `.main-column` e `.side-column`

**Severidade:** 🟢 BAIXO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/style.css:281-288`

**Descrição:**  
Classes `.main-column` e `.side-column` foram substituídas por `.gl-main` e `.gl-side`.

**Correção proposta:**
```css
/* REMOVER estas linhas: */
.game-layout .main-column {
  width: 100%;
  min-width: 0;
}
.game-layout .side-column {
  width: 100%;
}
```

**Dependências:** Nenhuma

---

### B-04: `.guess-dica` definido em 3 lugares

**Severidade:** 🟢 BAIXO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/style.css` — `.compact .guess-dica`
- `node/public/web-game.html` — inline `.guess-dica`
- `node/public/obs-overlay.html` — inline `.guess-dica`

**Descrição:**  
A mesma classe é definida em 3 lugares, causando duplicação e dificuldade de manutenção.

**Correção proposta:**
Manter apenas em `style.css`, remover dos inline styles dos HTML.

**Dependências:** Nenhuma

---

### B-05: Dead code Python — `similarity.rank_guess()`

**Severidade:** 🟢 BAIXO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `python/similarity.py` — função `rank_guess()`

**Descrição:**  
Função nunca é chamada. `game.py` implementa sua própria lógica de ranking.

**Correção proposta:**
Remover a função ou documentar que é legacy/deprecated.

**Dependências:** Nenhuma

---

### B-06: Dead code Python — `service.py:109`

**Severidade:** 🟢 BAIXO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `python/service.py:109`

**Descrição:**  
Linha `self.queue = asyncio.create_task if False else asyncio.Queue()` tem `asyncio.create_task` inalcançável (condição sempre False).

**Correção proposta:**
```python
# Substituir por:
self.queue = asyncio.Queue()
```

**Dependências:** Nenhuma

---

### B-07: Sem backoff nas páginas browser

**Severidade:** 🟢 BAIXO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/web-game.html` — reconexão WS
- `node/public/obs-overlay.html` — reconexão WS
- `node/public/obs-ranking.html` — reconexão WS

**Descrição:**  
WS `/browser` reconecta a cada 3s fixos sem exponencial. O painel `/logs` tem backoff correto (exponencial com cap).

**Correção proposta:**
```javascript
// Adicionar backoff exponencial:
let wsRetry = 0;

ws.onclose = () => {
  const delay = Math.min(1000 * Math.pow(2, wsRetry), 10000);
  wsRetry++;
  setTimeout(connectWS, delay);
};

ws.onopen = () => {
  wsRetry = 0;  // Reset on success
  // ... resto do código ...
};
```

**Dependências:** Nenhuma

---

### B-08: `#statusBadge` no web-game sempre oculto

**Severidade:** 🟢 BAIXO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/web-game.html` — elemento `#statusBadge`

**Descrição:**  
O elemento `#statusBadge` tem `display:none` e nunca é mostrado. É um "fantasma" no código.

**Correção proposta:**
Opção 1: Remover o elemento completamente  
Opção 2: Torná-lo visível (adicionar estilo e lógica de exibição)

**Dependências:** Decidir se o badge deve ser mostrado

---

### B-09: `readJsonFile()` exportado mas nunca usado

**Severidade:** 🟢 BAIXO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/db.js` — função `readJsonFile()`

**Descrição:**  
Função é exportada mas nunca chamada no `server.js`.

**Correção proposta:**
Remover a função ou usá-la consistentemente no lugar de `JSON.parse(fs.readFileSync(...))`.

**Dependências:** Nenhuma

---

### B-10: Scrollbar thumb do modal pós-partida

**Severidade:** 🟢 BAIXO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/style.css` — `.pg-modal-body::-webkit-scrollbar-thumb`

**Descrição:**  
Usa `#374151` enquanto o scrollbar global usa `#334155`. Divergência sutil.

**Correção proposta:**
Unificar em `#334155` ou documentar a divergência intencional.

**Dependências:** Nenhuma

---

### B-11: `#555577` no web-game.html linha 64

**Severidade:** 🟢 BAIXO  
**Status:** ⬜ Pendente  
**Arquivos afetados:**
- `node/public/web-game.html:64`

**Descrição:**  
Cor órfã do tema antigo. Não faz parte da paleta atual.

**Correção proposta:**
```html
<!-- Substituir: -->
<div style="... color: #555577;">
<!-- Por: -->
<div style="... color: #4B5563;">
```

**Dependências:** Nenhuma

---

## Seção 5: Checklist de execução

### Fase 1: Segurança (Crítico)
- [ ] **C-01**: Remover chaves expostas e rotacionar
- [ ] **C-02**: Corrigir duplo-broadcast de riddle

### Fase 2: Bugs de UI (Alto)
- [ ] **A-01**: Fechar `</div>` do postGameModal
- [ ] **A-02**: Padronizar @username vs nickname
- [ ] **A-03**: Padronizar ordem DOM da guess-row

### Fase 3: Segurança e Validação (Médio)
- [ ] **M-01**: Adicionar rate-limit em register
- [ ] **M-02**: Corrigir `clear_api_key` truthy
- [ ] **M-03**: Corrigir avatar de @menção
- [ ] **M-04**: Adicionar log para gift não encontrado
- [ ] **M-05**: Unificar breakpoints CSS
- [ ] **M-06**: Decidir comportamento de `likes_ranking`
- [ ] **M-07**: Adicionar `startShakeInterval` no obs-overlay

### Fase 4: Limpeza e Manutenção (Baixo)
- [ ] **B-01 a B-11**: Remover dead code, CSS morto, padronizações

---

## Seção 6: Notas técnicas

### Arquitetura do sistema

```
┌─────────────────────────────────────────────────────────────┐
│  Python Daemon (service.py)                                 │
│  - GameSession por tenant                                   │
│  - TikToolsHandler (WebSocket TikTok)                       │
│  - JogoContexto (lógica do jogo)                            │
│  - Likes acumulação                                         │
└────────────────────────┬────────────────────────────────────┘
                         │ stdout JSON (newline-delimited)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Node.js Server (server.js)                                 │
│  - Express HTTP server                                      │
│  - WebSocket server (/logs, /browser)                       │
│  - Daemon message handler                                   │
│  - Game state management                                    │
└────────────────────────┬────────────────────────────────────┘
                         │ WebSocket + HTTP
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend (HTML/JS)                                         │
│  - web-game.html (página principal do jogo)                 │
│  - obs-overlay.html (overlay para OBS)                      │
│  - obs-ranking.html (ranking de curtidas)                   │
│  - control-panel.html (painel administrativo)               │
└─────────────────────────────────────────────────────────────┘
```

### Fluxo de eventos

1. **TikTok Live** → `TikToolsHandler` captura eventos (chat, gift, like)
2. **Handler** → chama callbacks (`on_comment`, `on_gift`, `on_like`)
3. **Callbacks** → processam lógica (`process_guess`, `process_gift`, acumula likes)
4. **Emit** → envia JSON via stdout para Node.js
5. **Node.js** → atualiza `gameState`, broadcasta para WebSocket clients
6. **Frontend** → recebe eventos via WebSocket, atualiza DOM

### Convenções de nomenclatura

- **`user`**: TikTok `uniqueId` (ex: `@iampeu`)
- **`nickname`**: Nome de exibição do TikTok (ex: `🍟❤️🔥 PEU ❤️‍🍟`)
- **`avatar`**: URL da foto de perfil
- **`gift_name`**: Nome do gift em inglês (ex: `Rose`, `TikTok`)
- **`diamond_count`**: Valor em diamantes do gift

### Paleta de cores (tema dark flat)

| Cor | Uso |
|-----|-----|
| `#0F111A` | Background mais profundo |
| `#1C1E26` | Cards/painéis |
| `#8B5CF6` | Roxo primário (botões, destaques) |
| `#9CA3AF` | Texto secundário |
| `#A78BFA` | Roxo claro (acentos) |
| `#FBBF24` | Dourado (sucesso, troféus) |
| `#10B981` | Verde (status positivo) |
| `#334155` | Scrollbar thumb |

---

**Fim do documento**
