"""Utilitários comuns do daemon — extraídos de service.py (sem mudança de comportamento).

Fase A do plano de separação estrutural (ver docs/separacao-estrutural.md).
Extrações: get_rank_color, DEFAULT_SETTINGS, normalize_settings, emit.
"""
import json
import unicodedata
from contextvars import ContextVar


_SESSION_ID = ContextVar("tikplay_daemon_session_id", default=None)
_ACTIVE_SESSION_IDS = {}


def bind_session_id(session_id):
    """Vincula session_id à task atual e às tasks filhas (asyncio context)."""
    return _SESSION_ID.set(str(session_id) if session_id else None)


def reset_session_id(token):
    _SESSION_ID.reset(token)


def set_active_session_id(tenant_id, session_id):
    if tenant_id is None:
        return
    if session_id:
        _ACTIVE_SESSION_IDS[tenant_id] = str(session_id)
    else:
        _ACTIVE_SESSION_IDS.pop(tenant_id, None)


def clear_active_session_id(tenant_id, expected_session_id=None):
    current = _ACTIVE_SESSION_IDS.get(tenant_id)
    if current is not None and (expected_session_id is None or current == str(expected_session_id)):
        _ACTIVE_SESSION_IDS.pop(tenant_id, None)


def get_rank_color(rank: int) -> str:
    if rank == 1:
        return "green"
    if rank <= 50:
        return "lime"
    if rank <= 300:
        return "yellow"
    if rank <= 1000:
        return "orange"
    return "red"


DEFAULT_SETTINGS = {
    "apenas_seguidores": False,
    "apenas_heart_me": False,
    "pct_dica": 70,
    "pct_charada": 30,
    "tts_rate": 1.0,
    "tts_voice": "",
    "chat_narr_enabled": False,
    "chat_narr_mode": "all",
    "chat_narr_char": "#",
    "command_prefix": "#",
    "auto_round": False,
    "auto_round_pause": 20,
    "riddle_auto_narrate": True,
    "tap_meta": 1000,
    "boss_mode": True,
}


def normalize_settings(raw) -> dict:
    settings = dict(DEFAULT_SETTINGS)
    if not isinstance(raw, dict):
        return settings
    for key in ("apenas_seguidores", "apenas_heart_me"):
        if key in raw:
            settings[key] = bool(raw[key])
    for key, other in (("pct_dica", "pct_charada"), ("pct_charada", "pct_dica")):
        if key in raw:
            try:
                val = int(raw[key])
                val = max(0, min(100, val))
            except (TypeError, ValueError):
                val = DEFAULT_SETTINGS[key]
            settings[key] = val
            settings[other] = 100 - val
    if "tts_rate" in raw:
        try:
            val = float(raw["tts_rate"])
            val = max(0.1, min(10.0, val))
        except (TypeError, ValueError):
            val = DEFAULT_SETTINGS["tts_rate"]
        settings["tts_rate"] = val
    if "tts_voice" in raw:
        settings["tts_voice"] = str(raw["tts_voice"] or "").strip()
    if "chat_narr_enabled" in raw:
        settings["chat_narr_enabled"] = bool(raw["chat_narr_enabled"])
    if "chat_narr_mode" in raw:
        mode = str(raw["chat_narr_mode"] or "all").strip()
        if mode == "no_guesses":
            mode = "exclude"
        settings["chat_narr_mode"] = mode if mode in ("all", "exclude", "only") else "all"
    if "chat_narr_char" in raw:
        char = str(raw["chat_narr_char"] or "")
        settings["chat_narr_char"] = char[:1] or "#"
    if "command_prefix" in raw:
        prefix = str(raw["command_prefix"] or "").strip()
        settings["command_prefix"] = prefix if prefix in ("#", "!") else ("" if prefix == "" else settings["command_prefix"])
    if "auto_round" in raw:
        settings["auto_round"] = bool(raw["auto_round"])
    if "auto_round_pause" in raw:
        try:
            val = int(raw["auto_round_pause"])
            settings["auto_round_pause"] = max(5, min(300, val))
        except (TypeError, ValueError):
            pass
    if "tap_meta" in raw:
        try:
            val = int(raw["tap_meta"])
            settings["tap_meta"] = max(50, min(100000, val))
        except (TypeError, ValueError):
            pass
    if "riddle_auto_narrate" in raw:
        settings["riddle_auto_narrate"] = bool(raw["riddle_auto_narrate"])
    if "boss_mode" in raw:
        settings["boss_mode"] = bool(raw["boss_mode"])
    return settings


def emit(tenant_id, type_, payload, session_id=None):
    out = {"tenant_id": tenant_id, "type": type_}
    sid = session_id or _SESSION_ID.get()
    if not sid and tenant_id is not None:
        sid = _ACTIVE_SESSION_IDS.get(tenant_id)
    if sid:
        out["session_id"] = str(sid)
    if type_ == "status":
        out["status"] = payload
    elif type_ == "game":
        out["msg"] = payload
    elif type_ in ("interaction", "live_session", "viewer_level"):
        out[type_] = payload
    elif type_ == "log" and isinstance(payload, dict):
        # Compatível com o legado; logs estruturados preservam categoria/evento/origem.
        out.update(payload)
        out.setdefault("source", "python")
    elif type_ == "log":
        out["text"] = payload
        out["source"] = "python"
    else:
        out["text"] = payload
    print(json.dumps(out, ensure_ascii=False), flush=True)

def strip_accents(s: str) -> str:
    if not s:
        return ""
    s = s.lower().strip()
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


GIFT_PT_MAP = {
    "rose": "Rosa",
    "finger heart": "Coração com os Dedos",
    "hand heart": "Coração com as Mãos",
    "tiktok": "TikTok",
    "ice cream": "Casquinha de Sorvete",
    "doughnut": "Rosquinha",
    "donut": "Rosquinha",
    "coffee": "Café",
    "weights": "Halteres",
    "paper crane": "Ave de Papel (Tsuru)",
    "cap": "Boné",
    "panda": "Panda",
    "perfume": "Perfume",
    "microphone": "Microfone",
    "crown": "Coroa",
    "gg": "GG",
    "love bear": "Ursinho do Amor",
    "sunglasses": "Óculos de Sol",
    "gold mine": "Mina de Ouro",
    "lion": "Leão",
    "galaxy": "Galáxia",
    "universe": "Universo",
    "rosa": "Rosa",
}
