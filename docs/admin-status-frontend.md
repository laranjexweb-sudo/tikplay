# Admin: tema Site e contrato de atividade

Em 13/10/2026, o usuario atribuiu a este agente somente o frontend e solicitou
o tema de `Site/styles.css` no Super Admin. O tema escuro/ciano fica isolado em
`node/public/ui/tikplay-admin-site.css`, sem mudar os demais paineis.

O frontend preserva as rotas existentes. A listagem de contas em
`GET /api/admin/users` pode incluir um objeto opcional `activity` por usuario:

```json
{
  "panel_online": true,
  "tiktok_status": "connected",
  "game_name": "Palavra Secreta",
  "game_status": "running",
  "last_activity_at": "2026-10-13T20:00:00Z"
}
```

- `panel_online`: booleano ou null; deve medir o painel autenticado, nao overlays.
- `tiktok_status`: connected, disconnected, connecting, reconnecting ou offline.
- `game_name`: nome de exibicao da partida atual, ou null.
- `game_status`: running, paused, finished ou idle.
- `last_activity_at`: data ISO 8601 com fuso, ou null.

Campos ausentes, desconhecidos ou invalidos aparecem como Indisponivel.
`idle` sem nome aparece como Sem partida. Nunca deduzir uso real a partir de
permissoes, plano, conta ativa ou username cadastrado.

A atualizacao e manual pelo botao Atualizar. Presenca, coleta de atividade,
persistencia e atualizacao automatica sao responsabilidade do backend; nao
foram implementadas nesta tarefa. Os resumos usam apenas os dados existentes
de contas e planos, sem inferir pagamento ou assinatura vigente.

Validacao visual e funcional com Playwright em 1440 e 390 pixels, usando
respostas API simuladas apenas no teste: navegacao, busca, filtro e formulario.
As capturas de exemplo nao representam clientes reais.

## Dashboard ao vivo

Dashboard e a secao inicial do Admin. Usa a mesma listagem de contas e o mesmo
objeto activity; nao exige uma nova rota nesta etapa. Exclui contas com role
admin das metricas de clientes. Mostra online, lives conectadas, partidas em
andamento, agrupamento por jogo e tabela de atividade com busca e Ver conta.

Cada indicador informa quantos clientes possuem dados validos. Ausencia de
telemetria aparece como indisponivel, sem contar como offline. Atualizacao
manual e horario da ultima consulta bem-sucedida. Historico por periodo e
tempo de uso permanecem dependentes da coleta do backend e fora desta etapa.

Validado com dados completos/ausentes, erro de API, busca, acesso a conta e
viewport mobile, sem erros de JavaScript nem overflow da pagina.

---

## Backend implementado (13/10/2026) — dados reais de atividade

`GET /api/admin/users` (protegida por `auth.requireAdmin`, isolada por conta)
agora anexa a cada usuario um objeto **`activity`** com dados reais do servidor.
Nenhum campo existente foi removido e **nao** se expoe senha/token/API key
(`db.publicUser` continua mascarando a chave). `panel_online: false` e
`tiktok_status: "offline"` significam "sem conexao neste servidor", nao "conta
inativa"; nada e inferido de conta ativa, permissao, plano ou username.

### `panel_online` (painel autenticado)
- Medido pelos sockets autenticados de **`/logs`** (a pagina do Painel). **Overlays/OBS**
  usam **`/browser`** e **nao** contam.
- Suporta **multiplas abas** (qualquer socket aberto => `true`).
- **Heartbeat** de 30s (`ping`/`pong`) encerra conexoes abandonadas (navegador
  fechado sem `close`), evitando painel "fantasma" contado como online.
- `true`/`false` sempre; nunca `null` nesta etapa.

### `tiktok_status` (conexao da live)
Derivado do status do daemon + flag de sessao (`sessionStarted`):

| Sessao / estado do daemon | `tiktok_status` |
|---|---|
| Sem sessao iniciada (mesmo com status residual) | `offline` |
| Sessao + `connected` | `connected` |
| Sessao + `waiting` (tentando/reconectando) | `reconnecting` |
| Sessao + `disconnected` | `disconnected` |
| Sessao + `offline` (daemon caiu) | `offline` |
| Sessao + sem status ainda | `connecting` |

### `game_name` / `game_status`
Jogo **primario** em execucao. Jogos existentes mapeados: **Palavra Secreta**,
**3 Dicas**, **Caça Palavras**, **Bichinho Virtual**, **Batalha**, **Duelo 1x1**
e **Corda**. Sem partida => `game_name: null`, `game_status: "idle"`.

| Jogo | Fonte | `running` | `paused` | `finished` |
|---|---|---|---|---|
| Palavra Secreta | `gameState.active/finished` | ativo, nao finalizado | — | finalizado |
| 3 Dicas | `tresState.active/finished/paused` | ativo | `paused` | finalizado |
| Caça Palavras | `cacaState.active/finished` | ativo | — | finalizado |
| Bichinho Virtual | `vpetState.active` | ativo | — | — |
| Batalha | `gameState.battle.active` | ativo | — | — |
| Duelo 1x1 | `dueloState.active/final/winner` | ativo | — | `final && winner` |
| Corda | `cordaState.active/match_winner` | ativo | — | `match_winner` |

**Jogos simultaneos** (ex.: Palavra Secreta + Batalha + Duelo) sao possiveis.
Como o contrato expoe **um** jogo, reporta-se o *primario*: prioriza
`running > paused > finished` e, em empate, a ordem Palavra > 3 Dicas > Caça >
Bichinho > Batalha > Duelo > Corda. O frontend que quiser detalhamento por jogo
precisaria de um campo adicional (fora do escopo desta etapa).

### `last_activity_at`
ISO 8601 com fuso (`new Date(ts).toISOString()`, “Z”), ou `null`.
Atualizado **apenas** em acoes operacionais do cliente:
`POST /start-game`, `/stop-game`, `/api/new-game`, `/api/end-game`,
`/api/game/manual-action`, `/api/play-riddle`, `battle/{start,stop,reset}`,
`caca/{start,stop,reveal}`, `tres/{start,stop,pause,resume,reset}`,
`vpet/{start,stop,battle/start}`, `duelo/{start,stop,reset-round,new-match}` e
`corda/{start,stop,new-match}`.
**Consultar o Dashboard/API nao gera atividade.** E **em memoria** (perde-se no
restart do servidor); persistencia/historico ficam para uma etapa posterior.

### Validacao (automatizada)
`node tests/admin-activity.test.js` (55 casos): painel conectado/desconectado,
multiplas abas, somente OBS, reconexao TikTok, estados dos jogos, jogos
simultaneos, dados ausentes/neutros, paths de atividade (painel GET nao conta)
e autorizacao da rota (401/403/200) + ausencia de segredos. Inclui verificacao
**end-to-end** de `panel_online` via WebSocket `/logs` vs `/browser`.

## Dependencias do frontend
Nenhuma. O contrato consumido (`activity`) ja e atendido sem nova rota; o
Dashboard continua com atualizacao manual. Se, numa etapa futura, quiser
*historico/tempo de uso* ou *detalhamento de jogos simultaneos*, sera necessario
definir campos/rotas e a coleta passara a exigir persistencia no backend.
