# CORDA — Proposta de regras para impulsos visuais

Data: 13/10/2026
Status: proposta documentada; implementação pendente.

## Objetivo

Tornar os puxões perceptíveis sem depender de combos altos de presentes. A conclusão de uma meta de curtidas deve produzir uma resposta visual clara para o público.

## Separar força e animação

A força determina quanto a disputa se move. A intensidade visual determina como o puxão aparece na cena. Um impacto visual forte não deve aumentar automaticamente a força aplicada.

Na configuração padrão atual, o impacto exige pelo menos 25 de força. Com 0,5 de força por moeda, isso corresponde a 50 rosinhas de uma moeda. A meta de 500 curtidas gera 5 de força, abaixo desse limiar. Esses valores são configuráveis.

## Comportamento proposto

| Evento | Efeito na disputa | Resposta visual |
| --- | --- | --- |
| Curtidas chegando | Acumulam energia na barra da equipe | Preenchimento suave e coração pulsando |
| Meta de curtidas concluída | Aplica a força configurada por meta | Impacto curto, pose de personagem recebendo puxão e mensagem “PUXÃO AZUL!” ou “PUXÃO VERMELHO!” |
| Presente pequeno | Acrescenta força proporcional às moedas e quantidade | Movimento leve de puxar |
| Presente forte | Acrescenta força proporcional maior | Impacto mais intenso |
| Disputa perto do fim | Mantém as regras atuais de força e vitória | Balanço de pressão e puxão final |

## Meta de curtidas

- Toda meta concluída dispara impacto visual, mesmo quando gera apenas 5 de força.
- A animação sugerida dura aproximadamente meio segundo.
- Usar pequeno deslocamento dos personagens e da corda, com pose de recebimento do puxão no adversário.
- Identificar claramente a equipe responsável pelo puxão.
- Preservar a suavização do preenchimento e a confirmação de meta antes do início do próximo ciclo.

## Metas simultâneas e impactos repetidos

- Se várias metas forem concluídas no mesmo lote de curtidas, aplicar a força correspondente a todas elas.
- Agrupar a apresentação em um único impacto mais intenso, com indicação como “3× PUXÃO!”.
- Evitar uma fila longa de tremores.
- Adotar intervalo mínimo entre impactos visuais; duração exata a definir na implementação.
- Esse intervalo limita apenas a apresentação: não descarta energia nem força recebida.
- Respeitar a preferência de movimento reduzido.

## Equilíbrio inicial

Manter inicialmente os valores atuais de força por moeda e por meta. Alterar apenas os gatilhos e a apresentação visual, para avaliar a clareza do efeito antes de ajustar o equilíbrio.

Os presentes continuam contribuindo proporcionalmente, sem exigir combos altos para haver movimento. A meta de curtidas passa a ser um momento visual marcante de participação coletiva.

## Limites da proposta

Este documento não implementa as mudanças. A energia por comentários e o processamento progressivo de combos são propostas separadas e não fazem parte destas regras de impulso.
