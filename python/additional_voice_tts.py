"""Tenant-scoped synthesis for the admin-managed additional voice catalog."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import struct
import urllib.request
import uuid
from contextlib import contextmanager

import tts
import elevenlabs_tts
import tts_emotions
import tts_credits

MAX_AUDIO_BYTES = 5 * 1024 * 1024
MAX_CHAT_CHARACTERS = 150
CATALOG_PATH = Path(__file__).resolve().parents[1] / "node" / "lib" / "additional-voice-models.json"
try:
    MODELS = {item["id"]: item for item in json.loads(CATALOG_PATH.read_text(encoding="utf-8"))}
except (OSError, ValueError, KeyError, TypeError):
    MODELS = {}


class ProviderError(Exception):
    pass


@contextmanager
def _connect():
    path = os.environ.get("DB_PATH") or str(Path(__file__).resolve().parents[1] / "node" / "data.db")
    conn = sqlite3.connect(path, timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _clean(text):
    value = tts.clean_text(text, max_len=MAX_CHAT_CHARACTERS)
    for index, character in enumerate(value):
        if character.isalpha():
            return (value[:index] + character.upper() + value[index + 1:])[:MAX_CHAT_CHARACTERS]
    return value


def _selection(conn, tenant_id):
    try:
        row = conn.execute("""SELECT e.*,u.status FROM tenant_elevenlabs e JOIN users u ON u.id=e.tenant_id
            WHERE e.tenant_id=? AND e.enabled=1""", (tenant_id,)).fetchone()
        if not row or row["status"] != "active":
            return None
        values = dict(row)
        values.setdefault("model_id", "elevenlabs/eleven-v4-turbo")
        return values
    except sqlite3.OperationalError:
        return None


def _model_enabled(conn, model_id):
    try:
        row = conn.execute("SELECT enabled FROM additional_voice_models WHERE model_id=?", (model_id,)).fetchone()
        return bool(row and row["enabled"] == 1)
    except sqlite3.OperationalError:
        return model_id == "elevenlabs/eleven-v4-turbo"


def _voice_enabled(conn, model_id, voice_id):
    try:
        row = conn.execute("SELECT enabled FROM additional_voice_options WHERE model_id=? AND voice_id=?",
                           (model_id, voice_id)).fetchone()
        return bool(row and row["enabled"] == 1)
    except sqlite3.OperationalError:
        # Older databases remain compatible until the Node service creates the allowlist table.
        return _model_enabled(conn, model_id)


def _wav_from_pcm(audio, sample_rate):
    channels, bits = 1, 16
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    header = b"RIFF" + struct.pack("<I", 36 + len(audio)) + b"WAVEfmt "
    header += struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, bits)
    header += b"data" + struct.pack("<I", len(audio))
    return header + audio


def _synthesize_openrouter(model, voice, text, key, emotion=None):
    payload = {"model": model["model_id"], "input": text,
               "voice": voice, "response_format": model.get("response_format", "mp3")}
    if model.get("model_id", "").startswith("google/gemini-"):
        instruction = tts_emotions.instruction_for("gemini", emotion)
        if instruction:
            payload["instructions"] = instruction
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/audio/speech", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "Accept": "audio/mpeg, audio/pcm, audio/wav"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            if response.status != 200:
                raise ProviderError("SYNTHESIS_FAILED")
            content_type = response.headers.get("Content-Type", "").lower()
            audio = response.read(MAX_AUDIO_BYTES + 1)
    except ProviderError:
        raise
    except Exception:
        raise ProviderError("SYNTHESIS_FAILED") from None
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise ProviderError("INVALID_AUDIO")
    if "audio/mpeg" in content_type or "audio/mp3" in content_type:
        return audio, ".mp3"
    if "audio/wav" in content_type or "audio/wave" in content_type:
        return audio, ".wav"
    if "audio/pcm" in content_type:
        return _wav_from_pcm(audio, int(model.get("pcm_sample_rate") or 24000)), ".wav"
    raise ProviderError("INVALID_AUDIO")


def synthesize(tenant_id, text, out_dir, rate=1.0, emotion=None):
    """Return (path, code), or (None, code) for fallback; never log content or secrets."""
    text = _clean(text)
    emotion = tts_emotions.canonical_emotion(emotion)
    if not text:
        return None, "NOT_SELECTED"
    try:
        with _connect() as conn:
            selection = _selection(conn, tenant_id)
            if not selection:
                return None, "NOT_SELECTED"
            model_id = selection.get("model_id") or "elevenlabs/eleven-v4-turbo"
            model = MODELS.get(model_id)
            voice = selection.get("voice_id") or ""
            if not model or not voice or not _model_enabled(conn, model_id) or not _voice_enabled(conn, model_id, voice):
                return None, "ACCESS_CHANGED"
            if model["provider"] == "elevenlabs":
                path, code = elevenlabs_tts.synthesize(tenant_id, text, out_dir, rate, emotion=emotion,
                    credit_charger=lambda: tts_credits.charge(tenant_id, model_id, len(text)))
                if path:
                    with _connect() as current_conn:
                        current = _selection(current_conn, tenant_id)
                        if not current or current.get("model_id", "elevenlabs/eleven-v4-turbo") != model_id \
                                or current.get("voice_id") != voice or not _voice_enabled(current_conn, model_id, voice):
                            try:
                                Path(path).unlink()
                            except OSError:
                                pass
                            return None, "ACCESS_CHANGED"
                return path, code
            key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
            if not key:
                return None, "NOT_CONFIGURED"
            instruction = tts_emotions.instruction_for("gemini", emotion) if model_id.startswith("google/gemini-") else ""
            digest = hashlib.sha256(f"{text}|{model_id}|{voice}|{instruction}".encode("utf-8")).hexdigest()
            output_base = Path(out_dir) / f"voice_{digest}"
            for suffix in (".mp3", ".wav"):
                existing = output_base.with_suffix(suffix)
                if existing.is_file() and existing.stat().st_size:
                    return str(existing), "CACHE_HIT"
            selection = _selection(conn, tenant_id)
            if not selection or selection.get("model_id", "elevenlabs/eleven-v4-turbo") != model_id or not _model_enabled(conn, model_id) or not _voice_enabled(conn, model_id, voice):
                return None, "ACCESS_CHANGED"
            _, charge_code = tts_credits.charge(tenant_id, model_id, len(text))
            if charge_code != "CHARGED":
                return None, charge_code
        audio, suffix = _synthesize_openrouter(model, voice, text, key, emotion)
        output = output_base.with_suffix(suffix)
        output.parent.mkdir(parents=True, exist_ok=True)
        tts._prune_audio_cache(str(output.parent))
        temp = output.with_name(f"{output.stem}.{uuid.uuid4().hex}.tmp")
        try:
            temp.write_bytes(audio)
            os.replace(temp, output)
        finally:
            if temp.exists():
                temp.unlink()
        with _connect() as conn:
            current = _selection(conn, tenant_id)
            if not current or current.get("model_id", "elevenlabs/eleven-v4-turbo") != model_id or current.get("voice_id") != voice or not _voice_enabled(conn, model_id, voice):
                try:
                    output.unlink()
                except OSError:
                    pass
                return None, "ACCESS_CHANGED"
        return str(output), "SYNTHESIZED"
    except ProviderError as exc:
        return None, str(exc)
    except sqlite3.OperationalError:
        return None, "NOT_AVAILABLE"
