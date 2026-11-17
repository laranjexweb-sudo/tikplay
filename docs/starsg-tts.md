# Integração StarsG para vozes TTS

## Escopo implementado

O Super Admin pode salvar/remover a chave StarsG e testar a autenticação por `GET /v1/models` (sem credencial a API responde 401). A síntese usa o protocolo realtime documentado pela StarsG via WebSocket (`wss://api.starsg.ai/v1/realtime?model=...`), com saída PCM mono a 24 kHz convertida para WAV. O catálogo busca os modelos e vozes pela API antes de permitir o administrador aprová-los globalmente. Durante a validação local, `GET /v1/realtime/models` e os endpoints documentados de vozes responderam 404. O handshake WebSocket com Altair Mini e Vega Flash, sem gerar áudio, aceitou a sessão realtime sem `voice_id`.

Modelos cadastrados:

- `tts-altair-v1-mini` — StarsG Altair Mini.
- `tts-vega-v1-flash` — StarsG Vega Flash.

Ambos iniciam desativados no TikPlay. O administrador precisa cadastrar a chave na página Integrações e habilitar as vozes aprovadas em Vozes liberadas. Quando o catálogo de `voice_id` da API StarsG falha, o TikPlay conserva a opção **Voz padrão do modelo** e usa o catálogo manual consultado no site oficial/fornecido pelo usuário. Para `tts-altair-v1-mini` foram cadastrados os 13 IDs Ballad, Coral, Marin, Nova, Sage, Shimmer, Alloy, Ash, Cedar, Echo, Fable, Onyx e Verse. Para `tts-vega-v1-flash` foram cadastrados 15 IDs recebidos: Achernar, Aoede, Autonoe, Callirrhoe, Despina, Erinome, Gacrux, Kore, Laomedeia, Leda, Pulcherrima, Sulafat, Vindemiatrix, Zephyr e Achird. A lista do Vega dizia ter 30 vozes; os outros 15 IDs ainda não foram recebidos. A pronúncia PT-BR e geração completa de áudio ainda precisam ser verificadas por prévia; a sessão WebSocket sem voz explícita foi aceita pelos dois modelos.

## Cobrança

A tarifa inicial é 120 TikCoins por 150 caracteres (multiplicador ×0,8) nos dois modelos, arredondada conforme as regras de cobrança por mensagem existentes. O Super Admin pode ajustar a tarifa. A isenção administrativa existente de TikCoins também se aplica, sem eliminar o custo do provedor.

O custo monetário só é registrado como `actual` se a resposta realtime trouxer contagem separada de tokens de texto de entrada e áudio de saída. Sem esses campos, a chamada fica com custo `unknown`; não inferir custo real a partir de caracteres ou tokens genéricos. Referência de preços publicada pela StarsG: [preços TTS](https://starsg.ai/id/pricing).

## Fluxo e limites

1. O serviço Node valida o catálogo/allowlist e encaminha a configuração escolhida.
2. O daemon Python aplica a cobrança interna e solicita síntese com a chave carregada no ambiente.
3. Respostas de áudio são limitadas a 5 MiB e a sessão realtime expira após 30 segundos.
4. A chave salva pelo painel exige recarregar o daemon para ser propagada ao processo Python; o painel mostra esse estado. Planeje o reinício em uma janela segura, pois ele interrompe conexões de live.
5. O cache de áudio segue escopado pelo conteúdo, modelo e voz, sem expor texto nos logs.

## Mapa de observabilidade

- Salvar/remover: `integrations.starsg.saved` (`diagnostic`/`info`) ou `integrations.starsg.save_failed` (`error`/`error`), com ator e operação; nunca chave.
- Teste: `integrations.test.succeeded`/`integrations.test.failed`, com provedor e status HTTP/código; nunca corpo da resposta. A checagem de credencial usa `GET /v1/models`; isso não confirma que os modelos TTS estejam habilitados.
- Catálogo: `tts.provider.failed` com `operation=catalog`, `provider=starsg` e código estável.
- Prévia do Super Admin: `tts.admin_voice_preview.completed`/`tts.admin_voice_preview.failed`, com modelo, provedor, código e `trace_id`.
- Narração do chat: resumo `chat.tts.batch` e falhas/fallbacks já existentes; uso do fornecedor em `api_cost_usage`. Não registrar comentário, texto da prévia, áudio, chave ou payload bruto.

## Referência técnica

- [Documentação realtime TTS StarsG](https://starsg.ai/products/tts/docs)
- [Preços StarsG](https://starsg.ai/id/pricing)



O Super Admin identifica o 404 da listagem e informa no catálogo de vozes que a chave foi autenticada, mas os IDs não estão disponíveis. O teste de chave usa GET /v1/models; isso não substitui a listagem TTS. Não aprovar nem inventar IDs quando o catálogo falhar.


## Ativação na conta StarsG

O guia atual da StarsG informa que os modelos ficam habilitados por padrão. No console, a área de modelos de fala é separada de AI Models; só é necessário reativar um modelo se ele foi desativado manualmente. Portanto, um modelo marcado como Enabled não explica o 404 do catálogo. A verificação local confirmou que a chave autentica (GET /v1/models → 200), mas GET /v1/realtime/models e os endpoints documentados por modelo continuam retornando 404. Tratar isso como indisponibilidade/divergência da API de catálogo, não como falha de ativação.
