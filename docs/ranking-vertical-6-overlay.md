# Ranking vertical de diamantes · 6 posições

## Escopo

Nova apresentação da moldura `../../Site/Overlay-game/overleyvertical.png` em
`node/public/overlays/gifts/v4/`. O painel **Sobreposições** mantém o card e o
link do ranking V3 e acrescenta um card V4 separado. A prévia V4 mostra somente
a moldura PNG (sem dados de exemplo); os botões V3 e V4 geram seus próprios
links. Posição e escala têm controles e preferências independentes para cada
versão; quantidade continua configurável no V3 e fixa em seis no V4.

A composição tem seis posições fixas. As fotos usam as coordenadas calibradas
na prévia; o PNG fica acima delas, e nomes/pontuações ficam na camada frontal.
O terceiro nome mostra até 9 caracteres, acrescentando `...` quando necessário.
Os valores vêm do mesmo relatório de ranking de presentes e mantêm o formato
numérico com ícone de moeda.

## Fluxo e contratos reutilizados

- Abrir/copiar link: `POST /api/game/room-link`; token público permanece na URL
  conforme o fluxo atual de fontes de navegador.
- Dados: `GET /api/reports/ranking` e `GET /api/reports/events`, tipo `gift`,
  com limite de seis participantes; `/api/game-state` identifica a sala atual.
- Atualização: WebSocket `/browser` recebe `status`, `gift_event` e
  `gift_ranking_vertical_layout`; o overlay reconcilia o ranking pelo endpoint
  atual.
- Posição e escala independentes: `/api/gift-ranking/vertical-layout`, com
  preferência própria por conta e transmissão de prévia via
  `gift-ranking-vertical-preview-config`. O V3 mantém
  `/api/gift-ranking/layout` sem alterações. Na primeira configuração do V4,
  ele parte da posição e escala atuais do V3; o painel salva esse ponto inicial
  no campo independente do V4.
- Sem alterações no cálculo/ordem do ranking, histórico, armazenamento,
  autenticação, saldo ou eventos de presentes.

## Mapa de observabilidade

Os ajustes V4 usam produtores estruturados próprios, descritos em
`PADRAO_DE_LOGS.md` §6:

- Salvar layout: `overlay.gift_ranking_vertical_layout.saved`, `diagnostic`/`debug`,
  agregado por 2 s; detalhes limitados a `x`, `y`, `scale` e
  `suppressed_count`.
- Layout inválido: `overlay.gift_ranking_vertical_layout.rejected`,
  `notice`/`warning`, código `INVALID_LAYOUT`.
- Falha ao salvar: `overlay.gift_ranking_vertical_layout.failed`, `error`/`error`,
  código `LAYOUT_SAVE_FAILED`.
- Não registrar token, URL assinada, nome, foto, comentário ou payload bruto.
- As preferências e eventos do V3 continuam separados e inalterados.
- `status`, `gift_event` e snapshots são somente consumidos; sem log por
  presente, participante, reconexão ou atualização visual.

## Verificações recomendadas após publicar

- Conferir no painel as duas opções: V3 com seu preview e controles de
  quantidade; V4 com somente a arte PNG no preview.
- Abrir cada link e conferir a versão correspondente; V4 mostra as seis
  posições, moldura acima das fotos e texto contido nas placas.
- Abrir/copiar link autenticado e confirmar a atualização em tempo real após
  presente, troca de sala e alteração de posição/escala.
- Confirmar que URL V3 anteriormente copiada continua carregando a versão V3.
