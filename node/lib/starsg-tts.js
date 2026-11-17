const WebSocket = require("ws");

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const DEFAULT_VOICE_ID = "__model_default__";

function wavFromPcm(pcm, sampleRate = 24000) {
  if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 2) throw new Error("VOICE_PREVIEW_INVALID_AUDIO");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function costFromUsage(modelId, usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputDetails = usage.input_token_details || usage.inputTokenDetails || {};
  const outputDetails = usage.output_token_details || usage.outputTokenDetails || {};
  const inputTokens = Number(inputDetails.text_tokens ?? inputDetails.textTokens ?? usage.input_text_tokens);
  const audioTokens = Number(outputDetails.audio_tokens ?? outputDetails.audioTokens ?? usage.output_audio_tokens ?? usage.audio_output_tokens);
  const textOutputTokens = Number(outputDetails.text_tokens ?? outputDetails.textTokens ?? usage.output_text_tokens ?? 0);
  if (![inputTokens, audioTokens, textOutputTokens].every(Number.isFinite)) return null;
  const rates = modelId === "tts-altair-v1-mini" ? { input: 1.25, output: 5, audio: 3 }
    : modelId === "tts-vega-v1-flash" ? { input: 1, output: 0, audio: 12 } : null;
  if (!rates) return null;
  return (inputTokens * rates.input + textOutputTokens * rates.output + audioTokens * rates.audio) / 1_000_000;
}

function synthesize({ modelId, voiceId, text, apiKey, sampleRate = 24000, timeoutMs = 30000 }) {
  if (!apiKey) return Promise.reject(new Error("STARS_NOT_CONFIGURED"));
  const url = new URL("wss://api.starsg.ai/v1/realtime");
  url.searchParams.set("model", modelId);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 10000,
      maxPayload: MAX_AUDIO_BYTES + 1024 * 1024 });
    const queued = [];
    const waiters = [];
    const pcmParts = [];
    let pcmBytes = 0;
    let settled = false;
    const timer = setTimeout(() => finish(new Error("STARS_TTS_TIMEOUT")), timeoutMs);
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(error); else resolve(value);
    };
    const send = value => socket.send(JSON.stringify(value));
    const nextEvent = () => queued.length ? Promise.resolve(queued.shift())
      : new Promise(resolveEvent => waiters.push({ predicate: () => true, resolve: resolveEvent }));
    socket.on("message", raw => {
      let event;
      try { event = JSON.parse(String(raw)); } catch { return finish(new Error("STARS_TTS_INVALID_EVENT")); }
      const waiterIndex = waiters.findIndex(waiter => waiter.predicate(event));
      if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0].resolve(event);
      else queued.push(event);
    });
    const waitFor = async types => {
      const accepts = event => types.includes(event.type) || event.type === "error" || String(event.type || "").endsWith(".failed");
      const queuedIndex = queued.findIndex(accepts);
      if (queuedIndex >= 0) {
        const event = queued.splice(queuedIndex, 1)[0];
        if (event.type === "error" || String(event.type || "").endsWith(".failed")) throw new Error("STARS_TTS_PROVIDER_REJECTED");
        return event;
      }
      return new Promise((resolveEvent, rejectEvent) => waiters.push({ predicate: accepts,
        resolve: event => event.type === "error" || String(event.type || "").endsWith(".failed")
          ? rejectEvent(new Error("STARS_TTS_PROVIDER_REJECTED")) : resolveEvent(event) }));
    };
    socket.once("open", async () => {
      try {
        await waitFor(["session.created"]);
        const output = { format: { type: "audio/pcm", rate: sampleRate } };
        if (voiceId !== DEFAULT_VOICE_ID) output.voice = voiceId;
        send({ type: "session.update", session: { type: "realtime", output_modalities: ["audio"],
          audio: { output } } });
        await waitFor(["session.updated"]);
        send({ type: "conversation.item.create", item: { type: "message", role: "user",
          content: [{ type: "input_text", text }] } });
        send({ type: "response.create" });
        let completed;
        while (!settled) {
          const event = await nextEvent();
          if (event.type === "error" || String(event.type || "").endsWith(".failed"))
            throw new Error("STARS_TTS_PROVIDER_REJECTED");
          if (event.type === "response.output_audio.delta") {
            const chunk = Buffer.from(String(event.delta || ""), "base64");
            pcmBytes += chunk.length;
            if (!chunk.length || pcmBytes > MAX_AUDIO_BYTES) throw new Error("VOICE_PREVIEW_AUDIO_TOO_LARGE");
            pcmParts.push(chunk);
          } else if (event.type === "response.done") {
            completed = event.response || event;
            if (completed.status && completed.status !== "completed") throw new Error("STARS_TTS_PROVIDER_REJECTED");
            break;
          }
        }
        const wav = wavFromPcm(Buffer.concat(pcmParts, pcmBytes), sampleRate);
        if (wav.length > MAX_AUDIO_BYTES) throw new Error("VOICE_PREVIEW_AUDIO_TOO_LARGE");
        const usage = completed?.usage || null;
        finish(null, { audio: wav, contentType: "audio/wav", usage,
          actualCostUsd: costFromUsage(modelId, usage), requestId: completed?.id || null });
      } catch (error) {
        finish(error instanceof Error ? error : new Error("STARS_TTS_PROVIDER_REJECTED"));
      }
    });
    socket.once("error", error => finish(new Error(error?.message === "TIMEOUT" ? "STARS_TTS_TIMEOUT" : "STARS_TTS_CONNECTION_FAILED")));
    socket.once("unexpected-response", (_request, response) => finish(new Error(response.statusCode === 401 || response.statusCode === 403
      ? "STARS_TTS_AUTH_FAILED" : "STARS_TTS_CONNECTION_FAILED")));
    socket.once("close", () => { if (!settled) finish(new Error("STARS_TTS_CONNECTION_CLOSED")); });
  });
}

module.exports = { synthesize, costFromUsage, wavFromPcm, DEFAULT_VOICE_ID };
