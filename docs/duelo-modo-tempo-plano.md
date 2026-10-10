# Duelo 1x1 — Modo 2: DEBATE POR TEMPO (plano de implementação)

> Documento de planejamento. O modo atual (Debate por HP) permanece como "Modo 1" e não é alterado.

## 1. Conceito

Modo separado do HP/escudo:

- **Não existe HP** nem **escudo funcional**;
- golpes são **apenas visuais** (não causam dano);
- presentes somam **votos** = `moedas × combo` (mesma regra/sem dupla contagem);
- cada personagem principal tem **1 presente principal** (o combo define qual golpe visual);
- **apoiadores especiais** continuam existindo;
- a **rodada tem duração** (`round_time_s`);
- ao terminar o tempo, **votos são congelados** e **só então** a porcentagem final é calculada (sobre o total da rodada);
- quem tiver mais votos vence a rodada → `debate_wins` do vencedor +1 (empate: ninguém soma).

## 2. Regras por categoria de presente (prioridade de match)

Ordem: **1. apoiador especial → 2. presente principal → 3. presente extra** (um gift nunca é processado 2x).

| Categoria | Soma votos | Ação visual |
|---|---|---|
| **Apoiador** (Nikolas/Pavanato → Flávio; Ana/Erika → Lula) | `coins × combo` | apoio entra, fala, golpe aleatório, sai — **sem dano real** |
| **Principal** (`main_gifts[side]`) | `coins × combo` | golpe escolhido pelo **combo**: `x1-4 → soco`, `x5-19 → chute`, `x20+ → levantada` |
| **Extra** (`extra_gifts[side]`) | `coins × combo` | **votar apenas** (`action: "vote_only"`): float +N, sem golpe/defesa/apoio |

### Presentes extras — extensível

Cadastro mínimo: `gift_id`, `gift_name`, `enabled`, `action` (default `vote_only`).
Preparado para futuras ações: `change_scene`, `screen_animation`, `special_effect`, `character_event` (não implementar agora).

### Combo → golpe (limites default, futuramente configuráveis)

```text
kick_combo_min = 5
uppercut_combo_min = 20
```

## 3. Rodada cronometrada

- Início: `votes=0`, `time_remaining=round_time_s`, `roundActive=true`; **debate_wins permanecem**.
- Durante: `time_remaining > 0` → aceita principal/extras/apoios (todos somam votos).
- Placar durante: **votos absolutos** (ex. `120 | 95`), barra com proporção relativa (visual), **TEMPO mm:ss**. **Nunca %**.
- Fim: `time_remaining == 0` → `roundActive=false`; para de aceitar votos; deixa animação atual terminar (orquestração visual).

## 4. Resultado (só no final)

```text
total = votes.flavio + votes.lula
flavioPct = votes.flavio / total * 100
lulaPct   = votes.lula   / total * 100
```

- `total > 0` → mostra `60% x 40%` + barra em %.
- Vencedor = maior votos (empate/0x0 → **EMPATOU**).
- Banners: `flavio-ganhou.png`, `lula-ganhou.png`, `empate.png` (**não** os de "ganhou o debate"/luvas).
- `debate_wins[vencedor] += 1` (empate não soma).
- Exibição do resultado após a animação atual (igual `pendingWinnerVisual` → **pendingRoundResult/flush**).

## 5. Nova rodada automática

- Após `round_result_delay_s` (default 8s): `resetTimedRound()` → zera votos, reinicia cronômetro, `final_result=null`, `roundActive=true`, **mantém debate_wins**.
- **REINICIAR PARTIDA** (`reset_match()`): zera votos **e** debate_wins + reinicia cronômetro.

## 6. Estado autoritativo (timed)

```js
{
  mode: "timed",
  active: true,
  votes: { flavio: 120, lula: 95 },
  debate_wins: { flavio: 2, lula: 1 },
  time_remaining: 154,
  round_time: 180,
  roundActive: true,
  final_result: null
}
// ao acabar:
{ roundActive: false, final_result: { winner: "flavio", flavio_pct: 56, lula_pct: 44 } }
```

`duelo_state` é a única fonte. Votos autoritativos; desatenção visual 100% cliente.

## 7. Integração com mecânicas existentes

- **Defesa**: no timed, **aleatória** 50/50 entre `defesa.png` e `defesa-escudo.png` (escudo = só visual).
- **Apoios**: mesmo fluxo; sem dano real; impacto visual (💥/shake); votos/float +N normalmente.
- **Floats**: voto por lado (Flávio azul / Lula vermelho), sem `-HP`.
- **Falas**: ataque/virada/idle/apoio mantidos; sem `lowHp`/shield real/hit com dano.
- **Idle**: STOPPED (área desativada) e ACTIVE_NO_INTERACTION inalterados (baseados em `state.active`).
- **Virada**: banners `FAVIO/LULA VIROU`/`EMPATE` por votos absolutos; sem %.
- **Orquestração final**: `pendingRoundResult`; se `busy`, aguarda; `flushRoundResult()`.

## 8. Arquivos a alterar

| Arquivo | Mudança |
|---|---|
| `python/duelo.py` | `game_mode`, rodada cronometrada, `main_gifts/extra_gifts`, `final_result`, votos por combo, sem HP/escudo no timed, prioridade de match |
| `python/service.py` | tick do cronômetro (1×/s, broadcast `duelo_state`) + finalização + `resetTimedRound()` automático |
| `node/server.js` | `normalizeDueloSettings`: `game_mode`, `round_time_s`, `round_result_delay_s`, `main_gifts`, `extra_gifts` |
| `node/public/control-panel.html` | seletor MODO DE JOGO + campos condicionais (principal/extras/tempo × HP oculto) |
| `node/public/duelo.html` | HUD timed (sem HP/escudo, com cronômetro), placar absoluto/% final, defesa aleatória, sem float de dano, `pendingRoundResult` |

## 9. Painel — resumo dos campos

**MODO DE JOGO**
```text
[ Debate por HP ] [ Debate por Tempo ]
```

**timed** (visíveis): Tempo da rodada, Tempo de resultado, Presente principal Flávio, Presente principal Lula, Apoios Especiais, Presentes Extras — FLÁVIO/LULA.
**timed** (ocultos): Vida, Escudo inicial/máx, danos Soco/Chute/Levantada, Meta (maioria).
**hp** (visíveis): os atuais; novos campos ocultos.

## 10. Não alterar

- Regra `coins × combo` (com dedup real existente dos handlers).
- Motor/regras do modo HP (majority, debate_wins, autorestart, morte, escudo).
- Outros jogos.

## 11. Perguntas/pendências a confirmar antes do código

1. **Ativar Área no timed** = partida nova completa (zera votos + debates + cronômetro) — recomendado.
2. **Cronômetro autoritativo** (servidor decrementa e emite `duelo_state` ~1×/s) vs. countdown local. **Recomendado: autoritativo** (sincronizado no OBS).
3. Limites de combo **fixos** na v1 (`kick=5`, `uppercut=20`) ou expostos no painel.
4. Presentes extras **não listados** na lateral (manter limpa; só principal + apoiadores) — recomendado.
5. Gifts de **escudo** no timed: **sem função** (ignorados) — recomendado.