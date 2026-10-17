"""Allowlisted emotion commands at the end of chat messages for TTS providers."""
import re
import unicodedata


_EMOTIONS = {
    "grito": {"gemini": "gritando com intensidade e urgência", "eleven": "shouts"},
    "feliz": {"gemini": "alegre e feliz, com sorriso na voz", "eleven": "happy"},
    "animado": {"gemini": "animado e entusiasmado", "eleven": "excited"},
    "triste": {"gemini": "triste e abatido", "eleven": "sad"},
    "raiva": {"gemini": "irritado e com raiva", "eleven": "angry"},
    "sussurro": {"gemini": "sussurrando baixinho", "eleven": "whispers"},
    "medo": {"gemini": "assustado e apreensivo", "eleven": "afraid"},
    "surpresa": {"gemini": "surpreso e impressionado", "eleven": "surprised"},
    "rindo": {"gemini": "rindo enquanto fala", "eleven": "laughs"},
    "sarcasmo": {"gemini": "falando com sarcasmo", "eleven": "sarcastic"},
    "calmo": {"gemini": "calmo e tranquilo", "eleven": "calm"},
    "curioso": {"gemini": "curioso e interessado", "eleven": "curious"},
    "chorando": {"gemini": "chorando, com a voz emocionada", "eleven": "crying"},
}

_ALIASES = {
    "grito": "grito", "gritando": "grito", "gritar": "grito",
    "feliz": "feliz", "alegre": "feliz",
    "animado": "animado", "animada": "animado", "empolgado": "animado", "empolgada": "animado",
    "triste": "triste", "deprimido": "triste", "deprimida": "triste",
    "raiva": "raiva", "bravo": "raiva", "brava": "raiva", "irritado": "raiva", "irritada": "raiva",
    "sussurro": "sussurro", "sussurrando": "sussurro", "sussurrar": "sussurro",
    "medo": "medo", "assustado": "medo", "assustada": "medo",
    "surpresa": "surpresa", "surpreso": "surpresa",
    "rindo": "rindo", "risada": "rindo", "rir": "rindo",
    "sarcasmo": "sarcasmo", "sarcastico": "sarcasmo", "sarcastica": "sarcasmo",
    "calmo": "calmo", "calma": "calmo",
    "curioso": "curioso", "curiosa": "curioso",
    "chorando": "chorando", "choro": "chorando",
}

_TRAILING_TAG = re.compile(r"(?:^|\s)#([\w-]{1,32})\s*[.!?…]*\s*$", re.UNICODE)


def _normalize(value):
    return "".join(char for char in unicodedata.normalize("NFD", str(value or "").casefold())
                   if unicodedata.category(char) != "Mn")


def canonical_emotion(value):
    """Return a known, normalized emotion key; arbitrary chat text is never a prompt."""
    return _ALIASES.get(_normalize(value))


def extract_trailing_emotion(text):
    """Remove one recognized final #emotion and return (speech text, canonical key)."""
    raw = str(text or "")
    match = _TRAILING_TAG.search(raw)
    emotion = canonical_emotion(match.group(1)) if match else None
    if not match or not emotion:
        return raw, None
    return raw[:match.start()].rstrip(" \t,;"), emotion


def instruction_for(provider, emotion):
    canonical = canonical_emotion(emotion)
    return _EMOTIONS.get(canonical, {}).get(provider) if canonical else None
