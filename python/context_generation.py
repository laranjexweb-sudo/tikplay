"""OpenRouter context generation and durable accounting. No game/session side effects."""
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
import db as local_db

ROOT = Path(__file__).resolve().parents[1]
MODEL = 'anthropic/claude-haiku-5.5'
METHOD = 'openrouter-top50-v1'


def now():
    return datetime.now(timezone.utc).isoformat()


def norm(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.casefold().strip())
                   if unicodedata.category(c) != 'Mn')


def pool_version():
    return local_db.get_word_catalog_version()


def connect():
    conn = sqlite3.connect(os.environ.get('DB_PATH') or ROOT / 'node' / 'data.db', timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA busy_timeout=10000')
    return conn


def merge(target, candidates, local_words):
    canonical = {norm(w): w for w in local_words if norm(w) != norm(target)}
    chosen = []
    seen = {norm(target)}
    if not isinstance(candidates, list):
        raise ValueError('INVALID_RESPONSE')
    for word in candidates:
        if not isinstance(word, str):
            continue
        key = norm(word)
        if key in canonical and key not in seen:
            chosen.append(canonical[key])
            seen.add(key)
    chosen = chosen[:50]
    top = {norm(w) for w in chosen}
    ranking = chosen + [w for k, w in canonical.items() if k not in top]
    if len(ranking) < 50:
        raise ValueError('INSUFFICIENT_LOCAL_WORDS')
    return ranking


def request_neighbors(target, allowed, key, model=MODEL):
    # Input is ranked locally. Keep the prompt focused instead of sending the
    # whole dictionary twice (prompt + enum), which produced short replies.
    allowed = allowed[:300]
    schema = {'type': 'object', 'properties': {'words': {
        'type': 'array', 'minItems': 80, 'maxItems': 80,
        'items': {'type': 'string', 'enum': sorted(allowed)}}},
        'required': ['words'], 'additionalProperties': False}
    payload = {'model': model, 'max_tokens': 6000, 'reasoning': {'effort': 'low'},
        'provider': {'require_parameters': True},
        'response_format': {'type': 'json_schema', 'json_schema': {
            'name': 'semantic_neighbors', 'strict': True, 'schema': schema}},
        'messages': [{'role': 'system', 'content':
            'Você prepara o ranking de um jogo Contexto em português brasileiro. '
            'Selecione EXATAMENTE 80 palavras distintas do vocabulário permitido; '
            'usaremos as primeiras 50 após validação. Ordene da mais próxima '
            'semanticamente à menos próxima do alvo. Priorize sentido, sinônimos '
            'e relações conceituais naturais, nunca semelhança de escrita ou som. '
            'Não inclua o alvo nem invente palavras. Escolha um sentido comum '
            'e coerente para alvos ambíguos. Revise relações fracas e repetições.'},
            {'role': 'user', 'content': json.dumps({
                'alvo': target, 'vocabulario_permitido': sorted(allowed)}, ensure_ascii=False)}]}
    req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions',
        data=json.dumps(payload).encode(), headers={
            'Content-Type': 'application/json', 'Authorization': f'Bearer {key}',
            'X-Title': 'TikPlay context generator'})
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.load(response)


def numeric(value, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return None
    return int(value) if integer else float(value)


def attempt(conn, run_id, target, local_words, sims, key, model=MODEL, request=request_neighbors):
    attempt_id = str(uuid.uuid4())
    conn.execute('INSERT INTO context_generation_attempts(id,run_id,target,model,status,created_at) VALUES(?,?,?,?,?,?)',
                 (attempt_id, run_id, target, model, 'pending', now()))
    conn.commit()  # A killed worker still leaves an auditable unknown-cost attempt.
    started = time.monotonic()
    try:
        data = request(target, local_words, key, model)
        usage = data.get('usage') or {}
        cost = numeric(usage.get('cost'))
        conn.execute('UPDATE context_generation_attempts SET status=?,prompt_tokens=?,completion_tokens=?,cost_usd=?,provider_id=? WHERE id=?',
                     ('received', numeric(usage.get('prompt_tokens'), True),
                      numeric(usage.get('completion_tokens'), True), cost,
                      str(data.get('id') or '')[:160], attempt_id))
        conn.commit()  # Preserve billed invalid responses before parsing/validation.
        generated = json.loads(data['choices'][0]['message']['content'])['words']
        if not isinstance(generated, list):
            raise ValueError('INVALID_RESPONSE')
        canonical_keys = {norm(w) for w in local_words if norm(w) != norm(target)}
        ai_words = []
        seen = {norm(target)}
        for word in generated:
            if isinstance(word, str):
                word_key = norm(word)
                if word_key in canonical_keys and word_key not in seen:
                    ai_words.append(word)
                    seen.add(word_key)
        ai_count = min(50, len(ai_words))
        local_fill_count = 50 - ai_count
        unique_count = len({norm(w) for w in generated if isinstance(w, str)})
        with conn:
            conn.execute('UPDATE context_generation_attempts SET received_count=?,unique_count=?,ai_count=?,local_fill_count=? WHERE id=?',
                         (len(generated), unique_count, ai_count, local_fill_count, attempt_id))
        ranked = merge(target, generated, local_words)
        ranking = [{'palavra': w, 'score': sims.get(norm(w), -1.0)} for w in ranked]
        created = now()
        with conn:
            conn.execute('INSERT INTO contextos(alvo,gerado_em,ranking) VALUES(?,?,?) ON CONFLICT(alvo) DO UPDATE SET gerado_em=excluded.gerado_em,ranking=excluded.ranking',
                         (norm(target), created, json.dumps(ranking, ensure_ascii=False)))
            conn.execute('INSERT INTO generated_context_metadata VALUES(?,?,?,?,?,?,?) ON CONFLICT(target) DO UPDATE SET pool_version=excluded.pool_version,model=excluded.model,method_version=excluded.method_version,top_count=excluded.top_count,created_at=excluded.created_at,run_id=excluded.run_id',
                         (norm(target), pool_version(), model, METHOD, 50, created, run_id))
            conn.execute('UPDATE context_generation_attempts SET status=?,duration_ms=? WHERE id=?',
                         ('success', round((time.monotonic()-started)*1000), attempt_id))
        return None
    except Exception as exc:
        known = ('INVALID_RESPONSE', 'INSUFFICIENT_LOCAL_WORDS')
        code = str(exc) if isinstance(exc, ValueError) and str(exc) in known else (
            f'HTTP_{exc.code}' if isinstance(exc, urllib.error.HTTPError) else type(exc).__name__)
        with conn:
            conn.execute('UPDATE context_generation_attempts SET status=?,duration_ms=?,error_code=? WHERE id=?',
                         ('failed', round((time.monotonic()-started)*1000), code[:64], attempt_id))
        return code
