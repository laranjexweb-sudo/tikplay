# Vozes adicionais por streamer

Status: implementado com API oficial ElevenLabs e chave global configuravel pelo admin; ativacao real pendente de chave, reinicio inicial e escolha das contas.

Atualizacao 2026-10-16: Super Admin controla quais modelos adicionais aparecem, agrupados em
vozes padrao (HeyGen Voice Turbo e Kokoro 82M via OpenRouter) e personalizadas (ElevenLabs
v4 Turbo). Streamer escolhe modelo e voz; acesso individual e limite existente continuam
valendo. OpenRouter reutiliza `OPENROUTER_API_KEY` do servidor. Mapa de eventos e detalhes
em `docs/modelos-voz-adicionais.md`.

## Escopo

Liberar vozes adicionais no leitor de chat apenas para contas autorizadas pelo administrador. Usar inicialmente uma credencial da plataforma, configurada no servidor. Nenhuma conta deve receber acesso automaticamente. Nao alterar o comportamento das charadas por efeito indireto da selecao de voz do chat.

Integra a API oficial ElevenLabs. A referencia anterior do agente a "NoElevenLabs" foi uma interpretacao incorreta. Nunca solicitar credenciais no chat.

## Pontos existentes verificados

- `node/server.js`: GET `/api/tts/voices` fornece duas vozes fixas; POST `/api/tts/test` encaminha o teste ao daemon.
- `python/tts.py`: sintetiza pelo Edge, limpa texto e limita cache de audio por tenant.
- `python/service.py`: `_tts_url` e `_tts_config_snapshot` atendem chat e charada com voz compartilhada; narração do chat tem fila por sessao.
- `node/public/control-panel.html`: painel streamer onde integrar a selecao e o teste.
- `node/public/admin.html`: administracao onde integrar a liberacao individual.
- Preferencias existentes: `tenant_settings.tts_voice` e `tts_rate`.

## Etapas de implementacao

1. Confirmar o provedor, autenticacao, listagem de vozes, sintese, formato de resposta e limites. Definir variaveis de ambiente e documentar configuracao sem valores secretos.
2. Persistir habilitacao por tenant em configuracao controlada pelo admin. Validar a permissao no servidor tanto na listagem quanto no teste e na sintese real. A escolha de uma voz nunca concede acesso ao provedor.
3. Criar adaptador do provedor com timeout, validacao do audio e codigos de falha estaveis. Calcular e debitar creditos pela tarifa do modelo antes da chamada externa; testar saldo insuficiente e concorrencia.
4. Separar a preferencia adicional do chat da configuracao compartilhada atual, preservando a voz da charada. Revalidar autorizacao a cada sintese, inclusive apos revogacao ou reinicio.
5. Entregar catalogo permitido ao painel autenticado. Exibir as vozes adicionais somente nas contas habilitadas, salvar a escolha por tenant e disponibilizar teste com texto fixo em portugues brasileiro.
6. Integrar sintese a fila existente e entregar o audio somente aos clientes do painel do tenant. Em falha ou revogacao, aplicar fallback para a voz padrao e impedir dupla reproducao.
7. Validar integracao e registrar instrucoes de ativacao do piloto. Recurso inicia desabilitado; a ativacao de contas reais exige informar quais streamers participam.

## Observabilidade

Correcao de emotes e inicio de audio: limpeza ocorre antes de cache/reserva/chamada e mensagens sem texto falavel nao chamam o provedor. Preservar `chat.tts.batch` (filtrados/sintetizados, agregado em 30 s), `tts.provider.fallback` e falhas de reproducao no console local com throttle de 5 s. Nunca logar mensagem ou URL. Testar emotes TikTok, emoticons ASCII, keycaps, texto misto, envio/contagem final, cancelamento/expiracao e preservacao integral das amostras de audio com margem local.

Configuracao global pelo admin: `tts.provider.config_saved` (system/info), `tts.provider.config_rejected` (notice/warning) e `tts.provider.config_failed` (error/error), com tenant do administrador, trace_id e apenas operacao/codigo/fonte. Nunca incluir chave, tamanho, cabecalhos ou corpo recebido. Rejeicoes e falhas usam throttle de 30 s; testar autorizacao, persistencia, substituicao, remocao e ausencia do segredo nos retornos/logs.

| Acao | Categoria / nivel | Evento | Dados permitidos |
| --- | --- | --- | --- |
| Admin habilita ou revoga acesso | system / info | tts.provider.access_changed | tenant, ator administrativo, habilitado, trace_id |
| Configuracao invalida ou acesso negado | notice / warning | tts.provider.rejected | tenant, operacao, code, trace_id; agregar repeticoes em 30 s |
| Preferencia salva e teste concluido | diagnostic / debug | tts.provider.preference_saved, tts.provider.completed | tenant, voz ou operacao, code, trace_id |
| Sintese do chat concluida | chat / info | chat.tts.batch | contagem agregada elevenlabs_synthesized na janela existente de 30 s |
| Falha de catalogo ou teste | error / error | tts.provider.failed | tenant, operacao, code, trace_id; catalogo com throttle de 30 s; testes limitados a um por conta a cada 10 s |
| Fallback aplicado | notice / warning | tts.provider.fallback | tenant, sessao, motivo enumerado; agregar repeticoes |

Nao registrar texto do chat, chave, cabecalhos, URL autenticada ou resposta bruta do provedor. Reutilizar armazenamento, taxonomia e interface de logs existentes. Validar evento persistido e visivel no processo atualizado; testes isolados nao comprovam ativacao em runtime.

## Verificacao

- Tenant autorizado lista, salva, testa e usa voz adicional; tenant nao autorizado nao consegue chamar o provedor mesmo forjando o ID da voz.
- Preferencias, consumo, fila e entrega de audio isolados entre dois tenants.
- Revogacao e reinicio preservam permissao correta e fallback.
- Timeout, credencial ausente, catalogo indisponivel, resposta sem audio e quota esgotada resultam em falha explicita ou fallback controlado.
- Testes tambem consomem limite; concorrencia nao ultrapassa a quota; cache nao provoca cobranca duplicada local.
- Voz da charada e leitor padrao continuam funcionando.
- Painel apresenta sucesso apenas depois da resposta real; credenciais nunca chegam ao navegador ou aos logs.

## Ativacao do piloto

1. Em Admin > Configuracoes globais > Integracao ElevenLabs, colar a chave e clicar **Salvar chave**. O formulario limpa o campo apos salvar e nunca recupera a chave. `ELEVENLABS_API_KEY` continua como alternativa quando nao existe configuracao salva. Nenhuma dependencia nova precisa ser instalada.
2. Opcional: `ELEVENLABS_MODEL_ID`; padrao `eleven_v4_turbo` (Eleven v4 Turbo), solicitado pelo usuario.
3. Reiniciar servidor/daemon em uma janela segura para carregar esta versao pela primeira vez. Depois disso, alteracoes da chave pelo admin sao lidas em runtime, sem reiniciar. A implementacao nao reinicia a live automaticamente.
4. Admin: editar uma conta existente, bloco **ElevenLabs - Leitor de chat**, marcar liberacao, escolher limite e clicar **Salvar acesso ElevenLabs**. Esta acao e separada de **Salvar usuario**. Para conta nova, primeiro criar e depois editar.
5. Atualizar o painel streamer, abrir Sons / Narracao, escolher **Voz ElevenLabs do chat** e usar **Testar voz do chat**. O teste toca apenas no painel dessa conta e consome o mesmo limite.
6. Ativar a leitura pelo controle existente. A selecao adicional permite voltar a voz padrao; a configuracao das charadas permanece independente.

## Contrato e limites

- GET/PUT `/api/admin/integrations/elevenlabs`: restrito ao admin; GET retorna somente configured/source. PUT recebe api_key para substituir ou clear=true para remover. Campo vazio e rejeitado, preservando a configuracao; remocao explicita desativa tambem o fallback da variavel de ambiente.
- Configuracao salva em `node/data/integrations/elevenlabs.json`, fora de public e ignorada pelo Git. Gravacao por arquivo temporario e rename; diretorio 0700 e arquivo 0600 onde suportados. O arquivo e texto, sem criptografia em repouso: no Windows, as ACLs herdadas da pasta do servidor controlam o acesso. A chave nao e retornada por nenhuma API nem registrada nos logs.
- Node e Python leem o mesmo arquivo; `ELEVENLABS_CONFIG_PATH` permite definir o caminho absoluto para ambos. Em caso de arquivo invalido/inacessivel, a integracao fica desativada em vez de reutilizar silenciosamente uma chave antiga.
- Catalogo e invalidado ao mudar a chave. Salvar configura a credencial, mas nao comprova validade na ElevenLabs; catalogo e teste exercitam a autenticacao real depois.

- `tenant_elevenlabs`: enabled, voice_id e model_id por tenant; acesso desabilitado por padrao. A coluna monthly_limit e preservada para compatibilidade historica.
- `tts_credit_wallets` e `tts_credit_ledger`: saldo inteiro sem validade mensal e historico append-only de compra, uso e ajuste; debito atomicamente bloqueado quando insuficiente.
- GET/PUT `/api/admin/users/:id/elevenlabs`: somente admin; habilitacao individual.
- `additional_voice_models.credits_per_100_chars`: tarifa inteira definida pelo Super Admin. O uso cobra `ceil(caracteres × tarifa / 100)`, com minimo de um credito; cada modelo pode ter tarifa diferente.
- `tts_credit_packages` e `/api/admin/tts/credit-packages`: pacotes avulsos configuraveis pelo Super Admin; checkout via Mercado Pago Preferences e credito liberado somente apos consulta e validacao do pagamento aprovado, valor, BRL e referencia externa. Webhook idempotente.
- `/api/tts/credits` mostra saldo, tarifas liberadas, pacotes e movimentacoes recentes. `/api/tts/credits/checkout` cria a compra do streamer autenticado. Ajuste manual fica em `/api/admin/users/:id/tts-credits`.
- GET/PUT `/api/tts/elevenlabs`: consulta acesso/catalogo e salva a propria voz; identidade vem do token.
- POST `/api/tts/elevenlabs/test`: voz persistida, texto fixo, tenant do token.
- Catalogo GET oficial `/v2/voices`, paginado, cache de cinco minutos; retorna somente IDs e nomes.
- Sintese POST oficial `/v1/text-to-speech/{voice_id}`, MP3, timeout de oito segundos, sem retry automatico pago.
- Eleven v4 Turbo nao recebe o parametro speed; a velocidade da voz adicional fica natural. Modelos compativeis continuam usando o intervalo de 0,7x a 1,2x. A voz padrao mantem o controle existente.
- Cache por tenant/texto/voz/modelo/velocidade. Revogacao bloqueia tambem o cache. Cache hit nao cobra creditos novamente.
- No painel streamer, a tecnologia nao e citada: aparece como "voz adicional". Sinteses adicionais limitam cada texto a 150 caracteres antes de calcular o debito; a voz padrao mantem seu fluxo proprio. A previa usa uma frase curta e cobra como uso explicito do streamer.
- O helper compartilhado remove emojis graficos, keycaps, codigos compactos de emote TikTok como `[happy]`, shortcodes como `:heart:` e emoticons ASCII comuns antes de cortar o texto. Conteudo sem letras/numeros nao gera fala; apenas o texto final e enviado e tarifado. O log original de chat pode continuar mostrando a mensagem integral; ele nao representa o corpo enviado a API.
- Na reproducao adicional, o painel decodifica o arquivo completo e usa o AudioContext persistente com ganho unitario, sem fade. Uma margem silenciosa local de 150 ms precede a fala sem remover qualquer amostra nem consumir caracteres. A fila continua serial, respeita prioridade, expiracao e cancelamento; timeout local de carregamento em 15 s. Navegadores sem WebAudio continuam com o player anterior em volume 1.
- A carteira mede creditos debitados conforme a tarifa de cada modelo, nao uma cota mensal de caracteres. Timeout depois do inicio da chamada nao estorna o debito porque o provedor pode ter cobrado.
- Quota, revogacao ou erro aplicam fallback no chat. O teste explicito informa falha, sem trocar silenciosamente a voz testada.
- Audio usa a infraestrutura de arquivos TTS existente; nao foi criada uma nova camada de anexos privados.

## Verificacao executada

- Integracao HTTP Node em processo separado com banco temporario: autorizacao, isolamento, catalogo simulado, salvamento, teste, revogacao e consulta dos logs persistidos pelo leitor existente.
- Python: sintese simulada, cache, quota concorrente, timeout, resposta invalida, revogacao durante requisicao e regressao do worker/charada.
- Navegador com API simulada: selecionar, salvar, solicitar teste e ocultar recurso para conta desabilitada; scripts inline analisados sintaticamente.
- Nenhuma chamada paga foi feita. Chave, pronuncia, latencia e logs no servidor principal atualizado aguardam ativacao do piloto.

### Correcao de inicio e emotes (2026-10-15)

Nao foi encontrado fade programado na reproducao anterior. Ela instanciava um HTMLAudio por fala. Analise local de quatro MP3s existentes encontrou inicios mais baixos, mas nao permite atribuir so ao player ou ao arquivo a percepcao no dispositivo do usuario. A correcao de buffer/margem elimina a troca de saida e preserva todas as amostras; nao modifica a dinamica que o modelo ja gerou. Confirmacao auditiva no dispositivo continua necessaria.

Regressoes: 15 testes do adaptador (incluindo payload/contagem sem emotes), 26 de limpeza/fila/charada e 5 da fila de reproducao. Teste em navegador real com WAV sintetico validou decodificacao, ganho unitario, conclusao e igualdade de cada amostra original apos a margem. Nenhuma geracao paga foi usada. Usuario autorizou o reinicio com a live conectada; servidor e daemon foram reiniciados. Painel respondeu HTTP 200 com o player atualizado e o novo daemon iniciou sem erros no stderr. Limpeza do helper validada com mensagens sinteticas. Confirmacao auditiva no dispositivo e reconexao efetiva da live nao foram comprovadas por essa verificacao.

Referencias oficiais: https://elevenlabs.io/docs/api-reference/text-to-speech/convert e https://elevenlabs.io/docs/api-reference/voices/search.
