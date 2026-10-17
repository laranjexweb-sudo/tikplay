# Créditos para vozes adicionais

## Regra comercial inicial

- O saldo é por streamer, inteiro e sem expiração mensal; o ledger é a fonte auditável.
- Cada modelo tem uma tarifa em créditos por bloco de 100 caracteres falados. Uma síntese cobra `ceil(caracteres × tarifa / 100)`, com mínimo de 1 crédito. A hashtag de emoção não conta; texto limpo falado conta.
- Cache-hit não cobra, pois não faz nova chamada paga. Teste do streamer cobra como síntese. Preview do Super Admin segue debitado da integração da plataforma, fora da carteira do streamer.
- O Super Admin define tarifa de modelo e pacotes (créditos + preço em BRL). A compra abre checkout avulso do Mercado Pago; somente pagamento aprovado confirmado pela API credita o saldo.
- O painel do streamer mostra o preço de cada pacote em reais, a tarifa da voz, uma referência média de 75 caracteres (metade do limite de 150 da live) e uma estimativa local por texto. A simulação aplica o arredondamento, remove hashtag final de emoção conhecida e respeita o limite de 150 caracteres da narração. O histórico informa a quantidade de caracteres efetivamente debitada.
- Débito é atômico antes da chamada externa para impedir saldo negativo e corrida entre sessões. O débito não é revertido depois de iniciar a chamada: um timeout pode ter sido cobrado pelo provedor. Falha por saldo/configuração insuficiente ocorre antes da chamada e não debita.
- Reembolso integral confirmado pela API do Mercado Pago gera um lançamento reverso idempotente. Se o streamer já gastou esses créditos, o saldo fica negativo e compras futuras primeiro cobrem essa diferença. Reembolsos parciais e disputas/chargebacks exigem reconciliação administrativa.
- A antiga tabela de uso por caracteres pode permanecer para compatibilidade/histórico, mas deixa de limitar, debitar ou aparecer nos painéis.

## Persistência e segurança

`tts_credit_wallets` mantém o saldo corrente; `tts_credit_ledger` registra cada débito, compra ou ajuste com chave de idempotência. `tts_credit_purchases` guarda snapshot de pacote e pagamento. Chaves de pagamento e síntese são únicas. Todas as mutações financeiras usam transações SQLite imediatas. Nenhum preço ou quantidade enviado pelo cliente é confiável: checkout resolve pacote ativo no servidor e o webhook compara referência, status, moeda e valor esperados antes de creditar.

## Mapa de observabilidade

| Ação/transição | Evento | Categoria/nível | Campos permitidos |
|---|---|---|---|
| Admin altera preço de custo por modelo | `tts.credits.model_cost_saved` | `billing`/`info` | ator, modelo, tarifa anterior/nova em créditos por 100 caracteres, `trace_id` |
| Admin altera pacotes | `tts.credits.packages_saved` / `tts.credits.packages_rejected` | `diagnostic`/`info`; `notice`/`warning` | ator, quantidade de pacotes, IDs, código, `trace_id`; sem dados de pagador |
| Admin ajusta saldo | `tts.credits.adjusted` / `tts.credits.adjustment_rejected` | `system`/`info`; `notice`/`warning` | tenant, ator, variação, saldo resultante, código, `trace_id` |
| Checkout criado | `tts.credits.checkout_created` / `tts.credits.checkout_failed` | `billing`/`info`; `error`/`error` | tenant, pacote, créditos, centavos, código, `trace_id`; sem e-mail ou URL de checkout |
| Compra liquidada/reembolsada | `tts.credits.purchase_approved` / `tts.credits.purchase_rejected` / `tts.credits.purchase_refunded` | `billing`/`info`; `notice`/`warning` | tenant, ID do pagamento, pacote, centavos, créditos e saldo; sem payload bruto |
| Débito/falta de saldo na narração | `chat.tts.batch` (agregado) / `tts.provider.fallback` (throttle 30 s) | `chat`/`info`; `notice`/`warning` | contagem agregada e código de falha; nenhum conteúdo de mensagem, chave ou resposta do provedor. Débitos individuais ficam no ledger |

Não criar log por mensagem para débito normal. O ledger financeiro registra o débito transacionalmente; o log de chat existente agrega sínteses. Webhooks são idempotentes e eventos duplicados não duplicam crédito.

## Validação

- Testar tarifa diferente por modelo, arredondamento/mínimo, hashtags removidas da contagem, texto vazio e cache sem cobrança.
- Testar saldo insuficiente sem chamada ao provedor, atomicidade concorrente, isolamento entre tenants e registro imutável de débitos/ajustes.
- Testar pacotes inválidos/ocultos, criação de checkout, webhook pendente/rejeitado/aprovado, valor/moeda/referência divergentes e repetição do mesmo pagamento.
- Testar que a tela do cliente não pode fornecer preço, valor de crédito ou saldo; só o webhook validado e o admin podem creditar.
- Testar compatibilidade da seleção de voz e fallback sem alterar a voz padrão das charadas.
