# CORDA — duelo de cabo de guerra

Implementado em 12/10/2026. O usuário autorizou a criação do motor e da interface nesta sessão, incluindo as adaptações do painel. CORDA é um jogo independente que compartilha a conexão TikTok e a permissão `duelo`; não altera os modos HP/Tempo/Batalha do Duelo 1x1.

## Como usar

1. Reinicie o servidor Node para carregar as novas rotas e o daemon Python atualizado.
2. No painel, abra **Mais jogos → CORDA · Duelo**.
3. Escolha pelo catálogo ao menos um presente para cada equipe e clique em **Salvar regras**. O mesmo presente não pode pertencer aos dois lados.
4. Conecte a live e clique em **Iniciar**. O motor confirma o início por WebSocket.
5. **Abrir link público** abre o jogo; **Copiar link público / OBS** fornece `/corda?room=...&tk=...`, gerado pelo mesmo `POST /api/game/room-link` dos outros jogos (token de 365 dias, sem depender da sessão curta do painel). A tela pública também está em `/corda`.
6. **Demonstração offline** abre `/corda?demo=1`: controles e partidas locais, sem alterar a live ou a configuração salva. Enquanto o Node anterior ainda estiver em execução, `/corda.html?demo=1` também permite conferir a cena estática nova.

Pare a partida antes de editar regras. **Nova partida** zera placar e equipes e começa outra disputa. Após a vitória final, o jogo aguarda essa ação; não reinicia a partida automaticamente. Desconectar a live para o CORDA.

## Regras implementadas

- Posição autoritativa de **−100 a +100**, começando em zero. Flávio/azul puxa para a esquerda; Lula/vermelho, para a direita. Chegar ao limite encerra a rodada uma única vez.
- Presentes cadastrados geram `moedas por unidade × quantidade final do combo × força por moeda`. Padrão: **0,5 de força por moeda**. O ID do catálogo identifica o presente; cadastro legado sem ID usa nome com comparação sem acentos e sem diferenciar maiúsculas. Não duplicar a contabilização do combo: os handlers TikTok existentes já consolidam os eventos.
- Comentários com `azul`, `Flávio`, `Bolsonaro` ou `22` escolhem azul; `vermelho`, `Lula` ou `13`, vermelho. Como no Duelo 1x1, o participante pode trocar de equipe por outro comentário. Se citar os dois lados, azul tem prioridade. Repetir a equipe atual não duplica a entrada; o comentário não gera força. Curtidas futuras seguem a nova equipe, sem transferir curtidas já contabilizadas.
- Curtidas de usuários com equipe cadastrada alimentam uma meta por equipe. Padrão: **500 curtidas → 5 de força**, preservando o restante da meta. Curtidas sem equipe não movem a disputa. Os filtros de acesso da plataforma também se aplicam aos comentários, curtidas e presentes do CORDA.
- Força recebida entra numa fila assinada. O motor avança até **60 unidades por segundo**, em ticks de 100 ms. Forças contrárias na fila se compensam. Não há corte arbitrário da força de presentes grandes: o movimento é distribuído no tempo.
- Ao encerrar a rodada, o restante da fila é limpo. Interações no resultado são ignoradas, sem passar força para a próxima rodada. Assim, um presente grande pode vencer uma rodada, mas não várias rodadas de uma vez.
- Padrão: **melhor de 3**, com opção de melhor de 5. Vence a partida quem conquistar 2 ou 3 rodadas, respectivamente.
- Padrão: rodada de **180 segundos**. No tempo limite, vence quem tiver vantagem na posição já aplicada; posição central é empate. Empate não soma vitória. A fila pendente não é aplicada depois do prazo.
- Resultado por **6 segundos**, seguido de nova rodada automática se não houver vencedor da partida. As equipes atuais e vitórias permanecem; posição, metas de curtidas e força voltam a zero.
- Configurações persistem em SQLite por streamer. Partidas, equipes e placar atual ficam em memória, como estado efêmero. Após reiniciar o serviço, inicie outra partida.

Não há multiplicador extra de combo de equipe nesta versão: o combo do presente já multiplica as moedas. Isso mantém a relação entre interação e força compreensível. Poses adicionais de desespero/impulso não são exigidas; usamos as imagens disponíveis.

## Cena e assets

Originais em `cabo-de-guerra/` na raiz, com `flavio-ok` e `lula-ok`. Cópias idênticas em `node/public/corda-assets/` permitem publicar o submódulo TikPlay sem depender da pasta externa. Ao substituir um original, atualize sua cópia pública e a geometria em `manifest.json`.

O cenário mantém a proporção **1134 × 1387**. O canvas desenha na resolução original e escala a cena inteira. A geometria considera a área com alpha ≥128, ignorando as margens quase invisíveis dos recortes. Isso não modifica as imagens.

- Cenário fixo. Personagens e corda recebem o mesmo deslocamento horizontal, com pés alinhados ao piso.
- Cordas e poses são camadas separadas. A corda esticada é desenhada entre os pontos das mãos, antes dos personagens, para ficar atrás da pegada.
- Posição próxima do centro usa `neutro.png`. Durante uma puxada, usa `puxando.png`; o lado arrastado usa `pressao.png`. As faixas de intensidade usam deslocamento/estado visual, sem escolher sprites aleatoriamente.
- Puxão de força ≥25 aciona `recebendo-puxao-fx.png` **no adversário arrastado**, orientado conforme a equipe, por aproximadamente 480 ms.
- Vitória troca para `vitoria.png`, derrota para `derrotado.png` e corda para `corda-chao.png`, com transição curta. A escala normaliza as alturas visíveis das poses.
- Suavização independente da taxa de quadros. Tremor leve apenas em pressão alta; preferência de movimento reduzido elimina tremor/efeito e suavização.
- Placar no estilo do Duelo 1x1: fundo escuro, borda dourada, vitórias em badges nas extremidades, barras azul/vermelha e metas de TAP. As barras de cada equipe indicam o progresso da meta de TAP; a barra central indica exclusivamente a posição da corda. Cronômetro no cabeçalho, nomes e vitórias agrupados por equipe, sem introduzir HP ou votos no CORDA. HUD e controles usam tokens TikPlay e componentes `tp-*`, adaptando o texto à largura da cena.
- Entrada/troca de equipe exibe balão com avatar, nome e TIME AZUL/VERMELHO subindo no lado escolhido. Reutiliza a cadência do Duelo (até 6 balões por equipe, duração aproximada de 2,5–3 segundos).
- Curtidas exibem bolhas com o avatar no lado da equipe (até 24 por lado, intervalo mínimo de 120 ms por usuário) e “+N TAP” para 5 ou mais curtidas. Avatares ausentes/indisponíveis têm fallback com inicial; conteúdo de nome é tratado como texto.
- As opções `show_team_balloons` e `show_like_bubbles` são salvas por streamer e controlam apenas os efeitos. Desativar os efeitos não impede registro de equipe, contabilização de TAP nem força. Os contadores de participantes por equipe aparecem nos controles.
- Efeitos pendentes são limpos na troca de rodada/parada; eventos de rodada anterior não são reaplicados. Movimento reduzido usa cartões estáticos breves e menos bolhas.

## Arquivos e contratos

- `python/corda.py`: motor autoritativo, sem dependências TikTok/NLP.
- `python/service.py`: roteamento dos callbacks existentes, comandos e tick; encerra o motor ao finalizar a sessão.
- `node/lib/corda.js`: normalização, validação e rotas autenticadas.
- `node/db.js`: tabela `corda_config`, isolada por `tenant_id`.
- `node/server.js`: rota amigável, cache/replay de estado por tenant e parada ao desconectar.
- `node/public/corda.html`: tela, controles, demo e renderização. JS embutido conforme convenção do projeto.
- Painel: entrada **Mais jogos → CORDA · Duelo**; iframe só carrega ao abrir a aba. A permissão acompanha `duelo` tanto na navegação quanto na API.

Rotas: `GET /api/corda/config`, `GET /api/corda/state`; `POST /api/corda/config` com `{config:{...}}`; `POST /api/corda/start`, `/stop`, `/new-match`; `/test` com `{side:'flavio'|'lula',force:25}`. O teste altera uma rodada real e exige live conectada. Configuração pode ser salva offline; iniciar/testar exige live online. Falha ao enviar ao daemon retorna erro, sem declarar a partida iniciada.

Comandos Python: `corda_start`, `corda_stop`, `corda_new_match`, `corda_test`. Eventos: `corda_state` (posição, placar, fase, tempo, configuração e identificador da rodada), `corda_pull` (lado, receptor, força, origem, impulso), `corda_team` (usuário estável, equipe, nome/avatar e equipe anterior) e `corda_tap_avatar_burst` (usuário estável, avatar, equipe e delta de curtidas). O WebSocket envia o último estado ao conectar; uma tela recarregada recupera a partida sem reaplicar presentes.

## Validação

- 25 testes Python: posição, reversão, forças contrárias, combos, presentes grandes, entrada/troca de equipes, metadados dos balões/curtidas, curtidas, timeout, empate, rodada seguinte, vitória final, parada e números inválidos. Também executam os callbacks e o loop de comandos reais extraídos de `service.py`, com dependências externas substituídas, verificando IDs estáveis, filtros e preservação da meta de TAP da Palavra Secreta/Final Boss.
- Testes Node: normalização, conflito de presentes, autenticação, permissão, isolamento entre tenants, gravação/leitura em SQLite temporário, bloqueio de edição durante jogo, trava de live, teste de partida ativa, erro do daemon e sintaxe dos scripts embutidos.
- Testes Edge/Playwright: cena neutra, pressão, efeito, vitória de cada lado, salvar configuração pelo formulário, partida do motor Python real via API/WebSocket, duas telas sincronizadas, recarga, integração no painel e largura de 375 px sem rolagem horizontal. Inclui balões de entrada/troca, bolhas, limite simultâneo de avatares e persistência/desativação dos efeitos pelo painel. Capturas inspecionadas visualmente.
- O servidor usado no teste é `server.js` real, com banco temporário e um daemon de fixture que executa `CordaEngine`; não usa a live nem o banco do streamer. Não foi feita validação com presentes de uma live real.

Comandos, a partir da raiz do submódulo:

```text
python -m unittest discover -s python/tests -p "test_corda*.py" -v
node node/tests/corda-api.cjs
node node/tests/corda-preview-server.cjs
```

O servidor de fixture usa a porta 3112 (ou `CORDA_TEST_PORT`) e imprime o diretório temporário. Para executar `corda-browser.cjs`, defina `CORDA_TEST_DIR` com esse diretório e, se Playwright não estiver no ambiente, `CORDA_PLAYWRIGHT_MODULE` com o caminho do pacote. O teste usa Edge em modo headless e bloqueia recursos externos.

Pendência operacional: reiniciar o Node/daemon em uso para disponibilizar as rotas e validar os eventos em uma live real. Não houve publicação, alteração do banco em uso ou commit nesta implementação.

## Ajustes de apresentação

Nomes visíveis: AZUL e VERMELHO; chaves internas dos personagens preservadas. Placar com padrão X=50%, Y=5%, escala=82%. O formulário Posição e escala do placar oferece prévia imediata, restauração do padrão e gravação via POST /api/corda/layout. Esse endpoint permite ajustar durante a partida, aceita somente score_x/score_y/score_scale, preserva regras/pontuação e transmite corda_layout para as telas. O Node acrescenta o layout salvo aos estados do motor sem modificar sua lógica.

Presentes habilitados aparecem por equipe em caixas próprias, com nomes traduzidos e ícones disponíveis no catálogo. A faixa de instrução e contagem de curtidas permanece oculta. Validação: API comprova persistência e ausência de comandos/reinício de rodada ao salvar layout; navegador comprova recarga com escala salva e edição em rodada ativa.

## Áudio

Arquivos fornecidos em cabo-de-guerra copiados sem alteração para node/public/corda-audio (trilha, movimento, pressao, win). O painel possui formulário Áudio e música: trilha desligada por padrão, volume 50%; efeitos ligados por padrão, volume 70%. Salvamento pelo endpoint de apresentação existente /api/corda/layout, propagado por WebSocket sem resetar a rodada. A trilha fica em loop durante a partida e para na vitória final/parada. Efeitos tocam uma vez por entrada de estado: movimento (>2 unidades ou força pendente), pressão (>50), vitória (resultado com vencedor). Troca de rodada limpa efeitos. O painel não reproduz som para evitar duplicação com a tela pública. Navegador com autoplay bloqueado apresenta Ativar áudio. Teste com objetos de áudio simulados confirmou contagem única por transição, volume e parada.

## Preparação e participação — 13/10/2026

O painel usa contagem inicial de 10s e contagem entre rodadas de 3s, configuráveis (0 desliga). Participantes entram durante a preparação; pontos e tempo da rodada começam depois. Membros permanecem entre rodadas.

Comentários de participantes somam 1 à barra por padrão, com intervalo de 2s por usuário. Comentários contendo termos dos dois times não pontuam. Não multiplicam pelo bônus de compartilhamento. O comentário de entrada também conta quando recebido na rodada ativa.

Compartilhamentos identificados ficam desativados por padrão. Habilitados, somam 3 à barra, emitem balão de compartilhamento e ativam TAP ×2 por 30s para o usuário; intervalo de 30s por pessoa, sem acumular multiplicadores. Bônus expira ao mudar de rodada. TikTokLive recebe ShareEvent; TikTools aceita evento share com usuário. Validar disponibilidade em live real antes de habilitar. Não há detecção de republicação.

## Meta ajustável ao vivo

O controle Meta de FORÇA da barra altera apenas tap_target durante a partida e persiste para futuras partidas. Na rodada ativa, saldo igual ou maior que a nova meta gera um único puxão pela força configurada e zera a barra. Outros saldos permanecem. Salvar a mesma meta não premia novamente. Durante preparação/resultado a meta muda sem premiar.

## Formato infinito e apresentação de vitória

best_of=0 seleciona rodadas infinitas, encerradas pelo botão Parar. Vitórias são acumuladas sem vencedor final. Melhor de 3/5 apresenta texto luminoso AZUL/VERMELHO GANHOU A RODADA por 2,5s nas vitórias intermediárias; poses, banner e efeito de áudio win completos somente no fim da partida. No infinito, vitória completa em cada rodada.
