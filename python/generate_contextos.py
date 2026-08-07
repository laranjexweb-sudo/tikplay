# -*- coding: utf-8 -*-
"""Gera rankings de contexto LOCALMENTE: spaCy + IA corrige o topo.

Abordagem: o spaCy gera o ranking completo das ~1440 palavras de words.json para a
palavra-alvo; a IA local (LM Studio) reordena/limpa o TOP (CORRIGE_TOP); o resultado
final e o ranking mesclado (topo corrigido + resto do spaCy).

Modo agendado: 1 alvo a cada INTERVAL_S (default 900s = 15min). Suporta resume.
Config (env): LLM_BASE_URL, LLM_MODEL, INTERVAL_S, LIMIT, WORDS_PER_CONTEXT, CORRIGE_TOP.
Progresso: stdout JSON {"done","total","current","errors","running","finished","last_error"}.
Saida: tabela `contextos` no banco unificado (node/data.db).
"""
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
import db

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
TARGETS_PATH = os.path.join(PROJECT_DIR, "1000_palavras_seguras_contexto.txt")
OUT_DIR = os.path.join(BASE_DIR, "contextos")
WORDS_PATH = os.path.join(BASE_DIR, "words.json")

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://127.0.0.1:1234/v1").rstrip("/")
LLM_MODEL = os.environ.get("LLM_MODEL", "qwen2.5-coder-7b-instruct")
INTERVAL_S = max(0, float(os.environ.get("INTERVAL_S", "900")))
LIMIT = max(0, int(os.environ.get("LIMIT", "0")))
WORDS_PER_CONTEXT = max(100, int(os.environ.get("WORDS_PER_CONTEXT", "1000")))
CORRIGE_TOP = max(10, int(os.environ.get("CORRIGE_TOP", "200")))

RERANK_PROMPT = """Você é um especialista em similaridade semântica do português do Brasil. Aqui está uma lista de palavras que um sistema apontou como as mais próximas da palavra-alvo "{ALVO}", já em ordem aproximada:
{LISTA}

Tarefa: REORDENE essas palavras pela real proximidade semântica com "{ALVO}" (da mais próxima para a mais distante). Remova as palavras que claramente NÃO têm relação com "{ALVO}". NÃO adicione palavras novas. Use apenas palavras da lista fornecida. Retorne SOMENTE um JSON válido, sem markdown, neste formato:
{{"ranking":[{{"palavra":"...","score":0.99}}]}}
(score entre 0.9999 e 0.1000 decrescente; mantenha as palavras restantes da lista)"""


def emit(**kw):
    print(json.dumps(kw, ensure_ascii=False), flush=True)


def load_targets():
    with open(TARGETS_PATH, encoding="utf-8") as f:
        raw = f.read()
    seen = set()
    out = []
    for w in raw.split(","):
        w = w.strip()
        if w and w not in seen:
            seen.add(w)
            out.append(w)
    return out


def load_word_pool():
    with open(WORDS_PATH, encoding="utf-8") as f:
        return json.load(f)


def slugify(word):
    s = "".join(c for c in unicodedata.normalize("NFD", word) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower()


def llm_chat(prompt, max_tokens):
    body = json.dumps({
        "model": LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": max_tokens,
    }).encode("utf-8")
    req = urllib.request.Request(
        LLM_BASE_URL + "/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"].strip()


def parse_json(text):
    t = re.sub(r"```(?:json)?", "", text).strip()
    start = t.find("{")
    if start == -1:
        raise ValueError("JSON nao encontrado")
    end = t.rfind("}")
    if end == -1 or end <= start:
        raise ValueError("JSON sem objeto")
    for e in range(end, start - 1, -1):
        try:
            return json.loads(t[start:e + 1])
        except Exception:
            continue
    raise ValueError("JSON invalido")


def _score(v):
    try:
        s = float(v)
    except (TypeError, ValueError):
        return None
    return max(0.1, min(0.9999, round(s, 4)))


# spaCy carregado uma vez (fallback se falhar)
_nlp = None
try:
    from similarity import nlp as _nlp
except Exception:
    _nlp = None


def spacy_rank(alvo, pool):
    if _nlp is None:
        return []
    secret_doc = _nlp(alvo)
    scored = []
    for w in pool:
        if w == alvo:
            continue
        d = _nlp(w)
        if d.has_vector and secret_doc.has_vector:
            scored.append((w, float(d.similarity(secret_doc))))
    scored.sort(key=lambda x: -x[1])
    return scored


def correct_top(alvo, top_words):
    """Envia o top ao LLM local e devolve a lista reordenada/filtrada (apenas palavras da lista)."""
    prompt = RERANK_PROMPT.replace("{ALVO}", alvo).replace("{LISTA}", ", ".join(top_words))
    content = llm_chat(prompt, max_tokens=top_words_len(top_words))
    obj = parse_json(content)
    ok_set = set(top_words)
    out = []
    for it in (obj.get("ranking") or []):
        w = str(it.get("palavra", "")).strip().lower()
        if w in ok_set and w != alvo and " " not in w:
            s = _score(it.get("score"))
            if s is not None:
                out.append({"palavra": w, "score": s})
    return out


def top_words_len(top_words):
    return max(1500, len(top_words) * 20)


def build_context(alvo, pool):
    t0 = time.time()
    scored = spacy_rank(alvo, pool)
    t_spacy = round(time.time() - t0, 1)
    top_words = [w for w, _ in scored[:CORRIGE_TOP]]
    corrected = []
    t_ia = 0.0
    if top_words:
        t1 = time.time()
        try:
            corrected = correct_top(alvo, top_words)
        except Exception:
            corrected = []
        t_ia = round(time.time() - t1, 1)
    corrected_set = {c["palavra"] for c in corrected}
    result = list(corrected)
    for w, s in scored:
        if w in corrected_set:
            continue
        result.append({"palavra": w, "score": round(max(0.1, min(0.9999, s)), 4)})
    if len(result) < 50:
        raise ValueError(f"contexto curto ({len(result)})")
    return result[:WORDS_PER_CONTEXT], t_spacy, t_ia


def main():
    targets = load_targets()
    if LIMIT > 0:
        targets = targets[:LIMIT]
    pool = load_word_pool()
    db.init_db()
    done_set = {c["alvo"] for c in db.list_contextos()}

    total = len(targets)
    errors = 0
    done = 0

    for idx, alvo in enumerate(targets):
        if alvo in done_set:
            done += 1
            emit(done=done, total=total, current=alvo, errors=errors, log=f"PULOU {alvo} (já gerado)", running=True, finished=False, skipped=True)
            continue

        emit(done=done, total=total, current=alvo, errors=errors, running=True, finished=False)
        t_start = time.time()
        log = ""
        try:
            ranking, t_spacy, t_ia = build_context(alvo, pool)
            t_total = round(time.time() - t_start, 1)
            db.save_contexto(alvo, time.strftime("%Y-%m-%dT%H:%M:%S"), ranking)
            log = f"OK {alvo} · {len(ranking)} palavras · {t_total}s (spaCy {t_spacy}s · IA {t_ia}s)"
        except Exception as e:
            t_total = round(time.time() - t_start, 1)
            errors += 1
            log = f"ERRO {alvo} · {str(e)[:80]} · {t_total}s"
            emit(done=done, total=total, current=alvo, errors=errors, last_error=str(e)[:200], log=log, running=True, finished=False)

        done += 1
        emit(done=done, total=total, current=alvo, errors=errors, log=log, running=True, finished=False)

        if idx < total - 1:
            time.sleep(INTERVAL_S)

    emit(done=done, total=total, current="", errors=errors, running=False, finished=True)


if __name__ == "__main__":
    main()
