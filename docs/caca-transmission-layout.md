# Caça Palavras — composição para transmissão

## Escopo

Adaptar a tela pública do Caça Palavras a fontes de navegador em 9:16, 16:9 e dimensões personalizadas. Expor preset e margens seguras no painel do streamer, persistir a configuração visual junto às preferências existentes do streamer/sala e atualizá-la pelo estado WebSocket `caca_state` já utilizado.

## Mapa de observabilidade

- Ações: leitura e salvamento das preferências de exibição; envio do estado do jogo para a tela pública; acertos e fim de rodada.
- Eventos reaproveitados: requisição existente `/api/caca/config`, comando/evento `caca_config` e estado `caca_state`. Não criar evento novo; guardar somente o preset e quatro margens percentuais validadas.
- Categoria/nível/correlação: sem evento operacional novo, portanto sem categoria, nível ou trace ID adicional. A persistência fica no registro de configuração identificado pelo tenant/streamer, que representa a sala configurada no painel.
- Dados permitidos: preset e margens seguras (números limitados); estado de jogo e identificadores de participantes permanecem nos contratos atuais. Não incluir comentário bruto, segredo ou conteúdo de chat em telemetria.
- Volume: salvar com o debounce já fornecido por `createPreferenceSaver`; broadcasts somente quando houver estado/configuração existente.
- Testes: migração legada, defaults/limites de configuração, round-trip API/DB, atualização `caca_state`, sintaxe dos scripts e layout sem scroll em 720×1280, 1080×1920, 1280×720 e 1920×1080, incluindo estado vazio, rodada, acertos em fila e ranking final.

## Implementação e validação

Implementado: presets vertical (9:16) e horizontal (16:9), margens seguras customizáveis com limites, prévia no painel, autosave na configuração já persistida por streamer/sala, aplicação imediata por `caca_state`, composição do overlay baseada na viewport real, tabuleiro quadrado, líder compacto, avisos temporários de acerto e ranking final sem o tabuleiro quando habilitado.

Verificado: migração de uma tabela legada, defaults dos presets, limites e round-trip SQLite via `node/tests/caca-config.test.js`; `node --check node/server.js`. A conferência de layout automatizada com Edge não foi concluída porque o processo headless do ambiente travou ao inicializar o renderer. Não declarar a matriz de viewports validada até fazer a inspeção no navegador.

Regras, palavras, coordenadas, pontuação, URLs, eventos e ações do jogo permanecem iguais. A configuração é salva por streamer/sala; dimensões da fonte são lidas pela própria página pública, sem fixar resolução.
