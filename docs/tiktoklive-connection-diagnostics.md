# Diagnóstico de conexão TikTokLive

## Mapa de observabilidade

- Falha de uma tentativa: `tiktoklive.connection.failed` (`error`/`error`, código estável `TIKTOKLIVE_CONNECTION_FAILED`). Inclui fase (`client_start`/`live_stream`), classe da exceção, família classificada, errno/status HTTP/código de fechamento WebSocket quando disponíveis, duração, contador e espera antes da próxima tentativa.
- Agendamento da repetição: `tiktoklive.connection.retry_scheduled` (`connection`/`warning` após falha; `connection`/`info` quando offline ou sessão encerrada). Inclui motivo enumerado, tentativa, duração e segundos até o retry.
- A conexão e a reconexão bem-sucedidas continuam registradas pelos eventos e mensagens existentes do TikTokLive.

## Privacidade e volume

Não registrar texto bruto da exceção, corpo/resposta do provedor, URL, username, cookies, credenciais, tokens ou payloads TikTok. Os campos técnicos são extraídos por allowlist; motivos são valores enumerados. Não há um evento por pacote ou evento de chat: no máximo um par falha/retry por tentativa, respeitando o backoff existente (5–60 segundos).

## Limitações

O diagnóstico diferencia DNS, TLS, timeout, rede, limite/rejeição HTTP, fechamento WebSocket e erro de cliente/protocolo quando os atributos vêm estruturados na exceção ou em sua cadeia de causas (`__cause__`/`__context__`, limitada a quatro níveis). Se a biblioteca encapsular a causa sem atributos seguros, o log mostrará apenas a classe e `client_or_protocol`; nesse caso é necessário consultar logs operacionais protegidos da VPS e correlacionar com horário e deploy. Nenhum detalhe bruto da exceção é encaminhado ao histórico do streamer.

## Validação

`python/tests/test_tiktoklive_connection_diagnostics.py` cobre classificação, allowlist de metadados e sequência de falha/retry sem vazar a mensagem original da exceção. Após carregar a nova versão do daemon, uma ocorrência deve mostrar os dois eventos com `attempt`, `phase`, `failure_family` e `retry_seconds`.
