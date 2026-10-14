# Painel streamer: modelo fornecido

Referencia solicitada pelo usuario:
`F:\Programação\Jogo TikTok\Site\tikplay-admin-new\tikplay-admin-new`.

`ui/tikplay-streamer-reference.css` reproduz o CSS original do modelo.
`ui/tikplay-streamer-model.css` adapta os controles existentes, preservando
IDs, rotas, eventos e permissoes. Inter e Space Grotesk sao carregadas com a
mesma URL de fontes da referencia.

O Dashboard e a tela inicial quando nao houver aba salva ou hash solicitado.
A navegacao existente fica no menu lateral. O log completo fica no console,
com filtros, copia e limpeza preservados; a visao geral mostra suas ultimas
linhas. Menu e console fecham por botao, fundo ou Escape.

Dados reais do Dashboard:
- Conexao: status recebido pelo painel e snapshot existente.
- Curtidas: soma do ranking retornado em game-state; nao e uma estimativa.
- Presentes: quantidades dos eventos recebidos desde a abertura do painel,
  sem alegar historico anterior.
- Jogos: estados das APIs existentes (Palavra Secreta, 3 Dicas, Batalha,
  Caca Palavras, Duelo, Bichinho e CORDA), respeitando recursos liberados.
- Links/preview: gerados pela rota room-link existente, usando token publico.

Consulta de Dashboard a cada 15 segundos enquanto visivel. Cards de atalho
respeitam a permissao da aba correspondente. Jogos indisponiveis para o
cliente nao sao consultados. Configuracoes e acoes reais permanecem nas
secoes existentes. Nao foram copiados os numeros ficticios da referencia.

CORDA carrega o novo tema somente no modo de controle; a cena publica nao
carrega estas folhas de estilo. Os demais jogos publicos tambem permanecem
fora da migracao do painel.

Validacao com respostas simuladas: navegacao das 11 secoes em 1440 e 390px,
fontes, imagens dos overlays, menu mobile e console. Sem erros JS ou overflow
horizontal da pagina. Integracao com uma live real nao testada nesta tarefa.
