const API_VERSION = "2026-08-14";
const API_BASE = "https://api.cartesia.ai";
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

async function synthesize({ apiKey, modelId = "sonic-3.6", voiceId, text, speed = 1, timeoutMs = 15000 }) {
  if (typeof apiKey !== "string" || !apiKey || typeof voiceId !== "string" || !voiceId || typeof text !== "string" || !text)
    throw new Error("INVALID_REQUEST");
  const response = await fetch(`${API_BASE}/tts/bytes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Cartesia-Version": API_VERSION,
      "Content-Type": "application/json",
      Accept: "audio/wav",
    },
    body: JSON.stringify({
      model_id: modelId,
      transcript: text,
      voice: voiceId,
      locale: "pt-BR",
      normalization: "auto",
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 },
      generation_config: { speed: Math.max(0.6, Math.min(1.5, Number(speed) || 1)) },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error("CARTESIA_SYNTHESIS_FAILED");
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!contentType.includes("audio/")) throw new Error("VOICE_PREVIEW_INVALID_AUDIO");
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > MAX_AUDIO_BYTES) throw new Error("VOICE_PREVIEW_AUDIO_TOO_LARGE");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("VOICE_PREVIEW_INVALID_AUDIO");
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new Error("VOICE_PREVIEW_AUDIO_TOO_LARGE");
    }
    chunks.push(Buffer.from(value));
  }
  if (!total) throw new Error("VOICE_PREVIEW_INVALID_AUDIO");
  return {
    audio: Buffer.concat(chunks, total),
    contentType,
    requestId: response.headers.get("x-request-id") || response.headers.get("request-id") || null,
  };
}

module.exports = { API_VERSION, synthesize };
