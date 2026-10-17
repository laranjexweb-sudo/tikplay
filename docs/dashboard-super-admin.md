# Dashboard do Super Admin

## Objetivo e contrato

O Dashboard reúne estado atual, saúde monitorada, uso medido de APIs, consumo de créditos e incidentes ativos. Os dados operacionais atualizam sem recarregar a página; intervalo automático é configurável e fica no navegador do administrador.

Estados de processo vêm de `/api/admin/monitor/*`; a atividade por conta vem do estado em memória exposto em `/api/admin/users`. Ausência de sinal permanece “sem dados”. Configuração de uma credencial é exibida como “configurada”, nunca como prova de saúde do provedor. Integrações externas não são testadas automaticamente a cada atualização.

## Custos, créditos e receita

- `api_cost_usage` recebe metadados de chamadas novas de voz adicional (OpenRouter/Gemini e ElevenLabs), geração de charada e geração de dicas do 3 Dicas. Histórico anterior ao início da medição não pode ser recuperado.
- Custo retornado pelo provedor é marcado `actual`. Uma tarifa administrativa versionada produz `estimated`. Chamadas sem preço ou custo retornado ficam `unknown`; salvar tarifa não recalcula registros anteriores.
- Tarifas guardam provedor, modelo (opcional), recurso, unidade, preço, moeda, taxa USD→BRL e intervalo de validade. Conversões são capturadas na chamada. Não há busca automática de câmbio nem preço padrão.
- A projeção do fim do mês é linear sobre custos reais/estimados medidos no mês atual e é sempre marcada como parcial; chamadas sem medição, integrações ainda não instrumentadas e período anterior à implantação ficam de fora.
- `context_generation_attempts` já registra o custo USD retornado pelo OpenRouter para geração de contextos; é somado como custo real no período, sem duplicar essa fonte em `api_cost_usage`.
- Créditos consumidos vêm dos lançamentos `usage` de `tts_credit_ledger`, agrupados por modelo. Créditos não são custo monetário da API.
- Receita bruta usa apenas compras de pacotes aprovadas em `tts_credit_purchases`; não desconta taxas, reembolsos ou custo operacional. Ajustes manuais de créditos não contam como receita.
- A tela mostra chamadas, falhas, latência disponível, uso por modelo e clientes. Nenhum custo médio por conta é inferido a partir do saldo de créditos.

## Mapa de observabilidade

Esta funcionalidade é predominantemente uma consulta agregada. O refresh do Dashboard não grava eventos. Uso externo é registrado em `api_cost_usage`, que tem retenção pendente de decisão e, por isso, não é apagado automaticamente nesta etapa.

| Ação / transição | Evento ou métrica | Categoria / nível | Correlação | Campos permitidos |
| --- | --- | --- | --- | --- |
| Chamada externa terminou ou falhou | linha `api_cost_usage` com `status=success/failed/timeout` | Métrica de uso, sem log por chamada | `request_id`; `provider_request_id` quando oferecido pelo provedor | provedor, modelo, recurso, unidade, quantidade, tenant, duração, status, custo numérico e moeda |
| Admin salvou tarifa estimada | `admin.api_cost_rate.saved` | `billing` / `info` | `rate_id` (sem correlacionar chamadas distintas) | ator admin, id da tarifa, provedor, recurso, modelo |
| Leitura do painel/refresh automático | nenhuma gravação | — | — | consultas admin autenticadas e agregadas |
| Falha no refresh de uma fonte | estado de erro transitório na interface | — | — | nome da fonte e texto genérico; sem payload bruto |

Não registrar prompt, texto gerado, palavra secreta, dica, comentário, voz, áudio, conteúdo do request, credencial, token ou corpo de resposta. Não emitir log por chamada de alto volume; o armazenamento de uso é separado dos logs funcionais. Se futuramente forem adicionados eventos em log, devem ser agregados/throttled e seguir `docs/PADRAO_DE_LOGS.md`.

### Limites e validação

- A API de tarifas valida campos, moeda/unidade, valores e FX; cada alteração fecha a versão anterior e cria uma nova.
- Métricas são consultadas por faixa limitada (24h, 7d, 30d ou mês atual), agrupadas no SQL. Índices cobrem data dos registros e lançamentos.
- Testar: custo ausente, tarifa estimada, custo real, FX capturado, tarifa alterada sem reprecificar passado, campos privados ignorados, autenticação admin, agregação sem dados, e duração/status.
- Persistência das chamadas é best-effort e não altera retorno, cobrança de créditos ou resultado dos jogos. Falha de telemetria não bloqueia a chamada do provedor.
- Após atualizar o processo, validar uma síntese sintética e conferir linha sem conteúdo no banco, e abrir a rota do Dashboard autenticada. Código no working tree não prova que a medição está ativa no processo.

## Limites conhecidos

O conjunto de integrações externas não tem health check automático completo; status de credencial é configuração. Nem todo endpoint/modelo retorna custo real. Custo de TTS fica estimado até o administrador cadastrar tarifa correspondente. Falhas ocorridas antes de sair uma chamada para o provedor não aparecem como custo externo. O gráfico de custo monetário agregado não atribui valor aos créditos.
