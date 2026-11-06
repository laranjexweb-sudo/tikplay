# Mapa de observabilidade — página TikCoins e Recargas

## Escopo

Refatoração de apresentação do painel do streamer. A página usa a carteira, o catálogo de pacotes, o checkout, as tarifas e o ledger já existentes. Não foram adicionados eventos, categorias, campos de telemetria, logs, persistência ou contratos.

## Fluxo e dados apresentados

| Área/ação | Origem atual | Resultado na interface |
| --- | --- | --- |
| Carregar saldo e carteira | `GET /api/tts/credits` → `balance` | Saldo disponível em TikCoins. |
| Apresentar recargas | `GET /api/tts/credits` → `packages` | Cards com nome, quantidade, preço e botão que inicia o mesmo checkout atual. |
| Comprar pacote | Checkout atual em `/api/tts/credits/checkout` e confirmação Mercado Pago | O status continua sendo apresentado no modal/estado já existente; o ledger registra a entrada após aprovação. |
| Consultar movimentações | `GET /api/tts/credits` → `ledger` | Data, tipo, origem/modelo, caracteres, estado visual e valor com sinal; entradas e consumos têm cores distintas. |
| Consultar consumo e estimar mensagem | Tarifas da API e calculadora já existente | Faixas genéricas sem nomes técnicos, multiplicadores visuais, TikCoins por 150 caracteres e estimativa conforme arredondamento/limite existentes. |

## Telemetria e logs

Nenhuma telemetria é necessária para esta mudança de UI. Reutilizam-se as requisições e registros do fluxo existente; a página não envia conteúdo de mensagens a logs nem cria eventos de analytics. Falhas de carregamento usam o status acessível já exibido na interface e seguem os registros existentes das rotas.

## Limitações herdadas

- O endpoint entrega no máximo 15 movimentações ordenadas da mais recente para a mais antiga; o resumo de consumo considera somente essas movimentações exibidas.
- O ledger contém compras liquidadas e estornos, não pagamentos pendentes. O estado pendente fica no fluxo/modal de checkout já existente.
- As tarifas partem de `model_costs`, mas são agrupadas por valor único e exibidas com nomes genéricos; a interface não revela identificadores de modelo ou provedor.
- Os campos de pacote disponíveis hoje são nome, quantidade de TikCoins e preço. A página não inventa descontos ou benefícios ausentes do catálogo.
