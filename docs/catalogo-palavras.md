# Catálogo e sorteio de palavras

## Fluxo

O banco SQLite mantém o catálogo global, inicialmente semeado de `python/words.json`.
Palavras importadas entram ativas; o Super Admin pode alterar o status.
Todas as contas usam o mesmo vocabulário: somente palavras ativas e não banidas
podem ser sorteadas. As palavras não têm categorias nem níveis de dificuldade.
O ranking semântico continua usando o vocabulário ativo global.

Ao iniciar uma partida de Palavra Secreta ou 3 Dicas, o daemon reserva uma palavra
para o tenant dentro de uma transação SQLite `BEGIN IMMEDIATE`. A reserva registra
canal, ciclo, partida e horário antes de publicar o alvo. O ciclo muda quando todas
as palavras elegíveis daquele streamer já foram usadas. O histórico completo fica
consultável mesmo depois que um novo ciclo começa; reiniciar o ciclo manualmente
apenas avança seu número e não apaga os registros anteriores.

O sorteio não possui filtros por streamer. Se não houver nenhuma palavra ativa e
liberada, a partida é rejeitada sem expor qualquer palavra secreta.

## Dados e compatibilidade

`word_catalog` guarda grafia canônica, chave sem acentos, estado, origem e datas.
As colunas legadas de categoria e dificuldade permanecem apenas por compatibilidade
com bancos existentes e não participam da gestão nem do sorteio. `word_usage` guarda
cada reserva por tenant e ciclo, com chave única `(tenant_id, cycle_id, word_key)`.
`word_cycles` guarda o ciclo atual; `word_draw_settings` permanece como tabela legada
e não restringe mais os sorteios. O histórico legado `tenant_history`
é importado uma vez para o primeiro ciclo e continua atualizado para os clientes
que consomem `/api/history`. `words.json` continua sendo fallback se o catálogo
SQLite ainda não existir.

O cache de ranking e os contextos OpenRouter usam uma assinatura do conjunto de
palavras ativas. Mudanças no catálogo invalidam contextos e caches incompatíveis;
contextos antigos não são apagados e podem ser reutilizados se a assinatura voltar
a coincidir.

## Painel

Super Admin → Operação local inclui busca, resumo, filtro de status e edição do
catálogo; cadastro e importação em lote; estado ativo/revisão/inativo; seleção do
streamer, consumo do ciclo, histórico pesquisável e ação para avançar o ciclo.
Importação é limitada a 2.000 linhas por chamada; palavras
inválidas e duplicadas são reportadas e não criam registros parcialmente inválidos.

## Observabilidade e privacidade

| Ação | Evento | Categoria/nível | Detalhes permitidos |
| --- | --- | --- | --- |
| Importação aceita | `word_catalog.import.completed` | `diagnostic`/`info` | ator, trace_id, inseridas, duplicadas, inválidas |
| Palavra atualizada | `word_catalog.word.updated` | `diagnostic`/`info` | ator, trace_id, id e campos alterados; sem grafia |
| Validação rejeitada | `word_catalog.change.rejected` | `notice`/`warning` | ator, trace_id, código e quantidade |
| Falha no banco | `word_catalog.change.failed` | `error`/`error` | ator, trace_id, código/tipo seguro |
| Ciclo avançado | `word_usage.cycle.reset` | `diagnostic`/`info` | ator, trace_id, tenant_id e ciclo anterior/novo |
| Reserva concluída | `word_draw.reserved` | `diagnostic`/`debug` | session_id, game_id, trace_id, ciclo e contagens |

Os eventos de sorteio não incluem a palavra, prompt ou resposta. O painel
administrativo autenticado pode mostrar o histórico para fins
de gestão. Não emitir logs por item de importação nem por consulta/paginação.

## Validação

Cobrir migração do catálogo, normalização/duplicatas, importação atômica, atualização
do último item ativo, reserva concorrente, esgotamento e avanço do ciclo, banimento,
histórico por tenant, filtros legados ignorados e fallback sem tabela.
Validar manualmente a tela e o fluxo de início de partida; nenhuma chamada OpenRouter
é necessária para validar o sorteio.
