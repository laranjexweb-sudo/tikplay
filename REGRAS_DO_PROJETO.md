# Regras e Diretrizes do Projeto - Jogo TikTok (Contexto)

Este documento contém todas as regras de negócio, convenções de código, correções de bugs e decisões arquiteturais estabelecidas no desenvolvimento do **Jogo TikTok (Contexto)**.

---

## 1. Regras de Negócio e Processamento de Palpites

### 1.1 Acentuação e Busca Accent-Insensitive
- As palavras secretas do dicionário (`words.json`) possuem **acentuação em português correto** (ex: `coração`, `água`, `árvore`, `atenção`, `sentença`).
- O processamento de palpites é **accent-insensitive** (normalizado via `unicodedata.normalize('NFD')` em Python e normalização em JS).
- Chutes sem acento (ex: `!atencao`) casam perfeitamente com a palavra secreta acentuada (`atenção`), sendo exibidos com a grafia correta do dicionário.

### 1.2 Formatação e Extração de Chutes do Chat
- **Apenas a primeira palavra**: Entradas com múltiplas palavras (ex: `@bolo de chocolate`) consideram apenas o primeiro token (`bolo`), ignorando o restante da frase.
- **Limpeza de Pontuação e Símbolos**: Pontuações e erros de digitação comuns de teclados móbile (`-`, `,`, `.`, `!`, `?`) são removidos automaticamente via regex (`re.sub(r"[^\w]", "", word)`).
- **Formato Customizado de Atribuição**: Suporte a palpites no formato `@palavra@usuario` ou `!palavra@usuario`, atribuindo a pontuação da palavra ao usuário especificado após o segundo `@`.

### 1.3 Bloqueio Estrito de Múltiplos Vencedores (Single-Winner Guarantee)
- A partida encerra **imediatamente** quando o palpite atinge o **Rank #1**.
- O handler de comentários em `service.py` e `game.py` valida `if self.game.finished: return None`.
- A função de salvamento em histórico (`save_result`) e emissão de evento `game_over` executa **exclusivamente uma única vez** para o acerto do Rank #1. Palpites recebidos nos segundos posteriores não declaram novos vencedores.

---

## 2. Sistema de Dicas por Presentes (Gift Config)

### 2.1 Mapeamento Bilíngue (EN <-> PT-BR)
- **Frontend**: Apresenta os nomes traduzidos dos presentes para português (ex: `Rose` ➔ `Rosa`, `Finger Heart` ➔ `Coração com os Dedos`, `Ice Cream` ➔ `Sorvete`, `Doughnut` ➔ `Rosquinha`).
- **Busca Flexível**: O campo de busca no painel de controle permite filtrar tanto pelo nome em Português quanto pelo nome em Inglês.
- **Backend (Persistência)**: Salva os identificadores originais esperados pela API TikTools no arquivo de configuração (`"Rose"`, `"Finger Heart"`).
- **Backend (Reconhecimento)**: No Python (`game.py`), o método `process_gift` compara os presentes recebidos na live de forma bilíngue (aceita tanto o nome enviado em inglês quanto em português).

### 2.2 Sincronização de Estado dos Presentes
- Ao salvar a configuração de presentes (`POST /api/gift-config`), a lista em memória (`tenant.gameState.hint_gifts`) é atualizada instantaneamente.
- Na rota `/api/game-state`, a lista salva do usuário tem prioridade para evitar que sincronizações secundárias sobrescrevam os presentes selecionados.
- O mapeamento de presentes no frontend utiliza fallback (`giftByName(n)?.name || n`) para evitar o descarte acidental de itens.

---

## 3. Interface do Usuário (Frontend & UI)

### 3.1 Painel de Controle - Tela de Logs
- A caixa de logs (`.log-area`) possui barra de rolagem dedicada (`overflow-y: scroll`), `height` flexível e estilização de scrollbar customizada.
- Possui o botão **Copiar Logs** que copia todo o histórico formatado para a área de transferência via `navigator.clipboard`.
- Possui o botão **Limpar** para resetar a visualização da tela quando necessário.

### 3.2 Overlay de Dica Ativada (`dica-overlay`)
- Card centralizado via Flexbox (`align-items: center; justify-content: center;`).
- Imagem do presente definida com `display: block; margin: 0 auto 15px auto;` para centralização geométrica perfeita.
- Compensação de margem negativa (`margin-right` negativo) para anular o deslocamento de espaço extra gerado pela propriedade CSS `letter-spacing`.

### 3.3 Modal Pós-Partida ("Ver Palavras Próximas")
- **Botão Oculto no Jogo Active**: O botão `🔍 Ver Palavras Próximas (Pós-Partida)` permanece invisível durante a partida e é exibido **logo abaixo do painel da palavra secreta** (`.secret-display`) quando o jogo encerra.
- **Modal Overlay**: Exibe um modal responsivo (`width: 94%; max-width: 580px; height: 82vh;`) sobre a tela com fundo escuro borrado (`backdrop-filter: blur(4px)`).
- **Controles de Fechamento**: Suporta botão `×` no topo, botão "Fechar" no rodapé, clique fora no backdrop e tecla `ESC`.

---

## 4. Arquitetura e Execução de Processos

- **Servidor Web (Node.js/Express)**: Rodando na porta `3100`, gerenciando sessões WebSockets (`/browser`, `/logs`), persistência SQLite e rotas REST.
- **Daemon de NLP (Python `service.py`)**: Executado como filho do processo Node (`PYTHON_BIN`). Respawn automático com backoff exponencial se desconectado.
- **Modelo SpaCy**: Utiliza o modelo `pt_core_news_lg` para calcular a similaridade semântica por vetores entre palpites e a palavra secreta.

---
*Documento exportado automaticamente para referência e governança do projeto.*
