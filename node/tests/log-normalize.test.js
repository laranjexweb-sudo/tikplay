const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeLog } = require("../lib/log-normalize");
const { sanitizeDetails, sanitizeText } = require("../lib/log-sanitize");

test("legacy Palavra and 3 Dicas messages receive game metadata", () => {
  const palavra = normalizeLog("[Jogo] Partida preparada.");
  assert.equal(palavra.category, "game");
  assert.equal(palavra.game, "palavra");

  const tres = normalizeLog("[3 Dicas] Rodada 4 iniciada; dica 1 em 5s.");
  assert.equal(tres.category, "game");
  assert.equal(tres.game, "tres");

  const genericGift = normalizeLog("[Gift] Presente recebido.");
  assert.equal(genericGift.category, "notice");
  assert.equal(genericGift.game, "");
});

test("explicit canonical category is preserved while legacy levels are normalized", () => {
  const warning = normalizeLog({ text: "[3 Dicas] Configuração inválida.", category: "game", game: "tres", level: "warn" });
  assert.equal(warning.category, "game");
  assert.equal(warning.level, "warning");

  const diagnostic = normalizeLog({ text: "[debug][Palavra] game.start", game: "palavra", level: "trace" });
  assert.equal(diagnostic.category, "diagnostic");
  assert.equal(diagnostic.level, "debug");

  const error = normalizeLog({ text: "Falha ao iniciar", game: "tres", level: "err" });
  assert.equal(error.category, "error");
  assert.equal(error.level, "error");

  const gameWarning = normalizeLog({ text: "[3 Dicas] Dica não disponível.", game: "tres", level: "warn" });
  assert.equal(gameWarning.category, "game");
  assert.equal(gameWarning.level, "warning");
});

test("unknown legacy messages remain in the system fallback", () => {
  const entry = normalizeLog("[Mensagem antiga] sem origem conhecida");
  assert.equal(entry.category, "system");
  assert.equal(entry.level, "info");
});

test("legacy messages redact answers, clues, chat, and guesses", () => {
  assert.equal(sanitizeText("[Jogo] Palavra secreta: girassol"), "[Jogo] Palavra secreta: [oculta]");
  assert.equal(sanitizeText('[Manual] Charada: "texto reservado"'), "[Manual] Charada: [oculta]");
  assert.equal(sanitizeText("[3 Dicas] Dica 1: pista reservada (120s, 30 pts)"), "[3 Dicas] Dica 1: [dica omitida] (120s, 30 pts)");
  assert.equal(sanitizeText("[Chat] usuario: comentario privado"), "[Chat] usuario: [comentário omitido]");
  assert.equal(sanitizeText("[Chat] usuario: comentario real", { category: "chat" }), "[Chat] usuario: comentario real");
  assert.equal(sanitizeText("[Guess] usuario: girassol -> #1"), "[Guess] usuario: [palpite omitido] -> #1");
});

test("details redact private fields but retain safe diagnostics", () => {
  const details = JSON.parse(sanitizeDetails({ word_length: 9, secret_word: "girassol", stage: 2, raw_comment: "não guardar" }));
  assert.equal(details.word_length, 9);
  assert.equal(details.secret_word, "***");
  assert.equal(details.stage, 2);
  assert.equal(details.raw_comment, "***");
});
