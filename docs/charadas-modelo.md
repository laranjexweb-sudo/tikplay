# Modelo das charadas

Em 2026-10-16, `generate_openrouter_riddle` passou a usar
`openai/gpt-5.6-luna`, confirmado no catálogo público do OpenRouter.
Temperatura omitida por incompatibilidade; raciocínio desativado explicitamente
para manter o orçamento de 200 tokens dedicado à charada curta.
Prompt, timeout de 8 segundos e fallback existentes preservados.

## Plano de observabilidade e validação

Troca restrita ao payload do provedor, sem novos eventos ou volume de logs.
Preservar eventos existentes `palavra.riddle.*`: início/conclusão em game/info,
rejeição em notice/warning e falha em error/error, com correlação da sessão,
partida e trace existentes. Não registrar chave, palavra secreta ou charada
integral. Validar sintaxe e payload sem requisição paga.

Ativação depende de reiniciar o daemon em janela segura. Validação real do
provedor e dos eventos no armazenamento/painel permanece pendente; nenhum
reinício de live é realizado nesta alteração.
