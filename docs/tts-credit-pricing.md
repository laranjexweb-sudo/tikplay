# Política de créditos de voz — TikPlay

## Plano de observabilidade

- Ações existentes: consultar modelos e tarifas, salvar liberação/tarifa no Admin, comprar pacote e debitar uma síntese de chat.
- Eventos existentes preservados: `tts.credits.model_cost_saved`, `tts.credits.packages_saved`, eventos de pagamento/compra e ledger de uso.
- Categorias/níveis: manter `billing` para tarifa/pagamento; não criar evento por mensagem. O ledger registra `model_id`, caracteres e TikCoins debitados para análise agregada.
- Correlação: pagamentos seguem `purchase_id`/`payment_id`; síntese segue o identificador existente no ledger. Não adicionar texto, voz sintetizada, comentário bruto ou credenciais a logs.
- Volume/privacidade: sem novos eventos de alto volume; relatório usa agregação de ledger existente.
- Verificação prevista: validar que os pacotes aparecem no endpoint de Admin e no checkout, que as tarifas chegam à lista pública de vozes, e que a simulação de 150 caracteres corresponde ao débito por modelo. Cobrir valores-base, conta arredondamento e repetição do seed sem duplicação.

## Política inicial aprovada

Saldo denominado TikCoins, convertido em tarifa por 150 caracteres por mensagem:

| Modelo | Multiplicador | TikCoins / 150 caracteres |
| --- | ---: | ---: |
| Kokoro 82M | 0,1× | 15 |
| Gemini 3.1 Flash TTS | 1× | 150 |
| Gemini 3.8 Flash-Lite TTS | 0,5× | 75 |
| ElevenLabs v4 Turbo | 2× | 300 |

Pacotes iniciais: Inicial (30.000 / R$ 14,90), Criador (100.000 / R$ 39,90), Pro (300.000 / R$ 99,90). Estes são pacotes avulsos; a carteira existente e a confirmação idempotente do Mercado Pago permanecem responsáveis pelo crédito.

Os preços são uma política comercial inicial. Custos OpenRouter variáveis por duração de áudio não são usados para calcular o débito individual, que usa a tarifa fixa acima. Reavaliar multiplicadores usando uso/custo medido antes de alterar a política.

## Implementado em 2026-11-02

- O catálogo OpenRouter inclui Gemini 3.1 Flash TTS Preview e mantém somente Gemini 3.8 Flash-Lite TTS.
- A migração `weighted-characters-v1` configura uma vez as quatro tarifas aprovadas; mudanças posteriores feitas pelo Super Admin são preservadas após reinícios.
- Os três pacotes são inseridos pelo seed idempotente da carteira; IDs determinísticos evitam duplicação. Pacotes antigos não são removidos automaticamente e podem ser desativados em Pacotes e TikCoins.
- O painel do streamer mostra o multiplicador e o custo por 150 caracteres ao lado de cada voz no seletor, na tarifa selecionada e no estimador. A compra mostra nome, saldo e preço do pacote.
- Nenhum evento/log novo por mensagem foi criado; a cobrança e o ledger existentes permanecem responsáveis pelo débito, enquanto eventos existentes de tarifa, pacote e pagamento são mantidos.

## Acesso universal às vozes expressivas (2026-11-07)

O acesso individual foi encerrado. Contas ativas com a funcionalidade `chat`
liberada podem listar, selecionar e testar as vozes adicionais. A API valida
autenticação, status da conta e `requireFeature("chat")`. O Super Admin continua
controlando disponibilidade por voz e modelo, configuração do provedor e tarifa;
somente modelos/vozes ativos globalmente e com tarifa positiva são listados e
aceitos pelo servidor.

`tenant_elevenlabs.enabled` permanece no schema para compatibilidade, mas já não
é consultado como autorização na API, no checkout nem na síntese Python. Não há
backfill nem exclusão de coluna. A preferência por `model_id`/`voice_id` continua
por conta; o primeiro salvamento cria o registro caso ainda não exista. A antiga
rota de concessão administrativa por usuário foi removida.

A cobrança permanece proporcional aos caracteres de cada mensagem, com
arredondamento para cima e débito atômico no saldo/ledger. O teste de voz usa o
mesmo sintetizador pago. Se uma mensagem do chat não puder ser cobrada por saldo
insuficiente, a síntese expressiva não troca silenciosamente para voz gratuita:
o painel sinaliza o motivo e oferece o atalho para recarregar TikCoins. A
recarga de pacotes não depende do antigo sinalizador individual.
