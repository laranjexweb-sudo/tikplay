const crypto = require("crypto");
const wallet = require("../lib/tts-credit-wallet");

module.exports = function registerTtsCredits(app, { db, auth, mpFetch, mpConfigured, getPublicBaseUrl, getPublicKey, log }) {
  wallet.ensureSchema(db);
  const trace = () => crypto.randomUUID();
  const report = (category, level, event, message, details = {}, code) =>
    log({ category, level, event, message, code, trace_id: trace(), details });
  const packages = (enabledOnly = false) => db.db.prepare(`SELECT id,name,credits,price_cents,enabled
    FROM tts_credit_packages ${enabledOnly ? "WHERE enabled=1" : ""} ORDER BY price_cents,id`).all();

  app.get("/api/tts/credits", auth.requireAuth, (req, res) => {
    const tenantId = req.user.id;
    const account = db.getUserById(tenantId);
    res.set("Cache-Control", "no-store").json({ success: true, balance: wallet.getBalance(db, tenantId),
      account_email: account?.email || "",
      checkout: { public_key: typeof getPublicKey === "function" ? getPublicKey() : "" },
      packages: packages(true).map(item => ({ ...item, price: (item.price_cents / 100).toFixed(2) })),
      ledger: wallet.ledger(db, tenantId, 15),
      model_costs: db.db.prepare(`SELECT model_id,credits_per_150_chars,
        CAST(credits_per_150_chars AS REAL)/150 AS credit_multiplier FROM additional_voice_models
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
    const paymentMethod = req.body?.payment_method === "pix" ? "pix" : "card";
    const publicKey = typeof getPublicKey === "function" ? getPublicKey() : "";
    if (paymentMethod === "card" && !publicKey)
      return res.status(503).json({ success: false, error: "Pagamento com cartão indisponível. Escolha Pix ou tente mais tarde." });
    const card = req.body?.card && typeof req.body.card === "object" ? req.body.card : {};
    const identificationType = typeof req.body?.identification_type === "string" ? req.body.identification_type.trim().toUpperCase() : "";
    const identificationNumber = typeof req.body?.identification_number === "string" ? req.body.identification_number.replace(/\D/g, "") : "";
    if (paymentMethod === "card" && (typeof card.token !== "string" || !/^[\x21-\x7e]{8,512}$/.test(card.token)
        || typeof card.payment_method_id !== "string" || !/^[a-z0-9_-]{2,50}$/i.test(card.payment_method_id)
        || !Number.isSafeInteger(Number(card.installments)) || Number(card.installments) < 1 || Number(card.installments) > 24))
      return res.status(400).json({ success: false, error: "Confira os dados do cartão e tente novamente." });
    if (!/^[A-Z0-9]{2,10}$/.test(identificationType) || identificationNumber.length < 5 || identificationNumber.length > 20)
      return res.status(400).json({ success: false, error: "Informe um documento válido para o pagamento." });
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
        report("error", "error", "tts.credits.payment_failed", "Pagamento de créditos requer uma URL pública HTTPS para notificações.",
          { tenant_id: tenantId, package_id: item.id, code: "CHECKOUT_BASE_URL_NOT_HTTPS" }, "CHECKOUT_BASE_URL_NOT_HTTPS");
        return res.status(503).json({ success: false, error: "Compra indisponível até configurar o endereço HTTPS do painel." });
      }
      const paymentPayload = {
        transaction_amount: item.price_cents / 100,
        description: `TikPlay · ${item.name} — ${item.credits} TikCoins`,
        payment_method_id: paymentMethod,
        external_reference: externalReference,
        notification_url: `${origin}/api/webhooks/mercadopago`,
        payer: { email: user.email, identification: { type: identificationType, number: identificationNumber } },
      };
      if (paymentMethod === "card") Object.assign(paymentPayload, {
        token: card.token,
        installments: Number(card.installments),
        issuer_id: card.issuer_id ? String(card.issuer_id).slice(0, 32) : undefined,
      });
      const result = await mpFetch("/v1/payments", { method: "POST",
        headers: { "X-Idempotency-Key": purchaseId }, body: JSON.stringify(paymentPayload) });
      if (![200, 201].includes(result.status) || !result.data?.id || !result.data?.status
          || String(result.data.external_reference || "") !== externalReference) {
        db.db.prepare("UPDATE tts_credit_purchases SET status='checkout_failed' WHERE id=?").run(purchaseId);
        report("error", "error", "tts.credits.payment_failed", "Não foi possível iniciar o pagamento de créditos.",
          { tenant_id: tenantId, package_id: item.id, payment_method: paymentMethod, http_status: result.status,
            code: "PAYMENT_CREATE_FAILED" }, "PAYMENT_CREATE_FAILED");
        return res.status(502).json({ success: false, error: "O Mercado Pago não conseguiu iniciar o pagamento. Confira os dados e tente novamente." });
      }
      const settled = wallet.settleApprovedPayment(db, result.data, log);
      if (!settled.handled || !settled.success) {
        report("notice", "warning", "tts.credits.purchase_rejected", "Pagamento criado, mas a validação da compra não foi concluída.",
          { tenant_id: tenantId, package_id: item.id, payment_id: String(result.data.id), code: settled.code || "PAYMENT_REFERENCE_MISMATCH" },
          settled.code || "PAYMENT_REFERENCE_MISMATCH");
        return res.status(409).json({ success: false, error: "Não foi possível validar este pagamento. Entre em contato com o suporte antes de tentar novamente." });
      }
      report("billing", "info", "tts.credits.payment_created", "Pagamento transparente de créditos iniciado.",
        { tenant_id: tenantId, package_id: item.id, credits: item.credits, price_cents: item.price_cents,
          payment_method: paymentMethod, payment_status: String(result.data.status).slice(0, 32) });
      res.set("Cache-Control", "no-store").json({ success: true, payment: {
        id: String(result.data.id), status: String(result.data.status), status_detail: String(result.data.status_detail || "").slice(0, 64),
      }, pix: paymentMethod === "pix" ? {
        qr_code: String(result.data.point_of_interaction?.transaction_data?.qr_code || "").slice(0, 4096),
        qr_code_base64: String(result.data.point_of_interaction?.transaction_data?.qr_code_base64 || "").slice(0, 200000),
      } : undefined, settled: Boolean(settled.success && (settled.approved || settled.duplicate)) });
    } catch {
      db.db.prepare("UPDATE tts_credit_purchases SET status='checkout_failed' WHERE id=?").run(purchaseId);
      report("error", "error", "tts.credits.payment_failed", "Não foi possível iniciar o pagamento de créditos.",
        { tenant_id: tenantId, package_id: item.id, payment_method: paymentMethod, code: "PAYMENT_CREATE_FAILED" }, "PAYMENT_CREATE_FAILED");
      res.status(502).json({ success: false, error: "Não foi possível iniciar o pagamento. Tente novamente." });
    }
  });

  app.get("/api/tts/credits/payments/:paymentId", auth.requireAuth, async (req, res) => {
    const paymentId = String(req.params.paymentId || "");
    if (!/^\d{1,32}$/.test(paymentId)) return res.status(400).json({ success: false, error: "Pagamento inválido." });
    const purchase = db.db.prepare("SELECT id FROM tts_credit_purchases WHERE tenant_id=? AND payment_id=?")
      .get(req.user.id, paymentId);
    if (!purchase) return res.status(404).json({ success: false, error: "Pagamento não encontrado." });
    try {
      const result = await mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`);
      if (result.status !== 200 || !result.data?.id) throw new Error("PAYMENT_LOOKUP_FAILED");
      if (String(result.data.external_reference || "") !== `tts-credit:${purchase.id}`)
        return res.status(409).json({ success: false, error: "Não foi possível validar este pagamento." });
      const settled = wallet.settleApprovedPayment(db, result.data, log);
      if (settled.handled && !settled.success) return res.status(409).json({ success: false, error: "Não foi possível validar o pagamento." });
      res.set("Cache-Control", "no-store").json({ success: true,
        status: String(result.data.status || "pending").slice(0, 32),
        balance: settled.approved ? settled.balance : wallet.getBalance(db, req.user.id) });
    } catch {
      report("error", "error", "tts.credits.payment_status_failed", "Não foi possível consultar o status do pagamento.",
        { tenant_id: req.user.id, code: "PAYMENT_LOOKUP_FAILED" }, "PAYMENT_LOOKUP_FAILED");
      res.status(502).json({ success: false, error: "Não foi possível consultar o pagamento agora." });
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

  app.get("/api/admin/tts/credit-report", auth.requireAdmin, (req, res) => {
    const range = String(req.query?.range || "30d");
    const daysByRange = { "7d": 7, "30d": 30, "90d": 90 };
    if (range !== "all" && !daysByRange[range])
      return res.status(400).json({ success: false, error: "Período inválido." });
    const since = range === "all" ? null : `-${daysByRange[range]} days`;
    const pageSize = 100;
    const rawOffset = Number(req.query?.offset || 0);
    const offset = Number.isSafeInteger(rawOffset) ? Math.max(0, Math.min(100000, rawOffset)) : 0;
    const periodSql = since ? "AND datetime(l.created_at)>=datetime('now', ?)" : "";
    const periodParams = since ? [since] : [];
    const totals = db.db.prepare(`SELECT
      SUM(CASE WHEN l.kind='purchase' THEN 1 ELSE 0 END) AS paid_purchase_count,
      SUM(CASE WHEN l.kind='purchase' THEN l.amount ELSE 0 END) AS paid_credits,
      SUM(CASE WHEN l.kind='purchase' THEN COALESCE(p.price_cents,0) ELSE 0 END) AS gross_paid_cents,
      SUM(CASE WHEN l.kind='purchase_reversal' THEN 1 ELSE 0 END) AS refund_count,
      SUM(CASE WHEN l.kind='purchase_reversal' THEN ABS(l.amount) ELSE 0 END) AS refunded_credits,
      SUM(CASE WHEN l.kind='purchase_reversal' THEN COALESCE(p.price_cents,0) ELSE 0 END) AS refunded_cents,
      SUM(CASE WHEN l.kind='admin_adjustment' AND l.amount>0 THEN 1 ELSE 0 END) AS manual_add_count,
      SUM(CASE WHEN l.kind='admin_adjustment' AND l.amount>0 THEN l.amount ELSE 0 END) AS manual_added_credits,
      SUM(CASE WHEN l.kind='admin_adjustment' AND l.amount<0 THEN 1 ELSE 0 END) AS manual_remove_count,
      SUM(CASE WHEN l.kind='admin_adjustment' AND l.amount<0 THEN ABS(l.amount) ELSE 0 END) AS manual_removed_credits
      FROM tts_credit_ledger l
      LEFT JOIN tts_credit_purchases p ON p.payment_id=l.reference_id
      WHERE l.kind IN ('purchase','purchase_reversal','admin_adjustment') ${periodSql}`).get(...periodParams);
    const rows = db.db.prepare(`SELECT l.id,l.tenant_id,l.amount,l.kind,l.reference_id,l.created_at,
      u.name AS streamer_name,u.email AS streamer_email,
      actor.name AS actor_name,actor.email AS actor_email,
      p.package_name,p.payment_id,p.price_cents
      FROM tts_credit_ledger l
      JOIN users u ON u.id=l.tenant_id
      LEFT JOIN users actor ON actor.id=l.actor_id
      LEFT JOIN tts_credit_purchases p ON p.payment_id=l.reference_id
      WHERE l.kind IN ('purchase','purchase_reversal','admin_adjustment') ${periodSql}
      ORDER BY l.id DESC LIMIT ? OFFSET ?`).all(...periodParams, pageSize, offset).map(row => ({
        ...row,
        source: row.kind === "admin_adjustment" ? "manual" : row.kind === "purchase_reversal" ? "refund" : "paid",
      }));
    const totalRows = db.db.prepare(`SELECT COUNT(*) AS count FROM tts_credit_ledger l
      WHERE l.kind IN ('purchase','purchase_reversal','admin_adjustment') ${periodSql}`).get(...periodParams).count;
    res.set("Cache-Control", "no-store").json({ success: true, range, offset, page_size: pageSize,
      total_rows: Number(totalRows || 0), has_more: offset + rows.length < Number(totalRows || 0),
      totals: {
        paid_purchase_count: Number(totals.paid_purchase_count || 0), paid_credits: Number(totals.paid_credits || 0),
        gross_paid_cents: Number(totals.gross_paid_cents || 0), refund_count: Number(totals.refund_count || 0),
        refunded_credits: Number(totals.refunded_credits || 0), refunded_cents: Number(totals.refunded_cents || 0),
        net_paid_cents: Number(totals.gross_paid_cents || 0) - Number(totals.refunded_cents || 0),
        manual_add_count: Number(totals.manual_add_count || 0), manual_added_credits: Number(totals.manual_added_credits || 0),
        manual_remove_count: Number(totals.manual_remove_count || 0), manual_removed_credits: Number(totals.manual_removed_credits || 0),
      }, rows });
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
