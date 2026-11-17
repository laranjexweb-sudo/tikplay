"""StarsG realtime TTS synthesis over its documented OpenAI-compatible WebSocket."""
import asyncio
import base64
import json
import struct
import time
import uuid

import websockets

import api_costs

MAX_AUDIO_BYTES = 5 * 1024 * 1024
SAMPLE_RATE = 24000
DEFAULT_VOICE_ID = "__model_default__"


class ProviderError(Exception):
    pass


def _wav_from_pcm(pcm):
    if not pcm or len(pcm) % 2:
        raise ProviderError("INVALID_AUDIO")
    channels, bits = 1, 16
    byte_rate = SAMPLE_RATE * channels * bits // 8
    block_align = channels * bits // 8
    header = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt "
    header += struct.pack("<IHHIIHH", 16, 1, channels, SAMPLE_RATE, byte_rate, block_align, bits)
    header += b"data" + struct.pack("<I", len(pcm))
    return header + pcm


def _actual_cost_usd(model_id, usage):
    if not isinstance(usage, dict):
        return None
    input_details = usage.get("input_token_details") or usage.get("inputTokenDetails") or {}
    output_details = usage.get("output_token_details") or usage.get("outputTokenDetails") or {}
    try:
        input_tokens = float(input_details.get("text_tokens", input_details.get("textTokens",
            usage.get("input_text_tokens"))))
        audio_tokens = float(output_details.get("audio_tokens", output_details.get("audioTokens",
            usage.get("output_audio_tokens", usage.get("audio_output_tokens")))))
        text_output_tokens = float(output_details.get("text_tokens", output_details.get("textTokens",
            usage.get("output_text_tokens", 0))))
    except (TypeError, ValueError):
        return None
    rates = {
        "tts-altair-v1-mini": (1.25, 5.0, 3.0),
        "tts-vega-v1-flash": (1.0, 0.0, 12.0),
    }.get(model_id)
    if not rates:
        return None
    return (input_tokens * rates[0] + text_output_tokens * rates[1] + audio_tokens * rates[2]) / 1_000_000


async def _generate(model_id, voice_id, text, api_key):
    uri = "wss://api.starsg.ai/v1/realtime?model=" + model_id
    options = {"ping_interval": 20, "ping_timeout": 20, "close_timeout": 3, "max_size": MAX_AUDIO_BYTES + 1024 * 1024}
    try:
        try:
            connection = websockets.connect(uri, additional_headers={"Authorization": "Bearer " + api_key}, **options)
        except TypeError:
            connection = websockets.connect(uri, extra_headers={"Authorization": "Bearer " + api_key}, **options)
        async with connection as websocket:
            async def recv_event():
                raw = await asyncio.wait_for(websocket.recv(), timeout=30)
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8")
                try:
                    event = json.loads(raw)
                except (TypeError, ValueError):
                    raise ProviderError("INVALID_EVENT") from None
                if event.get("type") == "error" or str(event.get("type", "")).endswith(".failed"):
                    raise ProviderError("PROVIDER_REJECTED")
                return event

            async def wait_for(kind):
                while True:
                    event = await recv_event()
                    if event.get("type") == kind:
                        return event

            await wait_for("session.created")
            audio_output = {"format": {"type": "audio/pcm", "rate": SAMPLE_RATE}}
            if voice_id != DEFAULT_VOICE_ID:
                audio_output["voice"] = voice_id
            await websocket.send(json.dumps({"type": "session.update", "session": {
                "type": "realtime", "output_modalities": ["audio"],
                "audio": {"output": audio_output},
            }}))
            await wait_for("session.updated")
            await websocket.send(json.dumps({"type": "conversation.item.create", "item": {
                "type": "message", "role": "user", "content": [{"type": "input_text", "text": text}],
            }}))
            await websocket.send(json.dumps({"type": "response.create"}))
            audio_parts = []
            audio_length = 0
            while True:
                event = await recv_event()
                if event.get("type") == "response.output_audio.delta":
                    try:
                        chunk = base64.b64decode(event.get("delta", ""), validate=True)
                    except (ValueError, TypeError):
                        raise ProviderError("INVALID_AUDIO") from None
                    audio_length += len(chunk)
                    if not chunk or audio_length > MAX_AUDIO_BYTES:
                        raise ProviderError("AUDIO_TOO_LARGE" if audio_length > MAX_AUDIO_BYTES else "INVALID_AUDIO")
                    audio_parts.append(chunk)
                elif event.get("type") == "response.done":
                    response = event.get("response") or event
                    if response.get("status") not in (None, "completed"):
                        raise ProviderError("PROVIDER_REJECTED")
                    pcm = b"".join(audio_parts)
                    wav = _wav_from_pcm(pcm)
                    if len(wav) > MAX_AUDIO_BYTES:
                        raise ProviderError("AUDIO_TOO_LARGE")
                    return wav, response.get("usage"), response.get("id")
    except ProviderError:
        raise
    except asyncio.TimeoutError:
        raise ProviderError("TIMEOUT") from None
    except Exception:
        raise ProviderError("SYNTHESIS_FAILED") from None


def synthesize(tenant_id, model_id, voice_id, text, api_key):
    """Synthesize a bounded chat message and record provider usage without text/key data."""
    request_id = str(uuid.uuid4())
    started = time.monotonic()
    status = "failed"
    usage = None
    provider_request_id = None
    try:
        audio, usage, provider_request_id = asyncio.run(_generate(model_id, voice_id, text, api_key))
        status = "success"
        return audio
    except ProviderError as exc:
        raise ProviderError("STARS_TTS_" + str(exc)) from None
    finally:
        duration_ms = (time.monotonic() - started) * 1000
        cost = _actual_cost_usd(model_id, usage) if status == "success" else None
        api_costs.record("starsg", model_id, "chat_voice", "character", len(text), status,
                         duration_ms, tenant_id, actual_cost_usd=cost,
                         provider_request_id=provider_request_id, request_id=request_id)
