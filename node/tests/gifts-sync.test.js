// Testes de integração do POST /api/gifts/sync (proteção Super Admin).
// Executar com o servidor do TikPlay rodando em http://localhost:3100.
//
//   node tests/gifts-sync.test.js
//
// Cobre: 401 sem token, 403 streamer autenticado, 200 Super Admin enfileirado,
// payload/parâmetros inválidos (400), contrato {success, queued} e endpoints de
// consulta dos streamers seguem funcionais independentes dos filtros min/max.

const BASE = process.env.TEST_BASE || "http://localhost:3100";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const auth = require("../auth");

let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) { passed++; console.log("  PASS " + name); }
  else { failed++; console.log("  FAIL " + name + (extra ? " :: " + extra : "")); }
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  let opts = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + path, opts);
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

(async () => {
  // Verifica servidor no ar.
  try {
    const up = await fetch(BASE + "/api/plans");
    check("servidor no ar (GET /api/plans 200)", up.status === 200, "status=" + up.status);
  } catch (e) {
    console.error("Servidor nao respondeu em " + BASE + ". Inicie-o antes dos testes.");
    process.exit(1);
  }

  const adminTok = auth.signToken({ id: 1, role: "admin" });
  const userTok = auth.signToken({ id: 2, role: "user" });

  console.log("[1] Autenticacao / autorizacao");
  {
    const r = await req("POST", "/api/gifts/sync");
    check("sem token -> 401", r.status === 401, "status=" + r.status);
  }
  {
    const r = await req("POST", "/api/gifts/sync", { token: userTok });
    check("streamer autenticado -> 403", r.status === 403, "status=" + r.status + " json=" + JSON.stringify(r.json));
  }
  {
    const r = await req("POST", "/api/gifts/sync", { token: adminTok });
    check("super admin -> 200", r.status === 200, "status=" + r.status);
    check("contrato {success, queued} (bool)", r.json && typeof r.json.success === "boolean" && typeof r.json.queued === "boolean",
      JSON.stringify(r.json));
    check("operacao enfileirada (success/queued true)", r.json && r.json.success === true && r.json.queued === true,
      JSON.stringify(r.json));
  }

  console.log("[2] Forma da requisicao (payload/parametros invalidos)");
  {
    const r = await req("POST", "/api/gifts/sync", { token: adminTok, body: { min: 10 } });
    check("payload com 'min' (filtro local) -> 400", r.status === 400, "status=" + r.status + " json=" + JSON.stringify(r.json));
  }
  {
    const r = await req("POST", "/api/gifts/sync", { token: adminTok, body: { giftFilterMax: 100 } });
    check("payload com 'giftFilterMax' -> 400", r.status === 400, "status=" + r.status);
  }
  {
    const r = await req("POST", "/api/gifts/sync", { token: adminTok, body: [1, 2, 3] });
    check("body nao-objeto (array) -> 400", r.status === 400, "status=" + r.status);
  }
  {
    const r = await req("POST", "/api/gifts/sync", { token: adminTok, body: {} });
    check("body vazio {} -> 200 (aceito)", r.status === 200, "status=" + r.status);
  }
  {
    // Caso real da UI: POST sem body e sem content-type.
    const r = await fetch(BASE + "/api/gifts/sync", { method: "POST", headers: { Authorization: "Bearer " + adminTok } });
    check("POST sem corpo (como a UI) -> 200", r.status === 200, "status=" + r.status);
  }

  console.log("[3] Endpoints de consulta dos streamers (sem min/max)");
  {
    const r = await req("GET", "/api/gift-tags");
    check("GET /api/gift-tags (publico) 200", r.status === 200, "status=" + r.status);
  }
  {
    const r = await req("GET", "/api/gifts");
    check("GET /api/gifts (publico) 200", r.status === 200, "status=" + r.status);
  }
  {
    const r = await req("GET", "/api/gift-config", { token: userTok });
    check("GET /api/gift-config (streamer autenticado) 200", r.status === 200, "status=" + r.status);
  }
  {
    const r = await req("GET", "/api/gift-image-map");
    check("GET /api/gift-image-map (publico) 200", r.status === 200, "status=" + r.status);
  }

  console.log(`\nResultado: ${passed} passaram, ${failed} falharam.`);
  // Drena sockets/undici antes do exit para evitar artefato de teardown no Windows.
  await new Promise((r) => setTimeout(r, 300));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("ERRO no teste:", e); process.exit(1); });