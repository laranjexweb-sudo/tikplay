# Gerador de contextos pelo OpenRouter

## Plano e contrato

Super Admin → Operações locais usa Claude Haiku 5.5 para propor 80 candidatas
entre as 300 primeiras do ranking spaCy. A IA pode preencher de zero a 50
posições: palavras válidas e únicas ficam primeiro; as vagas restantes recebem
palavras do ranking spaCy, sem duplicatas. Palavra secreta = #1; as 50 posições
seguintes formam o contexto híbrido. Guardar a ordem, não scores inventados pela IA.
Reutilizar contextos já válidos da mesma versão; regenerar somente por opção
explícita. Não iniciar geração paga durante testes nem automaticamente no boot.

Corrigir caminho do script e parser de stdout fragmentado. Uma execução ativa
por processo; interrupção cooperativa entre chamadas, com timeout de rede.
Histórico persistente no SQLite unificado, inclusive falhas cobradas e custos
ausentes. Custo null significa desconhecido, nunca zero. Tentativas em voo
interrompidas também permanecem no relatório. Não fazer retry pago automático.

Jogo carrega ranking gerado no início da rodada; mantém snapshot até terminar.
Não alterar cache local compartilhado. Palpites fora do vocabulário usam a
distribuição local original e são posicionados fora das 50 vagas reservadas.
Metadados e assinatura do catálogo ativo impedem usar rankings incompatíveis.

## Observabilidade

Eventos `contexts.run.started/completed/stopped/failed` e
`contexts.attempt.completed/failed`: diagnostic/info, notice/warning para parada,
error/error para falha. Correlacionar run_id/trace_id e attempt_id; guardar ator
admin, modelo, contagens, duração, tokens e custo reportado pela API. Máximo dois
eventos por alvo, nenhum evento por palavra do ranking. Nunca registrar chave,
prompt, resposta bruta ou palavra secreta em logs técnicos. Progresso e alvos
ficam restritos ao relatório administrativo autenticado. Logs operacionais
persistem pela infraestrutura existente, relatório de consumo em tabelas próprias.

## Validação

Testes em SQLite temporário e provedor simulado: persistência após reload,
custo de resposta inválida, custo ausente, timeout, duplicatas, resume,
cancelamento, autenticação admin, stdout dividido, worker encerrado com erro,
rank #1 e 50 vagas, fallback para palavras externas, dicas e cache por rodada.
Verificar HTML/JS e a interface com dados simulados quando possível.
Ativação local exige reinício em janela segura; não interromper live ativa.

## Uso

1. Configurar `OPENROUTER_API_KEY` no servidor (compartilhada com charadas).
2. Abrir Super Admin → Operação local → Gerar contextos. Padrão: 10 alvos,
   intervalo zero. Limite 500 processa até 500 alvos elegíveis; zero usa todos.
3. Ativar geração. Rankings compatíveis já existentes são reutilizados sem
   chamada paga. Marcar Regenerar somente para refazer e consumir novamente.
4. Conferir últimas 20 execuções, últimas 100 chamadas da execução mais recente
   e consumo acumulado de todas as execuções. Tokens de saída incluem raciocínio
   quando o provedor o contabiliza. Custos reportados não incluem impostos/taxas.
5. Desativar solicita parada entre chamadas; a chamada atual pode levar até
   90 segundos e pode ser cobrada. Falhas de rede permanecem com custo pendente.
6. Duas falhas consecutivas encerram o lote automaticamente, sem retry pago.
   Relatório mostra quantas palavras das 50 posições vieram da IA e quantas do
   ranking local, além da quantidade recebida e única por chamada;
   campos de chamadas antigas podem ficar vazios porque a resposta não foi salva.

São reutilizados primeiro os alvos do arquivo legado de palavras seguras,
deduplicados; depois as demais palavras do dicionário. Alvos banidos são
excluídos. O vocabulário de vizinhas também é deduplicado e limitado a palavras
únicas, compatíveis com o processamento de palpites.

Tabelas aditivas em `node/lib/context-generation.sql`: execuções, tentativas e
metadados. Rankings permanecem na tabela `contextos`. Não sobrescrever um
ranking válido quando uma nova tentativa falhar. Não invalidar rodada ativa.

## Verificação concluída

- 12 testes Python de geração/experimento e um de payload final passaram.
- 10 testes Node passaram (incluindo 49 verificações internas do monitor).
- Worker Python atualizado foi executado como subprocesso real em banco
  temporário, com NLP e API simulados: salvou ranking, custo e correlação;
  eventos chegaram à tabela real `log_entries` pela função de persistência.
- Navegador conferiu formulário, histórico, custos e estado pendente em prévia
  isolada com dados simulados. Sintaxe do JavaScript do Admin e servidor válida.
- Nenhuma chamada paga nova nem lote real nesta implementação. O servidor
  principal ainda precisa ser reiniciado em janela segura para carregar rotas e
  daemon. Antes disso, a interface identifica a versão antiga e bloqueia o botão
  para não iniciar acidentalmente o gerador legado.

## Diagnóstico após uso real

O primeiro lote real rejeitou abelha, abraço e alegria por resposta curta;
almoço foi salvo antes da parada solicitada. A API finalizou normalmente as
respostas curtas; minItems no schema não garantiu a quantidade. Enviar todo o
dicionário no prompt e enum consumia cerca de 18 mil tokens de entrada.

O ajuste limita o vocabulário de seleção às 300 candidatas locais, reduzindo
entrada a cerca de 4 mil tokens. Validação real em banco isolado: abelha e
abraço passaram com 80 únicas; alegria retornou 48 únicas. A nova regra salva
as válidas e completa o restante localmente. Itens fora do dicionário, o alvo e
repetições são ignorados; respostas que não tenham uma lista JSON válida seguem
como falha e não substituem um ranking já salvo.

Respostas de diagnóstico e seu consumo estão nos artefatos locais em
`F:\Codex\Projetos\TikPlay\experimentos`; essas chamadas avulsas não compõem
o relatório do lote principal. O teste do worker corrigido está em
`validacao-gerador-300/resultado.json` e custou US$ 0,0031252 (três chamadas).
As quatro sondagens com resposta preservada somaram US$ 0,0048549. A sondagem
que retornou HTTP 400 não informou custo. Não iniciar novos lotes de teste pagos
sem necessidade nova; manter visíveis os custos históricos do lote original.
