# Experimento local: contexto híbrido

Comparação adicional autorizada pelo usuário: executar o mesmo protocolo,
semente, vocabulário e raciocínio low com `anthropic/claude-haiku-5.5`.
Modelo selecionável apenas no script de experimento; não alterar o modelo
das charadas ou o motor ativo. Mesma observabilidade e validações abaixo.

Plano: escolher três palavras de teste do dicionário com semente fixa;
comparar spaCy atual com seleção/ordenação de 50 vizinhas por OpenRouter.
Usar GPT-5.6 Luna, JSON Schema e vocabulário fechado. Validar quantidade,
unicidade sem acentos, exclusão do alvo e cobertura do ranking combinado.
Rank 1 reservado ao alvo, ranks 2–51 para a IA; spaCy preenche 52 em diante
sem duplicatas e preservando sua ordem relativa.

O dicionário tem duas entradas repetidas (ideia e sabor). A cópia experimental
deduplica por forma sem acentos antes da comparação; o dicionário real não é
modificado. A primeira execução paga foi interrompida pela validação de
unicidade na junção e não teve resposta/custo preservados; não incluí-la no
custo agregado das amostras válidas. Persistir respostas das próximas chamadas
como artefatos locais antes da validação evita perder evidência de falhas.

A chamada seguinte retornou 50 itens, mas 46 únicos (custo US$ 0,0030685).
Após evidenciar essa limitação, o experimento passou a pedir 80 candidatas,
deduplicar por forma normalizada e aproveitar 50; usar raciocínio low no mesmo
modelo. Não há laço automático de tentativas pagas. A seleção continua sendo
uma proposta semântica do modelo, não uma medida objetiva de proximidade.

Observabilidade: script isolado, sem sessões, banco ou live. Eventos
`experiment.context.started/completed/failed` em diagnostic/info ou error/error,
correlação por ID de execução. Somente contagens, modelo, duração e custo;
sem chave, prompt ou palavras em logs. Resultados com palavras artificiais
de teste ficam em artefatos locais para inspeção, nunca no histórico de live.
Volume máximo: dois eventos por amostra. Falha interrompe sem novas tentativas
pagas automáticas. Testes e relatório verificam resposta e invariantes.

Não integrar ao jogo neste experimento: o fallback atual para palpites fora
do dicionário usa busca binária em similaridades; depois de promover palavras
pela IA, as similaridades deixam de estar ordenadas. Uma integração requer
adaptar esse fallback, cache, dicas e estabilizar o ranking por rodada.

## Resultado observado

- Fogo: 80 candidatas, 76 únicas; primeiras 50 aceitas. Ranking combinado
  com 1.374 entradas únicas válidas para spaCy; 14/50 em comum com o top local.
  Tempo de API 5,349 s; custo US$ 0,00330065.
- Segunda amostra: 80 candidatas, apenas 24 únicas; repetição excessiva de
  `coisa`. Rejeitada, custo US$ 0,00328145. Terceira não executada.
- Custos conhecidos preservados: US$ 0,00965060, incluindo a tentativa de
  50 itens com duplicatas. Mais uma chamada inicial teve custo não preservado.
- Três testes locais de junção/rejeição passaram. O início do ranking para
  fogo parece mais intuitivo, mas há relações fracas (larva e solado).
  Isso não comprova melhora geral nem consistência suficiente para produção.
- Relatório em `F:\Codex\Projetos\TikPlay\experimentos\contexto-hibrido-20261016`.
  Nenhum servidor, daemon, banco, cache ou rodada foi modificado/reiniciado.

## Comparação com Claude Haiku 5.5

Mesmo prompt, vocabulário, alvos, schema e raciocínio low:

| Alvo | Candidatas únicas | Tempo API | Custo USD |
|---|---:|---:|---:|
| fogo | 80/80 | 17,970 s | 0,0035700 |
| tempero | 80/80 | 15,488 s | 0,0033910 |
| sinfonia | 80/80 | 14,675 s | 0,0033243 |

Três amostras aceitas, cada uma com 50 palavras da IA e ranking combinado
de 1.374 palavras únicas. Total US$ 0,0102853; média 16,044 s por chamada.
Sem repetições nas 240 candidatas dentro de suas listas. Isso melhora a
validade estrutural nesta amostra, não comprova qualidade semântica geral.
Há associações distantes no fim do top 50 (como astronauta para fogo).
Em fogo, Luna levou 5,349 s e custou US$ 0,00330065; Haiku foi mais lento,
com custo semelhante. Luna não passou na amostra tempero.

Relatório: `F:\Codex\Projetos\TikPlay\experimentos\contexto-hibrido-haiku-20261016\comparacao.md`.
Somente experimento; modelo de produção e charadas preservados.
