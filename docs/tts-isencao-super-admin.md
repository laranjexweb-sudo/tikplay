# Isenção de TikCoins para Super Admin em vozes por API

## Regra

Contas ativas com `users.role = 'admin'` podem usar todas as vozes adicionais habilitadas sem limite de TikCoins. A autorização é verificada no daemon Python consultando o banco, antes do débito; saldo ou role enviado pelo navegador não concede isenção. Contas de streamer continuam sujeitas à tarifa e ao saldo atuais.

A isenção cobre a cobrança interna de TikCoins nas sínteses de voz adicional (OpenRouter, ElevenLabs e StarsG). Não elimina os custos reais dos fornecedores: as chamadas continuam registradas em `api_cost_usage` para análise financeira. A voz padrão mantém seu comportamento atual.

## Mapa de observabilidade

- Pedido/resultado de teste: preservar `tts.provider.completed` ou `tts.provider.failed`, incluindo o código estável do sintetizador (`SYNTHESIZED` ou código de falha). `ADMIN_EXEMPT` é uma decisão interna do débito e não cria evento novo.
- Chave StarsG: `integrations.starsg.saved` (`diagnostic`/`info`) ou `integrations.starsg.save_failed` (`error`/`error`); teste reutiliza `integrations.test.succeeded`/`integrations.test.failed`. Registrar somente operação, provedor, status HTTP e código, nunca chave ou corpo bruto.
- Catálogo e prévia StarsG: falha de catálogo usa `tts.provider.failed` (`error`/`error`) com operação e código estável; prévia usa `tts.admin_voice_preview.completed`/`tts.admin_voice_preview.failed` com modelo, provedor, `trace_id` e código. O texto fixo da prévia e os deltas de áudio não entram nos logs.
- Narração StarsG: manter o resumo agregado `chat.tts.batch` e falhas/fallbacks existentes. O custo do fornecedor entra em `api_cost_usage` com tenant, modelo, duração, resultado e ID de requisição; sem texto do chat ou credencial.
- Narração de chat: preservar o resumo agregado `chat.tts.batch`; falha continua registrada por `chat.tts.failed` ou aviso de fallback já existentes. Não emitir evento por mensagem isenta para evitar volume desnecessário.
- Dados permitidos: operação, código de resultado, modelo já permitido pelo evento e quantidades agregadas. Nunca registrar texto narrado, chave/API token ou payload do fornecedor.
- A carteira responde `credits_unlimited` a partir do registro de usuário e a interface mostra a isenção; o histórico financeiro de uso de TikCoins não recebe débitos artificiais para administradores.

## Verificação

Validar após carregar esta versão no Node e no daemon: admin ativo sintetiza com saldo zero e sem linha `usage`; streamer sem saldo continua recebendo `INSUFFICIENT_CREDITS`; admin inativo não recebe isenção. Conferir também atualização do cabeçalho e da página da carteira. Os custos do fornecedor devem continuar presentes no registro operacional/API de custos.
