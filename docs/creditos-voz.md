# TikCoins para vozes adicionais

## Regra comercial inicial

- O saldo é por streamer, inteiro e sem expiração mensal; o ledger é a fonte auditável.
- Cada modelo tem uma tarifa inteira de TikCoins por 150 caracteres falados. Uma síntese cobra `max(1, ceil(caracteres × tarifa / 150))`; a cobrança é arredondada para cima em cada mensagem, não fracionada entre mensagens. A hashtag de emoção não conta; texto limpo falado conta.
- Tarifas existentes por 100 caracteres são migradas uma vez para a nova referência usando `ceil(tarifa_antiga × 1,5)`. Assim, Gemini 1/100 passa a 2/150 e ElevenLabs 3/100 passa a 5/150; saldos e históricos não são alterados.
- Cache-hit não cobra, pois não faz nova chamada paga. Teste do streamer cobra como síntese. Preview do Super Admin segue debitado da integração da plataforma, fora da carteira do streamer.
- O Super Admin define tarifa do modelo em TikCoins por 150 caracteres e pacotes (TikCoins + preço em BRL). A compra abre checkout avulso do Mercado Pago; somente pagamento aprovado confirmado pela API credita o saldo.
- A gestão manual fica na aba **Pacotes e TikCoins** do Super Admin: cadastro/edição de pacotes e uma lista de saldos por streamer, com ações separadas para adicionar ou remover TikCoins. A rota de listagem não cria carteiras vazias; remoção confirma a ação no painel e a transação recusa saldo final negativo.
- O **Relatório de recargas** da mesma aba separa compras pagas (`purchase` confirmado no ledger) de ajustes manuais (`admin_adjustment`), distinguindo adições e remoções e identificando o administrador que fez o ajuste. Pagamentos pendentes ou recusados não são venda; reembolsos aparecem como reversões separadas e reduzem a receita líquida. Consumo (`usage`) não compõe o relatório de recargas. O endpoint administrativo aceita períodos de 7, 30, 90 dias ou todo o histórico, com 100 linhas por página; os totais abrangem todo o período selecionado. Não altera saldo, checkout ou liquidação.
- O painel do streamer mostra o preço de cada pacote em reais, a tarifa por 150 caracteres e uma estimativa pelo texto digitado. A simulação aplica o mesmo arredondamento por mensagem, remove hashtag final de emoção conhecida e respeita o limite de 150 caracteres da narração. O histórico informa os TikCoins debitados e a quantidade de caracteres falados.
- Débito é atômico antes da chamada externa para impedir saldo negativo e corrida entre sessões. O débito não é revertido depois de iniciar a chamada: um timeout pode ter sido cobrado pelo provedor. Falha por saldo/configuração insuficiente ocorre antes da chamada e não debita.
- Reembolso integral confirmado pela API do Mercado Pago gera um lançamento reverso idempotente. Se o streamer já gastou esses créditos, o saldo fica negativo e compras futuras primeiro cobrem essa diferença. Reembolsos parciais e disputas/chargebacks exigem reconciliação administrativa.
- A antiga tabela de uso por caracteres pode permanecer para compatibilidade/histórico, mas deixa de limitar, debitar ou aparecer nos painéis.

## Persistência e segurança

`tts_credit_wallets` mantém o saldo corrente; `tts_credit_ledger` registra cada débito, compra ou ajuste com chave de idempotência. `tts_credit_purchases` guarda snapshot de pacote e pagamento. Chaves de pagamento e síntese são únicas. Todas as mutações financeiras usam transações SQLite imediatas. Nenhum preço ou quantidade enviado pelo cliente é confiável: checkout resolve pacote ativo no servidor e o webhook compara referência, status, moeda e valor esperados antes de creditar.

## Mapa de observabilidade

| Ação/transição | Evento | Categoria/nível | Campos permitidos |
|---|---|---|---|
| Admin altera tarifa de modelo | `tts.credits.model_cost_saved` | `billing`/`info` | ator, modelo, tarifa anterior/nova em TikCoins por 150 caracteres, `trace_id` |
| Admin altera pacotes | `tts.credits.packages_saved` / `tts.credits.packages_rejected` | `diagnostic`/`info`; `notice`/`warning` | ator, quantidade de pacotes, IDs, código, `trace_id`; sem dados de pagador |
| Admin ajusta saldo | `tts.credits.adjusted` / `tts.credits.adjustment_rejected` | `system`/`info`; `notice`/`warning` | tenant, ator, variação, saldo resultante, código, `trace_id` |
| Admin consulta saldos | sem evento (consulta administrativa somente leitura) | — | não persiste novos dados e não cria carteira; retorna apenas ID, nome, e-mail, status e saldo dos streamers |
| Checkout criado | `tts.credits.checkout_created` / `tts.credits.checkout_failed` | `billing`/`info`; `error`/`error` | tenant, pacote, créditos, centavos, código, `trace_id`; sem e-mail ou URL de checkout |
| Compra liquidada/reembolsada | `tts.credits.purchase_approved` / `tts.credits.purchase_rejected` / `tts.credits.purchase_refunded` | `billing`/`info`; `notice`/`warning` | tenant, ID do pagamento, pacote, centavos, créditos e saldo; sem payload bruto |
| Débito/falta de saldo na narração | `chat.tts.batch` (agregado) / `tts.provider.fallback` (throttle 30 s) | `chat`/`info`; `notice`/`warning` | contagem agregada e código de falha; nenhum conteúdo de mensagem, chave ou resposta do provedor. Débitos individuais ficam no ledger |

O relatório administrativo é somente leitura e reutiliza `tts_credit_ledger`/`tts_credit_purchases`; não emite eventos novos. Os ajustes continuam auditados por `actor_id` e pelo evento existente `tts.credits.adjusted`.

Não criar log por mensagem para débito normal. O ledger financeiro registra o débito transacionalmente; o log de chat existente agrega sínteses. Webhooks são idempotentes e eventos duplicados não duplicam crédito.

## Validação

- Testar tarifa diferente por modelo, conversão de tarifas legadas, arredondamento por mensagem em 75/150/151 caracteres, hashtags removidas da contagem, texto vazio e cache sem cobrança.
- Testar saldo insuficiente sem chamada ao provedor, atomicidade concorrente, isolamento entre tenants e registro imutável de débitos/ajustes.
- Testar pacotes inválidos/ocultos, criação de checkout, webhook pendente/rejeitado/aprovado, valor/moeda/referência divergentes e repetição do mesmo pagamento.
- Testar que a tela do cliente não pode fornecer preço, valor de crédito ou saldo; só o webhook validado e o admin podem creditar.
- Testar listagem de saldos restrita ao admin, exclusão de contas administrativas, saldo zero sem carteira criada e atualização após ajustes positivo/negativo.
- Testar compatibilidade da seleção de voz e fallback sem alterar a voz padrão das charadas.
