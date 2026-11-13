# Gestão financeira do Super Admin

## Escopo

`Super Admin → Gestão financeira` administra despesas e fornecedores e apresenta um resumo de caixa com as recargas reais já registradas pelo fluxo Mercado Pago. Não cria uma segunda entrada para recargas: a fonte é `tts_credit_ledger` (`purchase` e `purchase_reversal`) associada a `tts_credit_purchases.price_cents`.

Valores são persistidos como centavos inteiros em BRL. O resultado operacional do período é recargas confirmadas menos estornos registrados menos despesas pagas no período. Contas pendentes são exibidas à parte e não reduzem o resultado realizado até serem marcadas como pagas. Créditos manuais e consumo de TikCoins não são receita nem despesa financeira nesta visão.

## Dados e transições

- `finance_expenses`: descrição, categoria, fornecedor opcional, valor, vencimento, observações, status e timestamps/atores de criação e alteração.
- `finance_suppliers`: cadastro ativo/arquivado. Arquivar preserva as referências históricas nas despesas.
- `finance_audit_log`: estado anterior e posterior da entidade, ação, administrador e horário. Despesas pagas ou canceladas não podem voltar ao estado pendente; contas pendentes podem ser pagas ou canceladas.
- Categorias aceitas: APIs e serviços, Hospedagem, Infraestrutura, Software, Tarifas e impostos, Marketing e Outros.

Rotas administrativas são protegidas por `auth.requireAdmin`: `GET /api/admin/finance/summary`, `GET/POST /api/admin/finance/expenses`, `PUT /api/admin/finance/expenses/:id`, `GET/POST /api/admin/finance/suppliers` e `PUT /api/admin/finance/suppliers/:id`.

## Mapa de observabilidade

| Ação/transição | Evento | Categoria / nível | Detalhes permitidos |
| --- | --- | --- | --- |
| Despesa criada | `finance.expense.created` | `billing` / `info` | ator, ID, categoria, centavos, situação |
| Despesa editada | `finance.expense.updated` | `billing` / `info` | ator, ID, categoria, centavos |
| Conta marcada como paga | `finance.expense.paid` | `billing` / `info` | ator, ID, categoria, centavos |
| Despesa cancelada | `finance.expense.cancelled` | `billing` / `info` | ator, ID, categoria, centavos |
| Fornecedor criado/alterado/arquivado | `finance.supplier.created`, `.updated`, `.archived` | `billing` / `info` | ator, ID, categoria |
| Entrada ou transição rejeitada | `finance.expense.create_rejected`, `finance.expense.update_rejected` | `billing` / `warning` | ator e código estável; sem conteúdo livre enviado |

São ações administrativas de baixa frequência; não há throttle. Descrições, observações e dados de contato de fornecedores não são enviados aos logs operacionais. O histórico de auditoria persiste o conteúdo anterior/posterior para rastreabilidade de administradores autorizados no próprio banco.

## Limites atuais

A área cobre registro manual de despesas e contas a pagar/pagas; não cria recorrência automática, anexos de nota fiscal, conciliação bancária ou lançamentos contábeis. As datas e os totais são informativos de caixa, não substituem escrituração contábil/fiscal.
