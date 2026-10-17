"""Optional tenant-scoped ElevenLabs chat speech; no third-party SDK required."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone

import tts
import tts_emotions
import api_costs

MAX_AUDIO_BYTES = 5 * 1024 * 1024
MAX_CHAT_CHARACTERS = 150


class ProviderError(Exception):
    pass


def _api_key():
    path = os.environ.get("ELEVENLABS_CONFIG_PATH") or str(
        Path(__file__).resolve().parents[1] / "node" / "data" / "integrations" / "elevenlabs.json")
    try:
        with open(path, encoding="utf-8") as file:
            data = json.load(file)
        return data.get("api_key", "") if isinstance(data, dict) and isinstance(data.get("api_key"), str) else ""
    except FileNotFoundError:
        return os.environ.get("ELEVENLABS_API_KEY", "")
    except (OSError, ValueError):
        return ""


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


def _config(conn, tenant_id):
    return conn.execute("""SELECT e.* FROM tenant_elevenlabs e JOIN users u ON u.id=e.tenant_id
        WHERE e.tenant_id=? AND e.enabled=1 AND u.status='active'""", (tenant_id,)).fetchone()


def synthesize(tenant_id, text, out_dir, rate=1.0, emotion=None, credit_charger=None):
    """Return (path, code), or (None, code) for fallback. Never log text/secrets."""
    text = tts.clean_text(text, max_len=MAX_CHAT_CHARACTERS)
    for index, character in enumerate(text):
        if character.isalpha():
            text = (text[:index] + character.upper() + text[index + 1:])[:MAX_CHAT_CHARACTERS]
            break
    key = _api_key()
    if not key or not text:
        return None, "NOT_CONFIGURED"
    model = os.environ.get("ELEVENLABS_MODEL_ID") or "eleven_v4_turbo"
    supported_tag_models = {"eleven_v4", "eleven_v4_turbo", "eleven_v3", "eleven_v3_conversational"}
    emotion_tag = tts_emotions.instruction_for("eleven", emotion) if model in supported_tag_models else None
    speech_text = f"[{emotion_tag}] {text}" if emotion_tag else text
    supports_speed = model not in ("eleven_v4", "eleven_v4_turbo", "eleven_v3")
    speed = max(0.7, min(1.2, float(rate))) if supports_speed else 1.0
    try:
        with _connect() as conn:
            config = _config(conn, tenant_id)
            if not config or not config["voice_id"]:
                return None, "NOT_SELECTED"
            voice = config["voice_id"]
            digest = hashlib.sha256(f"{speech_text}|{voice}|{model}|{speed}".encode()).hexdigest()
            output = Path(out_dir) / f"eleven_{digest}.mp3"
            if output.is_file() and output.stat().st_size:
                return str(output), "CACHE_HIT"
            if credit_charger:
                _, charge_code = credit_charger()
                if charge_code != "CHARGED":
                    return None, charge_code
            else:
                # Compatibility path for direct internal callers. Production chat
                # synthesis passes the wallet charger through additional_voice_tts.
                conn.execute("BEGIN IMMEDIATE")
                config = _config(conn, tenant_id)
                if not config or config["voice_id"] != voice:
                    return None, "ACCESS_CHANGED"
                month = datetime.now(timezone.utc).strftime("%Y-%m")
                conn.execute("INSERT OR IGNORE INTO elevenlabs_usage(tenant_id,month) VALUES(?,?)", (tenant_id, month))
                changed = conn.execute("""UPDATE elevenlabs_usage SET characters=characters+?
                    WHERE tenant_id=? AND month=? AND characters+?<=?""",
                    (len(text), tenant_id, month, len(text), config["monthly_limit"])).rowcount
                if not changed:
                    return None, "LIMIT_REACHED"
        payload = {"text": speech_text, "model_id": model, "language_code": "pt"}
        if supports_speed:
            payload["voice_settings"] = {"speed": speed}
        body = json.dumps(payload).encode()
        request = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
            data=body, headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
            method="POST")
        started = time.monotonic()
        provider_request_id = None
        provider_status = "failed"
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                if response.status != 200 or "audio/" not in response.headers.get("Content-Type", ""):
                    raise ProviderError("INVALID_AUDIO")
                provider_request_id = response.headers.get("request-id") or response.headers.get("x-request-id")
                audio = response.read(MAX_AUDIO_BYTES + 1)
                if not audio or len(audio) > MAX_AUDIO_BYTES:
                    raise ProviderError("INVALID_AUDIO")
                provider_status = "success"
        except ProviderError:
            raise
        except Exception as exc:
            is_timeout = isinstance(exc, TimeoutError) or isinstance(getattr(exc, "reason", None), TimeoutError)
            provider_status = "timeout" if is_timeout else "failed"
            raise ProviderError("SYNTHESIS_FAILED") from None
        finally:
            api_costs.record("elevenlabs", model, "chat_voice", "character", len(text), provider_status,
                (time.monotonic() - started) * 1000, tenant_id, provider_request_id=provider_request_id)
        if _api_key() != key:
            return None, "ACCESS_CHANGED"
        with _connect() as conn:
            current = _config(conn, tenant_id)
            if not current or current["voice_id"] != voice:
                return None, "ACCESS_CHANGED"
        output.parent.mkdir(parents=True, exist_ok=True)
        tts._prune_audio_cache(str(output.parent))
        temp = output.with_suffix(f".{uuid.uuid4().hex}.tmp")
        try:
            temp.write_bytes(audio)
            os.replace(temp, output)
        finally:
            if temp.exists():
                temp.unlink()
        return str(output), "SYNTHESIZED"
    except sqlite3.OperationalError:
        return None, "NOT_AVAILABLE"
