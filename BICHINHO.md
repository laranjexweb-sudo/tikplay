# Bichinho Virtual — Documentação Interna

> Documento **interno** (não aparece na página pública de ajuda `/docs`).

## Visão geral
Mascote comunitário estilo Digimon que **nasce, evolui e luta contra bosses**. O estado é **salvo** —
ele continua evoluído entre as lives (persistido no banco, tabela `vpet_state`).

## Fases
1. **OVO** — o público chacoalha até ele chocar.
2. **BEBÊ → NOVATO → CAMPEÃO** (e fases superiores `guardiao`, `guerreiro`, `lorde`, `divindade`) — evolui com XP acumulado por cuidados.

## Como o público interage
- `#chocar` — chacoalha o ovo.
- `#alimentar` / `#comida` / `#comer` — restaura a fome.
- `#carinho` / `#cafune` / `#afagar` — restaura a energia.
- **Presentes** — alimentam o mascote (e também chocam o ovo).
- **Curtidas** — dão um pouco de energia.
- `!falar <texto>` — só o streamer manda o mascote falar.

## Batalha de boss
- A cada **15 minutos** (ou pelo botão no painel) um boss invade a tela.
- A batalha dura **60 segundos**.
- Durante a luta, **presentes viram dano**: 1 diamante = 50 de dano.
- <span class="ok">Vitória</span>: XP massivo e chance de evoluir.
- <span class="warn">Derrota</span> (tempo esgotado): fica ferido e perde fome/energia.
- O público acompanha HP do boss, cronômetro e "quem deu o último golpe".

## Modo Assistente
- Ativa no painel: o mascote **fala** — cumprimenta quem entra, agradece a cada 500 curtidas e comenta a batalha.
- Quando a live desconecta, o mascote **pausa automaticamente** (não perde fome/energia offline).

## Referência técnica
- Engine: `python/game.py` → classe `VPetEngine`.
- Orquestração/TTS: `python/service.py` (eventos `vpet_*`, agradecimentos por likes).
- Persistência: `node/db.js` / `python/db.py` (tabela `vpet_state`, chave por `tenant_id`).
- Rota/estado: `/api/vpet/*`, `/api/vpet/state`.
- Painel: aba **Bichinho** (`control-panel.html`).
- Telas: `/bichinho` (`bichinho.html`) e overlay transparente `/bichinho-overlay` (`bichinho-overlay.html`).