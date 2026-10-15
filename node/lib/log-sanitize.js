const MASK = "***";
const MAX_MESSAGE_LEN = 500;
const MAX_DETAILS_LEN = 2000;
const PRIVATE_DETAIL_KEYS = new Set([
  "secret", "secretword", "secretlength", "word", "palavra", "answer", "resposta",
  "riddle", "riddletext", "charada", "clue", "cluetext", "dica", "dicatext",
  "comment", "comentario", "raw", "rawcomment", "chattext", "token", "password",
  "apikey", "authorization", "signedurl",
]);

function sanitizeText(raw, { category = "" } = {}) {
  let text = String(raw == null ? "" : raw);
  if (!text) return "";
  text = text.replace(/(\b(?:bearer|authorization|token|api[_-]?key|access[_-]?token|jwt|secret|password|passwd|refresh_token|private_token))\s*[=:]\s*[^\s,;"]+/gi, `$1=${MASK}`);
  text = text.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${MASK}`);
  text = text.replace(/([?&](?:token|tk|api_key|apikey|key|secret|sig|signature|X-Amz-Signature|access_token|refresh_token)=)[^&\s]+/gi, `$1${MASK}`);
  text = text.replace(/\b(?:sk|pk|rk|ak|ghp|github_pat|AIza)[_-]?[A-Za-z0-9_-]{12,}/g, MASK);
  text = text.replace(/\b[A-Fa-f0-9]{32,}\b/g, MASK);

  // Remove respostas/conteúdo de jogo e mensagens de chat dos registros legados.
  text = text.replace(/(\[Jogo\]\s*Palavra secreta:\s*).*/i, `$1[oculta]`);
  text = text.replace(/(\[FIM\][^\n]*?\bPalavra:\s*).*/i, `$1[oculta]`);
  text = text.replace(/(\bCharada:\s*)(?:"[^"]*"|'[^']*'|.+)$/i, `$1[oculta]`);
  text = text.replace(/(\[3 Dicas\][^\n]*?palavra era\s+)(?:"[^"]*"|'[^']*'|.+)$/i, `$1[oculta]`);
  text = text.replace(/(\[3 Dicas\]\s*Dica\s+\d+:\s*).+?(\s+\(\d+s,\s*\d+\s*pts?\))/i, `$1[dica omitida]$2`);
  text = text.replace(/(\[3 Dicas\][^\n]*?acertou\s+).+?(\s+na Dica\s+\d+.*)$/i, `$1[resposta omitida]$2`);
  text = text.replace(/(\[Guess\]\s+[^:]+:\s*).+?(\s*->\s*#\d+)/i, `$1[palpite omitido]$2`);
  text = text.replace(/(\[Guess\]\s+[^:]+:\s*).+?(\s+já foi chutada)/i, `$1[palpite omitido]$2`);
  text = text.replace(/(\[Access\][^\n]*?:\s*).+?(\s+não subiu)/i, `$1[palpite omitido]$2`);
  text = text.replace(/(\[CacaPalavras\]\s*[^\n]*? acertou )'[^']*'(\s+\([^)]*\).*)/i, `$1uma palavra$2`);
  if (String(category).toLowerCase() !== "chat") {
    text = text.replace(/(\[Chat\]\s+[^:]+:\s*).*/i, `$1[comentário omitido]`);
  }
  text = text.replace(/(\[TTS\].*?para:\s*).+$/i, `$1[texto omitido]`);
  text = text.replace(/(\[Bichinho\]\s*Streamer falou:\s*).+$/i, `$1[texto omitido]`);

  if (text.length > MAX_MESSAGE_LEN) text = text.slice(0, MAX_MESSAGE_LEN).trimEnd() + "…";
  return text;
}

function sanitizeDetails(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return sanitizeText(raw); }
  }
  const redact = (value) => {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== "object") return value;
    const safe = {};
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
      safe[key] = PRIVATE_DETAIL_KEYS.has(normalizedKey) ? MASK : redact(item);
    }
    return safe;
  };
  try {
    const serialized = JSON.stringify(redact(raw));
    if (serialized.length > MAX_DETAILS_LEN) return serialized.slice(0, MAX_DETAILS_LEN - 1) + "…";
    return serialized;
  } catch {
    return null;
  }
}

module.exports = { sanitizeText, sanitizeDetails, MAX_MESSAGE_LEN, MAX_DETAILS_LEN };
