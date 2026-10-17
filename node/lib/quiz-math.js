const crypto = require("crypto");

const CONTENTS = Object.freeze([
  ["adicao_subtracao", "Adição e subtração"], ["multiplicacao_divisao", "Multiplicação e divisão"],
  ["porcentagem", "Porcentagem"], ["potenciacao", "Potenciação"], ["raiz_quadrada", "Raiz quadrada"],
  ["equacoes", "Equações simples"], ["expressoes", "Expressões numéricas"],
  ["sequencias", "Sequências lógicas"], ["problemas", "Problemas matemáticos"],
]);

function random(seed) {
  let state = crypto.createHash("sha256").update(String(seed)).digest().readUInt32LE(0) || 1;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function integer(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function pick(rng, list) { return list[Math.floor(rng() * list.length)]; }
function fmt(value) { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))).replace(".", ","); }
function optionsFor(answer, rng, difficulty) {
  const result = new Set([answer]);
  const spread = difficulty === "facil" ? 6 : difficulty === "medio" ? 18 : 40;
  for (let attempts = 0; result.size < 4 && attempts < 80; attempts++) {
    const offset = integer(rng, 1, spread) * (rng() < 0.5 ? -1 : 1);
    const value = answer + offset;
    if (Number.isFinite(value) && Math.abs(value - answer) > 1e-9) result.add(value);
  }
  let fallback = 1;
  while (result.size < 4) result.add(answer + fallback++);
  const shuffled = [...result].sort(() => rng() - 0.5).slice(0, 4);
  const labels = ["A", "B", "C", "D"];
  const options = Object.fromEntries(labels.map((label, index) => [label, fmt(shuffled[index])]));
  return { options, answer: labels[shuffled.indexOf(answer)] };
}

function generateQuestion({ seed, difficulty = "facil", contents = [], mode = "calculo" } = {}) {
  if (!["facil", "medio", "dificil"].includes(difficulty)) throw new Error("Dificuldade inválida.");
  const available = CONTENTS.map(([key]) => key);
  const allowed = contents.filter(item => available.includes(item));
  const operation = pick(random(seed || crypto.randomUUID()), allowed.length ? allowed : available);
  const rng = random(`${seed || "quiz"}:${operation}:${difficulty}`);
  const ranges = { facil: [2, 12], medio: [8, 40], dificil: [20, 120] };
  const [min, max] = ranges[difficulty];
  let prompt = "", answer = 0;
  switch (operation) {
    case "adicao_subtracao": {
      const a = integer(rng, min, max), b = integer(rng, min, max);
      if (rng() < 0.5) { prompt = `${a} + ${b} = ?`; answer = a + b; }
      else { const high = Math.max(a, b), low = Math.min(a, b); prompt = `${high} − ${low} = ?`; answer = high - low; }
      break;
    }
    case "multiplicacao_divisao": {
      const a = integer(rng, difficulty === "facil" ? 2 : 4, difficulty === "dificil" ? 25 : 12);
      const b = integer(rng, difficulty === "dificil" ? 4 : 2, difficulty === "dificil" ? 25 : 12);
      if (rng() < 0.65) { prompt = `${a} × ${b} = ?`; answer = a * b; }
      else { prompt = `${a * b} ÷ ${a} = ?`; answer = b; }
      break;
    }
    case "porcentagem": {
      const pct = pick(rng, difficulty === "facil" ? [10, 20, 25, 50] : difficulty === "medio" ? [12, 15, 20, 25, 30, 40] : [12.5, 15, 17.5, 22, 35, 45]);
      const base = integer(rng, difficulty === "facil" ? 2 : 4, difficulty === "dificil" ? 40 : 20) * (difficulty === "dificil" ? 8 : 4);
      prompt = `Quanto é ${fmt(pct)}% de ${base}?`; answer = base * pct / 100;
      break;
    }
    case "potenciacao": {
      const base = integer(rng, difficulty === "facil" ? 2 : 3, difficulty === "dificil" ? 15 : 10);
      const exponent = integer(rng, 2, difficulty === "facil" ? 3 : 4);
      prompt = `${base} elevado a ${exponent} = ?`; answer = base ** exponent;
      break;
    }
    case "raiz_quadrada": {
      const root = integer(rng, difficulty === "facil" ? 2 : 4, difficulty === "dificil" ? 30 : 18);
      prompt = `Qual é a raiz quadrada de ${root * root}?`; answer = root;
      break;
    }
    case "equacoes": {
      const x = integer(rng, difficulty === "facil" ? 1 : 3, difficulty === "dificil" ? 30 : 15);
      const a = integer(rng, difficulty === "facil" ? 2 : 3, difficulty === "dificil" ? 12 : 8);
      const b = integer(rng, min, max);
      const c = a * x + b;
      prompt = `${a}x + ${b} = ${c}. Quanto vale x?`; answer = x;
      break;
    }
    case "expressoes": {
      const a = integer(rng, min, max), b = integer(rng, min, max), c = integer(rng, 2, difficulty === "dificil" ? 12 : 6);
      if (rng() < 0.5) { prompt = `${c} × (${a} + ${b}) − ${a} = ?`; answer = c * (a + b) - a; }
      else { prompt = `(${a} + ${b}) ÷ ${c} = ?`; const sum = a + b; prompt = `${sum * c} ÷ ${c} = ?`; answer = sum; }
      break;
    }
    case "sequencias": {
      const base = integer(rng, 1, 12);
      if (difficulty === "facil") { const step = integer(rng, 2, 5); prompt = `${base}, ${base + step}, ${base + 2 * step}, ${base + 3 * step}, …`; answer = base + 4 * step; }
      else if (difficulty === "medio") { prompt = `${base}, ${base * 2}, ${base * 4}, ${base * 8}, …`; answer = base * 16; }
      else { const step = integer(rng, 2, 6); prompt = `${base}, ${base + step}, ${base + 2 * step + 1}, ${base + 3 * step + 3}, …`; answer = base + 4 * step + 6; }
      prompt = `Qual é o próximo número? ${prompt}`;
      break;
    }
    case "problemas": {
      const unit = integer(rng, 3, max), groups = integer(rng, 2, 8);
      if (difficulty === "facil") { prompt = `${groups} caixas têm ${unit} itens cada. Quantos itens há ao todo?`; answer = groups * unit; }
      else if (difficulty === "medio") { prompt = `Um produto de ${unit * groups} reais recebeu ${groups * 5}% de desconto. Qual foi o valor do desconto?`; answer = unit * groups * groups * 5 / 100; }
      else { prompt = `Uma viagem de ${unit * groups} km foi dividida igualmente em ${groups} trechos. Quantos km tem cada trecho?`; answer = unit; }
      break;
    }
    default: throw new Error("Conteúdo matemático inválido.");
  }
  if (!Number.isFinite(answer)) throw new Error("Não foi possível gerar a questão.");
  const contentLabel = CONTENTS.find(([key]) => key === operation)?.[1] || operation;
  if (mode === "alternativas") {
    const choice = optionsFor(answer, rng, difficulty);
    return { theme: "matematica", subtheme: operation, content_label: contentLabel, difficulty, mode, prompt, options: choice.options, answer: choice.answer, answer_value: fmt(answer), tolerance: 0, explanation: `O resultado correto é ${fmt(answer)}.`, origin: "generated_math" };
  }
  return { theme: "matematica", subtheme: operation, content_label: contentLabel, difficulty, mode: "calculo", prompt, options: {}, answer: fmt(answer), answer_value: fmt(answer), tolerance: 0, explanation: `O resultado correto é ${fmt(answer)}.`, origin: "generated_math" };
}

module.exports = { CONTENTS, generateQuestion };
