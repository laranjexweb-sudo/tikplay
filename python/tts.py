"""TTS Edge-only — infraestrutura de narração refatorada (somente Microsoft Edge).

Remove gTTS, Piper e Kokoro. Dependência única: `edge-tts` (v7+).
"""
import asyncio
import hashlib
import math
import os
import re
import threading
import time
import unicodedata

EDGE_AVAILABLE = False
edge_tts = None
try:
    import edge_tts
    EDGE_AVAILABLE = True
except Exception:
    edge_tts = None

VOICE_EDGE_ANTONIO = "edge_antonio"
VOICE_EDGE_FRANCISCA = "edge_francisca"

VOICE_LABELS = {
    VOICE_EDGE_ANTONIO: "Antonio",
    VOICE_EDGE_FRANCISCA: "Francisca",
}

EDGE_VOICE_MAP = {
    VOICE_EDGE_ANTONIO: "pt-BR-AntonioNeural",
    VOICE_EDGE_FRANCISCA: "pt-BR-FranciscaNeural",
}

_EDGE_LOCK = threading.Lock()

EDGE_LAST_ERROR = ""
MAX_AUDIO_CACHE_FILES_PER_TENANT = 500

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tts_models")


def edge_available() -> bool:
    return EDGE_AVAILABLE


def voices() -> list:
    result = []
    if EDGE_AVAILABLE:
        result.append({"key": VOICE_EDGE_ANTONIO, "label": VOICE_LABELS[VOICE_EDGE_ANTONIO]})
        result.append({"key": VOICE_EDGE_FRANCISCA, "label": VOICE_LABELS[VOICE_EDGE_FRANCISCA]})
    return result


def _hash(text: str, extra: str) -> str:
    return hashlib.md5(f"{text}|{extra}".encode("utf-8")).hexdigest()


def clean_text(text: str, max_len: int = 200) -> str:
    """Limpa o texto para sintese TTS.

    Remove URLs, @mencoes, hashtags, emojis, codigos de emote e emoticons que fazem o motor
    truncar. Mantem letras (com acentos), numeros, espacos e pontuacao basica.
    """
    if not text:
        return ""
    t = unicodedata.normalize("NFC", str(text))
    # Remove complete emote codes before their brackets would be stripped.
    t = re.sub(r"\[[A-Za-z][A-Za-z0-9_-]{0,40}\]", " ", t)
    t = re.sub(r"(?<!\w):[A-Za-z][A-Za-z0-9_+-]{1,40}:(?!\w)", " ", t)
    t = re.sub(r"[#*0-9]\ufe0f?\u20e3", " ", t)
    t = re.sub(r"(?:[:;=][~^'\-]?[)(/\\dDpPoO*|]|</?3)(?!\w)|(?<!\w)(?:[xX][dD]|[tT][_.-][tT]|[uU][_.-][uU]|\^[_-]?\^)(?!\w)", " ", t)
    t = t.replace(r"¯\_(ツ)_/¯", " ")
    t = re.sub(r"https?://\S+|www\.\S+", " ", t, flags=re.IGNORECASE)
    t = re.sub(r"@\w+", " ", t)
    t = re.sub(r"#\S+", " ", t)
    t = re.sub(r"[^\w\s.,!?;:'\"()\-]", " ", t, flags=re.UNICODE)
    t = t.replace("_", " ")
    t = re.sub(r"\s+", " ", t).strip()
    if not any(char.isalpha() or char.isdigit() for char in t):
        return ""
    if len(t) > max_len:
        cut = t[:max_len].rsplit(" ", 1)[0].rstrip()
        t = cut if cut else t[:max_len].rstrip()
    return t


def prepare_chat_text(text: str, mode: str = "all", marker: str = "#", max_len: int = 200) -> str:
    """Aplica os filtros de narração e prepara um comentário para o TTS.

    `only` fala apenas comentários com o marcador inicial e remove o marcador
    antes da síntese. `exclude` omite esses comentários. O texto resultante
    passa pela limpeza compartilhada, que remove emojis e conteúdo não falável.
    """
    raw = str(text or "").strip()
    marker = str(marker or "#")[:1]
    mode = "exclude" if mode == "no_guesses" else str(mode or "all")
    starts_with_marker = bool(marker and raw.startswith(marker))

    if mode == "only":
        if not starts_with_marker:
            return ""
        raw = raw[len(marker):].lstrip()
    elif mode == "exclude" and starts_with_marker:
        return ""

    return clean_text(raw, max_len=max_len)


def _cleanup(path):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def _prune_audio_cache(out_dir: str, max_files: int = MAX_AUDIO_CACHE_FILES_PER_TENANT) -> int:
    """Mantém o cache de MP3 limitado sem remover os áudios mais recentes."""
    try:
        entries = [
            entry for entry in os.scandir(out_dir)
            if entry.is_file() and entry.name.lower().endswith(".mp3")
        ]
        entries.sort(key=lambda entry: entry.stat().st_mtime_ns)
    except (FileNotFoundError, OSError):
        return 0
    removed = 0
    for entry in entries[:max(0, len(entries) - max(0, int(max_files)))]:
        try:
            os.remove(entry.path)
            removed += 1
        except OSError:
            pass
    return removed


def _edge_rate_str(rate: float) -> str:
    try:
        value = float(rate)
    except (TypeError, ValueError):
        value = 1.0
    if not math.isfinite(value):
        value = 1.0
    pct = round((value - 1.0) * 100)
    return f"{pct:+d}%"


def synthesize_edge(text: str, out_dir: str, voice_key: str, rate: float = 1.0):
    """Gera um MP3 com as vozes Edge (Microsoft). Retorna o caminho ou None.

    Serializa as chamadas (uma por vez) e tenta varias vezes com backoff,
    porem o Edge e flaky em rajadas.
    """
    text = clean_text(text)
    if not EDGE_AVAILABLE or not text:
        EDGE_LAST_ERROR = "edge_tts indisponivel" if not EDGE_AVAILABLE else "texto vazio"
        return None
    ms_voice = EDGE_VOICE_MAP.get(voice_key)
    if not ms_voice:
        EDGE_LAST_ERROR = f"voz desconhecida: {voice_key}"
        return None
    os.makedirs(out_dir, exist_ok=True)
    _prune_audio_cache(out_dir)
    fname = f"edge_{_hash(text, f'{voice_key}|{round(float(rate), 3)}')}.mp3"
    out_path = os.path.join(out_dir, fname)
    if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
        EDGE_LAST_ERROR = ""
        return out_path
    try:
        _last_err = None
        for attempt in range(4):
            try:
                with _EDGE_LOCK:
                    async def _run():
                        c = edge_tts.Communicate(text, ms_voice, rate=_edge_rate_str(rate))
                        await asyncio.wait_for(c.save(out_path), timeout=10)
                    asyncio.run(_run())
                break
            except Exception as e:
                _last_err = e
                EDGE_LAST_ERROR = f"(tentativa {attempt + 1}) {type(e).__name__}: {e}"
                _cleanup(out_path)
                time.sleep(0.8 * (attempt + 1))
        else:
            raise _last_err
    except Exception:
        _cleanup(out_path)
        return None
    EDGE_LAST_ERROR = ""
    return out_path
