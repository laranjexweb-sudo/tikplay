"""Cartesia Sonic synthesis for approved TikPlay voice catalog entries."""
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

import api_costs

API_VERSION = "2026-08-14"
API_URL = "https://api.cartesia.ai/tts/bytes"
MAX_AUDIO_BYTES = 5 * 1024 * 1024

# Convert common Portuguese chat laughter to Cartesia's documented nonverbalism.
# Keep this transformation local to Cartesia; billing and API usage continue to
# count the cleaned text written by the viewer, not the inserted marker.
_LAUGHTER_PATTERN = re.compile(
    r"(?<!\w)(?:(?:ha|he|rs|hua|hue)(?:[\s,.-]*(?:ha|he|rs|hua|hue))+|k{4,})(?!\w)",
    re.IGNORECASE,
)


def normalize_laughter(transcript):
    """Map clear repeated laughter tokens to Cartesia's [laughter] marker."""
    value = _LAUGHTER_PATTERN.sub("[laughter]", str(transcript or ""))
    return re.sub(r"(?:\[laughter\][\s,]*){2,}", "[laughter] ", value).strip()


class ProviderError(Exception):
    pass


def _api_key():
    directory = os.environ.get("INTEGRATIONS_CONFIG_DIR") or str(
        Path(__file__).resolve().parents[1] / "node" / "data" / "integrations")
    try:
        with open(Path(directory) / "cartesia.json", encoding="utf-8") as file:
            data = json.load(file)
        secret = data.get("secret", "") if isinstance(data, dict) else ""
        return secret if isinstance(secret, str) else ""
    except FileNotFoundError:
        return os.environ.get("CARTESIA_API_KEY", "")
    except (OSError, ValueError):
        return ""


def configured():
    return bool(_api_key())


def synthesize(tenant_id, model_id, voice_id, text, speed=1.0, emotion=None):
    key = _api_key()
    if not key:
        raise ProviderError("NOT_CONFIGURED")
    generation_config = {"speed": max(0.6, min(1.5, float(speed or 1.0)))}
    if emotion == "sussurro":
        # Cartesia has no documented whisper mode; use its lowest supported
        # volume as a best-effort quiet delivery cue.
        generation_config["volume"] = 0.5
    payload = {
        "model_id": model_id,
        "transcript": normalize_laughter(text),
        "voice": voice_id,
        "locale": "pt-BR",
        "normalization": "auto",
        "output_format": {"container": "wav", "encoding": "pcm_s16le", "sample_rate": 44100},
        "generation_config": generation_config,
    }
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Cartesia-Version": API_VERSION,
            "Content-Type": "application/json",
            "Accept": "audio/wav",
        },
        method="POST",
    )
    started = time.monotonic()
    request_id = None
    status = "failed"
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            request_id = response.headers.get("x-request-id") or response.headers.get("request-id")
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if response.status != 200 or not content_type.startswith("audio/"):
                raise ProviderError("INVALID_AUDIO")
            audio = response.read(MAX_AUDIO_BYTES + 1)
            if not audio or len(audio) > MAX_AUDIO_BYTES:
                raise ProviderError("INVALID_AUDIO")
            status = "success"
            return audio
    except urllib.error.HTTPError as exc:
        code = "CARTESIA_CREDENTIAL_REJECTED" if exc.code in (401, 403) else "SYNTHESIS_FAILED"
        raise ProviderError(code) from None
    except ProviderError:
        raise
    except (TimeoutError, urllib.error.URLError) as exc:
        if isinstance(exc, TimeoutError) or isinstance(getattr(exc, "reason", None), TimeoutError):
            status = "timeout"
        raise ProviderError("SYNTHESIS_FAILED") from None
    finally:
        api_costs.record("cartesia", model_id, "chat_voice", "character", len(text), status,
                         (time.monotonic() - started) * 1000, tenant_id,
                         provider_request_id=request_id)
