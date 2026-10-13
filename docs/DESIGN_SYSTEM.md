# TikPlay — Design System Oficial (tema reutilizável)

> **Documento vivo.** Toda alteração visual do TikPlay (Painel Streamer, Super Admin,
> overlays e jogos) deve seguir este documento. Antes de codar visual, leia a seção
> **Status / Progresso** para saber o que já foi feito e o que falta.

- **Última atualização:** 2026-10-12
- **Escopo:** Node `node/public/*` (HTML/CSS/JS embutido) + `node/public/style.css`
- **Regra de ouro:** refatoração **visual e estrutural de CSS/componentes**. Não alterar
  lógica de jogo, rotas, IDs, eventos, WebSockets, APIs, banco, auth, permissões, OBS,
  ranking nem nomes de eventos (ver `REGRAS_DO_PROJETO.md`).

---

## 0. COMO USAR ESTE DOCUMENTO

1. **Antes** de mexer no visual, leia **§2 Diagnóstico** e **§10 Status/Progresso**.
2. Use **somente** tokens de **§3** (nada de hex solto no CSS novo).
3. Use **somente** componentes de **§4** (nada de botão/card “inventado” por página).
4. Siga a ordem de implementação de **§9** (não refatorar tudo de uma vez).
5. Ao concluir uma etapa, marque o checkbox em **§10** e atualize a data no topo.
6. Se uma mudança estrutural exigir alteração funcional, **pare e documente** aqui antes.

---

## 1. Identidade visual

Mistura coerente de **console de streaming + arcade + painel SaaS + ferramenta de produção
de live**. Precisa ser imediatamente reconhecível como **TikPlay**.

Base: **PRETO + OFF-WHITE + AMARELO TIKPLAY**. Cores semânticas:

| Cor | Uso |
|---|---|
| 🟡 Amarelo | TikPlay / seleção / ação principal / atenção |
| 🟢 Verde | ativo / iniciar / sucesso |
| 🔴 Vermelho/coral | parar / excluir / perigo |
| 🔵 Azul | informação / lado azul / ferramenta |
| ⚫ Preto/grafite | navegação / contraste |

Características: fundo claro levemente quente, contornos pretos, cards bem definidos,
cantos arredondados, tipografia forte nos títulos, ícones simples, sombras discretas,
interface compacta mas legível.

**Evitar:** excesso de gradientes, glassmorphism, transparências exageradas, neon genérico
futurista, sombras gigantes, visual Bootstrap/Material padrão, bordas finas, minimalismo excessivo.

> ⚠️ **Divergência conhecida:** hoje o **Painel/SaaS** já é claro (`#fdfaf3`, bordas pretas,
> amarelo `#fec90f`), enquanto as **telas de jogo** são escuras (`#0F111A`/`#000`, roxo
> `#8B5CF6`, âmbar `#FBBF24`). O Design System **promove a identidade do Painel** a oficial e
> migra os jogos progressivamente, preservando acentos próprios por jogo (§7). Não substituir
> a identidade por outra paleta.

---

## 2. Diagnóstico (inventário executado em 2026-10-12)

### 2.1 Estrutura atual dos arquivos visuais

Todo o front vive em `node/public/` (estáticos servidos pelo `server.js`). **Não há `<script src>`
externo** — todo o JS é embutido. Fontes: `Inter` (Google Fonts) em alguns arquivos; Bootstrap
vem de `/vendor/brite/bootstrap.min.css`.

| Arquivo | Bytes | `<style>` inline | `style=` inline | `<link>` | Observação |
|---|---:|---:|---:|---:|---|
| `control-panel.html` | 232.506 | 20.556 B | **148** | bootstrap | Painel Streamer — maior dor |
| `duelo.html` | 114.970 | 29.769 B | 10 | — | tela mais completa (referência) |
| `web-game.html` | 59.789 | 583 B | 24 | `style.css` | único que usa o CSS global |
| `tres-pontinhos.html` | 52.690 | 22.169 B | 5 | — | |
| `bichinho.html` | 25.704 | 4.222 B | 0 | — | |
| `batalha.html` | 24.649 | 11.714 B | 2 | — | |
| `admin.html` | 23.111 | 823 B | 34 | bootstrap | Super Admin |
| `caca-palavra.html` | 19.316 | 6.861 B | 7 | — | |
| `docs.html` | 16.415 | 4.760 B | 0 | — | já tem `:root` próprio |
| `bichinho-overlay.html` | 14.662 | 2.123 B | 3 | — | overlay OBS |
| `login.html` | 8.104 | 1.751 B | 2 | bootstrap | |
| `obs-ranking.html` | 4.625 | 1.719 B | 0 | Inter | overlay OBS |
| **`style.css`** | **57.122** | — | — | — | tema escuro do web-game, ~50 seções |

Referência de overlays OBS: `obs-overlay.html` (Palavra Secreta), `bichinho-overlay.html`,
`obs-ranking.html`.

### 2.2 Arquivos CSS envolvidos

- **Global:** `node/public/style.css` (57 KB) — na prática serve **só** `web-game.html`.
- **Inline por página:** os 12 HTMLs acima (≈95 KB de CSS repartido, sem tokens, sem reuso).
- **Framework:** Bootstrap (`/vendor/brite/bootstrap.min.css`) usado em `control-panel`,
  `admin` e `login`.
- **Tokens existentes:** apenas `docs.html` (`:root { --bg:#fdfaf3; --ink:#111; --accent:#fec90f; ... }`)
  e `#tab-duelo` em `control-panel.html` (`--duelo-gap`, `--duelo-radius`, `--duelo-border`…).

### 2.3 O que é global hoje (de fato)

- `style.css`: classes do jogo Palavra Secreta (`.guess-*`, `.secret-display`, `.dica-overlay`,
  `.pg-modal-*`, `.roulette-*`, `.meta-*`) — **não** é um CSS de plataforma, é de um jogo.
- Bootstrap: grid/form/table usados por Painel e Admin.
- Não existe CSS de header/navegação/botão/card compartilhado de verdade.

### 2.4 O que é específico de cada jogo

Cada tela de jogo carrega seu próprio `<style>` (web-game usa `style.css`; os demais, inline):
Duelo (30 KB), 3 Dicas (22 KB), Palavra Secreta (57 KB via `style.css`), Batalha (12 KB),
Caça Palavras (7 KB), Bichinho (4 KB + overlay 2 KB).

### 2.5 Principais duplicações encontradas

**Cores** (ocorrências nos HTMLs + `style.css`):

```
#000 (138)  #fff (85)  #9ca3af (27)  #fbbf24 (25)  #a78bfa (24)  #ff6b6b (18)
#fec90f (13)  #34d399 (12)  #8b5cf6 (11)  #1c1e26 (10)  #ef4444 (10)  #5bc0ff (9)
#ffd200 (9)  #e5e7eb (9)  #ffd700 (9)  #10b981 (7)  #3b82f6 (6)  #f97316 (6) …
```

> Há **dezenas** de tons quase iguais (4 amarelos, 5 verdes, 4 vermelhos, 3 azuis) — todos
> candidatos a 1 token cada.

**Componentes repetidos (de-facto, sem sistema):**

- Botões: `.btn` + `.btn-nb` (72×) e variantes `.btn-dark/.btn-danger/.btn-success/.btn-primary/.btn-sm/.btn-tiny`,
  além de `.duelo-btn` + modificadores `--primary/--danger/--warning/--neutral/--small/--success` (63×).
  **Dois sistemas de botão convivendo.**
- Cards: `.nb-card` (43×), `.duelo-team`, `.meta-card`, `.winner-card`, `.rk-card`, `.tm-card`.
- Títulos de seção: `.duelo-section-title`, `.panel-title`.
- Um mini-tema já existe em `docs.html` (`--bg/--ink/--accent/--green/--red/--blue`).

**Estilos inline:** `control-panel.html` tem **148** `style="..."` — a maior frente de dívida.

### 2.6 Arquivos que pretende CRIAR

```
node/public/ui/            # Design System global (servido via /ui/*)
├── tikplay-theme.css      # APENAS tokens + fundamentos (:root, tipografia, reset)
├── tikplay-layout.css     # header, shell do painel, grid, overflow/scroll
├── tikplay-components.css # card, badge, tabs, toolbar, section, divider, modal, toast
├── tikplay-buttons.css    # .tp-btn + variantes semânticas
├── tikplay-forms.css      # input, select, checkbox, range, label, focus
├── tikplay-tables.css     # .tp-table
└── tikplay-responsive.css # breakpoints
node/public/shared/        # partes reutilizáveis (quando extrair HTML/JS)
node/public/games/<jogo>/  # assets/css/js por jogo (fase futura, ver §8)
```

### 2.7 Arquivos que pretende ALTERAR

- `node/public/control-panel.html` (Painel Streamer) — **alvo principal**, Etapa 5+.
- `node/public/admin.html` (Super Admin) — Etapa 7.
- `node/public/web-game.html` + `style.css` — Etapa 6.
- `node/public/duelo.html` — **primeiro jogo**, Etapa 5.
- `node/public/{batalha,caca-palavra,bichinho,bichinho-overlay,tres-pontinhos,obs-ranking,obs-overlay,login,docs}.html` — Etapa 6/8.
- `node/server.js` — **só** para adicionar o static `/ui` (e `/games`), sem tocar em rotas.

### 2.8 Riscos de quebra

| Risco | Mitigação |
|---|---|
| JS depende de classes/IDs (querySelector/classList/dataset) | Não renomear classe usada por JS. Ao trocar, atualizar **todas** as referências. Adicionar classe `tp-*` **ao lado** da antiga antes de remover. |
| Bootstrap sobrescrito por tema | Carregar `ui/*` **depois** do Bootstrap; não reescrever grid/JS do Bootstrap. |
| Duplicação de eventos (ver `PLANO_MELHORIAS.md` C-02) | Não tocar nessa área; refactor é só visual. |
| `style.css` serve só 1 tela mas é “global” | Migrar para `games/secret-word` sem renomear classes usadas pelo JS. |
| Perda de identidade por jogo | Manter acentos por jogo via override local (§7). |
| Sem git no projeto | **Fazer backup/`git init` antes da Etapa 1.** |

### 2.9 Plano de migração (resumo)

Tokens → componentes → header/nav → layout do Painel (log fixo à esquerda) → Duelo →
demais jogos → Super Admin → limpeza do CSS legado. Detalhe e checkboxes em **§9/§10**.

---

## 3. Tokens (fonte única de verdade)

Valores **reconciliados com o que já existe** (Painel usa `#fdfaf3`/`#111`/`#fec90f`).
Ajustes finos permitidos, mas centralizados em `ui/tikplay-theme.css`.

```css
:root {
  /* Brand */
  --tp-yellow: #fec90f;         /* amarelo TikPlay (já usado) */
  --tp-yellow-hover: #edb800;
  --tp-yellow-soft: #ffdd66;

  --tp-black: #111315;
  --tp-black-2: #171a1f;
  --tp-black-3: #22262d;

  /* Background / superfícies */
  --tp-bg: #fdfaf3;             /* off-white quente (já usado) */
  --tp-surface: #ffffff;
  --tp-surface-soft: #f7f5ef;
  --tp-surface-muted: #ececea;

  /* Ações / semânticas */
  --tp-green: #3ddc84;
  --tp-green-hover: #2fc473;
  --tp-red: #ff6b6b;
  --tp-red-hover: #ef5555;
  --tp-blue: #5b8cff;
  --tp-blue-hover: #4777ec;
  --tp-orange: #ff9f32;
  --tp-purple: #8b5cf6;
  --tp-pink: #ff5f9e;

  /* Texto */
  --tp-text: #111315;
  --tp-text-soft: #555b66;
  --tp-text-muted: #818793;
  --tp-text-inverse: #ffffff;

  /* Bordas */
  --tp-border: #111315;
  --tp-border-soft: #c9ccd1;

  /* Status */
  --tp-success: var(--tp-green);
  --tp-warning: var(--tp-yellow);
  --tp-danger: var(--tp-red);
  --tp-info: var(--tp-blue);

  /* Raio */
  --tp-radius-xs: 5px;
  --tp-radius-sm: 8px;
  --tp-radius-md: 12px;
  --tp-radius-lg: 16px;

  /* Sombra (neo-brutalista: offset duro) */
  --tp-shadow-card: 3px 4px 0 rgba(17, 19, 21, 0.95);
  --tp-shadow-soft: 0 4px 16px rgba(0, 0, 0, 0.08);

  /* Espaçamento */
  --tp-space-1: 4px;  --tp-space-2: 8px;  --tp-space-3: 12px;
  --tp-space-4: 16px; --tp-space-5: 20px; --tp-space-6: 24px; --tp-space-8: 32px;

  /* Z-index centralizado */
  --z-base: 1; --z-sticky: 20; --z-dropdown: 100; --z-modal: 500; --z-toast: 1000;

  /* Tipografia */
  --tp-font-ui: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --tp-font-display: 'Inter', 'Segoe UI', system-ui, sans-serif; /* pode receber fonte arcade depois */
}
```

### Tipografia

- **Interface** (`--tp-font-ui`): labels, campos, tabelas, logs, descrições.
- **Display / títulos** (`--tp-font-display`): seções, menus, botões importantes, títulos de jogos.
- Títulos: `font-weight: 800; letter-spacing: .03em;` · **uppercase** reservado a títulos/navegação.
- Evitar textos longos muito espaçados.

---

## 4. Componentes base

Prefixo único **`tp-`**. Tabela de componentes obrigatórios:

```
.tp-card  .tp-card-header  .tp-card-title  .tp-card-desc  .tp-divider
.tp-btn  .tp-btn-primary  .tp-btn-success  .tp-btn-danger  .tp-btn-dark  .tp-btn-neutral
.tp-input  .tp-select  .tp-checkbox  .tp-range  .tp-label
.tp-badge  .tp-badge-success  .tp-badge-danger  .tp-badge-warning  .tp-badge-info
.tp-table  .tp-toolbar  .tp-section
.tp-tabs  .tp-tab          # navegação horizontal de jogos
.tp-modal  .tp-toast
```

**Card** (elemento central da identidade):

```css
.tp-card {
  background: var(--tp-surface);
  border: 2px solid var(--tp-border);
  border-radius: var(--tp-radius-md);
  padding: var(--tp-space-4);   /* 16px */
  display: flex; flex-direction: column; gap: var(--tp-space-3); /* 12px */
}
.tp-card--raised { box-shadow: var(--tp-shadow-card); }
```

Estrutura interna do card: `título + ícone` → `descrição (opcional)` → `divisor` → `conteúdo`.
Não aplicar sombra forte em todos os elementos (usar `.tp-card--raised` só nos importantes).

**Botões** — mesma altura/raio/borda, ícone alinhado, estados hover/active/disabled/focus-visible:

```css
.tp-btn {
  min-height: 36px; padding: 0 14px;
  border: 2px solid var(--tp-border);
  border-radius: var(--tp-radius-sm);
  font-weight: 700; font-family: var(--tp-font-ui);
  transition: 120ms ease; cursor: pointer;
}
```

Semântica: **amarelo** principal/seleção · **verde** iniciar/ativar/sucesso · **vermelho**
parar/excluir/perigo · **preto** secundário importante · **cinza/branco** neutro.

**Campos**:

```css
.tp-input, .tp-select {
  height: 34px; padding: 0 10px;
  border: 2px solid var(--tp-border);
  border-radius: 7px; background: #fff;
}
.tp-input:focus-visible, .tp-select:focus-visible {
  outline: none; box-shadow: 0 0 0 3px rgba(254, 201, 15, .25);
}
```

**Compatibilidade:** ao introduzir `.tp-*`, manter as classes antigas (`btn btn-nb`,
`duelo-btn`, `nb-card`) ativas **durante** a migração e só remover após confirmar que o JS
não as usa (Etapa 8).

---

## 5. Header global e navegação

**Header** compartilhado, compacto (**64–72px**): `Logo TikPlay` à esquerda; à direita
`usuário · tipo da conta · sala · admin · ajuda · sair`.

**Navegação dos jogos** (Painel Streamer) — horizontal, um único componente `.tp-game-tab`
(nunca um botão diferente por jogo):

```
Conectar Live | Leitura de Chat | Alertas Sonoros | Palavra Secreta | Batalha |
Caça Palavras | Bichinho | 3 Dicas | Duelo 1x1
```

Barra: fundo preto/grafite, texto branco, divisores sutis, ícones, hover, **aba ativa amarela**.

---

## 6. Layout do Painel Streamer (obrigatório)

```
┌───────────────┬──────────────────────────────────┐
│               │ HEADER                           │
│               ├──────────────────────────────────┤
│     LOG       │ NAVEGAÇÃO DOS JOGOS             │
│     25%       ├──────────────────────────────────┤
│               │ CONTEÚDO DO JOGO                │
└───────────────┴──────────────────────────────────┘
```

- Log **à esquerda**, largura `clamp(300px, 25vw, 430px)`.
- Log **não acompanha** o scroll do conteúdo do jogo:
  ```css
  position: sticky; top: var(--tp-space-3); height: calc(100vh - var(--tp-space-6));
  ```
  (ou solução equivalente à estrutura real). Só a lista interna de mensagens rola (`overflow-y:auto`).
- O lado direito (conteúdo do jogo) é a única coluna que rola a página.

### Visual do log (console TikPlay)

- Fundo `#10151c`, fonte monoespaçada.
- Cores: timestamp azul-claro · `[OK]` verde · `[WARN]` amarelo · `[ERR]` vermelho ·
  sistema azul/ciano · evento de jogo coral · texto comum branco/cinza.
- Header fixo: `LOGS  V75` + botões `[Copiar Logs] [Limpar]`. Header não rola; só as mensagens.

---

## 7. Área de cada jogo (esqueleto comum)

```
game/
├── header      # título + status
├── status      # modo, cenário
├── controls    # [Ativar] [Desativar] [Reiniciar] [Salvar]
├── settings    # configurações do jogo
├── assets      # presentes/imagens
└── advanced    # opções avançadas
```

Evitar uma única caixa gigantesca. Sub-navegação **opcional** (reutilizável, sobretudo no Duelo):
`Presets | Assets | Áudios | Cenas | Regras` — criar **só a estrutura visual** primeiro.

**Tema por jogo:** cada jogo pode ter acento próprio sem sair da plataforma —
Duelo (azul/vermelho), Palavra Secreta (efeito tecnológico), 3 Dicas (particular). Prefira
sobrescrever tokens (`--tp-accent`) no escopo do jogo a redeclarar cores soltas.

---

## 8. Estrutura de arquivos alvo

```text
node/public/
├── ui/                        # Design System global (ETAPA 1–2)
│   ├── tikplay-theme.css      # tokens + fundamentos
│   ├── tikplay-layout.css
│   ├── tikplay-components.css
│   ├── tikplay-buttons.css
│   ├── tikplay-forms.css
│   ├── tikplay-tables.css
│   └── tikplay-responsive.css
├── shared/                    # header, navigacao, log-panel, modal, toast
└── games/
    ├── secret-word/  { index, game.js, game.css, config.js, assets/ }
    ├── three-hints/  { index, game.js, game.css, config.js, assets/ }
    ├── duel/         { index, game.js, game.css, config.js,
    │                   assets/{ characters/ scenes/ effects/ audio/ gifts/ } }
    ├── battle/  pet/  word-search/  ...
```

> **Não mover arquivos só para cumprir a estrutura se isso quebrar imports/rotas.**
> Primeiro inventário (§2) e migração segura, arquivo por arquivo, preservando os nomes
> usados pelo JS e as rotas do `server.js`.

---

## 9. Etapas de implementação (ordem obrigatória)

1. **ETAPA 1 — Tokens.** Criar `ui/tikplay-theme.css` (só tokens/fundamentos). Sem alterar telas.
2. **ETAPA 2 — Componentes globais.** `buttons/forms/tables/components` (`tp-*`).
3. **ETAPA 3 — Header + navegação global.**
4. **ETAPA 4 — Layout do Painel Streamer.** Implementar **LOG fixo à esquerda** (§6).
5. **ETAPA 5 — Aplicar ao Duelo 1x1** (tela mais completa, serve de referência).
6. **ETAPA 6 — Adaptar os outros jogos** progressivamente.
7. **ETAPA 7 — Aplicar ao Super Admin** (`admin.html`).
8. **ETAPA 8 — Remover CSS legado** que deixou de ser necessário.

> Critérios por etapa seguem §1–§8. Só avançar de etapa com a anterior validada.

---

## 10. Status / Progresso

- [x] **Fase 0** — Backup / versionamento (git) antes de qualquer alteração
- [ ] **ETAPA 1** — Tokens (`ui/tikplay-theme.css`)
- [ ] **ETAPA 2** — Componentes globais
- [ ] **ETAPA 3** — Header + navegação
- [ ] **ETAPA 4** — Layout Painel + LOG fixo à esquerda
- [ ] **ETAPA 5** — Duelo 1x1
- [ ] **ETAPA 6** — Demais jogos (Batalha, Caça Palavras, Bichinho, 3 Dicas, Palavra Secreta)
- [ ] **ETAPA 7** — Super Admin
- [ ] **ETAPA 8** — Limpeza do CSS legado

**Concluído:**

- 2026-10-12 — CORDA: áudios fornecidos integrados; trilha em loop com liga/desliga e volume, efeitos por entrada em movimento/pressão/vitória com volume próprio. Ajustes persistentes durante a partida e botão para liberação de autoplay no navegador.

- 2026-10-12 — CORDA: seleção de presentes refinada conforme Duelo: blocos por equipe, busca individual, nome original no campo, tradução + original nas sugestões, foto de 24px, moedas e opção Ativo. Seleção e salvamento verificados no navegador.

- 2026-10-12 — CORDA: seleção de presentes alinhada ao Duelo com busca por nome PT/EN/ID, sugestões com foto e moedas, seleção por clique ou setas/Enter. IDs e persistência preservados.

- 2026-10-12 — CORDA: fotos superiores usam /gift-images/ para os arquivos da biblioteca; texto dos nomes removido da exibição, mantido somente em acessibilidade/tooltip.

- 2026-10-12 — CORDA: caixas inferiores de presentes preservadas e ocultadas; fotos maiores dos presentes configurados posicionadas nas laterais superiores, com zoom suave de 4 segundos e respeito a movimento reduzido.

- 2026-10-12 — CORDA: controles alinhados à densidade do painel TikPlay via variante compartilhada tp-admin-controls: títulos compactos em caixa alta, botões/campos de 13px, cards com sombra e grids responsivos de 3/2/1 colunas. Tela pública preservada.

- 2026-10-12 — CORDA: iframe do painel com altura automática via ResizeObserver/postMessage validado por origem e janela; rolagem interna removida para usar apenas a rolagem do painel, inclusive ao adicionar presentes ou mudar a largura.

- 2026-10-12 — CORDA: prévia da arena oculta no painel; controles usam a largura disponível e links públicos preservados.

- 2026-10-12 — CORDA: banners existentes azul-ganhou.png/vermelho-ganhou.png exibidos no resultado após a queda; ocultados na rodada seguinte, reinício e parada.

- 2026-10-12 — CORDA: balanço suave contínuo durante a disputa (amplitude de 2,5 unidades da cena, ciclo de aproximadamente 7 segundos), somado ao tremor de pressão alta; preservadas pegadas da corda e preferência de movimento reduzido.

- 2026-10-12 — CORDA: nomes visíveis AZUL/VERMELHO; placar com escala padrão de 82%, controles persistentes de X/Y/escala com ajuste durante a partida; presentes por equipe em caixas próprias na tela pública, sem restaurar a faixa inferior de instrução.

- 2026-10-12 — CORDA: faixa inferior de instrução de equipe e contagem de curtidas ocultada a pedido do usuário; elementos e atualizações preservados.

- 2026-10-12 — CORDA: placar reorganizado com cronômetro no cabeçalho, nomes/vitórias por equipe, barras próprias de progresso de TAP e barra central exclusiva para a posição da corda.

- 2026-10-12 — CORDA: placar no estilo escuro/dourado do Duelo 1x1; entrada e troca de equipes pelo chat com balões de nome/avatar; bolhas e +TAP por equipe. Painel com contagem de participantes e opções persistentes de exibição dos dois efeitos. Alteração solicitada pelo usuário; animação existente da disputa preservada.

- 2026-10-12 — CORDA: nova tela de duelo com cenário fixo, deslocamento conjunto, poses e efeito em quem recebe o puxão; controles no painel via iframe isolado. Componentes `tp-*` compartilhados e tokens adicionais. Ampliação funcional autorizada pelo usuário nesta sessão; não altera as mecânicas do Duelo existente. Validação registrada em `docs/corda.md`.

- 2026-10-12 — Palavra Secreta pública: letras em linha única centralizada; largura e fonte reduzidas apenas quando excedem o quadro, com espaçamento adaptativo e altura preservada. Validação de 4 a 20 letras em viewports de 1280, 640, 375 e 320; sem alterações de backend.

- 2026-10-12 — Slot de próximo palpite ocultado ao renderizar resultado final e reativado no início da nova partida.

- 2026-10-12 — Movimento de saída do palpite repetido aplicado diretamente ao card: desliza 110% para a direita em 550 ms, dentro do recorte do slot.

- 2026-10-12 — Saída de palpite repetido desliza para a direita com fade, recortada pelo espaço reservado para respeitar suas margens.

- 2026-10-12 — Slot de palpite identificado como PRÓXIMO PALPITE; animação local limitada ao slot, sem escala ou deslocamento lateral, usando fade para entrada e saída.

- 2026-10-12 — Linha fixa reservada para novos palpites; repetidos recebem etiqueta REPETIDA e saem pela direita sem inserir outra palavra. Novos mantêm animação para a posição ordenada.

- 2026-10-12 — Cores de resultado corrigidas: vitória em azul/verde e encerramento sem vencedor em vermelho, preservando dimensões e estados.

- 2026-10-12 — Segundo teste de paleta: grafite neutro sem matiz azul, fundo #121212 e cards #292929, mantendo medidas. Primeira paleta salva em `docs/layout-backups/2026-10-12-contraste-01/palette-01-azulada.css`.

- 2026-10-12 — Teste reversível de paleta da Palavra Secreta: fundo quase preto, cards grafite azulado e texto secundário mais claro, sem mudanças de dimensões. Override isolado em `ui/secret-word-palette.css`; backup em `docs/layout-backups/2026-10-12-contraste-01`.

- 2026-10-12 — Ranking lateral mais compacto: avatar de 24px, espaçamento vertical de 4px e nomes de 16px para exibir mais participantes; vitórias mantidas à direita.

- 2026-10-12 — Refinamento do ranking lateral: foto, nome e vitórias à direita em linha única, com detalhe chanfrado à esquerda no top 3 inspirado na V2 de taps.

- 2026-10-12 — Ranking lateral com avatar, nome e vitórias abaixo; medalha removida e pódio identificado por bordas ouro/prata/bronze nos três primeiros. Ordenação, dados e largura preservados.

- 2026-10-12 — @ dos participantes nos palpites com peso 600 (seminegrito), preservando tamanho e layout.

- 2026-10-12 — Refinamento dos cards laterais da Palavra Secreta: bordas em grafite (`--tp-black-3`) substituem o contorno claro, mantendo tipografia e contraste do conteúdo.

- 2026-10-12 — Ajuste pontual autorizado de legibilidade da Palavra Secreta: coluna lateral de 17rem, títulos/valores de 1rem, nomes de 1.125rem e contraste reforçado; preservados IDs, estados e lógica. Tokens de §3 materializados em `ui/tikplay-theme.css`, sem iniciar a migração geral do tema.

- 2026-10-12 — Inventário/diagnóstico visual completo (§2) + tokens preliminares (§3) + governança (este doc, `REGRAS_DO_PROJETO.md`, `AGENTS.md`).
- 2026-10-12 — Versionamento: repo guarda-chuva na raiz + `jogo-contexto` como submódulo do TikPlay.
- 2026-10-12 — Plano de separação estrutural documentado com evidência em `docs/separacao-estrutural.md`
  (Fase A-1 iniciada: utilitários Python extraídos p/ `service_common.py`).

### Acompanhamento por arquivo

| Arquivo | Tokens | Componentes | Layout | Concluído |
|---|---|---|---|---|
| `ui/tikplay-theme.css` | — | — | — | não criado |
| `control-panel.html` | não | não | não | não |
| `duelo.html` | não | não | não | não |
| `admin.html` | não | não | não | não |
| `web-game.html` + `style.css` | não | não | não | não |

---

## 11. Regras rígidas (checklist de PR visual)

- [ ] Nenhum hex/px “solto”: usa token.
- [ ] Nenhum botão/card novo fora dos `tp-*`.
- [ ] IDs, classes usadas por JS, rotas, eventos e nomes de evento **preservados**.
- [ ] `focus-visible` presente; nada de remover outline sem substituto.
- [ ] `aria-label` em botões só-ícone.
- [ ] `z-index` só via `--z-*`.
- [ ] Sem `!important` novo desnecessário.
- [ ] Sem animação constante em controles administrativos (microinterações discretas: `translateY(-1px)` hover, `translateY(1px)` active, `transition:120ms ease`).
- [ ] Bootstrap carregado antes de `ui/*`.

- 2026-10-13: CORDA destaca a disputa na barra maior com marcador dourado/branco. Curtidas ficam abaixo em barras finas, corações pulsantes e preenchimento gradual com confirmação da meta antes do reinício. Aviso público para aguardar o início; movimento reduzido respeitado.

- 2026-10-13: Barras de TAP do CORDA ampliadas para 8–12px, com contagem e corações maiores para leitura na live.

- 2026-10-13: TAP usa aproximação exponencial independente do FPS; lotes pequenos também animam gradualmente, em vez de terminar em um ou dois quadros.

- 2026-10-13: CORDA remove título e textos de formato/vitórias do placar público; cronômetro maior centralizado entre as equipes. Formato de partida e contadores preservados.

- 2026-10-13: Relógio e contadores CORDA alinhados verticalmente; pontuações maiores em branco sobre fundo escuro com bordas da equipe.

- 2026-10-13: Tela pública e botões demo CORDA em maiúsculas; rótulos de curtidas e incrementos visuais apresentados como ENERGIA.

- 2026-10-13: Menções a disputa/duelo removidas dos status e descrições acessíveis da cena pública CORDA; mensagens de energia e movimento.

- 2026-10-13: TAP público rotulado FORÇA; conclusão mostra equipe e força enviada. Impacto visual disparado por metas e combos superiores a x10 sem modificar a força aplicada.

- 2026-10-13: Cliente CORDA garante impacto visual para corda_pull de origem tap, inclusive quando o serviço ainda em execução envia impulse=false.

- 2026-10-13: Barras de FORÇA com brilho direcional recortado ao preenchimento, avançando rumo à meta (azul à direita, vermelho à esquerda); respeita movimento reduzido.

- 2026-10-13: Aviso ENVIEM FORÇA TIME! no lado da equipe atrás, com pulsação suave. Exibe após 15 pontos de diferença e oculta abaixo de 8 para evitar piscar próximo do empate; somente rodada ativa.

- 2026-10-13: Chamado FORÇA menor em cartão compacto com raio e faixa lateral; aparece por 2s ao entrar em forte pressão (>50), sem repetir enquanto ela persistir. Rearma abaixo de 45.

- 2026-10-13: Chamado de forte pressão recomposto como lettering luminoso em duas linhas, na cor da equipe, acima dos personagens; sem caixa ou emoji, com traço luminoso inferior.

- 2026-10-13: Acabamento do placar CORDA integrado à arena: cantos retos, borda fina, linha superior azul/branco/vermelho e brilho lateral discreto por equipe; contraste dos contadores preservado.

- 2026-10-13: Aviso de espera CORDA alinhado ao acabamento do placar, acima dos personagens; oculto na carga inicial, desconexão, painel e jogo ativo.

- 2026-10-13: Cada foto de presente cadastrado recebe +FORÇA acima, com lettering luminoso na cor da equipe seguindo o chamado +FORÇA TIME!.

- 2026-10-13: Preparação CORDA com contagem e instrução de entrada no aviso existente; campos de participação no painel e balão de compartilhamento identificado.

- 2026-10-13: Preparação com contagem destacada e instrução em dois passos: escolha a equipe no chat (AZUL/VERMELHO coloridos) e curta para enviar força.

- 2026-10-13: Controle independente de meta ao vivo no painel CORDA e status breve META ATUALIZADA na cena.

- 2026-10-13: Campo duplicado de meta removido das regras; ajuste concentrado no cartão independente Meta de FORÇA da barra.

- 2026-10-13: Vitória intermediária em lettering luminoso ascendente por 2,5s; vitória completa reservada ao final em melhor de 3/5 ou a cada rodada no infinito.

- 2026-10-13: Presentes por equipe alternam em slide de 3,5s; cadastro Puxão dispara impacto visual e muda legenda para PUXÃO, preservando força proporcional.

- 2026-10-13: Balão de entrada CORDA com cantos retos, fundo do placar, faixa e brilho da equipe; identidade do participante e chamada de entrada preservadas.

- 2026-10-13: Slide de cada equipe inclui item padrão com coração na cor do time e chamada TAP AUMENTA / FORÇA!, inclusive sem presentes.

- 2026-10-13: Pontos de encaixe da corda nas poses do novo personagem vermelho recalibrados para as mãos em neutro/puxando/pressão; corda permanece desenhada atrás do personagem.

- 2026-10-13: Presentes que disparam impacto sobem balão com foto/nome do remetente e ENVIOU PUXÃO na cor da equipe.

- 2026-10-13: Switch Modo Boss no bloco Palavra Secreta, seguindo controles existentes; hidratação, detecção de alteração e salvamento automático via boss_mode.

- 2026-10-13: Usuário TikTok bloqueado ao solicitar conexão; bloqueio preservado em tentativa/erro e refresh da aba, liberado somente por desconexão confirmada.

- 2026-10-13: Super Admin adota, por solicitação explícita do usuário, o tema escuro/ciano de `Site/styles.css`, isolado em `ui/tikplay-admin-site.css`. Navegação por seções, resumo de contas, busca/filtro e quatro indicadores de uso preparados para o backend. Contrato em `admin-status-frontend.md`; validação desktop/mobile com dados simulados, sem alterações de backend.

- 2026-10-13: Contraste das tabelas do Super Admin reforçado: cabeçalho destacado, linhas alternadas mais claras, divisórias visíveis, texto claro, hover e badges de status com fundo/borda semânticos. Indicadores de uso ampliados para leitura.

- 2026-10-13: Dashboard como seção inicial do Admin, com clientes online, lives conectadas, partidas em andamento, uso por jogo e atividade dos clientes. Atualização manual, busca e acesso à conta; dados ausentes não inferem offline. Frontend validado com API simulada em desktop/mobile; histórico depende do backend.
