const FEATURE_CATALOG = Object.freeze([
  { key: "connect", label: "Conectar Live", kind: "required" },
  { key: "chat", label: "Leitura de Chat", kind: "feature" },
  { key: "alerts", label: "Alertas Sonoros", kind: "feature" },
  { key: "games", label: "Palavra Secreta", kind: "game" },
  { key: "batalha", label: "Batalha", kind: "game" },
  { key: "caca", label: "Caça Palavras", kind: "game" },
  { key: "bichinho", label: "Bichinho", kind: "game" },
  { key: "tres", label: "3 Dicas", kind: "game" },
  { key: "duelo", label: "Duelo 1x1", kind: "game" },
  { key: "corda", label: "CORDA", kind: "game" },
  { key: "quiz", label: "Quiz Live", kind: "game" },
  { key: "ring_arena", label: "Arena dos Anéis", kind: "game" },
]);

function featureAllowed(user, feature) {
  if (!user || user.role === "admin") return true;
  const features = user.features && typeof user.features === "object" ? user.features : {};
  if (!Object.keys(features).length) return true;

  // Contas antigas usavam a permissão Duelo 1x1 para controlar o CORDA.
  const key = feature === "corda" && !Object.hasOwn(features, "corda") ? "duelo" : feature;
  if (feature === "ring_arena" && !Object.hasOwn(features, key)) return false;
  return features[key] !== false;
}

module.exports = { FEATURE_CATALOG, featureAllowed };
