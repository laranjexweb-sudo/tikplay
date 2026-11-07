# Retomada automática da conexão com a live

**Status:** implementada no fluxo Node → daemon Python; a validação em runtime depende de reiniciar os serviços em uma janela segura.

## Comportamento

- Ao aceitar `POST /start-game`, o servidor registra em `active_live_connections` apenas que a conta solicitou manter a conexão. Username, chave Tik.Tools e demais credenciais não são duplicados nessa tabela.
- No encerramento gracioso do Node (`SIGINT`, `SIGTERM` ou exit), sessões ativas também confirmam o marcador antes de o processo Python ser encerrado.
- A intenção sobrevive ao reinício do Node e do daemon. O daemon emite `daemon_ready` após iniciar o leitor de comandos; o Node relê a conta ativa, engine, usuário e chave atuais e envia um novo `start` com `session_id` novo.
- Durante a recuperação, o painel recebe o estado `reconnecting` e continua conectado ao WebSocket. Não precisa recarregar a página nem clicar para conectar novamente.
- O streamer pode cancelar a intenção com **Desconectar** durante a recuperação. A intenção é apagada antes de enviar `stop`, inclusive quando o daemon está indisponível.
- Quando a conexão termina normalmente e o daemon reporta `offline`, a intenção persistida é apagada. Contas inativas, sem permissão de conexão ou sem os dados obrigatórios também não são retomadas.
- O checkpoint existente da Palavra Secreta só é enviado se o jogo ainda estiver ativo e o checkpoint corresponder à Room ID guardada. O daemon verifica novamente a sala ao conectar; uma Room ID diferente invalida a restauração.

Essa retomada cobre atualização/reinício de processo. Não elimina a curta interrupção causada pelo encerramento do processo que mantém o socket TikTok. O estado dos demais jogos não tem checkpoint equivalente neste fluxo e pode exigir retomada própria; a recuperação de partida documentada aqui é a da Palavra Secreta.

Na primeira publicação desta mudança, uma sessão iniciada pela versão anterior não tem marcador persistido. Não é possível inferi-la com segurança no novo processo sem também reconectar contas que foram desconectadas de propósito. A persistência passa a cobrir todas as conexões iniciadas por esta versão e os próximos reinícios graciosos.

## Eventos e observabilidade

| Evento | Categoria / nível | Uso e detalhes permitidos |
| --- | --- | --- |
| `daemon.ready` | connection / info | Daemon pronto para receber comandos; evento global de processo. |
| `connection.auto_resume.waiting` | connection / warning | Daemon reiniciou; `engine` e `suppressed_count`; no máximo um por tenant a cada 30 s. |
| `connection.auto_resume.requested` / `.queued` | connection / info | Nova tentativa e comando enviado; `engine`, motivo enum e `session_id` novo. |
| `connection.auto_resume.completed` | connection / info | Status `connected` da nova sessão; engine e indicação se Room ID conhecida permaneceu igual. |
| `connection.auto_resume.failed` / `.rejected` | connection / warning | Live indisponível ou conta inelegível; código estável, sem credenciais. |
| `connection.auto_resume.cancelled` | connection / info | Streamer cancelou enquanto o daemon estava fora do ar. |

Não registrar username, API key, token, payload TikTok nem conteúdo do jogo nos detalhes de recuperação. Falhas repetidas de espera são limitadas por tenant; eventos de cada tentativa são limitados pela política geral de retenção.

## Validação operacional pendente

Após publicar e reiniciar em janela segura, confirmar: intenção gravada no start; daemon pronto; novo `session_id`; estado reconectando → conectado sem clique; mesmos dados de live; checkpoint restaurado somente na mesma Room ID; desconexão manual durante a espera impede novo start; live encerrada apaga a intenção. Não inferir sucesso de produção apenas pela sintaxe ou pelo working tree.
