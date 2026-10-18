# Sons — alertas por presente e por ação

## Fluxo

- Presentes: o daemon envia `gift_event` com nome, ID, repetição e sessão. O painel procura primeiro pelo nome conhecido e usa o ID do catálogo como fallback. Os áudios normais/combos e os áudios de ação ficam no armazenamento `tenant_gift_config.sound_alerts`, sempre isolados por tenant.
- Ações: `on_follow`, `on_share` e `on_member` enviam `action_alert_event` ao painel autenticado. O cliente toca o áudio salvo para `follow`, `share` ou `gifter_join`.
- A entrada de presenteador especial exige `gifter_level >= gifter_min_level`. O padrão é nível 30, configurável de 1 a 50. Sem nível informado pelo provider, o alerta de entrada não toca.
- Os providers TikTokLive e TikTools já possuem eventos de follow/share/entrada registrados. A qualidade do evento de entrada e do nível depende dos metadados entregues pela integração.
- Os alertas tocam no painel do streamer enquanto ele está aberto e conectado. O navegador precisa ter sido desbloqueado por uma interação do usuário; erros de reprodução aparecem no status/console do painel.

## Observabilidade e limitações

- A mensagem de alerta é efêmera e entregue por WebSocket; não vira log persistente nem interação de relatório.
- `action_alert_event` é filtrado no servidor para o WebSocket do painel, sem alterar estado de jogo ou enviar eventos de entrada a overlays públicos.
- Falhas de áudio são informadas no painel. Não registrar URL/arquivo completo ou dados pessoais em logs técnicos.
- O teste unitário do acumulador de likes e o smoke test SQLite cobrem persistência de configuração e escopo por tenant. A validação end-to-end depende de uma live real para confirmar quais metadados de entrada o provider disponibiliza.

## Ranking de curtidas e reconexão

- O ranking canônico da sala é acumulado no Node a partir de `likes_ranking_delta`, emitido somente após os filtros de acesso existentes.
- `live_session.start` compara `room_id`: a mesma sala preserva o acumulado depois de uma reinicialização do daemon; uma sala diferente começa vazia.
- IDs de evento repetidos são ignorados quando disponíveis; IDs ausentes (alguns eventos TikTools) permanecem best-effort.
- O acumulador é memória do processo Node: uma reinicialização do Node ainda inicia estado novo. A solicitação coberta aqui é a queda/reinicialização isolada do daemon Python.
