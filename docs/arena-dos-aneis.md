# Arena dos Anéis — implementação e observabilidade

## Escopo da primeira versão

Jogo multiplayer 2D para TikTok Live, isolado em um serviço Node e em páginas próprias. O servidor mantém a simulação autoritativa (movimento, colisão, energia, eliminação, tempo e resultado); a página pública só desenha o snapshot recebido. Comentários e presentes entram pelo fluxo de `interaction` já normalizado. A página pública recebe somente o estado público da sala. O painel autenticado controla partida, configurações e simulação mock sem live.

Inclui arena circular com limite físico, movimento automático e rebote, colisões e dano, velocidade proporcional à energia, recuperação por presente, ranking Top 5, vitória por sobrevivência/tempo, persistência do catálogo e propriedade dos anéis por espectador, seleção de anel e progresso de desbloqueio por diamantes recebidos após o comando de chat `!anel <id>`. O comando configurado de entrada é separado. Bônus dos anéis são pequenos e limitados pelo servidor. O catálogo e o progresso são separados por conta streamer e ID estável do espectador.

Compra de anel representa presentes reais da live: espectadores não têm carteira TikCoins dentro do TikPlay. TikCoins da conta streamer não são debitados por este jogo. Desbloqueios são registrados por tenant e ID estável do espectador; não são compartilhados entre streamers.

## Plano de eventos e logs

| Ação/transição | Evento | Categoria/nível | Correlação e detalhes permitidos |
| --- | --- | --- | --- |
| Início solicitado/recusado/concluído | `ring_arena.match.start.requested`, `.rejected`, `.started` | `game`/`info`, `notice`/`warning` | `trace_id`, `game_id`, causa enumerada, modo demo, quantidade de jogadores |
| Entrada por chat/presente/painel | `ring_arena.player.joined`, `.join_rejected` | `game`/`info` ou `notice`/`warning` | `game_id`, origem, quantidade de jogadores e motivo; nome só no snapshot visual, nunca em diagnóstico |
| Colisões | `ring_arena.collision.summary` | `diagnostic`/`debug` agregado | no máximo um resumo por janela de 10 s, colisões/dano agregados; sem evento por frame ou por colisão individual |
| Energia/eliminações | `ring_arena.player.eliminated` | `game`/`info` | `game_id`, quantidade viva, causa enumerada; sem comentários/payload TikTok |
| Presente aceito/ignorado | `ring_arena.gift.applied`, `.gift.ignored` | `game`/`info` ou `notice`/`warning` | `game_id`, `gift_id`, quantidade de diamantes/energia, estado de desbloqueio; sem payload bruto |
| Progresso/desbloqueio/equipamento | `ring_arena.ring.progressed`, `.ring.unlocked`, `.ring.equipped` | `game`/`info` | `game_id`, `ring_id`, diamantes acumulados/preço; sem ID ou nome do espectador |
| Fim da partida/timeout/falha persistência | `ring_arena.match.finished`, `.match.timed_out`, `.persistence.failed` | `game`/`info`, `error`/`error` | `trace_id`, `game_id`, causa, duração, contagens e tipo de erro sanitizado; identidade do vencedor fica somente no resultado persistido/jogo |
| Ações painel/teste/configuração | `ring_arena.control.*`, `ring_arena.config.*` | `game`, `notice` ou `error` conforme resultado | `trace_id`, ação enum, modo de teste e resultado |

Não registrar texto integral de comentários, resposta completa de eventos TikTok, tokens, URLs assinadas, exceções cruas, eventos de frame/tick ou segredos. Testes devem cobrir geometria da borda, separação/rebote, energia/velocidade, fim por sobrevivência e timeout, entrada/deduplicação, isolamento de tenant, catálogo/compra/desbloqueio, autenticação, HTML/scripts inline e classificação dos eventos enviados ao persistidor de logs.

## Arquivos implementados

- `node/lib/ring-arena.js`: física autoritativa, estados, catálogo/progresso por espectador, API autenticada, projeção pública e eventos.
- `node/public/ring-arena.html`: fonte pública Canvas 9:16 e controles do streamer, com prévia e modo de teste. A configuração de presentes de recuperação usa busca no catálogo global, imagens/diamantes e seleção por teclado, preservando o contrato `gift_id`, `gift_name` e `energy_gain`.
- A borda jogável usa raio 500 e acompanha o círculo dourado do background; configurações antigas com raio padrão 472 são promovidas ao novo padrão, enquanto valores personalizados menores permanecem.
- Na tela 9:16, o centro do círculo é posicionado em 45,28% da altura; o background fica fixo e só os elementos da arena são deslocados.
- O anel Galaxy usa `node/public/assets/ring-galaxy.png` como moldura animada ao redor do avatar do participante; os outros anéis continuam usando os efeitos coloridos atuais.
- No painel, o seletor “Anel visual na prévia” e o botão de aplicar equipam o anel escolhido no espectador fictício durante uma partida demo. O estado público recebe a alteração para validar a aparência na tela da arena; partidas reais continuam exigindo o desbloqueio normal.
- `node/server.js`, `node/public/control-panel.html`, `node/public/admin.html`, `node/routes/auth.js`, `node/db.js` e `node/lib/feature-access.js`: integração com WebSocket, navegação, habilitação por Super Admin e cadastro.
- `node/tests/ring-arena.test.js` e `node/tests/feature-access.test.js`: física, presentes, isolamento, autorização e rotas.

## Limites desta versão

- O anel é desenhado por Canvas a partir da identidade e dos efeitos do item; ainda não há arquivos PNG de arte por anel.
- Para comprar/desbloquear, o espectador comenta `!anel <id>` e envia presentes TikTok; o progresso soma os diamantes do presente. Não há cobrança de TikCoins do streamer.
- O modo de live e WebSocket real precisa ser validado depois que o processo Node carregar esta versão. Os testes automatizados exercitam o motor isolado sem interromper uma transmissão ativa.
- Cada colisão publica `last_impact_at` no estado e dispara uma onda de choque e faíscas na tela; a observabilidade continua usando o resumo agregado de colisões existente, sem log por impacto.
