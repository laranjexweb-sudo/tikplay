# Comentários anteriores à conexão — 2026-10-16

Complemento: a biblioteca instalada configura `history_comment_count=6` no
WebSocket. O cliente passa a sobrescrever esse parâmetro para `0` em cada
conexão/reconexão, mantendo `process_connect_events=False` e o filtro temporal.
Teste com cliente simulado verifica ambas as opções sem conectar a uma live.

Plano: no motor TikTokLive, comentários recebidos sem conexão ativa ou com
data de criação anterior à conexão atual não chegam ao serviço/narração.
Comentários deixam de usar a tolerância de cinco segundos, que permanece
nos outros tipos de interação. Cada reconexão redefine o marco temporal.
Sem timestamp, comentários após conexão mantêm o comportamento anterior;
o provedor não permite comprovar a idade deles. TikTools não é alterado.

Observabilidade: preservar eventos de conexão e contadores existentes de
narração (categorias/níveis e correlação existentes); nenhum log por descarte,
nenhuma identidade, texto ou palavra secreta em diagnóstico. Volume inalterado.
Testar histórico recente, fronteira temporal, eventos antes/depois da conexão,
reconexão e compatibilidade dos demais eventos. Ativação exige novo daemon;
verificação real na live e no armazenamento/painel permanece pendente.
