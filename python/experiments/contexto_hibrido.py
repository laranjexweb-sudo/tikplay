"""Standalone paid OpenRouter experiment; never changes game state or its DB."""
import argparse
import json
import os
from pathlib import Path
import random
import time
import unicodedata
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]


def norm(word):
    return ''.join(c for c in unicodedata.normalize('NFD', word.casefold())
                   if unicodedata.category(c) != 'Mn')


def merge_ranking(target, selected, local):
    keys = [norm(w) for w in selected]
    if len(keys) != 50 or len(set(keys)) != 50 or norm(target) in keys:
        raise ValueError('INVALID_TOP_50')
    allowed = {norm(w) for w in local}
    if not set(keys) <= allowed:
        raise ValueError('OUT_OF_VOCABULARY')
    result = [target] + selected + [w for w in local if norm(w) not in set(keys)]
    if len(result) != len(local) + 1 or len({norm(w) for w in result}) != len(result):
        raise ValueError('INVALID_MERGE')
    return result


def event(run_id, name, **details):
    print(json.dumps({'category': 'error' if name.endswith('failed') else 'diagnostic',
                      'level': 'error' if name.endswith('failed') else 'info',
                      'event': name, 'trace_id': run_id, 'details': details}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--word', action='append')
    parser.add_argument('--samples', type=int, default=3)
    parser.add_argument('--model', default='openai/gpt-5.6-luna')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    from dotenv import load_dotenv
    import spacy
    load_dotenv(ROOT / 'node' / '.env')
    key = os.environ.get('OPENROUTER_API_KEY') or os.environ.get('OPENAI_API_KEY')
    if not key:
        raise RuntimeError('OPENROUTER_KEY_MISSING')
    model = args.model
    pool = json.loads((ROOT / 'python' / 'words.json').read_text(encoding='utf-8'))
    # Match production word vectors, without writing production caches.
    nlp = spacy.load('pt_core_news_lg')
    docs = list(nlp.pipe(pool))
    valid = [(w, d) for w, d in zip(pool, docs) if d.has_vector]
    # The source dictionary currently repeats ideia and sabor.
    valid = list({norm(w): (w, d) for w, d in valid}.values())
    targets = args.word or random.Random(20261016).sample([w for w, _ in valid], args.samples)
    by_key = {norm(w): (w, d) for w, d in valid}
    args.output.mkdir(parents=True, exist_ok=True)
    run_id = str(uuid.uuid4())
    results = []
    for number, target in enumerate(targets, 1):
        target, doc = by_key[norm(target)]
        local_pairs = sorted(((w, float(d.similarity(doc))) for w, d in valid
                              if norm(w) != norm(target)), key=lambda p: -p[1])
        local = [w for w, _ in local_pairs]
        # Dictionary order in the prompt must not reveal local proximity ranks.
        allowed = sorted(local)
        schema = {'type': 'object', 'properties': {'words': {
            'type': 'array', 'minItems': 80, 'maxItems': 80,
            'items': {'type': 'string', 'enum': allowed}}},
            'required': ['words'], 'additionalProperties': False}
        payload = {'model': model, 'reasoning': {'effort': 'low'}, 'max_tokens': 4000,
                   'provider': {'require_parameters': True},
                   'response_format': {'type': 'json_schema', 'json_schema': {
                       'name': 'semantic_neighbors', 'strict': True, 'schema': schema}},
                   'messages': [{'role': 'system', 'content':
                       'Você prepara o ranking de um jogo Contexto em português brasileiro. '
                       'Selecione EXATAMENTE 80 palavras distintas do vocabulário permitido; '
                       'usaremos as primeiras 50 após validação. As 80 devem estar '
                       'ordenadas da mais próxima semanticamente à menos próxima da palavra alvo. '
                       'Priorize sentido, sinônimos e relações conceituais naturais, não semelhança '
                       'de escrita ou som. Não inclua o alvo. Não invente palavras. '
                       'Escolha um sentido comum e coerente para alvos ambíguos. '
                       'Antes de responder, revise relações fracas ou sem relação e repetições.'},
                       {'role': 'user', 'content': json.dumps({
                           'alvo': target, 'vocabulario_permitido': allowed}, ensure_ascii=False)}]}
        event(run_id, 'experiment.context.started', sample=number, model=model)
        started = time.perf_counter()
        request = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions',
                    data=json.dumps(payload).encode(), headers={
                        'Authorization': f'Bearer {key}', 'Content-Type': 'application/json',
                        'X-Title': 'TikPlay local semantic experiment'})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = json.load(response)
            (args.output / f'resposta-{run_id}-{number}.json').write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
            generated = json.loads(data['choices'][0]['message']['content'])['words']
            canonical = {norm(w): w for w in local}
            selected = []
            seen = {norm(target)}
            for word in generated:
                k = norm(word)
                if k not in canonical:
                    raise ValueError('OUT_OF_VOCABULARY')
                if k not in seen:
                    selected.append(canonical[k])
                    seen.add(k)
            selected = selected[:50]
            merged = merge_ranking(target, selected, local)
        except Exception as exc:
            partial = ['# Resultado parcial do experimento', '',
                       f'Amostra {number} rejeitada. Terceira amostra não executada.', '']
            for completed in results:
                partial += [f"## Alvo: {completed['target']}", '',
                            f"Tempo: {completed['seconds']} s. Custo: US$ {completed['usage'].get('cost')}.", '',
                            '| Rank | spaCy | IA |', '|---:|---|---|']
                partial += [f'| {i + 2} | {a} | {b} |' for i, (a, b) in
                            enumerate(zip(completed['local_top50'], completed['ai_top50']))]
            (args.output / 'comparacao.md').write_text('\n'.join(partial), encoding='utf-8')
            event(run_id, 'experiment.context.failed', sample=number,
                  error_type=type(exc).__name__, status=getattr(exc, 'code', None),
                  validation_code=str(exc) if str(exc) in (
                      'INVALID_TOP_50', 'OUT_OF_VOCABULARY', 'INVALID_MERGE') else None)
            raise SystemExit('EXPERIMENT_FAILED (no automatic retry)') from None
        elapsed = round(time.perf_counter() - started, 3)
        usage = data.get('usage', {})
        cost = usage.get('cost')
        overlap = len(set(selected) & set(local[:50]))
        row = {'target': target, 'model': model, 'seconds': elapsed, 'usage': usage,
               'generated_count': len(generated), 'generated_unique': len(set(map(norm, generated))),
               'overlap_top50': overlap, 'local_top50': local[:50],
               'ai_top50': selected, 'hybrid_ranking': merged,
               'checks': {'exactly_50': True, 'unique': True, 'dictionary_only': True,
                          'target_rank_1': True, 'full_coverage': True}}
        results.append(row)
        (args.output / 'resultados.json').write_text(
            json.dumps({'run_id': run_id, 'results': results}, ensure_ascii=False, indent=2), encoding='utf-8')
        event(run_id, 'experiment.context.completed', sample=number, seconds=elapsed,
              cost_usd=cost, overlap_top50=overlap, total_ranked=len(merged))
    lines = ['# Teste local de contexto híbrido', '',
             f'Modelo: `{model}`. Alvos de teste, sem alterar partidas.', '',
             'Ranking #1: alvo. IA: #2–#51. Restante: spaCy, sem duplicatas.', '']
    for row in results:
        lines += [f"## Alvo: {row['target']}", '',
                  f"API: {row['seconds']} s; custo reportado: US$ {row['usage'].get('cost', 'indisponível')}; "
                  f"coincidência entre top 50: {row['overlap_top50']}/50.", '',
                  '| Rank | spaCy atual | OpenRouter / híbrido |', '|---:|---|---|']
        lines += [f'| {i + 2} | {local_word} | {ai_word} |'
                  for i, (local_word, ai_word) in enumerate(zip(row['local_top50'], row['ai_top50']))]
        lines += ['', f"Ranking combinado validado: {len(row['hybrid_ranking'])} palavras, sem repetição.", '']
    (args.output / 'comparacao.md').write_text('\n'.join(lines), encoding='utf-8')


if __name__ == '__main__':
    main()
