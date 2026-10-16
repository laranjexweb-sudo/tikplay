# Margem inicial da reprodução da voz — 2026-10-16

Relato: o mesmo MP3 perde o primeiro som na primeira reprodução, mas toca
corretamente na segunda. Isso sugere atraso na ativação da saída de áudio;
não comprova defeito do arquivo ou da geração.

Plano: ampliar o silêncio local anterior à voz ElevenLabs de 150 para 500 ms,
preservando todas as amostras, volume, fila, cancelamento e prioridade.
Nenhuma nova geração ou consumo de quota é necessário.

Observabilidade: manter os eventos existentes de reprodução e falha, com
categorias, níveis, correlação e limites existentes. Sem novos logs, payloads,
texto de chat ou identidades em diagnóstico.

Validação: testes do player verificam silêncio de 500 ms, igualdade das
amostras originais e regressões de fila/cancelamento. Recarregar o painel é
necessário; não exige reiniciar servidor/daemon. Confirmação auditiva na
primeira reprodução após inatividade depende do dispositivo do usuário.
