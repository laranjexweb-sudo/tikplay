> 2026-10-17: Super Admin → Pacotes e TikCoins ganhou relatório de recargas com período e paginação, separando compras aprovadas e reembolsos de adições/remoções manuais com identificação do admin; totais calculados a partir do ledger existente. Sem mudança em saldo, checkout ou eventos financeiros.

> 2026-10-17: Caça Palavras → ações “Iniciar rodada” e “Encerrar rodada” integradas à faixa do contador de palavras; em telas estreitas, ações se reorganizam para manter os botões utilizáveis. IDs, handlers e bloqueios de estado preservados.

> 2026-10-17: Caça Palavras público → acertos recentes e aviso de acerto identificam o participante com foto ou iniciais como fallback; ranking segue a mesma apresentação. Eventos e ordem dos acertos preservados. Mapa de observabilidade: somente apresentação de dados já existentes; nenhum log, evento, dado persistido ou contrato alterado.

> 2026-10-17: Caça Palavras público → a primeira letra de cada palavra encontrada recebe um avatar pequeno da pessoa que acertou; identificação por nome permanece nos acertos recentes. Sem sobreposição de etiquetas em outras letras; eventos, ordem e regras preservados.

> 2026-10-17: Caça Palavras → quantidade da rodada controlada por stepper de menos/mais com limites 4–16; seletores de modo do chat e formato das coordenadas explicitamente estendidos a toda a largura do card. Contagem enviada ao mesmo início de rodada, sem alterar contrato ou regra.

> 2026-10-17: Caça Palavras → controle de palavras movido para uma linha compacta abaixo do progresso e convertido em seletor de tamanho normal com opções de 4 a 16 palavras; divisor acima das ações removido. Campos de participação agora ocupam a largura do card. Valor, limite e eventos de jogo preservados.

> 2026-10-17: Caça Palavras → refinamento final do painel: “Controle da rodada” permanece como título e o badge comunica o estado; progresso e quantidade de palavras usam colunas próprias; participação pelo chat ganhou subtítulo e switch padrão. O card “Tela pública” ficou compacto, com abrir/copy lado a lado. A configuração OBS foi removida somente desta interface; rotas, endpoints e helpers técnicos permanecem. Sem mudança de regras, APIs, eventos ou logs.

> 2026-10-17: Painel do streamer → Caça Palavras reorganizado em operação da rodada, palavras com estados, acertos recentes, participação do chat e exibição pública/OBS; layout responsivo segue o modelo compartilhado de controle de jogos. IDs, endpoints, configurações, regras e eventos existentes preservados; sem novos logs.

> 2026-10-17: Caça Palavras refinado: controle da rodada em cabeçalho, progresso e ações; coluna principal em 65/35 com participação/exibição; palavras acertadas na tela pública agora seguem a ordem dos eventos recebidos, evitando esconder um palpite recente por causa da posição dele no gabarito. Regras de jogo, contratos e eventos preservados.

> 2026-10-17: Console de logs do streamer ganhou filtro opcional “Somente Caça Palavras”, salvo localmente; mensagens legadas identificadas pela etiqueta CacaPalavras passam a receber o filtro de jogo. Nenhum evento ou dado novo foi gerado.

> 2026-10-17: O console do streamer agora exibe comentários recebidos, limitados a 130 caracteres e a um por segundo; durante uma rodada ativa são classificados como Caça Palavras para facilitar o diagnóstico de palpites. O transporte de chat já existente foi reutilizado; nenhuma persistência adicional foi criada.

> 2026-10-17: Exemplo de hashtag em “Como usar os estilos” simplificado para texto corrido; somente a tag recebe destaque ciano, sem caixa, fundo ou borda.

> 2026-10-17: Acabamento de Sons → Narração: volume, amplificação, teste e observação final mais próximos; exemplo de hashtag apresentado como snippet; seletor rotulado apenas “Voz”; seção de pacotes vazia ocultada sem mensagem de indisponibilidade.

> 2026-10-17: Refinamento final em Sons → Narração: estado “Narração ativada/desativada” integrado ao toggle sem badge; autosave aproximado das abas; crédito total e tarifa expressos em duas linhas curtas; controles de velocidade/volume com valores alinhados à direita; instrução breve das tags abaixo do teste; limite da amplificação explicado somente quando aberto. IDs/handlers e eventos existentes preservados.

> 2026-10-17: Sons → Narração reorganizada para consumo rápido: estado principal do chat alinhado à esquerda com status e controle à direita, voz padrão, voz expressiva, regras e créditos em blocos separados; cards empilham conforme a largura útil e os limites dos sliders ficam recuados/alinhados aos marcadores. IDs, autosave, API e eventos existentes preservados; nenhuma telemetria nova introduzida (alteração visual).

> 2026-10-17: Refinamento de densidade em Sons → Narração: controle mestre mais compacto, cards com altura conforme o conteúdo, créditos em linha única com custo logo abaixo, botões de teste com largura igual, feedback de prévia em estado visual acessível e textos secundários/status de conexão mais discretos. Fluxo e eventos de TTS existentes preservados; nenhum evento novo.

# TikPlay — Design System Oficial (tema reutilizável)

> 2026-10-17: Caça Palavras público adaptado à proporção real da fonte de navegador com áreas seguras configuráveis (presets vertical/horizontal e personalizado), prévia e salvamento automático no painel. Progresso compacto, tabuleiro quadrado responsivo, acertos temporários e ranking final sem scroll; eventos e regras do jogo preservados. Mapa de observabilidade: `caca-transmission-layout.md`.

> 2026-10-17: Super Admin → Dashboard ampliado com refresh configurável, saúde da plataforma, incidentes, custo real/estimado por período, projeção mensal parcial, uso de APIs por recurso/modelo, créditos por modelo e consumo por cliente; tarifas futuras versionadas. Custos desconhecidos e lacunas históricas ficam explícitos; APIs de jogo e cobrança existentes preservadas. O código está no working tree, mas ainda depende de atualização segura do processo para ativar a coleta. Ver `dashboard-super-admin.md`.

> 2026-10-17: Refinamento visual do Dashboard do Super Admin: KPIs com hierarquia consistente, saúde separada entre serviços internos e integrações, resumo financeiro com métricas principais e faixa secundária de períodos, análises divididas em três blocos, formulário de tarifas responsivo, estados de atividade em badges e estados vazios mais claros. Cálculos, endpoints e estados funcionais preservados.

> 2026-10-17: Super Admin → Integrações reorganizada em resumo de estados, cartões compactos de serviços com edição recolhida, filtros/actions em massa no catálogo de vozes, grupos recolhíveis por modelo com tarifa e contagem, e resumo final do catálogo de presentes. IDs, handlers, rotas e autosave preservados; status de credenciais usa os valores mascarados fornecidos pelo servidor. Ver `integracoes-super-admin.md`.

> 2026-10-17: Integrações refinada visualmente: cards de voz reservam coluna fixa para status/switch e limitam nomes a duas linhas, grupos usam uma linha-resumo adaptável, contadores distinguem liberadas/bloqueadas/resultados, e catálogo prioriza quantidade. Cartões técnicos usam labels explícitas; nenhuma regra, ID, handler, endpoint ou persistência foi alterada.

> 2026-10-17: Integrações refinada para larguras estreitas: grid de vozes usa breakpoints baseados na largura real do card, reduzindo para uma coluna quando necessário para manter legível a área do nome e a coluna fixa de status/toggle. Cards de serviço seguem alinhados; sections de vozes e catálogo compartilham o wrapper da página. Ajuste apenas visual, sem novos eventos ou alterações de contrato.

> 2026-10-17: Resumo dos grupos de vozes usa singular correto para catálogos unitários (“1 voz · 1 liberada · 1 crédito / 100 caracteres”).

> 2026-10-17: Corrigida a hierarquia HTML de Integrações: fechamento explícito de “Serviços e credenciais” mantém Vozes e Catálogo dentro de Integrações, com Pacotes, Convites e Usuários como seções independentes. Validado no DOM e na navegação do painel.

> 2026-10-17: Super Admin separa o cadastro dos pacotes e os ajustes manuais de saldo da aba Integrações; a nova aba Pacotes e Créditos lista saldos por streamer, com ações distintas para adicionar/remover e confirmação antes da remoção.

> 2026-10-17: Carteira do streamer deixa explícito o preço em reais nos pacotes, estima créditos para uma mensagem digitada conforme tarifa da voz e limite de 150 caracteres, e mostra referência média de 75 caracteres (metade do limite da live). O histórico informa o tamanho da narração; hashtags finais de emoção não entram na contagem.

> 2026-10-17: Voz adicional do chat agora pode narrar até 150 caracteres, alinhada ao limite da mensagem da live; o débito continua calculado sobre o texto efetivamente falado.

> 2026-10-17: Ajuda de hashtags de emoção movida para o cartão de voz adicional do chat; nomes visíveis das vozes padrão Antonio e Francisca não exibem mais “(servidor)”. IDs internos preservados.

> 2026-10-17: Relatórios do streamer refinados para leitura analítica: filtros compactos com atualização automática, período agrupado em um único controle sem sobrepor o filtro de interação e exportação no cabeçalho; comparação absoluta/percentual, rótulo “Diamantes recebidos”, avatares com fallback por inicial e prévia de 12 interações com expansão paginada.

> 2026-10-16: Narração adicional passou de cota mensal por caracteres para carteira de créditos: Super Admin define tarifa por 100 caracteres em cada modelo e pacotes avulsos; streamer vê saldo, tarifa da voz, compra via Mercado Pago e histórico recente. Débitos são atômicos e pagamentos aprovados são processados de forma idempotente. Ver `creditos-voz.md` e `modelos-voz-adicionais.md`.

> 2026-10-16: Catálogo de vozes liberadas agora exige evidência de PT-BR: HeyGen fica indisponível aos clientes porque os IDs não identificam sotaque e as dez vozes testadas não soaram brasileiras; Kokoro só oferece PM Santa. ElevenLabs deixou de filtrar sotaque pela API antes da leitura dos metadados e inclui a voz própria Inêz (`pt-brazilian`); clones próprios sem idioma aparecem ao admin como não identificados para teste manual.

> 2026-10-16: Super Admin pode testar as 30 vozes multilíngues do Gemini 3.8 Flash Lite TTS via OpenRouter; cards avisam que o sotaque PT-BR precisa ser confirmado antes da liberação.

> 2026-10-16: Prévia e narração Gemini usam PCM (o modelo rejeita MP3) e convertem a resposta para WAV reproduzível no admin/navegador. Removido das Configurações globais o bloco de palavras banidas e seu autosave no frontend.

> 2026-10-16: Narração do chat interpreta uma hashtag permitida de emoção no final (ex.: `#grito`) como instrução de voz para Gemini e ElevenLabs, removendo-a do texto falado; tags não reconhecidas não viram prompts. Ver `modelos-voz-adicionais.md`.

> 2026-10-16: Painel Streamer exibe nomes de vozes sem sufixo do provedor/modelo; seletor é ocultado quando há no máximo uma opção, mantendo a escolha salva e o teste acessíveis.

> 2026-10-16: Prévia HeyGen no Super Admin pede PCM (formato aceito pelo modelo) e converte para WAV 44,1 kHz para reprodução; Kokoro continua em MP3. Causa do 502 confirmada com resposta HTTP 400 do OpenRouter e corrigida; teste de rota e síntese real aprovados. Ver `modelos-voz-adicionais.md`.

> 2026-10-16: Controles dos cards de voz ficam na ordem play, dados da voz e habilitação, também em telas estreitas.

> 2026-10-16: Super Admin > Vozes liberadas compacta os cards PT-BR em quatro colunas responsivas, com nomes em maiúsculas, play circular somente com ícone e switch claro seguindo os cartões do Monitor. Preview agora desbloqueia o contexto de áudio no gesto do clique, suporta parar e ignora respostas antigas; causa observada de preview indisponível: servidor ativo retorna HTTP 404 para a rota, então a versão nova ainda não foi carregada no processo. Ver `modelos-voz-adicionais.md`.

> 2026-10-16: Catálogo global de presentes movido para Configurações globais no Super Admin. IDs, estado de sincronização, endpoint e ação de sincronizar preservados.

> 2026-10-16: Importação do catálogo de palavras adiciona novas entradas diretamente como ativas; removida a escolha de status inicial do formulário e a rota aplica o mesmo padrão.

> 2026-10-16: Catálogo e importação de palavras não exibem nem editam dificuldade; em Uso e sorteio por streamer, somente categoria pode filtrar. A seleção de palavras ignora configurações antigas de dificuldade.

> 2026-10-16: Categorias removidas do catálogo/importação e dos filtros por streamer. Todas as contas sorteiam do mesmo conjunto de palavras ativas e não banidas; configurações legadas são ignoradas.

> 2026-10-16: Gerador de contextos reorganizado em controles, cobertura do catálogo, progresso e cartões de consumo/custo; histórico detalhado fica recolhido. Cobertura conta somente contextos válidos para o conjunto atual de palavras.

> 2026-10-16: Cabeçalho interno redundante “Operação local” removido da seção do Super Admin; o título da página permanece como identificação da tela.

> 2026-10-16: Operação local deixou de usar um cartão envolvendo todos os blocos. O catálogo de palavras usa um cartão próprio no mesmo nível dos blocos de uso e geração.

> 2026-10-16: Dificuldade removida do catálogo visual e dos filtros de sorteio por streamer; categoria continua opcional e todo o vocabulário ativo participa do sorteio. Colunas legadas do banco permanecem ignoradas por compatibilidade.

> 2026-10-16: Página pública do 3 Dicas adaptada para fontes verticais de live: área de jogo entre 10% e 70% da altura, dicas anteriores/bloqueadas compactas, até três palpites recentes com cores informativas e ranking semanal resumido ao líder. A tela horizontal mantém o layout anterior; IDs e eventos preservados.

> 2026-10-16: Operação local inclui catálogo de palavras pesquisável e importável, revisão de novas entradas, categorias/dificuldade, filtros por streamer, histórico persistente de uso e ciclos de sorteio. A reserva é transacional por tenant; o histórico não é apagado quando o ciclo avança. Ver `catalogo-palavras.md`.

> 2026-10-16: Operação local → Gerar contextos usa OpenRouter/Claude Haiku 5.5 para até 50 palavras próximas e completa vagas restantes com o ranking spaCy. O relatório mostra quantidades por origem, execuções, chamadas, tokens, custo conhecido e custos pendentes. Controles existentes preservados. Interface conferida em navegador com dados simulados; ativação no servidor principal pendente de reinício seguro. Ver `gerador-contextos-openrouter.md`.

> 2026-10-16: Margem silenciosa local das vozes da API ampliada de 150 para 500 ms para acomodar a ativação da saída de áudio. Amostras e volume preservados; validação auditiva no dispositivo pendente. Ver `voz-api-margem-inicial.md`.
> 2026-10-16: Sons → Narração ganhou volume ajustável de 0% a 300%, persistido por conta e aplicado ao ganho TTS do painel durante a reprodução; alertas de presentes permanecem independentes. Validação auditiva e ativação no serviço pendentes.
> 2026-10-16: Sons → Narração reorganizada: configurações gerais ficam à esquerda; voz adicional e limite mensal ficam juntos à direita. Removido o cartão redundante “Status do áudio”; ajuda de alertas aparece somente na aba de alertas.
> 2026-10-16: Voz adicional e informações de consumo foram trazidas para dentro do cartão “Voz do narrador”, em uma grade interna responsiva. Na aba Narração, o cartão ocupa a largura do conteúdo; instruções de presentes continuam na coluna lateral da aba Alertas.
> 2026-10-16: Slider de volume da narração usa escala com 100% no centro e 300% no máximo; voz adicional e limite permanecem na barra lateral.
> 2026-10-16: Cartão “Voz do narrador” organizado em “Voz e reprodução” e “Narração do chat”. Botão de teste junto aos controles, toggle alinhado à direita e aviso sobre charadas compacto; handlers e IDs preservados.
> 2026-10-16: “Narração do chat” movida para o início do cartão “Voz do narrador”, deixando “Ler mensagens do chat em voz alta” como primeiro ajuste; IDs e handlers preservados.
> 2026-10-16: Campos de seleção da narração receberam seta personalizada, cores escuras também no menu de opções e estados de foco/hover com contraste; foco por teclado preservado.
> 2026-10-16: Formulários do Painel Streamer padronizados com tokens compartilhados para altura, fundo, borda, raio, tipografia e seta de seleção. Campo de busca e ação de adicionar presente alinhados; focos de teclado e comportamentos existentes preservados.
> 2026-10-16: Seletores do Painel Streamer passaram a abrir listas próprias no tema TikPlay, com destaque ciano e seleção marcada, seguindo o autocomplete de presentes. IDs, opções, valores, eventos change/input e validação do select original são mantidos; suporte a teclado e atualização de opções dinâmicas incluídos.
> 2026-10-16: Campos de filtro da narração do chat alinhados pelo topo e com altura igual; margem global de `.field` neutralizada apenas nesses controles para evitar deslocamento causado pelo texto auxiliar.

> 2026-10-16: Palavra Secreta mantém o acerto imediato no ranking sem duplicar rank 1 no destaque temporário de palpite. Eventos atrasados não reabrem destaques após o encerramento. Ver `correcao-destaque-vencedor.md`.

> 2026-10-15: Reproducao das vozes adicionais passa a decodificar o audio completo em saida persistente, sem fade, com margem silenciosa local de 150 ms. Fila, prioridade e cancelamento preservados; nenhuma mudanca visual.

> 2026-10-15: Configuracoes globais do Super Admin incluem campo protegido para salvar/remover a chave ElevenLabs. Somente o estado da credencial volta ao navegador; componentes administrativos existentes e rota de navegacao `#adminRules` preservados.

> 2026-10-15: ElevenLabs opcional por streamer: Admin oferece liberacao individual e limite mensal; Sons/Narracao exibe seletor e teste exclusivos do chat apenas para contas autorizadas. Controles reutilizam os componentes existentes. Chave e ativacao real pendentes; ver `plano-vozes-por-streamer.md`.

> 2026-10-15: No painel streamer, a voz adicional nao expoe o nome da integracao. Para economizar quota, cada sintese adicional usa no maximo 120 caracteres e a previa foi encurtada; voz padrao inalterada.

> 2026-10-15: Login e cadastro adotam a composição do site e os controles compartilhados do Painel Streamer (botões, campos e indicador de aba), com `/register`/`/cadastro` abrindo o cadastro quando permitido. Fluxos de autenticação, convites e APIs preservados.

> 2026-10-15: Ranking de diamantes V3 salva posição, escala e quantidade por conta; páginas públicas abertas carregam a preferência e recebem atualização via WebSocket. Prévia de Narração posiciona o marcador 1x conforme a escala linear real e oculta referências visíveis ao mecanismo de voz, preservando IDs internos.

> 2026-10-15: Sons → Narração habilita leitura de comentários com Edge TTS e filtros persistidos, compartilhando voz/velocidade com as charadas. Mantidos componentes, autosave e contrato `/api/settings`; playback do painel serializado.

> 2026-10-15: Áudio da charada removido da página pública/OBS; texto e apresentação visual permanecem. Narração automática e replay de áudio ficam no painel streamer.

> 2026-10-15: Card público da charada permanece somente textual; removidos ícone de narração e botões de áudio, preservados o texto, o fechamento e as regras do jogo.

> 2026-10-15: Ranking Dragonwilds removido da aba Sobreposições do painel a pedido do usuário. Arquivos standalone e assets permanecem preservados. Implementação anterior: fonte transparente, dois rankings independentes, molduras PNG sobre fotos no top 3 e posicionamento/escalas independentes; sem alterações de API/backend.

> 2026-10-15: Central de Ajuda abre artigos diretamente pelos resultados e mostra carregamento/erro. Formulários de chamado, sugestão e resposta disparam também pelo clique direto do botão, validam com retorno visível no painel e mantêm categoria opcional como no contrato. API/backend preservados.

> 2026-10-15: Nova overlay independente de diamantes em `/overlays/gifts/v3`, baseada somente na composição compacta do V3. Cada linha mostra foto, nome e ícone/total de diamantes; top 3 recebe moldura PNG. Sem caixas, fundos, medalhas de posição ou @TikTok. Painel tem prévia, limite de 3/5/10 pessoas, controles próprios de posição/escala e links públicos com ajustes embutidos; preferências ficam locais por conta, sem alterar backend nem as preferências de curtidas.
> 2026-10-15: Overlay de diamantes V3 compactada horizontalmente; foto do top 3 ampliada e elevada dentro da moldura para remover o vão no topo. Ajuste somente visual, sem alteração no backend.
> 2026-10-15: Overlay de moedas mostra o total abaixo do nome e usa ícone de moeda dourada com giro periódico suave, respeitando movimento reduzido.
> 2026-10-15: Quantidade de moedas reduzida para equilibrar a hierarquia visual com o nome e a foto.
> 2026-10-15: Giro das moedas usa duração e atraso aleatórios por item para evitar animação sincronizada.
> 2026-10-15: Texto do valor de moedas igualado ao V3 de curtidas (13 px ao vivo, 16 px na prévia). Foto no V3 de curtidas deslocada para baixo para centralizar na abertura da moldura e eliminar o vão inferior; CSS versionado para limpar cache. Posição original correta da overlay de moedas preservada.
> 2026-10-15: Ajuste fino adicional desce alguns pontos a foto emoldurada no V3 de curtidas.
> 2026-10-15: Ranking de moedas mantém nas posições 4+ a altura, tipografia e diâmetro real da foto do top 3, sem aplicar as molduras.
> 2026-10-15: Avatares simples das posições 4+ centralizados na coluna da foto, no preview e na overlay ao vivo.
> 2026-10-15: Prévia do ranking de moedas passa a respeitar posição/escala enviados pelo painel; URL pública continua embutindo os ajustes atuais.

> 2026-10-14: Relatorios do streamer consomem `summary.level_up` com total por eixo, filtram subidas por `gifter`/`fanclub` e exibem mensagem explicita quando `before` e desconhecido. CSS versionado para atualizar cache.

> 2026-10-14: Jogo Contexto público em `/contexto` (página auto-contida com tokens `--tp-*`): palavra do dia pseudorrandômica por navegador/data, ilimitado com sorteio sem repetir acertos locais, 3 dicas, lista de palpites anônima e tensão. A interface e API não expõem o tamanho nem oferecem revelação; a palavra só aparece após acertar. Cache local no navegador; API `/api/contexto/*` reusa o daemon spaCy existente. O site institucional fica na raiz do apex `tikplay.com.br` (`node/public/site/`).

> 2026-10-14: A fonte única de subida de nível agora identifica `gifter` e `fanclub`. A Jornada de Fã usa os seis escudos de capítulo e acento coral/laranja, com marcos 1/10/20/30/40/50; presenteador continua usando os diamantes originais. Painel mostra as duas prévias lado a lado, compartilha posição/escala e oferece testes visuais para ambos os eixos.

> 2026-10-14: Captura de comunidade também escuta o evento explícito TikTokLive `FANS_LEVEL_UPGRADE` (`current_grade`), diferenciando-o da entrada no fã-clube. Promoções explícitas são registradas e difundidas mesmo quando o baseline local ainda não existe; níveis continuam persistidos e visíveis nos Relatórios.

> 2026-10-14: Overlay de subida do nível de presenteador integrado em Sobreposições. A fonte pública consome `level_up` do eixo `gifter` pelo WebSocket autenticado, enfileira eventos, exibe os seis PNGs oficiais dos tiers e omite progresso quando o backend não o envia. O teste autenticado transmite apenas evento visual efêmero, sem persistência. A máquina de estados começa em quadro compacto, apresenta o membro, expande uma única vez e revela o nível; subida comum revela apenas o diamante atual, enquanto troca de faixa percorre a timeline sequencialmente antes do reveal central do novo diamante. Na conclusão, diamante, faixa, nível alcançado e mensagem ficam centralizados numa hierarquia única. A prévia do painel usa um estado final estático, centralizado e dimensionado conforme o contêiner, enquanto a fonte OBS mantém a animação. Canvas mestre fixo de 1040×820 px, com redução automática somente em viewports menores, posição/escala persistidas por conta e sincronizadas por REST + WebSocket. Transições refinadas com pausas maiores, curvas sem overshoot e brilho/escala mais contidos para valorizar a progressão sem flashes bruscos.

> 2026-10-14: Botoes de acao do Painel Streamer e Super Admin centralizados em `ui/tikplay-admin-buttons.css`: alturas, bordas, tipografia, cores semanticas e estados hover/press/disabled/foco consistentes. Controles de navegacao e layout permanecem especificos.

> 2026-10-14: Palpites ficam legiveis no topo por 1,2 s; a lista ordenada atualiza incrementalmente sem reconstruir as linhas. O novo item ocupa sua posicao e so desloca suavemente os itens abaixo, sem piscadas; repetidos recebem tom vermelho e mantem a etiqueta REPETIDA. Fila e eventos preservados.

> 2026-10-14: Apos revelar o tamanho da palavra, o card lateral alterna em intervalos aleatorios entre o presente de dica/Boss e o presente da primeira letra, com slide discreto. Ciclo para quando a letra e revelada ou a partida termina; regras de presentes preservadas.

> 2026-10-14: Preferências de posição, tipografia e sombra dos rankings V2/V3 agora se aplicam ao elemento correto nas prévias e overlays. Assets receberam nova versão de cache para carregar o suporte a configuração ao atualizar o painel.

> 2026-10-14: Ao posicionar a foto do ranking à direita, nome, curtidas e total também se alinham à direita. No Neon Compacto, o acento vertical dos três primeiros colocados acompanha a composição e passa para a margem direita.

> 2026-10-14: Controles de cor da fonte dos rankings usam seletor HSV integrado ao tema (matiz contínua + área de saturação/brilho), campo HEX e cores rápidas; sem pop-up nativo e com atualização imediata da prévia.

> 2026-10-14: Espaçamento horizontal entre retrato e nome reduzido de forma consistente nos rankings Neon Compacto e Pódio Neon, para foto à esquerda ou à direita.

> 2026-10-14: Curtidas flutuantes seguem o arranjo dos rankings, com prévia à esquerda e controles à direita. Campos de animação/HEX usam o formulário escuro padrão do painel; cores dos corações usam o seletor HSV/HEX integrado, com amostras rápidas e atualização imediata. Persistência e contrato `heart_colors` preservados.

> 2026-10-14: Central de Ajuda e Suporte implementada no tema escuro atual em `/suporte` e `/ajuda`, com chamados, anexos autenticados, sugestões e gestão no Super Admin. A interface consome somente o contrato existente em `suporte-contrato-api.md`; nenhuma rota, banco ou regra do backend foi alterada.

> 2026-10-14: Ajuda e Suporte implementados como interface nativa no DOM do Painel Streamer, sem iframe. A aba consome o contrato existente de artigos, chamados, anexos, respostas e sugestões; shell, navegação e console originais permanecem no mesmo painel.

> 2026-10-14: Ajuda e Suporte fica disponível somente na seção Sistema da navegação do streamer; removidos os atalhos duplicados do topo e do menu principal.

> 2026-10-14: Relatórios reposicionado logo abaixo de Conectar Live na navegação do Painel Streamer; tela e carregamento preservados.

> 2026-10-14: Aba 3 Dicas migrada integralmente para `tikplay-3-dicas-novo.html`: cabecalho, grade responsiva, status/controles, configuracao, presentes e resumo/ranking lateral. IDs, handlers, autosave, catalogo e destino tecnico preservados; chips, autocomplete e botoes seguem o tema escuro atual.

> 2026-10-13: Setas de posicao dos rankings aceitam pressao continua: movimento inicia no pressionar e repete ate soltar, com suporte pointer/touch e teclado.

> 2026-10-13: Botoes de copiar link dos rankings receberam estilo compartilhado, com altura, cor, tipografia e estados de interacao iguais e sem sombra/deslocamento herdados.

> 2026-10-13: Rankings de sobreposicao agora usam nomes descritivos no painel: Ranking Neon Compacto (antigo V2) e Ranking Podio Neon (antigo V3). Rotas e chaves internas mantidas.

> 2026-10-13: Resetar movido ao cabecalho de controles, como no index.html de referencia. Controle Passo removido; movimento fixo de 1% por seta.

> 2026-10-13: Controles de Sobreposicoes conferidos contra index.html da referencia. Removido o controle extra Passo 1% (alternava deslocamento entre 1% e 5%); setas agora movem em 1% fixo e permanecem d-pad 52px, escala +/- 44px e espacamento 60px.

> 2026-10-13: Controles de posicao/escala das Sobreposicoes alinhados ao modelo: d-pad 52px, ajuste de escala 44px, espacamento central de 60px e paineis com proporcao 1.2/.8. Efeitos antigos de sombra/deslocamento retirados, com hover suave.

> 2026-10-13: Historico de partidas alinhado a tabela da referencia: filtros organizados, cabecalho escuro, divisorias sutis, palavra sem ID repetido e sem estilos antigos de borda preta.

> 2026-10-13: Probabilidade de dicas/charadas integrada a Regras e automacao, com slider unico e percentuais complementares ao vivo. IDs de preferencias e autosave preservados.

> 2026-10-13: Switches da Palavra Secreta corrigidos: removido deslocamento duplicado (left + transform) herdado da referencia geral. Bolinha permanece dentro do trilho nos dois estados.

> 2026-10-13: Presente do Boss movido ao final de Dicas e presentes, depois de tamanho/primeira letra. Contador de selecao removido; limite de um presente e bloqueio por modo Boss preservados.

> 2026-10-13: Presente Revelador renomeado Presente do Boss. Configuracao desabilitada por fieldset quando Boss esta OFF, com mensagem de ativacao; selecao salva preservada.

> 2026-10-13: Contadores de presentes seguem a referencia: badge amarelo discreto, fonte 9px/800 e apenas quantidade/limite. Removida regra antiga do giftCounter que escurecia e ampliava o texto.

> 2026-10-13: Etiquetas selecionadas reforcadas no escopo da Palavra Secreta, sem sombra/efeito antigo e com texto mais legivel. Versao dos estilos atualizada para invalidar cache do navegador.

> 2026-10-13: Catalogo de presentes padronizado no painel streamer: filtro de valor escuro com campos alinhados, selecao em ciano e etiquetas sem sombra antiga, com remocao discreta. Filtragem e selecao preservadas.

> 2026-10-13: Dica usa o mesmo estilo azul/ciano de Soltar Charada, mantendo os bloqueios existentes.

> 2026-10-13: O botao de alternar ranking mostra o estado recebido do backend: Ranking Rodada, Ranking Live, Ranking Semanal ou Ranking Oculto. Texto inferior ocultado; acao e bloqueios preservados.

> 2026-10-13: Controles da Palavra Secreta agrupados em duas linhas de tres: Dica/Mudar Ranking/Lista Final e Soltar Charada/Replay/Fechar Charada. Acoes secundarias no mesmo tom neutro; Soltar Charada em ciano e Encerrar Partida em vermelho discreto. Iniciar/Encerrar permanece em largura total; handlers e bloqueios preservados.

> 2026-10-13: Palavra Secreta usa a estrutura/CSS de `tikplay-palavra-secreta-novo.html`, isolados em `ui/tikplay-word-model.css`. Layout de duas colunas, controles, presentes, automação, roleta, histórico e resumo lateral; dados fictícios removidos e IDs/handlers preservados. Estados dos botões e campos seguem o modelo. Validado com API simulada, campos, switches e viewport mobile; sem erros JS ou overflow na página do jogo.

> 2026-10-13: Sons migra para a estrutura e CSS de `Site/tikplay-admin-new/tikplay-admin-new/tikplay-sons-novo.html`, com estilos isolados em `ui/tikplay-sounds-model.css`. Abas Narração/Alertas, resumo lateral e lista real de presentes; handlers de voz, upload normal/combo, reprodução e remoção preservados. Dados demonstrativos removidos. Validado com API simulada, permissões, upload e viewport mobile.

> 2026-10-13: Conectar Live reconstruída com a estrutura da referência: título, conexão e filtros em duas colunas, campo com @, botões e status-card, switches originais. IDs/handlers e credencial opcional preservados; validação desktop/mobile sem erros JS.

> 2026-10-13: Sobreposições segue a página do modelo fornecido, com prévia à esquerda e posição/escala à direita por ranking. Painéis, setas e campos no tema original; prévia dimensionada pela quantidade de participantes. Navegação desktop/mobile e controles V2/V3 validados com API simulada.

> 2026-10-13: Painel streamer migra, a pedido explícito do usuário, para o modelo `Site/tikplay-admin-new/tikplay-admin-new`. CSS original em `ui/tikplay-streamer-reference.css`, adaptações isoladas em `ui/tikplay-streamer-model.css`. Dashboard funcional, sidebar, busca, topbar e console; controles existentes e gating preservados. CORDA aplica o tema apenas em control=1. Validado com Playwright nas 11 seções, desktop/mobile e API simulada; sem alterações de backend nesta tarefa.

> 2026-10-13: Admin usa a referência explícita `Site/tikplay-admin-new/tikplay-admin-new`: fontes Inter/Space Grotesk, paleta, marca, workspace, topbar e navegação ciano. Funções administrativas preservadas; frontend validado desktop/mobile.

> **Documento vivo.** Toda alteração visual do TikPlay (Painel Streamer, Super Admin,
> overlays e jogos) deve seguir este documento. Antes de codar visual, leia a seção
> **Status / Progresso** para saber o que já foi feito e o que falta.

- **Última atualização:** 2026-10-15
- **Escopo:** Node `node/public/*` (HTML/CSS/JS embutido) + `node/public/style.css`
- **Regra de ouro:** refatoração **visual e estrutural de CSS/componentes**. Não alterar
  lógica de jogo, rotas, IDs, eventos, WebSockets, APIs, banco, auth, permissões, OBS,
  ranking nem nomes de eventos (ver `REGRAS_DO_PROJETO.md`).

---

## 0. COMO USAR ESTE DOCUMENTO

1. **Antes** de mexer no visual, leia **§2 Diagnóstico** e **§10 Status/Progresso**.
2. Use **somente** tokens de **§3** (nada de hex solto no CSS novo).
3. Use **somente** componentes de **§4** (nada de botão/card “inventado” por página).
4. Siga a ordem de implementação de **§9** (não refatorar tudo de uma vez).
5. Ao concluir uma etapa, marque o checkbox em **§10** e atualize a data no topo.
6. Se uma mudança estrutural exigir alteração funcional, **pare e documente** aqui antes.

---

## 1. Identidade visual

Mistura coerente de **console de streaming + arcade + painel SaaS + ferramenta de produção
de live**. Precisa ser imediatamente reconhecível como **TikPlay**.

Base: **PRETO + OFF-WHITE + AMARELO TIKPLAY**. Cores semânticas:

| Cor | Uso |
|---|---|
| 🟡 Amarelo | TikPlay / seleção / ação principal / atenção |
| 🟢 Verde | ativo / iniciar / sucesso |
| 🔴 Vermelho/coral | parar / excluir / perigo |
| 🔵 Azul | informação / lado azul / ferramenta |
| ⚫ Preto/grafite | navegação / contraste |

Características: fundo claro levemente quente, contornos pretos, cards bem definidos,
cantos arredondados, tipografia forte nos títulos, ícones simples, sombras discretas,
interface compacta mas legível.

**Evitar:** excesso de gradientes, glassmorphism, transparências exageradas, neon genérico
futurista, sombras gigantes, visual Bootstrap/Material padrão, bordas finas, minimalismo excessivo.

> ⚠️ **Divergência conhecida:** hoje o **Painel/SaaS** já é claro (`#fdfaf3`, bordas pretas,
> amarelo `#fec90f`), enquanto as **telas de jogo** são escuras (`#0F111A`/`#000`, roxo
> `#8B5CF6`, âmbar `#FBBF24`). O Design System **promove a identidade do Painel** a oficial e
> migra os jogos progressivamente, preservando acentos próprios por jogo (§7). Não substituir
> a identidade por outra paleta.

---

## 2. Diagnóstico (inventário executado em 2026-10-12)

### 2.1 Estrutura atual dos arquivos visuais

Todo o front vive em `node/public/` (estáticos servidos pelo `server.js`). **Não há `<script src>`
externo** — todo o JS é embutido. Fontes: `Inter` (Google Fonts) em alguns arquivos; Bootstrap
vem de `/vendor/brite/bootstrap.min.css`.

| Arquivo | Bytes | `<style>` inline | `style=` inline | `<link>` | Observação |
|---|---:|---:|---:|---:|---|
| `control-panel.html` | 232.506 | 20.556 B | **148** | bootstrap | Painel Streamer — maior dor |
| `duelo.html` | 114.970 | 29.769 B | 10 | — | tela mais completa (referência) |
| `web-game.html` | 59.789 | 583 B | 24 | `style.css` | único que usa o CSS global |
| `tres-pontinhos.html` | 52.690 | 22.169 B | 5 | — | |
| `bichinho.html` | 25.704 | 4.222 B | 0 | — | |
| `batalha.html` | 24.649 | 11.714 B | 2 | — | |
| `admin.html` | 23.111 | 823 B | 34 | bootstrap | Super Admin |
| `caca-palavra.html` | 19.316 | 6.861 B | 7 | — | |
| `docs.html` | 16.415 | 4.760 B | 0 | — | já tem `:root` próprio |
| `bichinho-overlay.html` | 14.662 | 2.123 B | 3 | — | overlay OBS |
| `login.html` | 8.104 | 1.751 B | 2 | bootstrap | |
| `obs-ranking.html` | 4.625 | 1.719 B | 0 | Inter | overlay OBS |
| **`style.css`** | **57.122** | — | — | — | tema escuro do web-game, ~50 seções |

Referência de overlays OBS: `obs-overlay.html` (Palavra Secreta), `bichinho-overlay.html`,
`obs-ranking.html`.

### 2.2 Arquivos CSS envolvidos

- **Global:** `node/public/style.css` (57 KB) — na prática serve **só** `web-game.html`.
- **Inline por página:** os 12 HTMLs acima (≈95 KB de CSS repartido, sem tokens, sem reuso).
- **Framework:** Bootstrap (`/vendor/brite/bootstrap.min.css`) usado em `control-panel`,
  `admin` e `login`.
- **Tokens existentes:** apenas `docs.html` (`:root { --bg:#fdfaf3; --ink:#111; --accent:#fec90f; ... }`)
  e `#tab-duelo` em `control-panel.html` (`--duelo-gap`, `--duelo-radius`, `--duelo-border`…).

### 2.3 O que é global hoje (de fato)

- `style.css`: classes do jogo Palavra Secreta (`.guess-*`, `.secret-display`, `.dica-overlay`,
  `.pg-modal-*`, `.roulette-*`, `.meta-*`) — **não** é um CSS de plataforma, é de um jogo.
- Bootstrap: grid/form/table usados por Painel e Admin.
- Não existe CSS de header/navegação/botão/card compartilhado de verdade.

### 2.4 O que é específico de cada jogo

Cada tela de jogo carrega seu próprio `<style>` (web-game usa `style.css`; os demais, inline):
Duelo (30 KB), 3 Dicas (22 KB), Palavra Secreta (57 KB via `style.css`), Batalha (12 KB),
Caça Palavras (7 KB), Bichinho (4 KB + overlay 2 KB).

### 2.5 Principais duplicações encontradas

**Cores** (ocorrências nos HTMLs + `style.css`):

```
#000 (138)  #fff (85)  #9ca3af (27)  #fbbf24 (25)  #a78bfa (24)  #ff6b6b (18)
#fec90f (13)  #34d399 (12)  #8b5cf6 (11)  #1c1e26 (10)  #ef4444 (10)  #5bc0ff (9)
#ffd200 (9)  #e5e7eb (9)  #ffd700 (9)  #10b981 (7)  #3b82f6 (6)  #f97316 (6) …
```

> Há **dezenas** de tons quase iguais (4 amarelos, 5 verdes, 4 vermelhos, 3 azuis) — todos
> candidatos a 1 token cada.

**Componentes repetidos (de-facto, sem sistema):**

- Botões: `.btn` + `.btn-nb` (72×) e variantes `.btn-dark/.btn-danger/.btn-success/.btn-primary/.btn-sm/.btn-tiny`,
  além de `.duelo-btn` + modificadores `--primary/--danger/--warning/--neutral/--small/--success` (63×).
  **Dois sistemas de botão convivendo.**
- Cards: `.nb-card` (43×), `.duelo-team`, `.meta-card`, `.winner-card`, `.rk-card`, `.tm-card`.
- Títulos de seção: `.duelo-section-title`, `.panel-title`.
- Um mini-tema já existe em `docs.html` (`--bg/--ink/--accent/--green/--red/--blue`).

**Estilos inline:** `control-panel.html` tem **148** `style="..."` — a maior frente de dívida.

### 2.6 Arquivos que pretende CRIAR

```
node/public/ui/            # Design System global (servido via /ui/*)
├── tikplay-theme.css      # APENAS tokens + fundamentos (:root, tipografia, reset)
├── tikplay-layout.css     # header, shell do painel, grid, overflow/scroll
├── tikplay-components.css # card, badge, tabs, toolbar, section, divider, modal, toast
├── tikplay-buttons.css    # .tp-btn + variantes semânticas
├── tikplay-forms.css      # input, select, checkbox, range, label, focus
├── tikplay-tables.css     # .tp-table
└── tikplay-responsive.css # breakpoints
node/public/shared/        # partes reutilizáveis (quando extrair HTML/JS)
node/public/games/<jogo>/  # assets/css/js por jogo (fase futura, ver §8)
```

### 2.7 Arquivos que pretende ALTERAR

- `node/public/control-panel.html` (Painel Streamer) — **alvo principal**, Etapa 5+.
- `node/public/admin.html` (Super Admin) — Etapa 7.
- `node/public/web-game.html` + `style.css` — Etapa 6.
- `node/public/duelo.html` — **primeiro jogo**, Etapa 5.
- `node/public/{batalha,caca-palavra,bichinho,bichinho-overlay,tres-pontinhos,obs-ranking,obs-overlay,login,docs}.html` — Etapa 6/8.
- `node/server.js` — **só** para adicionar o static `/ui` (e `/games`), sem tocar em rotas.

### 2.8 Riscos de quebra

| Risco | Mitigação |
|---|---|
| JS depende de classes/IDs (querySelector/classList/dataset) | Não renomear classe usada por JS. Ao trocar, atualizar **todas** as referências. Adicionar classe `tp-*` **ao lado** da antiga antes de remover. |
| Bootstrap sobrescrito por tema | Carregar `ui/*` **depois** do Bootstrap; não reescrever grid/JS do Bootstrap. |
| Duplicação de eventos (ver `PLANO_MELHORIAS.md` C-02) | Não tocar nessa área; refactor é só visual. |
| `style.css` serve só 1 tela mas é “global” | Migrar para `games/secret-word` sem renomear classes usadas pelo JS. |
| Perda de identidade por jogo | Manter acentos por jogo via override local (§7). |
| Sem git no projeto | **Fazer backup/`git init` antes da Etapa 1.** |

### 2.9 Plano de migração (resumo)

Tokens → componentes → header/nav → layout do Painel (log fixo à esquerda) → Duelo →
demais jogos → Super Admin → limpeza do CSS legado. Detalhe e checkboxes em **§9/§10**.

---

## 3. Tokens (fonte única de verdade)

Valores **reconciliados com o que já existe** (Painel usa `#fdfaf3`/`#111`/`#fec90f`).
Ajustes finos permitidos, mas centralizados em `ui/tikplay-theme.css`.

```css
:root {
  /* Brand */
  --tp-yellow: #fec90f;         /* amarelo TikPlay (já usado) */
  --tp-yellow-hover: #edb800;
  --tp-yellow-soft: #ffdd66;

  --tp-black: #111315;
  --tp-black-2: #171a1f;
  --tp-black-3: #22262d;

  /* Background / superfícies */
  --tp-bg: #fdfaf3;             /* off-white quente (já usado) */
  --tp-surface: #ffffff;
  --tp-surface-soft: #f7f5ef;
  --tp-surface-muted: #ececea;

  /* Ações / semânticas */
  --tp-green: #3ddc84;
  --tp-green-hover: #2fc473;
  --tp-red: #ff6b6b;
  --tp-red-hover: #ef5555;
  --tp-blue: #5b8cff;
  --tp-blue-hover: #4777ec;
  --tp-orange: #ff9f32;
  --tp-purple: #8b5cf6;
  --tp-pink: #ff5f9e;

  /* Texto */
  --tp-text: #111315;
  --tp-text-soft: #555b66;
  --tp-text-muted: #818793;
  --tp-text-inverse: #ffffff;

  /* Bordas */
  --tp-border: #111315;
  --tp-border-soft: #c9ccd1;

  /* Status */
  --tp-success: var(--tp-green);
  --tp-warning: var(--tp-yellow);
  --tp-danger: var(--tp-red);
  --tp-info: var(--tp-blue);

  /* Raio */
  --tp-radius-xs: 5px;
  --tp-radius-sm: 8px;
  --tp-radius-md: 12px;
  --tp-radius-lg: 16px;

  /* Sombra (neo-brutalista: offset duro) */
  --tp-shadow-card: 3px 4px 0 rgba(17, 19, 21, 0.95);
  --tp-shadow-soft: 0 4px 16px rgba(0, 0, 0, 0.08);

  /* Espaçamento */
  --tp-space-1: 4px;  --tp-space-2: 8px;  --tp-space-3: 12px;
  --tp-space-4: 16px; --tp-space-5: 20px; --tp-space-6: 24px; --tp-space-8: 32px;

  /* Z-index centralizado */
  --z-base: 1; --z-sticky: 20; --z-dropdown: 100; --z-modal: 500; --z-toast: 1000;

  /* Tipografia */
  --tp-font-ui: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --tp-font-display: 'Inter', 'Segoe UI', system-ui, sans-serif; /* pode receber fonte arcade depois */
}
```

### Tipografia

- **Interface** (`--tp-font-ui`): labels, campos, tabelas, logs, descrições.
- **Display / títulos** (`--tp-font-display`): seções, menus, botões importantes, títulos de jogos.
- Títulos: `font-weight: 800; letter-spacing: .03em;` · **uppercase** reservado a títulos/navegação.
- Evitar textos longos muito espaçados.

---

## 4. Componentes base

Prefixo único **`tp-`**. Tabela de componentes obrigatórios:

```
.tp-card  .tp-card-header  .tp-card-title  .tp-card-desc  .tp-divider
.tp-btn  .tp-btn-primary  .tp-btn-success  .tp-btn-danger  .tp-btn-dark  .tp-btn-neutral
.tp-input  .tp-select  .tp-checkbox  .tp-range  .tp-label
.tp-badge  .tp-badge-success  .tp-badge-danger  .tp-badge-warning  .tp-badge-info
.tp-table  .tp-toolbar  .tp-section
.tp-tabs  .tp-tab          # navegação horizontal de jogos
.tp-modal  .tp-toast
```

**Card** (elemento central da identidade):

```css
.tp-card {
  background: var(--tp-surface);
  border: 2px solid var(--tp-border);
  border-radius: var(--tp-radius-md);
  padding: var(--tp-space-4);   /* 16px */
  display: flex; flex-direction: column; gap: var(--tp-space-3); /* 12px */
}
.tp-card--raised { box-shadow: var(--tp-shadow-card); }
```

Estrutura interna do card: `título + ícone` → `descrição (opcional)` → `divisor` → `conteúdo`.
Não aplicar sombra forte em todos os elementos (usar `.tp-card--raised` só nos importantes).

**Botões** — mesma altura/raio/borda, ícone alinhado, estados hover/active/disabled/focus-visible:

```css
.tp-btn {
  min-height: 36px; padding: 0 14px;
  border: 2px solid var(--tp-border);
  border-radius: var(--tp-radius-sm);
  font-weight: 700; font-family: var(--tp-font-ui);
  transition: 120ms ease; cursor: pointer;
}
```

Semântica: **amarelo** principal/seleção · **verde** iniciar/ativar/sucesso · **vermelho**
parar/excluir/perigo · **preto** secundário importante · **cinza/branco** neutro.

**Campos**:

```css
.tp-input, .tp-select {
  height: 34px; padding: 0 10px;
  border: 2px solid var(--tp-border);
  border-radius: 7px; background: #fff;
}
.tp-input:focus-visible, .tp-select:focus-visible {
  outline: none; box-shadow: 0 0 0 3px rgba(254, 201, 15, .25);
}
```

**Compatibilidade:** ao introduzir `.tp-*`, manter as classes antigas (`btn btn-nb`,
`duelo-btn`, `nb-card`) ativas **durante** a migração e só remover após confirmar que o JS
não as usa (Etapa 8).

---

## 5. Header global e navegação

**Header** compartilhado, compacto (**64–72px**): `Logo TikPlay` à esquerda; à direita
`usuário · tipo da conta · sala · admin · ajuda · sair`.

**Navegação dos jogos** (Painel Streamer) — horizontal, um único componente `.tp-game-tab`
(nunca um botão diferente por jogo):

```
Conectar Live | Leitura de Chat | Alertas Sonoros | Palavra Secreta | Batalha |
Caça Palavras | Bichinho | 3 Dicas | Duelo 1x1
```

Barra: fundo preto/grafite, texto branco, divisores sutis, ícones, hover, **aba ativa amarela**.

---

## 6. Layout do Painel Streamer (obrigatório)

```
┌───────────────┬──────────────────────────────────┐
│               │ HEADER                           │
│               ├──────────────────────────────────┤
│     LOG       │ NAVEGAÇÃO DOS JOGOS             │
│     25%       ├──────────────────────────────────┤
│               │ CONTEÚDO DO JOGO                │
└───────────────┴──────────────────────────────────┘
```

- Log **à esquerda**, largura `clamp(300px, 25vw, 430px)`.
- Log **não acompanha** o scroll do conteúdo do jogo:
  ```css
  position: sticky; top: var(--tp-space-3); height: calc(100vh - var(--tp-space-6));
  ```
  (ou solução equivalente à estrutura real). Só a lista interna de mensagens rola (`overflow-y:auto`).
- O lado direito (conteúdo do jogo) é a única coluna que rola a página.

### Visual do log (console TikPlay)

- Fundo `#10151c`, fonte monoespaçada.
- Cores: timestamp azul-claro · `[OK]` verde · `[WARN]` amarelo · `[ERR]` vermelho ·
  sistema azul/ciano · evento de jogo coral · texto comum branco/cinza.
- Header fixo: `LOGS  V75` + botões `[Copiar Logs] [Limpar]`. Header não rola; só as mensagens.

---

## 7. Área de cada jogo (esqueleto comum)

```
game/
├── header      # título + status
├── status      # modo, cenário
├── controls    # [Ativar] [Desativar] [Reiniciar] [Salvar]
├── settings    # configurações do jogo
├── assets      # presentes/imagens
└── advanced    # opções avançadas
```

Evitar uma única caixa gigantesca. Sub-navegação **opcional** (reutilizável, sobretudo no Duelo):
`Presets | Assets | Áudios | Cenas | Regras` — criar **só a estrutura visual** primeiro.

**Tema por jogo:** cada jogo pode ter acento próprio sem sair da plataforma —
Duelo (azul/vermelho), Palavra Secreta (efeito tecnológico), 3 Dicas (particular). Prefira
sobrescrever tokens (`--tp-accent`) no escopo do jogo a redeclarar cores soltas.

---

## 8. Estrutura de arquivos alvo

```text
node/public/
├── ui/                        # Design System global (ETAPA 1–2)
│   ├── tikplay-theme.css      # tokens + fundamentos
│   ├── tikplay-layout.css
│   ├── tikplay-components.css
│   ├── tikplay-buttons.css
│   ├── tikplay-forms.css
│   ├── tikplay-tables.css
│   └── tikplay-responsive.css
├── shared/                    # header, navigacao, log-panel, modal, toast
└── games/
    ├── secret-word/  { index, game.js, game.css, config.js, assets/ }
    ├── three-hints/  { index, game.js, game.css, config.js, assets/ }
    ├── duel/         { index, game.js, game.css, config.js,
    │                   assets/{ characters/ scenes/ effects/ audio/ gifts/ } }
    ├── battle/  pet/  word-search/  ...
```

> **Não mover arquivos só para cumprir a estrutura se isso quebrar imports/rotas.**
> Primeiro inventário (§2) e migração segura, arquivo por arquivo, preservando os nomes
> usados pelo JS e as rotas do `server.js`.

---

## 9. Etapas de implementação (ordem obrigatória)

1. **ETAPA 1 — Tokens.** Criar `ui/tikplay-theme.css` (só tokens/fundamentos). Sem alterar telas.
2. **ETAPA 2 — Componentes globais.** `buttons/forms/tables/components` (`tp-*`).
3. **ETAPA 3 — Header + navegação global.**
4. **ETAPA 4 — Layout do Painel Streamer.** Implementar **LOG fixo à esquerda** (§6).
5. **ETAPA 5 — Aplicar ao Duelo 1x1** (tela mais completa, serve de referência).
6. **ETAPA 6 — Adaptar os outros jogos** progressivamente.
7. **ETAPA 7 — Aplicar ao Super Admin** (`admin.html`).
8. **ETAPA 8 — Remover CSS legado** que deixou de ser necessário.

> Critérios por etapa seguem §1–§8. Só avançar de etapa com a anterior validada.

---

## 10. Status / Progresso

- [x] **Fase 0** — Backup / versionamento (git) antes de qualquer alteração
- [ ] **ETAPA 1** — Tokens (`ui/tikplay-theme.css`)
- [ ] **ETAPA 2** — Componentes globais
- [ ] **ETAPA 3** — Header + navegação
- [ ] **ETAPA 4** — Layout Painel + LOG fixo à esquerda
- [ ] **ETAPA 5** — Duelo 1x1
- [ ] **ETAPA 6** — Demais jogos (Batalha, Caça Palavras, Bichinho, 3 Dicas, Palavra Secreta)
- [ ] **ETAPA 7** — Super Admin
- [ ] **ETAPA 8** — Limpeza do CSS legado

**Concluído:**

- 2026-10-17 — Caça Palavras: ações de iniciar/encerrar movidas para a mesma faixa do stepper de quantidade; em viewport estreita, os botões podem usar uma linha própria. IDs, handlers e estado desabilitado preservados.
- 2026-10-17 — Caça Palavras: contador de palavras trocado por botões de diminuir/aumentar, com valor central, limites visíveis e estado desabilitado nos extremos; seletores de participação e coordenadas ocupam toda a largura do card. O handler de início continua enviando a mesma contagem numérica (4–16). Nenhum evento ou log alterado/adicionado.
- 2026-10-17 — Caça Palavras: removido o divisor entre o progresso e as ações; a quantidade da próxima rodada ficou abaixo da barra e os seletores de participação foram expandidos à largura do card. O controle de quantidade foi posteriormente refinado para botões de diminuir/aumentar. IDs, handlers e limites 4–16 mantidos; sem novos eventos ou logs.
- 2026-10-17 — Caça Palavras no painel do streamer: controle com título fixo, estado em badge e progresso separado da quantidade de palavras; participação com switch padrão e resumo explicativo; “Tela pública” com abrir/copiar lado a lado. A interface deixou de mostrar a configuração de fonte OBS, preservando rotas/helpers técnicos. Mapa de observabilidade: nenhum evento ou log alterado/adicionado (ajuste de UX); validação cobre IDs/handlers preservados, script embutido e CSS responsivo.
- 2026-10-17 — Quiz Live: painel de controle, configurações, banco e histórico usando tokens `--tp-*`; overlay público responsivo com margens seguras para 9:16 e 16:9, narração com o TTS Edge padrão e atualização por WebSocket com confirmação de reprodução. Validados estado do jogo, gabarito oculto antes do fechamento, ranking e fluxo de perguntas. Testes: `node --test node/tests/quiz-live.test.js` (7 testes Node e 2 testes Python aprovados). Falta conferir a composição dentro do OBS/Live Studio nos quatro tamanhos previstos.
- 2026-10-17 — Caça Palavras público: composição vertical 9:16 com área segura, tabuleiro responsivo de células quadradas, instrução/progresso compactos, lista de palavras em duas colunas e ranking final enxuto. IDs, ações e eventos WebSocket existentes preservados. Mapa de observabilidade: nenhuma transição ou log alterado/adicionado; validação cobre página servida, sintaxe do script, prévia com rodada ativa e troca entre jogo/orientações.
- 2026-10-17 — Caça Palavras público: refinamento para live TikTok; acertos aparecem em aviso temporário com participante, palavra e coordenadas; tabuleiro sem nomes ou badges nas células; lista limitada aos quatro acertos mais recentes durante a rodada; ranking completo destacado no encerramento. Eventos e regras do jogo preservados.
- 2026-10-17 — Caça Palavras público ajustado como canvas 9:16 de altura fixa, sem rolagem vertical; orçamento de tela prioriza tabuleiro, usa safe areas configuráveis e aviso sobreposto em faixa reservada. Exibição durante a rodada inclui líder compacto; encerramento mostra apenas Top 3. Validação visual e métricas de viewport confirmaram scrollHeight igual a clientHeight em 720×1280 e 1080×1920, nos estados ativo e final.
- 2026-10-17 — Instruções do Caça Palavras simplificadas: o público pode enviar a palavra encontrada diretamente no chat; coordenadas seguem disponíveis como alternativa. Sem mudança de componentes visuais, eventos ou layout.
- 2026-10-17 — Formato de participação do Caça Palavras controlado no painel do streamer: palavra, coordenadas ou ambos. O backend persiste a escolha, valida apenas os formatos habilitados e atualiza as instruções públicas pelo estado existente `caca_state`; padrão preservado como ambos.
- 2026-10-17 — Super Admin → Dashboard (código pronto; ativação runtime pendente): estado atual do Monitor, serviços e credenciais claramente separados, incidentes ativos, uso e custo de APIs em faixas limitadas, créditos consumidos por modelo e receita bruta de pacotes aprovados. Após carregar a versão nova, chamadas de TTS, prévia admin, charada e 3 Dicas serão medidas sem conteúdo textual; custo estimado exige tarifa versionada e não reprecifica o passado. Resumos diário/semanal/mensal e projeção mensal parcial; refresh automático configurável e responsivo.
- 2026-10-17 — Super Admin → Integrações reúne OpenRouter, ElevenLabs, Mercado Pago, URL de checkout, pacotes de créditos, catálogo de vozes e catálogo global de presentes; status e testes de conexão ficam junto da configuração. Credenciais não são devolvidas à interface; o daemon Python sinaliza quando uma atualização do OpenRouter depende de reinício seguro.
- 2026-10-17 — Super Admin → Pacotes e Créditos separa o cadastro de pacotes das configurações de integração e centraliza ajustes manuais de saldo por streamer; listagem restrita ao admin, sem criar carteiras durante leitura, e remoção com confirmação e validação transacional para impedir saldo negativo.
- 2026-10-17 — Relatórios: gráfico de atividade passa a ocupar a altura disponível do card, com barras alinhadas ao espaço vertical; rolagem horizontal do intervalo por minuto usa scrollbar fina com tokens do tema streamer.
- 2026-10-15 — Login/cadastro: composição do site, botões compartilhados, campos e alertas com contraste escuro, layout responsivo e seleção de aba pelo caminho amigável. Contratos e lógica de autenticação preservados.

- 2026-10-17 — Sons → Narração: hierarquia voltada ao streamer, com estado geral alinhado à esquerda, voz padrão, voz expressiva, regras de leitura e créditos separados. Cards empilham quando a largura útil é inferior a 1100 px; sliders recuam seus extremos e alinham os marcadores aos pontos de ajuste. Autosave e contratos preservados; amplificação acima de 100% recolhida em ajuste avançado.
- 2026-10-17 — Sons → Narração: controle mestre compactado; cards acompanham a altura do conteúdo; saldo e unidade de créditos ficam na mesma linha, com a tarifa logo abaixo. Botões de teste têm largura igual e falhas de prévia usam estado de alerta legível. Contrato de logs já existente preservado, sem novos eventos.
- 2026-10-17 — Sons → Narração: badge de estado removida e ativação integrada ao toggle; estado de autosave aparece junto das abas; bloco de créditos resume saldo, tarifa e limite; valores da velocidade/volume alinhados aos controles; instrução de hashtags movida para baixo do teste; limite da amplificação aparece somente ao expandir.
- 2026-10-17 — Sons → Narração: ajustes finais de densidade no card padrão, exemplo de hashtag em snippet, rótulo do seletor simplificado e lista de pacotes oculta quando vazia; nenhum evento ou contrato alterado.
- 2026-10-17 — Sons → Narração: exemplo de hashtag convertido de snippet com aparência de campo para texto simples, com destaque só na tag.
- 2026-10-15 — Sons → Narração: preferências persistidas para habilitar a fala do chat, selecionar filtro e caractere; Edge TTS usa voz/velocidade compartilhadas com charadas. Fila serial e playback no painel respeitam prioridade de charada.
- 2026-10-16 — Sons → Narração: slider de volume de 0% a 300% persistido por conta; ganho aplicado às narrações TTS e prévias, inclusive durante áudio em execução. Alertas por presente não usam esse ganho. Teste auditivo e carregamento no processo atualizado pendentes.
- 2026-10-16 — Sons → Narração: configurações gerais organizadas na coluna esquerda; controles da voz adicional agrupados com o limite mensal na direita. Removido o cartão de status de áudio; instruções de efeitos sonoros ficam restritas à aba de alertas.
- 2026-10-16 — Sons → Narração: voz adicional e limite mensal agrupados dentro do cartão “Voz do narrador” em duas colunas responsivas; a aba Narração expande o cartão para a largura do conteúdo.
- 2026-10-16 — Sons → Narração: escala do controle ajustada para 0% à esquerda, 100% no centro e 300% à direita; voz adicional e limite mensal exibidos novamente na lateral direita.
- 2026-10-16 — Sons → Narração: controles agrupados visualmente em “Voz e reprodução” e “Narração do chat”; botão de teste movido junto aos controles de voz, toggle à direita e informação sobre charadas compactada. IDs e handlers mantidos.
- 2026-10-16 — Sons → Narração: seção “Narração do chat” movida para o início do cartão para priorizar o controle de leitura em voz alta; IDs e salvamento automático preservados.
- 2026-10-16 — Sons → Narração: seletores com seta personalizada e menu escuro; foco e hover destacados sem remover o indicador de teclado.
- 2026-10-16 — Admin SaaS → Configurações globais: administrador libera vozes específicas por tipo/modelo; streamer escolhe apenas uma voz da lista aprovada. Seletor de modelo removido do painel do cliente.
- 2026-10-16 — Admin SaaS → Configurações globais: botão de prévia individual por voz, com amostra fixa e reprodução no navegador antes de liberar a opção aos clientes.
- 2026-10-16 — Painel Streamer: campos de texto e seletores compartilham altura, borda, fundo, raio, fonte e seta; estilos responsivos compactos e exceções de controles especializados preservados.
- 2026-10-16 — Painel Streamer: menus de seleção substituem o pop-up nativo do Windows por lista no tema TikPlay, com seleção/hover ciano, rolagem e suporte a teclado; select nativo oculto preserva IDs, opções, valores e eventos usados pelo código.
- 2026-10-16 — Sons → Narração: alinhamento superior e altura igual aplicados aos campos “Comentários narrados” e “Caractere de filtro”; removido o efeito da margem global sobre essas colunas.
- 2026-10-16 — Créditos de voz: carteira persistente com histórico, tarifas editáveis por modelo e por 100 caracteres, pacotes configuráveis no admin, checkout avulso Mercado Pago e crédito automático após confirmação idempotente do webhook. Painel streamer informa saldo, tarifa atual, pacotes e movimentações.

- 2026-10-15 — Sons → Narração: removido o card informativo duplicado "Prévia da narração"; controles e botão real de teste preservados.

- 2026-10-15 — Sons → Narração: painel lateral "Limite de voz adicional" apresenta consumo mensal usando os dados de quota existentes; créditos aparecem como prévia visual indisponível, sem integração de recarga ou alteração do backend.

- 2026-10-15 — Sons → Narração: removida a frase explicativa sob o botão de teste; limite permanece apresentado no cartão lateral.

- 2026-10-15 — Charada pública: narração/controles de áudio removidos da página do jogo; texto preservado. O painel mantém voz, velocidade, reprodução automática e replay.

- 2026-10-15 — Jogo Contexto público: card de charada sem reprodução de áudio; removidos controles/indicador TTS, mantendo texto e fechamento.

- 2026-10-15 — Sobreposição Dragonwilds integrada à aba Sobreposições: dois exemplos lado a lado e seletor Diamantes/Curtidas que direciona setas e escala para cada fonte. Rankings dinâmicos usam likes ao vivo e agregados de gifts por `room_id`; itens mostram avatar, nome e @TikTok. Cada ranking tem posição/escala livres e independentes; link OBS inclui ambos os layouts. Sem alterações no backend; armazenamento local por conta no navegador.

- 2026-10-14 — Jogo Contexto público (`/contexto`) + site institucional na raiz do apex. Palavra do dia por navegador/data; ilimitado com novas palavras após acerto, sem repetir acertos guardados localmente. Sem tamanho/revelação; palavra exibida só após acertar.

- 2026-10-14 — Central de Ajuda e Suporte: hub do streamer, busca/categorias/artigos públicos, chamados com conversa e anexos via fetch autenticado, sugestões, e gestão administrativa de fila, status, respostas rápidas, categorias e artigos Markdown.

- 2026-10-14 — 3 Dicas: estrutura e tema alinhados à referência em `ui/tikplay-threedicas-model.css`. Ranking continua vindo do serviço, resumo lateral reflete os valores configurados, presentes mantêm busca/seleção funcional e destino técnico continua usando link autenticado por sala. Controles usam a folha compartilhada de botões.

- 2026-10-14 — Painel Streamer e Super Admin: botões de ação usam uma folha compartilhada para tamanho, tipografia, cores semânticas, hover, clique, indisponibilidade e foco. Mantidos os fundos neutros adequados a cada tema.

- 2026-10-12 — CORDA: áudios fornecidos integrados; trilha em loop com liga/desliga e volume, efeitos por entrada em movimento/pressão/vitória com volume próprio. Ajustes persistentes durante a partida e botão para liberação de autoplay no navegador.

- 2026-10-12 — CORDA: seleção de presentes refinada conforme Duelo: blocos por equipe, busca individual, nome original no campo, tradução + original nas sugestões, foto de 24px, moedas e opção Ativo. Seleção e salvamento verificados no navegador.

- 2026-10-12 — CORDA: seleção de presentes alinhada ao Duelo com busca por nome PT/EN/ID, sugestões com foto e moedas, seleção por clique ou setas/Enter. IDs e persistência preservados.

- 2026-10-12 — CORDA: fotos superiores usam /gift-images/ para os arquivos da biblioteca; texto dos nomes removido da exibição, mantido somente em acessibilidade/tooltip.

- 2026-10-12 — CORDA: caixas inferiores de presentes preservadas e ocultadas; fotos maiores dos presentes configurados posicionadas nas laterais superiores, com zoom suave de 4 segundos e respeito a movimento reduzido.

- 2026-10-12 — CORDA: controles alinhados à densidade do painel TikPlay via variante compartilhada tp-admin-controls: títulos compactos em caixa alta, botões/campos de 13px, cards com sombra e grids responsivos de 3/2/1 colunas. Tela pública preservada.

- 2026-10-12 — CORDA: iframe do painel com altura automática via ResizeObserver/postMessage validado por origem e janela; rolagem interna removida para usar apenas a rolagem do painel, inclusive ao adicionar presentes ou mudar a largura.

- 2026-10-12 — CORDA: prévia da arena oculta no painel; controles usam a largura disponível e links públicos preservados.

- 2026-10-12 — CORDA: banners existentes azul-ganhou.png/vermelho-ganhou.png exibidos no resultado após a queda; ocultados na rodada seguinte, reinício e parada.

- 2026-10-12 — CORDA: balanço suave contínuo durante a disputa (amplitude de 2,5 unidades da cena, ciclo de aproximadamente 7 segundos), somado ao tremor de pressão alta; preservadas pegadas da corda e preferência de movimento reduzido.

- 2026-10-12 — CORDA: nomes visíveis AZUL/VERMELHO; placar com escala padrão de 82%, controles persistentes de X/Y/escala com ajuste durante a partida; presentes por equipe em caixas próprias na tela pública, sem restaurar a faixa inferior de instrução.

- 2026-10-12 — CORDA: faixa inferior de instrução de equipe e contagem de curtidas ocultada a pedido do usuário; elementos e atualizações preservados.

- 2026-10-12 — CORDA: placar reorganizado com cronômetro no cabeçalho, nomes/vitórias por equipe, barras próprias de progresso de TAP e barra central exclusiva para a posição da corda.

- 2026-10-12 — CORDA: placar no estilo escuro/dourado do Duelo 1x1; entrada e troca de equipes pelo chat com balões de nome/avatar; bolhas e +TAP por equipe. Painel com contagem de participantes e opções persistentes de exibição dos dois efeitos. Alteração solicitada pelo usuário; animação existente da disputa preservada.

- 2026-10-12 — CORDA: nova tela de duelo com cenário fixo, deslocamento conjunto, poses e efeito em quem recebe o puxão; controles no painel via iframe isolado. Componentes `tp-*` compartilhados e tokens adicionais. Ampliação funcional autorizada pelo usuário nesta sessão; não altera as mecânicas do Duelo existente. Validação registrada em `docs/corda.md`.

- 2026-10-12 — Palavra Secreta pública: letras em linha única centralizada; largura e fonte reduzidas apenas quando excedem o quadro, com espaçamento adaptativo e altura preservada. Validação de 4 a 20 letras em viewports de 1280, 640, 375 e 320; sem alterações de backend.

- 2026-10-12 — Slot de próximo palpite ocultado ao renderizar resultado final e reativado no início da nova partida.

- 2026-10-12 — Movimento de saída do palpite repetido aplicado diretamente ao card: desliza 110% para a direita em 550 ms, dentro do recorte do slot.

- 2026-10-12 — Saída de palpite repetido desliza para a direita com fade, recortada pelo espaço reservado para respeitar suas margens.

- 2026-10-12 — Slot de palpite identificado como PRÓXIMO PALPITE; animação local limitada ao slot, sem escala ou deslocamento lateral, usando fade para entrada e saída.

- 2026-10-12 — Linha fixa reservada para novos palpites; repetidos recebem etiqueta REPETIDA e saem pela direita sem inserir outra palavra. Novos mantêm animação para a posição ordenada.

- 2026-10-12 — Cores de resultado corrigidas: vitória em azul/verde e encerramento sem vencedor em vermelho, preservando dimensões e estados.

- 2026-10-12 — Segundo teste de paleta: grafite neutro sem matiz azul, fundo #121212 e cards #292929, mantendo medidas. Primeira paleta salva em `docs/layout-backups/2026-10-12-contraste-01/palette-01-azulada.css`.

- 2026-10-12 — Teste reversível de paleta da Palavra Secreta: fundo quase preto, cards grafite azulado e texto secundário mais claro, sem mudanças de dimensões. Override isolado em `ui/secret-word-palette.css`; backup em `docs/layout-backups/2026-10-12-contraste-01`.

- 2026-10-12 — Ranking lateral mais compacto: avatar de 24px, espaçamento vertical de 4px e nomes de 16px para exibir mais participantes; vitórias mantidas à direita.

- 2026-10-12 — Refinamento do ranking lateral: foto, nome e vitórias à direita em linha única, com detalhe chanfrado à esquerda no top 3 inspirado na V2 de taps.

- 2026-10-12 — Ranking lateral com avatar, nome e vitórias abaixo; medalha removida e pódio identificado por bordas ouro/prata/bronze nos três primeiros. Ordenação, dados e largura preservados.

- 2026-10-12 — @ dos participantes nos palpites com peso 600 (seminegrito), preservando tamanho e layout.

- 2026-10-12 — Refinamento dos cards laterais da Palavra Secreta: bordas em grafite (`--tp-black-3`) substituem o contorno claro, mantendo tipografia e contraste do conteúdo.

- 2026-10-12 — Ajuste pontual autorizado de legibilidade da Palavra Secreta: coluna lateral de 17rem, títulos/valores de 1rem, nomes de 1.125rem e contraste reforçado; preservados IDs, estados e lógica. Tokens de §3 materializados em `ui/tikplay-theme.css`, sem iniciar a migração geral do tema.

- 2026-10-12 — Inventário/diagnóstico visual completo (§2) + tokens preliminares (§3) + governança (este doc, `REGRAS_DO_PROJETO.md`, `AGENTS.md`).
- 2026-10-12 — Versionamento: repo guarda-chuva na raiz + `jogo-contexto` como submódulo do TikPlay.
- 2026-10-12 — Plano de separação estrutural documentado com evidência em `docs/separacao-estrutural.md`
  (Fase A-1 iniciada: utilitários Python extraídos p/ `service_common.py`).

### Acompanhamento por arquivo

| Arquivo | Tokens | Componentes | Layout | Concluído |
|---|---|---|---|---|
| `ui/tikplay-theme.css` | — | — | — | não criado |
| `control-panel.html` | não | não | não | não |
| `duelo.html` | não | não | não | não |
| `admin.html` | não | não | não | não |
| `web-game.html` + `style.css` | não | não | não | não |

---

## 11. Regras rígidas (checklist de PR visual)

- [ ] Nenhum hex/px “solto”: usa token.
- [ ] Nenhum botão/card novo fora dos `tp-*`.
- [ ] IDs, classes usadas por JS, rotas, eventos e nomes de evento **preservados**.
- [ ] `focus-visible` presente; nada de remover outline sem substituto.
- [ ] `aria-label` em botões só-ícone.
- [ ] `z-index` só via `--z-*`.
- [ ] Sem `!important` novo desnecessário.
- [ ] Sem animação constante em controles administrativos (microinterações discretas: `translateY(-1px)` hover, `translateY(1px)` active, `transition:120ms ease`).
- [ ] Bootstrap carregado antes de `ui/*`.

- 2026-10-13: CORDA destaca a disputa na barra maior com marcador dourado/branco. Curtidas ficam abaixo em barras finas, corações pulsantes e preenchimento gradual com confirmação da meta antes do reinício. Aviso público para aguardar o início; movimento reduzido respeitado.

- 2026-10-13: Barras de TAP do CORDA ampliadas para 8–12px, com contagem e corações maiores para leitura na live.

- 2026-10-13: TAP usa aproximação exponencial independente do FPS; lotes pequenos também animam gradualmente, em vez de terminar em um ou dois quadros.

- 2026-10-13: CORDA remove título e textos de formato/vitórias do placar público; cronômetro maior centralizado entre as equipes. Formato de partida e contadores preservados.

- 2026-10-13: Relógio e contadores CORDA alinhados verticalmente; pontuações maiores em branco sobre fundo escuro com bordas da equipe.

- 2026-10-13: Tela pública e botões demo CORDA em maiúsculas; rótulos de curtidas e incrementos visuais apresentados como ENERGIA.

- 2026-10-13: Menções a disputa/duelo removidas dos status e descrições acessíveis da cena pública CORDA; mensagens de energia e movimento.

- 2026-10-13: TAP público rotulado FORÇA; conclusão mostra equipe e força enviada. Impacto visual disparado por metas e combos superiores a x10 sem modificar a força aplicada.

- 2026-10-13: Cliente CORDA garante impacto visual para corda_pull de origem tap, inclusive quando o serviço ainda em execução envia impulse=false.

- 2026-10-13: Barras de FORÇA com brilho direcional recortado ao preenchimento, avançando rumo à meta (azul à direita, vermelho à esquerda); respeita movimento reduzido.

- 2026-10-13: Aviso ENVIEM FORÇA TIME! no lado da equipe atrás, com pulsação suave. Exibe após 15 pontos de diferença e oculta abaixo de 8 para evitar piscar próximo do empate; somente rodada ativa.

- 2026-10-13: Chamado FORÇA menor em cartão compacto com raio e faixa lateral; aparece por 2s ao entrar em forte pressão (>50), sem repetir enquanto ela persistir. Rearma abaixo de 45.

- 2026-10-13: Chamado de forte pressão recomposto como lettering luminoso em duas linhas, na cor da equipe, acima dos personagens; sem caixa ou emoji, com traço luminoso inferior.

- 2026-10-13: Acabamento do placar CORDA integrado à arena: cantos retos, borda fina, linha superior azul/branco/vermelho e brilho lateral discreto por equipe; contraste dos contadores preservado.

- 2026-10-13: Aviso de espera CORDA alinhado ao acabamento do placar, acima dos personagens; oculto na carga inicial, desconexão, painel e jogo ativo.

- 2026-10-13: Cada foto de presente cadastrado recebe +FORÇA acima, com lettering luminoso na cor da equipe seguindo o chamado +FORÇA TIME!.

- 2026-10-13: Preparação CORDA com contagem e instrução de entrada no aviso existente; campos de participação no painel e balão de compartilhamento identificado.

- 2026-10-13: Preparação com contagem destacada e instrução em dois passos: escolha a equipe no chat (AZUL/VERMELHO coloridos) e curta para enviar força.

- 2026-10-13: Controle independente de meta ao vivo no painel CORDA e status breve META ATUALIZADA na cena.

- 2026-10-13: Campo duplicado de meta removido das regras; ajuste concentrado no cartão independente Meta de FORÇA da barra.

- 2026-10-13: Vitória intermediária em lettering luminoso ascendente por 2,5s; vitória completa reservada ao final em melhor de 3/5 ou a cada rodada no infinito.

- 2026-10-13: Presentes por equipe alternam em slide de 3,5s; cadastro Puxão dispara impacto visual e muda legenda para PUXÃO, preservando força proporcional.

- 2026-10-13: Balão de entrada CORDA com cantos retos, fundo do placar, faixa e brilho da equipe; identidade do participante e chamada de entrada preservadas.

- 2026-10-13: Slide de cada equipe inclui item padrão com coração na cor do time e chamada TAP AUMENTA / FORÇA!, inclusive sem presentes.

- 2026-10-13: Pontos de encaixe da corda nas poses do novo personagem vermelho recalibrados para as mãos em neutro/puxando/pressão; corda permanece desenhada atrás do personagem.

- 2026-10-13: Presentes que disparam impacto sobem balão com foto/nome do remetente e ENVIOU PUXÃO na cor da equipe.

- 2026-10-13: Switch Modo Boss no bloco Palavra Secreta, seguindo controles existentes; hidratação, detecção de alteração e salvamento automático via boss_mode.

- 2026-10-13: Usuário TikTok bloqueado ao solicitar conexão; bloqueio preservado em tentativa/erro e refresh da aba, liberado somente por desconexão confirmada.

- 2026-10-13: CORDA promovido de Mais jogos para botão próprio no menu principal, com ícone de corda e comportamento/permissões preservados.

- 2026-10-13: Sobreposições recebe ranking de curtidas V2/V3, seleção de 1–10 participantes e links públicos OBS; visuais preservados e dados reais via snapshot/WebSocket existentes.

- 2026-10-13: Sobreposições V2/V3 exibem prévia de três participantes fictícios claramente identificada; links públicos continuam com dados reais.

- 2026-10-13: Cards de overlays V2/V3 lado a lado com prévias compactas sem escala de iframe; tipografia legível e seletor de quantidade com largura reduzida.

- 2026-10-13: Prévias V2/V3 limitadas a 400px de largura; cenário CORDA substituído pelo arquivo fornecido cenario-hallowen.png, com versão de cache atualizada.

- 2026-10-13: Overlays V2/V3 recebem brilho suave periódico nos avatares/pódio; V2 também nas bordas das linhas. Animações escalonadas, sem cobrir texto e desativadas com movimento reduzido.

- 2026-10-13: Fotos reais dos overlays contidas no slot circular; atualizações de contagem preservam DOM e animações, coração do líder pulsante e borda dourada V2 animada.

- 2026-10-13: Bloco V2 limitado a 380px, com nomes longos truncados e adaptação a fontes menores.

- 2026-10-13: Super Admin adota, por solicitação explícita do usuário, o tema escuro/ciano de `Site/styles.css`, isolado em `ui/tikplay-admin-site.css`. Navegação por seções, resumo de contas, busca/filtro e quatro indicadores de uso preparados para o backend. Contrato em `admin-status-frontend.md`; validação desktop/mobile com dados simulados, sem alterações de backend.

- 2026-10-13: Contraste das tabelas do Super Admin reforçado: cabeçalho destacado, linhas alternadas mais claras, divisórias visíveis, texto claro, hover e badges de status com fundo/borda semânticos. Indicadores de uso ampliados para leitura.

- 2026-10-13: Dashboard como seção inicial do Admin, com clientes online, lives conectadas, partidas em andamento, uso por jogo e atividade dos clientes. Atualização manual, busca e acesso à conta; dados ausentes não inferem offline. Frontend validado com API simulada em desktop/mobile; histórico depende do backend.

- 2026-10-13: Nova sobreposição de curtidas flutuantes, com fundo transparente, corações e avatares animados; evento individual de curtida inclui espectadores fora do ranking e filtros de pontuação, prévia demonstrativa disponível no painel.

- 2026-10-13: Legibilidade do ranking V3 reforçada para cenários de live variáveis, com contorno/sombra escura e reticências em nomes longos; nome completo preservado como título e rótulo acessível.

- 2026-10-13: Painel de Sobreposições organiza as prévias V2/V3 ao lado dos respectivos botões de posição e escala, com orientação para configurar a origem no TikTok Live Studio na resolução de saída da live; ajustes são salvos por streamer e enviados em tempo real às fontes abertas.

- 2026-10-13: Quantidade exibida de participantes configurável separadamente para V2 e V3; cada escolha acompanha a posição e escala salvas por versão, atualiza a prévia e a fonte aberta em tempo real.

- 2026-10-14: Super Admin recebe Monitor de Servidor nativo em `admin.html`, usando a sidebar com glifos da referência e CSS isolado. O monitor consome o contrato existente por polling + SSE autenticado via ticket, sem iframe, rotas adicionais ou dados demonstrativos; inclui wallboard, histórico de incidentes e ações administrativas de reconhecer, resolver e silenciar alertas.

- 2026-10-14: Dashboard, Usuários, Convites, Regras globais e Operação local padronizados com cabeçalhos, campos, cartões, tabelas, ações e estados responsivos no tema do Super Admin; IDs e comportamento existentes preservados.

- 2026-10-14: Tabela de Usuários refinada com colunas dimensionadas, atividade em grade label/valor, datas de criação e última atividade no mesmo formato pt-BR e ações com altura, espaçamento e hierarquia visual unificados.

- 2026-10-14: Ações da tabela de Usuários condensadas em botões quadrados somente com ícones (status, senha e edição), com tooltip e rótulo acessível por conta; largura da coluna reduzida.
- 2026-10-14: Tabela de Usuários ajustada após validação visual: coluna “Uso atual” ampliada e valores mantidos em linha única com reticências para evitar quebra e desalinhamento; data e ações preservadas.
- 2026-10-14: Ações da tabela de Usuários isoladas do padding horizontal do sistema compartilhado de botões; ícones mantêm caixas quadradas de tamanho fixo e a coluna tem largura para as três ações.
- 2026-10-14: Posição X/Y/escala dos rankings V2/V3 separada da orientação foto/nome em um contêiner externo; selecionar foto à direita reorganiza apenas as linhas e preserva a posição configurada na tela OBS. Assets versionados para invalidar cache.
- 2026-10-14: Nomes longos nos rankings V2/V3 limitados a uma linha com reticências dentro da coluna disponível; nome integral preservado em tooltip e rótulo acessível.
- 2026-10-14: Quantidade de participantes dos rankings V2/V3 controlada pela preferência salva no painel, não pelo link. Prévia atualiza por postMessage sem recarga; fonte pública carrega a configuração antes do ranking e recebe mudanças ao vivo por WebSocket.
- 2026-10-14: Relatórios do streamer exibem níveis de fã-clube e presenteador por participante (global ou por live selecionada) e permitem filtrar/detalhar subidas de nível no histórico de interações.

> 2026-10-16: Consulta do catálogo de palavras no Super Admin compactada com métricas em faixa, filtros alinhados, lista com rolagem interna e cabeçalho fixo, e importação recolhível. Busca, paginação e ações preservadas.

> 2026-10-16: Gestor de vozes do Super Admin identifica opções em português brasileiro (PT-BR), mostra o idioma ao lado da voz e informa que o catálogo está filtrado por essa variante.

> 2026-10-16: Gestor de vozes do Super Admin compactado em cards responsivos, com quatro colunas em telas largas, três em médias, duas em tablets e uma em celulares.

> 2026-10-16: Cards de voz ajustados ao padrão visual do Monitor de Servidor: fundo escuro em gradiente, borda discreta e tipografia neutra; grade compacta preservada.

> 2026-10-17: Carteira de narração apresentada como TikCoins, com tarifas inteiras por 150 caracteres, arredondamento para cima por mensagem e estimativa antes do envio; carteira e histórico existentes preservados durante a migração.

> 2026-10-17: Caça Palavras mantém a página pública sempre no tabuleiro e remove o menu de alternância jogo/ranking/ajuda. O painel controla por conta se o ranking da rodada aparece ao finalizar; estado, espaçamento e visual do tabuleiro preservados.

> 2026-10-17: Quiz Live → corrigido o seletor de temas do painel para interpretar o formato de tuplas retornado pela API; nomes e seleção voltam a aparecer sem alterar o contrato do endpoint.

> 2026-10-17: Quiz Live → painel reorganizado em Controle, Configurações, Banco de perguntas e Histórico; temas compactos, seções de configuração, presets de margem com prévia e biblioteca paginada com filtros e editor em diálogo. Contratos, handlers, validações, salvamento explícito e regras do jogo preservados.

> 2026-10-17: Quiz Live público → identidade de game show TikPlay e estados visuais separados para espera, pergunta, revelação do gabarito, ranking parcial e encerramento com pódio. Layout responsivo, áreas seguras e movimento reduzido preservados; sem mudança em API, pontuação ou observabilidade. O contrato público não fornece nomes/contagem de acertos por rodada.

> 2026-10-17: Quiz Live público → legibilidade priorizada: card claro uniforme, enunciado escuro sem sombra, alternativas com texto escuro e relógio menos dominante. Tamanho mínimo de fonte ajustado para leitura vertical; lógica e contratos preservados.

> 2026-10-17: Quiz Live público → corrigido contraste em todos os estados: cartões claros só na pergunta/alternativas; resultado, espera, selo da rodada e rodapé usam superfícies escuras com texto claro. Sem alteração de lógica ou API.

> 2026-10-17: Quiz Live → Banco global no Super Admin e biblioteca do streamer separada por catálogo oficial e perguntas particulares, com origem configurável da partida, importação revisável, filtros, métricas de uso e layout responsivo alinhado aos sistemas existentes.
