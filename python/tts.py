"""TTS Edge-only — infraestrutura de narração refatorada (somente Microsoft Edge).

Remove gTTS, Piper e Kokoro. Dependência única: `edge-tts` (v7+).
"""
import asyncio
import hashlib
import os
import re
import time

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
    VOICE_EDGE_ANTONIO: "Edge — Antonio (servidor)",
    VOICE_EDGE_FRANCISCA: "Edge — Francisca (servidor)",
}

EDGE_VOICE_MAP = {
    VOICE_EDGE_ANTONIO: "pt-BR-AntonioNeural",
    VOICE_EDGE_FRANCISCA: "pt-BR-FranciscaNeural",
}

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

    Remove URLs, @mencoes, hashtags, emojis e simbolos que fazem o motor
    truncar. Mantem letras (com acentos), numeros, espacos e pontuacao basica.
    """
    if not text:
        return ""
    t = text
    t = re.sub(r"https?://\S+|www\.\S+", " ", t, flags=re.IGNORECASE)
    t = re.sub(r"@\w+", " ", t)
    t = re.sub(r"#\S+", " ", t)
    t = re.sub(r"[^\w\s.,!?;:'\"()\-]", " ", t, flags=re.UNICODE)
    t = t.replace("_", " ")
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) > max_len:
        cut = t[:max_len].rsplit(" ", 1)[0].rstrip()
        t = cut if cut else t[:max_len].rstrip()
    return t


def _cleanup(path):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def _edge_rate_str(rate: float) -> str:
    pct = round((float(rate) - 1.0) * 100)
    return f"+{pct}%" if pct >= 0 else f"{pct}%"


def synthesize_edge(text: str, out_dir: str, voice_key: str, rate: float = 1.0):
    """Gera um MP3 com as vozes Edge (Microsoft). Retorna o caminho ou None."""
    text = clean_text(text)
    if not EDGE_AVAILABLE or not text:
        return None
    ms_voice = EDGE_VOICE_MAP.get(voice_key)
    if not ms_voice:
        return None
    os.makedirs(out_dir, exist_ok=True)
    fname = f"edge_{_hash(text, f'{voice_key}|{round(float(rate), 3)}')}.mp3"
    out_path = os.path.join(out_dir, fname)
    if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
        return out_path
    try:
        _last_err = None
        for attempt in range(3):
            try:
                async def _run():
                    c = edge_tts.Communicate(text, ms_voice, rate=_edge_rate_str(rate))
                    await c.save(out_path)
                asyncio.run(_run())
                break
            except Exception as e:
                _last_err = e
                _cleanup(out_path)
                if attempt < 2:
                    time.sleep(0.6)
        else:
            raise _last_err
    except Exception:
        _cleanup(out_path)
        return None
    return out_path