const crypto = require("crypto");
const wallet = require("../lib/tts-credit-wallet");

module.exports = function registerTtsCredits(app, { db, auth, mpFetch, mpConfigured, getPublicBaseUrl, log }) {
  wallet.ensureSchema(db);
  const trace = () => crypto.randomUUID();
  const report = (category, level, event, message, details = {}, code) =>
    log({ category, level, event, message, code, trace_id: trace(), details });
  const packages = (enabledOnly = false) => db.db.prepare(`SELECT id,name,credits,price_cents,enabled
    FROM tts_credit_packages ${enabledOnly ? "WHERE enabled=1" : ""} ORDER BY price_cents,id`).all();

  app.get("/api/tts/credits", auth.requireAuth, (req, res) => {
    const tenantId = req.user.id;
    res.set("Cache-Control", "no-store").json({ success: true, balance: wallet.getBalance(db, tenantId),
      packages: packages(true).map(item => ({ ...item, price: (item.price_cents / 100).toFixed(2) })),
      ledger: wallet.ledger(db, tenantId, 15),
      model_costs: db.db.prepare(`SELECT model_id,credits_per_150_chars FROM additional_voice_models
        WHERE enabled=1 ORDER BY model_id`).all() });
  });

  app.post("/api/tts/credits/checkout", auth.requireAuth, async (req, res) => {
    const tenantId = req.user.id;
    const user = db.getUserById(tenantId);
    const access = db.db.prepare("SELECT enabled FROM tenant_elevenlabs WHERE tenant_id=?").get(tenantId);
    const item = typeof req.body?.package_id === "string"
      ? db.db.prepare("SELECT * FROM tts_credit_packages WHERE id=? AND enabled=1").get(req.body.package_id) : null;
    if (!user || user.status !== "active" || !access?.enabled || !item)
      return res.status(400).json({ success: false, error: "Pacote de TikCoins indisponível para esta conta." });
    if (!(typeof mpConfigured === "function" ? mpConfigured() : mpConfigured))
      return res.status(503).json({ success: false, error: "Compra de TikCoins indisponível no momento." });
    const purchaseId = crypto.randomUUID();
    const externalReference = `tts-credit:${purchaseId}`;
    try {
      db.db.prepare(`INSERT INTO tts_credit_purchases(id,tenant_id,package_id,package_name,credits,price_cents)
        VALUES(?,?,?,?,?,?)`).run(purchaseId, tenantId, item.id, item.name, item.credits, item.price_cents);
      let origin = typeof getPublicBaseUrl === "function" ? getPublicBaseUrl() : process.env.PUBLIC_BASE_URL || "https://painel.tikplay.com.br";
      try {
        const publicUrl = new URL(origin);
        if (publicUrl.protocol !== "https:" || !publicUrl.host || publicUrl.username || publicUrl.password)
          throw new Error("CHECKOUT_BASE_URL_NOT_HTTPS");
        origin = publicUrl.origin;
      } catch {
        db.db.prepare("UPDATE tts_credit_purchases SET status='checkout_failed' WHERE id=?").run(purchaseId);
        report("error", "error", "tts.credits.checkout_failed", "Checkout de créditos requer uma URL pública HTTPS.",
          { tenant_id: tenantId, package_id: item.id, code: "CHECKOUT_BASE_URL_NOT_HTTPS" }, "CHECKOUT_BASE_URL_NOT_HTTPS");
        return res.status(503).json({ success: false, error: "Compra indisponível até configurar o endereço HTTPS do painel." });
      }
      const result = await mpFetch("/checkout/preferences", { method: "POST", body: JSON.stringify({
        items: [{ id: item.id, title: `TikPlay · ${item.name} — TikCoins para vozes`, quantity: 1,
          currency_id: "BRL", unit_price: item.price_cents / 100 }],
        external_reference: externalReference,
        payer: { email: user.email },
        back_urls: { success: `${origin}/painel?tts-credit=success`, pending: `${origin}/painel?tts-credit=pending`,
          failure: `${origin}/painel?tts-credit=failure` },
        auto_return: "approved", notification_url: `${origin}/api/webhooks/mercadopago`,
      }) });
      if (![200, 201].includes(result.status) || !result.data?.init_point) {
        db.db.prepare("UPDATE tts_credit_purchases SET status='checkout_failed' WHERE id=?").run(purchaseId);
        report("error", "error", "tts.credits.checkout_failed", "Não foi possível abrir o checkout de créditos.",
          { tenant_id: tenantId, package_id: item.id, code: "CHECKOUT_CREATE_FAILED" }, "CHECKOUT_CREATE_FAILED");
        return res.status(502).json({ success: false, error: "Não foi possível iniciar a compra de TikCoins. Tente novamente." });
      }
      report("billing", "info", "tts.credits.checkout_created", "Checkout de créditos criado.",
        { tenant_id: tenantId, package_id: item.id, credits: item.credits, price_cents: item.price_cents });
      res.set("Cache-Control", "no-store").json({ success: true, checkout_url: result.data.init_point });
    } catch {
      db.db.prepare("UPDATE tts_credit_purchases SET status='checkout_failed' WHERE id=?").run(purchaseId);
      report("error", "error", "tts.credits.checkout_failed", "Não foi possível abrir o checkout de créditos.",
        { tenant_id: tenantId, package_id: item.id, code: "CHECKOUT_CREATE_FAILED" }, "CHECKOUT_CREATE_FAILED");
      res.status(502).json({ success: false, error: "Não foi possível iniciar a compra de TikCoins. Tente novamente." });
    }
  });

  app.get("/api/admin/tts/credit-packages", auth.requireAdmin, (req, res) => {
    res.set("Cache-Control", "no-store").json({ success: true, packages: packages(false) });
  });

  app.get("/api/admin/tts/credit-balances", auth.requireAdmin, (req, res) => {
    const accounts = db.db.prepare(`SELECT u.id,u.name,u.email,u.status,COALESCE(w.balance,0) AS balance
      FROM users u LEFT JOIN tts_credit_wallets w ON w.tenant_id=u.id
      WHERE COALESCE(u.role,'user')<>'admin' ORDER BY lower(u.name),u.id`).all();
    res.set("Cache-Control", "no-store").json({ success: true, accounts });
  });

  app.put("/api/admin/tts/credit-packages", auth.requireAdmin, (req, res) => {
    const list = req.body?.packages;
    if (!Array.isArray(list) || list.length > 20 || list.some(item =>
      (item.id !== undefined && (typeof item.id !== "string" || !/^[a-f0-9-]{36}$/i.test(item.id)))
      || typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 80
      || !Number.isSafeInteger(item.credits) || item.credits < 1 || item.credits > 100000000
      || !Number.isSafeInteger(item.price_cents) || item.price_cents < 1 || item.price_cents > 100000000
      || typeof item.enabled !== "boolean") || new Set(list.filter(item => item.id).map(item => item.id)).size !== list.filter(item => item.id).length) {
      report("notice", "warning", "tts.credits.packages_rejected", "Configuração de pacotes de crédito rejeitada.",
        { actor_id: req.user.id, package_count: Array.isArray(list) ? list.length : 0, code: "INVALID_PACKAGES" }, "INVALID_PACKAGES");
      return res.status(400).json({ success: false, error: "Confira nome, TikCoins e preço de cada pacote." });
    }
    const current = new Set(packages(false).map(item => item.id));
    const save = db.db.prepare(`INSERT INTO tts_credit_packages(id,name,credits,price_cents,enabled)
      VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,credits=excluded.credits,
      price_cents=excluded.price_cents,enabled=excluded.enabled,updated_at=CURRENT_TIMESTAMP`);
    const transaction = db.db.transaction(() => {
      const keep = new Set();
      for (const item of list) {
        const id = item.id || crypto.randomUUID();
        if (item.id && !current.has(item.id)) throw new Error("UNKNOWN_PACKAGE");
        keep.add(id);
        save.run(id, item.name.trim(), item.credits, item.price_cents, item.enabled ? 1 : 0);
      }
      for (const id of current) if (!keep.has(id)) db.db.prepare("UPDATE tts_credit_packages SET enabled=0 WHERE id=?").run(id);
    });
    try {
      transaction.immediate();
      const result = packages(false);
      report("diagnostic", "info", "tts.credits.packages_saved", "Pacotes de créditos atualizados.",
        { actor_id: req.user.id, package_count: result.length, package_ids: result.map(item => item.id) });
      res.json({ success: true, packages: result });
    } catch {
      report("notice", "warning", "tts.credits.packages_rejected", "Configuração de pacotes de crédito não pôde ser salva.",
        { actor_id: req.user.id, package_count: list.length, code: "PACKAGE_SAVE_FAILED" }, "PACKAGE_SAVE_FAILED");
      res.status(400).json({ success: false, error: "Não foi possível salvar os pacotes enviados." });
    }
  });

  app.post("/api/admin/users/:id/tts-credits", auth.requireAdmin, (req, res) => {
    const tenantId = Number(req.params.id);
    const amount = req.body?.amount;
    if (!Number.isSafeInteger(amount) || amount === 0) {
      report("notice", "warning", "tts.credits.adjustment_rejected", "Ajuste de créditos inválido.",
        { tenant_id: tenantId, actor_id: req.user.id, code: "INVALID_ADJUSTMENT" }, "INVALID_ADJUSTMENT");
      return res.status(400).json({ success: false, error: "Informe uma quantidade inteira diferente de zero." });
    }
    const referenceId = crypto.randomUUID();
    try {
      const result = wallet.adjust(db, { tenantId, amount, actorId: req.user.id, referenceId });
      if (!result.success) {
        report("notice", "warning", "tts.credits.adjustment_rejected", "Ajuste de créditos não foi aplicado.",
          { tenant_id: tenantId, actor_id: req.user.id, code: result.code }, result.code);
        return res.status(result.code === "INSUFFICIENT_BALANCE" ? 409 : 400)
          .json({ success: false, error: result.code === "INSUFFICIENT_BALANCE" ? "O saldo não pode ficar negativo." : "Conta ou ajuste inválido." });
      }
      report("system", "info", "tts.credits.adjusted", "Saldo de créditos ajustado pelo administrador.",
        { tenant_id: tenantId, actor_id: req.user.id, amount, balance: result.balance, reference_id: referenceId });
      res.json({ success: true, balance: result.balance });
    } catch {
      res.status(500).json({ success: false, error: "Não foi possível alterar o saldo." });
    }
  });

  async function handlePaymentWebhook(paymentId) {
    try {
      const result = await mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`);
      if (result.status !== 200 || !result.data) throw new Error("PAYMENT_LOOKUP_FAILED");
      const settled = wallet.settleApprovedPayment(db, result.data, log);
      if (settled.handled && !settled.success) report("notice", "warning", "tts.credits.purchase_rejected",
        "Notificação de compra de créditos não foi validada.", { tenant_id: settled.tenantId,
          payment_id: String(paymentId), code: settled.code }, settled.code);
      return settled;
    } catch {
      report("error", "error", "tts.credits.webhook_failed", "Não foi possível confirmar o pagamento de créditos.",
        { payment_id: String(paymentId), code: "PAYMENT_LOOKUP_FAILED" }, "PAYMENT_LOOKUP_FAILED");
      return { handled: false, success: false, code: "PAYMENT_LOOKUP_FAILED" };
    }
  }

  return { handlePaymentWebhook };
};
