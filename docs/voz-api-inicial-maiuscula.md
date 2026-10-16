# Inicial maiúscula na voz da API — 2026-10-16

Plano: após limpar o comentário, converter apenas sua primeira letra para
maiúscula antes de calcular cache, reservar quota e enviar à ElevenLabs.
Preservar o restante do texto, inclusive siglas, pontuação e números iniciais.
Manter limite de 120 caracteres inclusive em expansões Unicode.

Observabilidade: manter eventos existentes de síntese/fallback, categorias,
níveis e correlação; nenhuma alteração no volume ou inclusão de texto nos logs.
Validar o payload com rede simulada, acentos, prefixos numéricos, siglas e cache.
A hipótese de que a caixa da letra causa o corte foi relatada pelo usuário;
o efeito auditivo ainda requer teste real. Ativação depende de novo daemon.
