# Créditos de voz (TTS): referência de custos e proposta comercial

**Atualizado em:** 17/10/2026
**Status:** proposta para decisão; não representa configuração aplicada no painel nem preço publicado.

## Objetivo

Vender saldo em créditos em vez de caracteres, permitindo cobrar valores diferentes conforme o custo de cada modelo. A comparação abaixo considera os modelos já discutidos para as vozes adicionais do TikPlay e uma mensagem no limite atual de **150 caracteres**.

## Premissas da simulação

- Conversão de referência: **US$ 1 = R$ 5,0826**, cotação PTAX de venda consultada em 16/10/2026.
- Texto: até 150 caracteres, já considerando que tags de emoção no fim da mensagem não são faladas nem cobradas.
- Gemini: a duração estimada de 150 caracteres é **12 a 15 segundos**. O custo varia com a duração gerada; o texto de entrada tem custo muito pequeno nesta estimativa.
- ElevenLabs: integração direta com a API ElevenLabs; não usar o preço de uma rota ElevenLabs via OpenRouter para estimar esta integração.
- Kokoro: o custo depende do provedor escolhido pelo OpenRouter; a tabela mostra o intervalo entre DeepInfra e Together.
- HeyGen: preço promocional exibido pelo OpenRouter na data da consulta; o preço de lista é informado à parte. O modelo estava desativado no TikPlay por ainda não haver uma voz aprovada com sotaque brasileiro.
- Os valores de API são referências variáveis, antes de impostos, taxas de pagamento, câmbio efetivo, cache e custos operacionais do TikPlay.

## Custo estimado do provedor por mensagem

| Modelo | Referência de API usada | Custo por 150 caracteres |
| --- | --- | ---: |
| ElevenLabs Turbo (API direta) | US$ 0,05 / 1.000 caracteres | **R$ 0,0381** |
| Gemini Flash Lite TTS (OpenRouter) | US$ 6 / milhão de tokens de áudio; 25 tokens/s | **R$ 0,0091–0,0114** para 12–15 s |
| Kokoro 82M (OpenRouter) | US$ 0,62–4 / milhão de caracteres, conforme provedor | **R$ 0,00047–0,00305** |
| HeyGen Voice Turbo (OpenRouter) | US$ 4 / milhão de caracteres na tarifa exibida; lista US$ 8 | **R$ 0,00305** promocional; **R$ 0,00610** a preço de lista |

Fórmulas: ElevenLabs = `150 × US$ 0,05 / 1.000`; Kokoro e HeyGen = `150 × tarifa por milhão / 1.000.000`; Gemini = `segundos × 25 × US$ 6 / 1.000.000`. Os resultados em reais usam a conversão de referência acima.

## Tarifa sugerida em créditos

Como ponto de partida para absorver a diferença de custo entre modelos:

| Modelo | Créditos por 100 caracteres | Débito máximo em 150 caracteres | Custo de API estimado para 150 |
| --- | ---: | ---: | ---: |
| ElevenLabs Turbo | **2** | **3 créditos** | R$ 0,0381 |
| Gemini Flash Lite TTS | **1** | **2 créditos** | R$ 0,0091–0,0114 |
| Kokoro 82M | **1** | **2 créditos** | R$ 0,00047–0,00305 |
| HeyGen Voice Turbo | **1** | **2 créditos** | R$ 0,00305 promocional; R$ 0,00610 a preço de lista |

Débito proposto: `máximo(1, teto(caracteres × tarifa_do_modelo / 100))`. Assim, mensagens menores também consomem proporcionalmente, com arredondamento para cima. Exemplo: 150 caracteres a 2 créditos/100 consomem 3 créditos; a 1 crédito/100 consomem 2.

Usando o valor unitário do maior pacote como cenário conservador de receita (R$ 89,90 / 4.000 = R$ 0,022475 por crédito), a comparação por mensagem máxima fica:

| Modelo | Receita equivalente em créditos | Custo estimado de API | Margem bruta estimada |
| --- | ---: | ---: | ---: |
| ElevenLabs Turbo | R$ 0,0674 | R$ 0,0381 | **43%** |
| Gemini Flash Lite TTS | R$ 0,0450 | R$ 0,0091–0,0114 | **75–80%** |
| Kokoro 82M | R$ 0,0450 | R$ 0,00047–0,00305 | **93–99%** |
| HeyGen Voice Turbo | R$ 0,0450 | R$ 0,00305 promocional; R$ 0,00610 lista | **86–93%** |

Margem bruta é `(receita equivalente − API) / receita equivalente`; não inclui taxas do Mercado Pago, impostos, infraestrutura ou outros custos.

## Proposta de venda

Como referência inicial, manter o plano Pro em **R$ 29,90/mês** e incluir **300 créditos por mês**. Oferecer recargas avulsas:

| Recarga | Preço sugerido | Preço efetivo por crédito |
| ---: | ---: | ---: |
| 500 créditos | **R$ 14,90** | R$ 0,0298 |
| 1.500 créditos | **R$ 39,90** | R$ 0,0266 |
| 4.000 créditos | **R$ 89,90** | R$ 0,0225 |

Pelo maior pacote, uma mensagem de 150 caracteres representa aproximadamente **R$ 0,0674 em créditos** no ElevenLabs (3 créditos) e **R$ 0,0450** nos modelos tarifados a 1 crédito/100 (2 créditos). Contra o custo de API estimado, isso deixa margem bruta antes das demais despesas. A margem real muda conforme o pacote comprado, provedor efetivamente selecionado, câmbio, duração de áudio, impostos e cache.

Os 300 créditos incluídos no Pro equivaleriam a até **100 mensagens de 150 caracteres no ElevenLabs** ou **150 nos modelos de 1 crédito/100**, se o saldo fosse usado só naquele modelo. Isso é uma estimativa de capacidade, não uma promessa de uso homogêneo ou de duração fixa.

## Pendências antes de publicar

- A proposta de 300 créditos mensais no Pro difere da regra documentada atualmente em `F:\Programação\Jogo TikTok\jogo-contexto\docs\creditos-voz.md`, onde o saldo é sem expiração mensal. Decidir qual regra comercial vale antes de implementar/publicar; uma cota recorrente que expira exige distinguir concessões mensais de recargas compradas.
- Definir se as recargas terão validade e como tratar estorno/reembolso do Mercado Pago.
- Medir custo real e duração por modelo com amostras de mensagens próximas de 150 caracteres; especialmente Gemini e rotas variáveis do OpenRouter.
- Validar sotaque PT-BR antes de liberar HeyGen. A estimativa de preço não significa que a voz esteja aprovada ou habilitada.
- Recalcular preços e margens antes do lançamento e sempre que os provedores alterarem tarifas ou roteamento.

## Fontes consultadas

- [ElevenLabs — preços da API](https://elevenlabs.io/pricing/api)
- [OpenRouter — Gemini Flash Lite TTS e provedores](https://openrouter.ai/google/gemini-3.8-flash-lite-tts/providers)
- [OpenRouter — Kokoro 82M](https://openrouter.ai/hexgrad/kokoro-82m)
- [OpenRouter — HeyGen Voice Turbo](https://openrouter.ai/heygen/heygen-voice-1-turbo)
- [Banco Central — consulta PTAX](https://ptax.bcb.gov.br/ptax_internet/consultarUltimaCotacaoDolar.do)
