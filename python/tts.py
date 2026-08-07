import asyncio
import hashlib
import json
import os
import re
import time
import urllib.request
import wave

try:
    from gtts import gTTS
    GTTS_AVAILABLE = True
except Exception:
    GTTS_AVAILABLE = False

PIPER_AVAILABLE = False
PiperVoice = None
SynthesisConfig = None
try:
    from piper import PiperVoice
    from piper.config import SynthesisConfig
    PIPER_AVAILABLE = True
except Exception:
    pass

EDGE_AVAILABLE = False
try:
    import edge_tts
    EDGE_AVAILABLE = True
except Exception:
    edge_tts = None

VOICE_GTTAS = "gtts"
VOICE_PIPER_FABER = "piper_faber"
VOICE_EDGE_ANTONIO = "edge_antonio"
VOICE_EDGE_FRANCISCA = "edge_francisca"
VOICE_KOKORO_DORA = "kokoro_pf_dora"
VOICE_KOKORO_ALEX = "kokoro_pm_alex"
VOICE_LABELS = {
    VOICE_GTTAS: "Google (gTTS) — voz do servidor",
    VOICE_PIPER_FABER: "Piper — Faber (servidor)",
    VOICE_EDGE_ANTONIO: "Edge — Antonio (servidor)",
    VOICE_EDGE_FRANCISCA: "Edge — Francisca (servidor)",
    VOICE_KOKORO_DORA: "Kokoro — Dora (Feminina) — servidor",
    VOICE_KOKORO_ALEX: "Kokoro — Alex (Masculina) — servidor",
}

EDGE_VOICE_MAP = {
    VOICE_EDGE_ANTONIO: "pt-BR-AntonioNeural",
    VOICE_EDGE_FRANCISCA: "pt-BR-FranciscaNeural",
}

KOKORO_URL = os.environ.get("KOKORO_URL", "http://localhost:8000")
KOKORO_VOICE_MAP = {
    VOICE_KOKORO_DORA: "pf_dora",
    VOICE_KOKORO_ALEX: "pm_alex",
}

_kokoro_checked = 0.0
_kokoro_ok = False

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tts_models")
PIPER_MODEL_PATH = os.path.join(MODELS_DIR, "pt_BR-faber-medium.onnx")

_piper_voice = None


def gtts_available() -> bool:
    return GTTS_AVAILABLE


def piper_available() -> bool:
    return PIPER_AVAILABLE and os.path.exists(PIPER_MODEL_PATH)


def edge_available() -> bool:
    return EDGE_AVAILABLE


def kokoro_available() -> bool:
    """Verifica (com cache de ~30s) se o servico Kokoro esta no ar."""
    global _kokoro_checked, _kokoro_ok
    now = time.time()
    if now - _kokoro_checked < 30:
        return _kokoro_ok
    _kokoro_checked = now
    _kokoro_ok = False
    try:
        req = urllib.request.Request(f"{KOKORO_URL}/voices", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200:
                _kokoro_ok = True
    except Exception:
        pass
    return _kokoro_ok


def _get_piper_voice():
    global _piper_voice
    if _piper_voice is None and piper_available():
        _piper_voice = PiperVoice.load(PIPER_MODEL_PATH)
    return _piper_voice


def voices() -> list:
    result = []
    if GTTS_AVAILABLE:
        result.append({"key": VOICE_GTTAS, "label": VOICE_LABELS[VOICE_GTTAS]})
    if piper_available():
        result.append({"key": VOICE_PIPER_FABER, "label": VOICE_LABELS[VOICE_PIPER_FABER]})
    if edge_available():
        result.append({"key": VOICE_EDGE_ANTONIO, "label": VOICE_LABELS[VOICE_EDGE_ANTONIO]})
        result.append({"key": VOICE_EDGE_FRANCISCA, "label": VOICE_LABELS[VOICE_EDGE_FRANCISCA]})
    if kokoro_available():
        result.append({"key": VOICE_KOKORO_DORA, "label": VOICE_LABELS[VOICE_KOKORO_DORA]})
        result.append({"key": VOICE_KOKORO_ALEX, "label": VOICE_LABELS[VOICE_KOKORO_ALEX]})
    return result


def _hash(text: str, extra: str) -> str:
    return hashlib.md5(f"{text}|{extra}".encode("utf-8")).hexdigest()


def clean_text(text: str, max_len: int = 200) -> str:
    """Limpa o texto para sintese TTS.

    Remove URLs, @mencoes, hashtags, emojis e simbolos que fazem o
    phonemizador (espeak) trocar de idioma ou sair truncado. Mantem
    letras (com acentos), numeros, espacos e pontuacao basica.
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


def _pad_wav(path, lead_s=0.25, tail_s=0.15):
    """Insere silencio no inicio e no fim de um WAV PCM 16-bit mono (in-place).

    Evita que a primeira palavra seja cortada na reproducao e da respiro no final.
    """
    try:
        with wave.open(path, "rb") as w:
            nch = w.getnchannels()
            sw = w.getsampwidth()
            fr = w.getframerate()
            frames = w.readframes(w.getnframes())
        if nch != 1 or sw != 2:
            return
        lead = int(lead_s * fr)
        tail = int(tail_s * fr)
        if lead <= 0 and tail <= 0:
            return
        silence = b"\x00\x00"
        with wave.open(path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(fr)
            w.writeframes(silence * lead)
            w.writeframes(frames)
            w.writeframes(silence * tail)
    except Exception:
        pass


def synthesize_gtts(text: str, out_dir: str, slow: bool = False):
    """Gera um MP3 com a voz Google (gTTS). Retorna o caminho ou None."""
    text = clean_text(text)
    if not GTTS_AVAILABLE or not text:
        return None
    os.makedirs(out_dir, exist_ok=True)
    fname = f"gtts_{_hash(text, 'slow' if slow else 'normal')}.mp3"
    out_path = os.path.join(out_dir, fname)
    if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
        return out_path
    try:
        tts = gTTS(text=text, lang="pt", slow=slow)
        tts.save(out_path)
    except Exception:
        _cleanup(out_path)
        return None
    return out_path


def synthesize_piper(text: str, out_dir: str, rate: float = 1.0):
    """Gera um WAV com o Piper (modelo faber). Retorna o caminho ou None.

    rate: velocidade (0.5 = lento, 1.0 = normal, 2.0 = rapido).
    """
    text = clean_text(text)
    if not piper_available() or not text:
        return None
    voice = _get_piper_voice()
    if voice is None:
        return None
    os.makedirs(out_dir, exist_ok=True)
    fname = f"piper_{_hash(text, f'pad{round(float(rate), 3)}')}.wav"
    out_path = os.path.join(out_dir, fname)
    if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
        return out_path
    try:
        if rate > 0:
            length_scale = max(0.25, min(4.0, 1.0 / rate))
        else:
            length_scale = 1.0
        syn = SynthesisConfig(length_scale=length_scale)
        with wave.open(out_path, "wb") as wf:
            voice.synthesize_wav(text, wf, syn_config=syn)
        _pad_wav(out_path, lead_s=0.25, tail_s=0.15)
    except Exception:
        _cleanup(out_path)
        return None
    return out_path


def _edge_rate_str(rate: float) -> str:
    pct = round((float(rate) - 1.0) * 100)
    return f"+{pct}%" if pct >= 0 else f"{pct}%"


def synthesize_edge(text: str, out_dir: str, voice_key: str, rate: float = 1.0):
    """Gera um MP3 com as vozes Edge (Microsoft Antonio/Francisca). Retorna o caminho ou None."""
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
        async def _run():
            c = edge_tts.Communicate(text, ms_voice, rate=_edge_rate_str(rate))
            await c.save(out_path)
        asyncio.run(_run())
    except Exception:
        _cleanup(out_path)
        return None
    return out_path


def synthesize_kokoro(text: str, out_dir: str, voice_key: str, rate: float = 1.0):
    """Gera um WAV com o servico Kokoro (pf_dora / pm_alex). Retorna o caminho ou None.

    rate: velocidade (0.3 a 2.0; o servico aceita speed entre 0.3 e 2.0).
    """
    text = clean_text(text)
    if not text:
        return None
    voice = KOKORO_VOICE_MAP.get(voice_key)
    if not voice:
        return None
    os.makedirs(out_dir, exist_ok=True)
    speed = max(0.3, min(2.0, float(rate) if float(rate) > 0 else 1.0))
    fname = f"kokoro_{_hash(text, f'{voice_key}|{round(speed, 3)}')}.wav"
    out_path = os.path.join(out_dir, fname)
    if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
        return out_path
    try:
        payload = json.dumps({"text": text, "voice": voice, "speed": speed}).encode("utf-8")
        req = urllib.request.Request(
            f"{KOKORO_URL}/tts",
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        if not data:
            _cleanup(out_path)
            return None
        with open(out_path, "wb") as f:
            f.write(data)
    except Exception:
        _cleanup(out_path)
        return None
    return out_path
