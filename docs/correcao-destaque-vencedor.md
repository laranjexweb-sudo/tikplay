# Correção do destaque duplicado do vencedor — 2026-10-16

Plano: manter a inserção imediata no ranking, omitir o destaque temporário do
rank 1 e ignorar palpites/destaques após o encerramento. Preservar os demais
palpites e a apresentação existente de game_over.

Observabilidade: correção local de apresentação, sem novos eventos ou logs.
Contratos, categorias/níveis, correlação e volume do backend preservados.
Nenhuma palavra secreta, identidade ou payload será adicionada a logs.
Validação: simular rank 1, palpite comum e eventos atrasados em JavaScript;
verificar sintaxe do script e conteúdo servido localmente. Validação visual
em uma partida real permanece pendente.
