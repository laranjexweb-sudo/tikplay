# Inventário e organização dos painéis TikPlay

Levantamento feito em 12/10/2026 a partir do código em `F:\Programação\Jogo TikTok\jogo-contexto`, das regras do projeto e do histórico local do ChatGPT sobre o TikPlay. Este documento organiza o que já existe e propõe a navegação; não altera nem implementa funções.

## Painel do streamer

Os cinco menus principais indicados pelo usuário são: **Conectar Live**, **Leitura de Chat**, **Alertas Sonoros**, **Palavra Secreta** e **3 Dicas**. O HTML atual já tem quatro deles com esses nomes; hoje a navegação possui nove abas, pois também expõe Batalha, Caça Palavras, Bichinho e Duelo 1x1 (`node/public/control-panel.html`, linhas 262–270).

### Funções existentes agrupadas nos cinco menus

| Menu | O que já existe | Organização sugerida |
|---|---|---|
| **Conectar Live** | Usuário TikTok; escolha entre TikTokLive e Tik.Tools; chave Tik.Tools opcional; conectar/desconectar; estado da conexão, Room ID e taxa da API. | Manter somente os dados e ações da conexão. Mostrar estado atual de forma persistente no cabeçalho. |
| **Leitura de Chat** | Comentários chegam ao sistema e aparecem no log. Há filtros globais por seguidores e Heart-me; configuração de voz, velocidade e botão de teste. Porém o próprio painel informa que o chat não é narrado: o áudio TTS existente é usado para a Charada da Palavra Secreta. | Reunir aqui leitura/eventos do chat e filtros. Tratar leitura por voz das mensagens como lacuna a confirmar, sem prometer que já funciona. Manter a voz da Charada dentro de Palavra Secreta ou como opção compartilhada claramente identificada. |
| **Alertas Sonoros** | Áudio associado a presentes, com slots normal/combinação; áudio de conexão; envio e remoção de arquivos; reprodução quando o presente correspondente chega. A API de alertas é autenticada e ligada à conta (`control-panel.html`, a partir da linha 1320; `server.js`, a partir da 1039). | Separar lista de presentes e áudio, com nome/ícone do presente, áudio configurado, controles de envio/troca/remoção e indicação de combinação. |
| **Palavra Secreta** | Início de partida e ações manuais; dicas e charadas; ranking da rodada/live/semanal; presente revelador, presentes de dica/tamanho/primeira letra; prefixo de palpite; rodada automática e intervalo; meta de taps; roleta de presentes; filtros de jogadores; histórico; links públicos do jogo e ranking. | Dividir em blocos: Partida ao vivo; Regras e participação; Presentes e dicas; Automação; Histórico e tela OBS. Ações destrutivas ou de encerramento ficam separadas das ações frequentes. |
| **3 Dicas** | Iniciar, pausar, parar e resetar; configurar dicas progressivas; presentes para revelar tamanho e primeira letra; ingresso/passe para liberar o chat; apoiador/multiplicador; ranking semanal; testes visuais de dicas, presentes, resultado e tempo; link da tela pública. | Organizar em Partida; Três etapas e presentes; Participação/passe; Ranking; Testes e tela OBS. |

### Outros jogos já implementados

O painel atual também oferece **Batalha** (tap × moeda, rodadas, rankings e histórico), **Caça Palavras** (grade, configuração, início/parada, revelação e respostas), **Bichinho Virtual** (mascote, modo assistente e invocação de boss) e **Duelo 1x1** (partidas, cenários, presentes, apoios, áudio/música e controles). Eles continuam sendo funções existentes. A proposta de cinco menus ainda precisa definir como esses quatro jogos ficarão acessíveis — por exemplo, como opções de jogos adicionais dentro de uma área secundária.

### Elementos compartilhados

- Cabeçalho atual: identidade TikPlay, usuário/role/sala, plano/assinatura, acesso admin, sincronização do catálogo de presentes, ajuda e sair.
- Log em tempo real: copiar, limpar, filtrar por jogo/nível e acompanhar eventos. O CSS atual usa uma divisão aproximada 75%/25%; a amostra histórica põe o log à direita. A orientação escrita do usuário pede **log fixo à esquerda, ocupando cerca de 25% da largura**, e essa deve guiar a proposta nova. O painel do log fica fixo; o conteúdo interno do log mantém sua própria rolagem para permitir consultar eventos anteriores.
- Links das telas públicas/OBS ficam nas seções do jogo correspondente, com cópia rápida.

## Painel Super Admin (administração SaaS)

O Super Admin atual é uma página única longa (`node/public/admin.html`). As funções verificadas são:

| Grupo proposto | Funções atuais |
|---|---|
| **Contas e permissões** | Listar, criar e editar contas; nome, e-mail, senha, plano, papel (usuário/admin), TikTok e chave Tik.Tools; ativar/desativar conta; redefinir senha; liberar ou bloquear recursos por conta. |
| **Convites** | Gerar convite de uso único, definir validade, copiar link, revogar e ver status (ativo, usado, revogado ou expirado), data de criação/expiração e quem usou. |
| **Regras globais dos jogos** | Manter palavras banidas que valem para Palavra Secreta e 3 Dicas para todos os clientes. |
| **Operação local** | Controlar geração automática de contextos, configurar intervalo, quantidade de palavras e limite; acompanhar progresso, palavra atual, erros e log. |

A tabela de contas mostra nome, e-mail, papel, status, plano, TikTok, sala e data de criação. **Não há no `admin.html` uma área para administrar pagamentos, assinaturas ou catálogo de planos**, embora o painel do streamer tenha tela de assinatura e o servidor possua rotas de cobrança/checkout. Se isso fizer parte do Super Admin desejado, será uma função nova a especificar.

A proposta visual é transformar a página longa em navegação por grupos — **Contas**, **Convites**, **Regras globais** e **Operação local** — mantendo ações de conta junto à tabela/detalhe da conta. Um resumo SaaS só deve ser incluído se métricas e ações forem definidas, pois o código atual não oferece esse dashboard.

## Direção visual e refatoração

A documentação local aprova uma identidade **geek/arcade para streaming e SaaS**, com fundo off-white quente, cartões brancos bem delimitados, contorno escuro, sombra curta, amarelo TikPlay como destaque, verde para sucesso, vermelho/coral para parar/remover, azul para informação e navegação grafite. A amostra anexada ao histórico mostra botões de alto contraste e estado selecionado amarelo; a barra de menus atual usa esse padrão. Preservar a personalidade e compactar os cartões e áreas longas.

Recomendações derivadas do código e das regras existentes:

1. Usar `node/public/ui/tikplay-theme.css` para tokens de cor, espaçamento, raio, tipografia e foco. O arquivo já existe e contém os tokens base.
2. Criar/aplicar componentes compartilhados `tp-*` para cartões, botões, campos, abas, badges e tabelas. Hoje convivem `btn-nb`, Bootstrap e `duelo-btn`, além de estilos inline.
3. Padronizar a semântica dos botões: amarelo para ação principal/seleção; verde para iniciar/salvar/confirmar; vermelho para parar/excluir; grafite para ação secundária; neutro para ações auxiliares. Manter tamanhos, foco, hover, pressionado e desabilitado coerentes.
4. No painel streamer, manter o log fixo na coluna esquerda de aproximadamente 25% e o conteúdo operacional à direita. Em telas estreitas, reordenar ou recolher essa coluna sem cortar os controles.
5. No Super Admin, priorizar tabelas legíveis e filtros/ações por linha; formulários de criar/editar devem ocupar uma área própria, evitando campos espalhados na página.
6. Preservar IDs, rotas, permissões, eventos, WebSockets, APIs e comportamento. O projeto exige JavaScript embutido nos HTMLs; não extraí-lo como parte desta etapa visual sem uma decisão específica.

### Estado dos arquivos de tema

`docs/DESIGN_SYSTEM.md` registra identidade, diagnóstico e fases; `REGRAS_DO_PROJETO.md` torna o tema e a preservação funcional obrigatórios. Existe uma divergência de manutenção: a seção de progresso ainda marca tokens e `ui/tikplay-theme.css` como não criados, embora o arquivo esteja presente e contenha tokens de tema. Atualizar esse status antes de usar o checklist como registro de progresso.

## Pontos a confirmar antes de implementar

1. Os quatro jogos adicionais devem ficar numa área secundária/“outros jogos” mantendo os cinco menus principais, ou devem continuar como abas principais?
2. “Leitura de Chat” significa exibir/filtrar comentários no painel, narrar mensagens por voz, ou ambos? Hoje os comentários alimentam o log, mas a narração por voz do chat está explicitamente desligada.
3. O Super Admin deve ganhar gestão de assinaturas e pagamentos ou, por enquanto, só reorganizamos as funções já existentes?

## Evidências principais

- `node/public/control-panel.html`: navegação (262–270), conexão e filtros (286–373), alertas (376–381), Palavra Secreta (387 em diante), 3 Dicas (aprox. 795 em diante), tabs de outros jogos (266–270).
- `node/public/admin.html`: palavras banidas, convites, contas, recursos por usuário e geração local de contextos.
- `node/server.js`: rotas `/api/admin/*`, `/api/sound-alerts`, `/api/plans` e `/api/billing`.
- `node/public/ui/tikplay-theme.css`, `docs/DESIGN_SYSTEM.md`, `REGRAS_DO_PROJETO.md`.
- Histórico e capturas locais do painel: `F:\Codex\Projetos\TikPlay\historico-chatgpt\conversas\02-painel-de-controle-tikplay.md` e pasta `anexos/6acc7664-0c50-83e9-a714-0488857b5c47/`.
