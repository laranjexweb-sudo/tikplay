function maskSecret(value) {
  const secret = String(value || "");
  if (!secret) return "";
  if (secret.length <= 7) return "•".repeat(secret.length);
  return `${secret.slice(0, 3)}${"•".repeat(secret.length - 7)}${secret.slice(-4)}`;
}

module.exports = maskSecret;
