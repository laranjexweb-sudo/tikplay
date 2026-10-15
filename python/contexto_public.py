"""Jogo Contexto público (site) — motor sem live.

Reaproveita `JogoContexto` (jogos/palavra.py) para calcular ranks por
similaridade spaCy, sem sessão de TikTok, sem presentes e sem histórico.

Modos:
  - diário: palavra pseudorrandômica, fixa por navegador e data de São Paulo;
  - ilimitado: palavra aleatória por rodada (Map em memória com TTL).

Protocolo (via service.py): comandos `public_*` sem `tenant_id`; a resposta é
emitida no formato {"tenant_id": null, "type": "public_result", "req_id", "ok", "data"}.
"""
import asyncio
import hashlib
import hmac
import json
import os
import random
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import db
from jogos.palavra import JogoContexto, strip_accents

# Fuso fixo de Brasília (sem horário de verão) para a virada do jogo do dia.
SP_TZ = timezone(timedelta(hours=-3))

# Posições (0-based) em all_scored usadas nas 3 dicas -> rank = pos + 2.
# Dica 1 mais vaga, dica 3 mais próxima.
HINT_INDEXES = [98, 48, 13]

MAX_HINTS = 3
ROUND_TTL = 6 * 3600  # 6h: rodadas ilimitadas abandonadas expiram
_rounds = {}


def _now_sp() -> datetime:
    return datetime.now(SP_TZ)


def _today_str() -> str:
    return _now_sp().date().isoformat()


class PublicContexto:
    """Fachada sem estado de sessão sobre o motor JogoContexto."""

    def __init__(self):
        # tenant_id=None: não usa histórico por tenant; nunca grava (não chamamos save).
        self.engine = JogoContexto(tenant_id=None)
        self._ready_key = None

    # ---- palavra do dia ----
    def daily_word(self, client_id: str) -> str:
        words = self.engine.word_pool
        n = len(words)
        if not n:
            return ""
        try:
            banned = db.load_banned_words()
        except Exception:
            banned = set()
        # Mantém a palavra por navegador/dia, sem guardar identificadores no banco.
        key = (os.environ.get("PUBLIC_GAME_SECRET") or os.environ.get("JWT_SECRET") or "tikplay-contexto-public-local-v1").encode("utf-8")
        assignment = f"{_today_str()}:{client_id or 'local'}".encode("utf-8")
        digest = hmac.new(key, assignment, hashlib.sha256).digest()
        idx = int.from_bytes(digest[:8], "big") % n
        for i in range(n):
            w = words[(idx + i) % n]
            if strip_accents(w) not in banned:
                return w
        return words[idx % n]

    # ---- índice da palavra secreta (custa ~3-6s na 1ª vez por palavra) ----
    def select(self, secret: str):
        key = strip_accents(secret)
        if self._ready_key == key:
            return
        self.engine.secret_word = secret
        self.engine.guesses = []
        self.engine.hints_given = []
        self.engine.finished = False
        self.engine.all_scored = []
        self.engine.hint_pool = []
        self.engine._secret_index_key = None
        self.engine._build_hint_pool()
        self._ready_key = key

    # ---- palpite ----
    def guess(self, secret: str, word: str) -> dict:
        self.select(secret)
        word = (word or "").strip()
        if not word:
            return {"error": "vazio"}
        # primeira palavra apenas (multi-palavra considera só o 1º token)
        token = re.split(r"\s+", word)[0]
        token = re.sub(r"[^\w]", "", token, flags=re.UNICODE)
        token = re.sub(r"\d+", "", token)
        norm = strip_accents(token)
        if not norm or len(norm) < 2:
            return {"error": "palpite muito curto"}
        display = self.engine.norm_to_word.get(norm, token)
        rank = self.engine._compute_rank(display)
        finished = norm == strip_accents(secret)
        if finished:
            display = secret
            rank = 1
        return {
            "word": display,
            "rank": rank,
            "finished": finished,
            "secret_word": secret if finished else None,
        }

    # ---- dica ----
    def hint(self, secret: str, index: int, avoid=None) -> dict:
        self.select(secret)
        n = len(self.engine.all_scored)
        if n == 0:
            return {"word": None, "rank": None}
        avoid_norm = {strip_accents(a) for a in (avoid or []) if a}
        try:
            index = int(index)
        except (TypeError, ValueError):
            index = 1
        index = max(1, min(MAX_HINTS, index))
        pos = min(HINT_INDEXES[index - 1], n - 1)
        best = None
        for radius in range(n):
            for p in (pos - radius, pos + radius):
                if 0 <= p < n:
                    w = self.engine.all_scored[p]
                    if strip_accents(w) in avoid_norm:
                        continue
                    best = w
                    break
            if best:
                break
        if not best:
            best = self.engine.all_scored[pos]
        return {"word": best, "rank": self.engine._compute_rank(best)}

    # ---- rodadas ilimitadas ----
    def new_round(self, exclude=None) -> dict:
        try:
            banned = db.load_banned_words()
        except Exception:
            banned = set()
        excluded = {
            strip_accents(w)
            for w in (exclude or [])
            if isinstance(w, str) and w.strip()
        }
        available = [
            w for w in self.engine.word_pool
            if strip_accents(w) not in banned and strip_accents(w) not in excluded
        ]
        if not available:
            raise ValueError("Você já acertou todas as palavras disponíveis neste navegador.")
        secret = random.choice(available)
        rid = uuid.uuid4().hex
        _rounds[rid] = {"secret": secret, "created": time.time()}
        self._cleanup()
        return {"roundId": rid}

    def _cleanup(self):
        now = time.time()
        for rid in [r for r, v in _rounds.items() if now - v["created"] > ROUND_TTL]:
            _rounds.pop(rid, None)

    def round_secret(self, round_id: str):
        r = _rounds.get(round_id)
        if not r:
            return None
        return r["secret"]


# ---------------- singleton + handler de comandos ----------------

_PUBLIC = None


def get_public() -> PublicContexto:
    global _PUBLIC
    if _PUBLIC is None:
        _PUBLIC = PublicContexto()
    return _PUBLIC


def _resolve_secret(mode: str, round_id: str, client_id: str) -> str:
    if mode == "unlimited":
        secret = get_public().round_secret(round_id)
        if not secret:
            raise ValueError("rodada expirada")
        return secret
    if not client_id:
        raise ValueError("identificador do navegador ausente")
    return get_public().daily_word(client_id)


async def _dispatch(cmd: dict) -> dict:
    c = cmd.get("cmd")
    public = get_public()
    mode = str(cmd.get("mode") or "daily")

    if c == "public_daily":
        return {"date": _today_str()}

    if c == "public_new_round":
        return public.new_round(cmd.get("exclude") or [])

    if c == "public_guess":
        word = str(cmd.get("word") or "")
        secret = _resolve_secret(mode, cmd.get("round_id"), str(cmd.get("client_id") or ""))
        return await asyncio.to_thread(public.guess, secret, word)

    if c == "public_hint":
        avoid = cmd.get("avoid") or []
        secret = _resolve_secret(mode, cmd.get("round_id"), str(cmd.get("client_id") or ""))
        return await asyncio.to_thread(public.hint, secret, cmd.get("index"), avoid)

    raise ValueError(f"comando publico desconhecido: {c}")


async def handle_public_command(cmd: dict):
    req_id = cmd.get("req_id")
    try:
        data = await _dispatch(cmd)
        ok = True
    except Exception as e:  # noqa: BLE001 - devolve erro ao cliente
        data = {"error": f"{type(e).__name__}: {e}"}
        ok = False
    out = {"tenant_id": None, "type": "public_result", "req_id": req_id, "ok": ok, "data": data}
    print(json.dumps(out, ensure_ascii=False), flush=True)
