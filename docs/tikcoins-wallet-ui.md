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

## Ajuste do checkout de cartão

- O modal mantém a mesma rota, catálogo, validação de pagamento e confirmação; somente a apresentação e a regra de parcelamento foram refinadas.
- O formulário mostra cartão, validade, CVV, nome impresso, CPF ou CNPJ do titular e e-mail para recibo. Emissor e parcelas não são exibidos; o backend sempre envia uma parcela, ignorando qualquer valor de parcelas vindo do navegador.
- Os campos seguros hospedados pelo SDK do Mercado Pago ficam limitados a uma linha de 48 px, evitando que os iframes expandam e dominem o modal. A grade continua em duas colunas para validade/CVV e CPF/e-mail também em telas estreitas.
- Os campos seguros recebem cor de texto e placeholder compatíveis com o tema escuro, tamanho legível e foco destacado no contêiner. CPF (11 dígitos) ou CNPJ (14 dígitos) é inferido pelo número; o backend deriva o tipo novamente e rejeita outros comprimentos.
- O SDK continua tokenizando os dados do cartão diretamente no Mercado Pago. O TikPlay recebe somente token, método, documento, e-mail e compra existente; dados do cartão não são persistidos nem registrados.

### Observabilidade deste ajuste

Nenhum evento, categoria, campo ou integração nova foi adicionado. Checkout continua usando os eventos existentes `tts.credits.payment_created`, `tts.credits.payment_failed`, `tts.credits.purchase_approved` e correlatos, com os limites e dados permitidos definidos em `creditos-voz.md`. Erros de montagem do SDK permanecem no status acessível do modal e não incluem campos/token do cartão.

## Preferência Pix e ciclo do CardForm

- Ao abrir uma recarga, Pix aparece primeiro e já fica selecionado; cartão permanece como alternativa, quando há Public Key configurada.
- Emissor, parcelas e tipo do documento continuam como seletores ocultos porque o CardForm exige esses elementos no mapa, conforme a documentação do SDK. Eles não aparecem como controles ao usuário e o servidor segue enviando sempre `installments: 1`.
- Ao fechar o modal, a instância do CardForm é desmontada; a próxima abertura aguarda o callback de desmontagem antes de montar outra, evitando contextos duplicados como `expirationFields`. O erro técnico é substituído por orientação segura para tentar novamente ou pagar via Pix.
- A mudança preserva rota, compra, confirmação, Pix, carteira e eventos. Documento e token do cartão não entram nos logs; a atualização do runtime ainda depende do deploy normal do painel Node.

## Refatoração do checkout transparente

- O modal mantém um resumo visível de pacote, TikCoins e total; Pix e Cartão alternam painéis no mesmo DOM e preservam os valores enquanto o usuário troca de método.
- Os botões principais exibem o total da compra. O envio fica bloqueado durante o processamento e enquanto existir uma transação aguardando confirmação, evitando reenvio acidental; uma nova tentativa fica disponível após recusa ou expiração.
- Pix exibe QR Code/copia e cola, valor, estado e expiração quando a API do Mercado Pago a retorna. O polling continua consultando a rota autenticada existente; somente a confirmação tratada pelo backend credita TikCoins.
- O rodapé informa somente que o pagamento é processado pelo Mercado Pago. Estados de formulário, envio, confirmação, recusa, expiração e falha de conexão são apresentados sem criar fluxo financeiro ou evento novo.
- Mapa de observabilidade: a solicitação, criação, falha, polling, confirmação e liquidação continuam usando os eventos e categorias já documentados em `creditos-voz.md`; sem eventos novos, sem log de documento/token, e sem exibir sucesso com base em estado local do navegador.
- Refinamento visual: o formulário de cartão usa espaçamentos e campos compactos para caber sem rolagem interna nas alturas comuns de tela; rolagem permanece como contingência em viewports muito baixos/teclado aberto. O ícone Pix representa um QR Code.
