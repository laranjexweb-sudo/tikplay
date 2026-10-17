# Ajuda e Suporte — Contrato da API (backend)

Documento de referência para o **agente de front-end**. Descreve os endpoints, payloads,
respostas, enums e regras já implementados no backend. Toda interface (HTML/CSS/JS) é de
responsabilidade do front; aqui não há telas.

- **Implementação:** `node/routes/support.js` (registrado em `node/server.js`).
- **Persistência:** `node/db.js` (mesmas funções exportadas nos nomes listados).
- **Base no servidor:** mesma origem do painel (ex.: `http://localhost:3100`).
- **Formato:** JSON, `{ "success": true, ... }` ou `{ "success": false, "error": "..." }`.

## 1. Autenticação e papéis

- **Streamer**: header `Authorization: Bearer <jwt>`. Vê/responder/fecha **apenas os próprios**
  chamados e acessa **apenas os anexos dos próprios** chamados.
- **Admin**: mesmo header, `role === "admin"`. Vê e opera todos os chamados, sugestões,
  categorias, respostas rápidas e artigos.
- **Central de Ajuda (`/api/help/*`)**: **leitura pública**, sem token; retorna **somente**
  artigos com `published = true`.
- Erros de auth: `401` sem/inválido token; `403` autenticado sem permissão.

## 2. Enums (validados no backend)

```
ticket.status:      novo | em_atendimento | aguardando_usuario | resolvido | fechado
ticket.priority:    baixa | normal | alta | urgente
message.sender_type: user | staff
suggestion.type:    nova_funcionalidade | melhoria | novo_jogo | melhoria_jogo | interface | integracao | outro
suggestion.status:  recebida | em_avaliacao | planejada | em_desenvolvimento | implementada | nao_planejada
game_id (slug):     palavra-secreta | tres | duelo | caca | batalha | bichinho | corda | quiz-live   (ou "" = nenhum)
```

`game_id` é **slug** (a tabela `games` existente é histórico de partidas, não um catálogo de jogos).
Os formulários atualmente exibem `palavra-secreta`, `caca`, `quiz-live` e `tres`; os demais slugs
permanecem válidos para compatibilidade com dados e fluxos antigos. `/api/support/games` retorna
essa lista em `games` e os nomes de exibição de todos os slugs em `game_labels`.
Valores fora da lista são rejeitados com `400`.

## 3. Tabelas

| Tabela | Campos principais |
|---|---|
| `support_categories` | `id, name, slug(unique), icon, sort_order, active` |
| `support_quick_replies` | `id, title, body, sort_order, active, created_at, updated_at` |
| `support_tickets` | `id, user_id, category_id, game_id, subject, status, priority, source_article_id, created_at, updated_at, closed_at` |
| `support_messages` | `id, ticket_id, sender_id, sender_type, message, created_at` |
| `support_attachments` | `id, ticket_id, message_id, file_path, mime_type, size, created_at` |
| `support_suggestions` | `id, user_id, type, game_id, title, description, status, created_at, updated_at` |
| `help_categories` | `id, name, slug(unique), icon, sort_order, active` |
| `help_articles` | `id, category_id, game_id, title, slug(unique), summary, content, keywords, published, sort_order, created_at, updated_at` |

Seed idempotente na inicialização: 7 categorias de suporte, 7 categorias de ajuda, 3 respostas
rápidas e 6 artigos de exemplo (5 publicados + 1 rascunho).

## 4. Endpoints — Streamer

### `GET /api/support/categories`
Categorias de chamado ativas.
```json
{ "success": true, "categories": [ { "id": 1, "name": "Problema técnico", "slug": "problema-tecnico", "icon": "", "sort_order": 0 } ] }
```

### `GET /api/support/games`
Listas de apoio para montar selects (jogos + enums).
```json
{ "success": true,
  "games": [ { "slug": "palavra-secreta", "name": "Palavra Secreta" }, { "slug": "duelo", "name": "Duelo 1x1" } ],
  "ticket_statuses": ["novo","em_atendimento","aguardando_usuario","resolvido","fechado"],
  "ticket_priorities": ["baixa","normal","alta","urgente"],
  "suggestion_types": ["nova_funcionalidade","melhoria","novo_jogo","melhoria_jogo","interface","integracao","outro"],
  "suggestion_statuses": ["recebida","em_avaliacao","planejada","em_desenvolvimento","implementada","nao_planejada"] }
```

### `POST /api/support/tickets` — Abrir chamado
Request:
```json
{
  "subject": "Presentes não estão ativando ações",
  "category_id": 3,
  "game_id": "duelo",
  "priority": "normal",
  "message": "Os presentes aparecem na live, mas não executam o golpe.",
  "source_article_id": 4,
  "source_article_slug": "presentes-nao-ativam-acoes"
}
```
- `subject`: 3–140 chars (obrigatório).
- `message`: 5–5000 chars (obrigatório; vira a 1ª mensagem do chamado).
- `category_id`, `game_id`, `priority`, `source_article_id`/`source_article_slug`: opcionais.
  Aceita `source_article_id` (número) **ou** `source_article_slug` (string) — usado no
  "Ainda não resolveu?" da Central de Ajuda.
- Resposta `201`: `{ "success": true, "ticket": { ... } }` (`ticket.status` nasce `novo`).

### `GET /api/support/tickets`
Filtros: `status`, `page`, `pageSize` (padrão 20, máx 100).
```json
{ "success": true, "items": [ { "id": 1, "subject": "...", "status": "em_atendimento", "priority": "alta", "game_id": "duelo", "category_id": 3, "category_name": "Presentes", "created_at": "...", "updated_at": "...", "closed_at": null } ],
  "total": 1, "page": 1, "pageSize": 20,
  "counts": { "novo": 0, "em_atendimento": 1, "aguardando_usuario": 0, "resolvido": 0, "fechado": 0 } }
```

### `GET /api/support/tickets/:id`
Detalhe com conversa e anexos.
```json
{ "success": true,
  "ticket": { "id": 1, "subject": "...", "status": "...", "category_name": "Presentes", "user_id": 2, ... },
  "messages": [ { "id": 1, "ticket_id": 1, "sender_id": 2, "sender_type": "user", "sender_name": "Streamer", "message": "...", "created_at": "..." } ],
  "attachments": [ { "id": 5, "ticket_id": 1, "message_id": null, "mime_type": "image/png", "size": 1234, "created_at": "..." } ] }
```
> O anexo **não** inclui URL: baixe via `GET /api/support/attachments/:id`.

### `POST /api/support/tickets/:id/messages` — Responder (usuário)
Request `{ "message": "..." }` (1–5000). Resposta:
```json
{ "success": true, "message": { "id": 3, "sender_type": "user", "message": "...", "created_at": "..." }, "ticket": { "status": "em_atendimento", ... } }
```
- Chamado `fechado` → `400`.
- Se estava `aguardando_usuario`, volta automaticamente para `em_atendimento`.

### `POST /api/support/tickets/:id/close` — Fechar (usuário)
Resposta `{ "success": true, "ticket": { "status": "fechado", "closed_at": "...", ... } }`.

### `POST /api/support/tickets/:id/attachments` — Anexar imagens (usuário)
`multipart/form-data`, campo **`files`** (até 5 arquivos), campo opcional `message_id`.
Ver §7 (validação/proteção). Resposta `201`:
```json
{ "success": true, "attachments": [ { "id": 5, "ticket_id": 1, "message_id": null, "mime_type": "image/png", "size": 1234, "created_at": "..." } ] }
```

### `GET /api/support/attachments/:id` — Baixar anexo
Retorna o binário (`Content-Type` da imagem). Permitido para o dono do chamado ou admin; senão
`403`. `404` se o anexo/arquivo não existir.

### `POST /api/support/suggestions` — Enviar sugestão
```json
{ "type": "melhoria", "game_id": "palavra-secreta", "title": "Ranking mensal", "description": "Explique como gostaria que funcionasse." }
```
- `title`: 3–140 (obrigatório). `description`: ≤5000. `type`/`game_id` opcionais.
- Resposta `201`: `{ "success": true, "suggestion": { "id": 1, "status": "recebida", ... } }`.
- **Sugestões não têm conversa** nesta versão.

### `GET /api/support/suggestions`
Filtros: `status`, `page`, `pageSize`. Retorna `{ success, items, total, page, pageSize }`.

## 5. Endpoints — Central de Ajuda (público, sem auth)

### `GET /api/help/categories`
`{ "success": true, "categories": [ { "id": 1, "name": "Primeiros passos", "slug": "primeiros-passos", "icon": "🚀", "sort_order": 0 } ] }`

### `GET /api/help/articles`
Filtros: `category_id`, `game_id`, `q`, `page`, `pageSize` (até 200).
- `q` busca em **`title`, `summary` e `keywords`**.
- Somente artigos `published = true`.
- Resposta: `{ success, items, total, page, pageSize }`, com `category_name`/`category_slug`.

### `GET /api/help/articles/:slug`
`{ "success": true, "article": { "id": 4, "title": "...", "summary": "...", "content": "...", "keywords": "...", "category_name": "...", "game_id": "palavra-secreta", ... } }`
`404` se não existir **ou** se for rascunho (`published = false`).

> Estrutura sugerida de artigo (markdown simples no `content`): Título → Resumo rápido →
> Como fazer → O que deve acontecer → Problemas comuns → Ainda não resolveu?
> (o último botão abre um chamado com `source_article_id`/`source_article_slug`).

## 6. Endpoints — Admin (requer `role: admin`)

| Método / rota | Descrição |
|---|---|
| `GET /api/admin/support/overview` | Contadores: `tickets` (por status), `suggestions` (por status), `resolved_this_week`. |
| `GET /api/admin/support/tickets` | Filtros: `status`, `category_id`, `game_id`, `priority`, `q` (assunto/e-mail/nome), `page`, `pageSize`. |
| `GET /api/admin/support/tickets/:id` | Detalhe + `messages` + `attachments` + `quick_replies` (ativas). |
| `POST /api/admin/support/tickets/:id/messages` | Resposta do suporte `{ message, status? }`. `status` opcional define o novo status; sem ele, `novo → em_atendimento`. |
| `POST /api/admin/support/tickets/:id/status` | `{ "status": "aguardando_usuario" }`. `fechado` grava `closed_at`; qualquer outro status **limpa** `closed_at` (reabertura). |
| `GET /api/admin/support/suggestions` | Filtros: `status`, `type`, `game_id`, `q`, `page`, `pageSize`. |
| `POST /api/admin/support/suggestions/:id/status` | `{ "status": "planejada" }`. |
| `GET /api/admin/support/categories` | Inclui inativas. |
| `POST /api/admin/support/categories` | Cria/atualiza (`id` opcional). Campos: `name, slug?, icon, sort_order, active`. Slug gerado se ausente. |
| `DELETE /api/admin/support/categories/:id` | Remove categoria. |
| `GET /api/admin/support/quick-replies` | Lista (inclui inativas). |
| `POST /api/admin/support/quick-replies` | Cria/atualiza (`id` opcional): `title, body, sort_order, active`. |
| `DELETE /api/admin/support/quick-replies/:id` | Remove resposta rápida. |
| `GET /api/admin/help/categories` | Categorias da ajuda (inclui inativas). |
| `POST /api/admin/help/categories` | Cria/atualiza: `name, slug?, icon, sort_order, active`. |
| `DELETE /api/admin/help/categories/:id` | Remove categoria da ajuda. |
| `GET /api/admin/help/articles` | Filtros: `category_id`, `game_id`, `q`, `published` (`1`/`0`), `page`, `pageSize`. |
| `GET /api/admin/help/articles/:id` | Artigo por id (inclui rascunhos). |
| `POST /api/admin/help/articles` | Cria/atualiza (`id` opcional): `title, slug?, category_id, game_id, summary, content, keywords, published, sort_order`. |
| `DELETE /api/admin/help/articles/:id` | Remove artigo. |

Regras de `updated_at` do chamado: é atualizado a cada **nova mensagem**, **mudança de status**
e **anexo** adicionado.

## 7. Anexos — validação e proteção

- **Somente imagens**: extensão em `png|jpg|jpeg|gif|webp|bmp|heic|heif` **e** `Content-Type image/*`.
  Arquivos fora disso são ignorados (se nenhum válido sobrar → `400`).
- **Limite**: 5 MB por arquivo; até 5 arquivos por requisição (`400` se exceder).
- **Armazenamento**: `node/data/support-files/<user_id>/<arquivo>` — **fora de `public/`** e
  ignorado pelo git (`node/data/` está no `.gitignore`).
- **Acesso**: apenas por `GET /api/support/attachments/:id`, autenticado; o dono do chamado ou
  admin. Outros recebem `403`. O servidor valida o caminho resolvido (evita path traversal) e
  não expõe `file_path` nas respostas.

## 8. Erros

- `400` — payload inválido (tamanho de campos, jogo/status inválido, arquivo grande/sem imagem).
- `401` — sem token válido.
- `403` — sem permissão (chamado/anexo de outro usuário; rota admin sem papel).
- `404` — recurso inexistente, anexo/arquivo faltando, artigo rascunho na rota pública.

## 9. Pontos que o agente de front precisa respeitar

1. **Não** crie endpoints próprios para suporte/ajuda; use os acima.
2. Datas vêm em **UTC** (`datetime('now')`), formato `YYYY-MM-DD HH:MM:SS`. Converta para
   exibição local se necessário.
3. Anexo ≠ URL: sempre renderize imagens via `GET /api/support/attachments/:id` **com o token**
   (não embuta `<img src="/api/support/attachments/1">` sem auth).
4. `game_id` deve usar **exatamente** os slugs da §2.
5. Sugestões não possuem thread de mensagens.
6. Enums são a fonte de verdade: renderize selects a partir de `GET /api/support/games`
   (e `GET /api/support/categories`).
7. Artigos rascunho **não** aparecem em `/api/help/*`; use as rotas admin para editá-los.
8. **Rotas amigáveis** (`/suporte`, `/ajuda`) ainda **não** foram adicionadas em
   `FRIENDLY_PAGES` no `server.js`. Quando os HTML existirem, o front deve pedir/registrar:
   `"/suporte": "support.html"` e `"/ajuda": "help.html"` (evita rota quebrada enquanto o
   arquivo não existe). Hoje `node/public/*.html` já é servido direto pelo static.

## 10. Como validar manualmente

```powershell
# na pasta jogo-contexto/node
npm install
npm start            # sobe em http://localhost:3100 (spawna o daemon Python)
```

1. `GET /api/help/categories` (sem token) → 7 categorias.
2. `GET /api/help/articles?q=presente` (sem token) → itens publicados.
3. `GET /api/help/articles/planos-e-limites` (sem token) → **404** (rascunho).
4. Logado como streamer: `POST /api/support/tickets` → `201`; responder; fechar.
5. Logado como outro streamer: acessar o chamado do primeiro → **403**.
6. Logado como admin: `GET /api/admin/support/overview`; responder (vira `em_atendimento`);
   mudar status; reabrir (limpa `closed_at`).
7. Anexar uma imagem no chamado e baixar via `/api/support/attachments/:id` (dono/admin).
8. Admin: CRUD de categoria de ajuda e de artigo (criar rascunho → não aparece no público).

Autentique com `Authorization: Bearer <jwt>` (obtido no login do painel).

## 11. Dependências

Nenhuma dependência nova: usa `express`, `multer`, `better-sqlite3`, `jsonwebtoken` e `bcryptjs`
já presentes em `node/package.json`. `package.json` **não** foi alterado.
