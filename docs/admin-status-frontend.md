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
