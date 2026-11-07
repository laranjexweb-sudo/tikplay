const crypto = require("crypto");
const wallet = require("../lib/tts-credit-wallet");

module.exports = function registerTtsCredits(app, { db, auth, mpFetch, mpConfigured, getPublicBaseUrl, getPublicKey, log }) {
  wallet.ensureSchema(db);
  const trace = () => crypto.randomUUID();
  const report = (category, level, event, message, details = {}, code) =>
    log({ category, level, event, message, code, trace_id: trace(), details });
  const packages = (enabledOnly = false) => db.db.prepare(enabledOnly
    ? "SELECT id,name,credits,price_cents,enabled FROM tts_credit_packages WHERE enabled=1 ORDER BY price_cents,id"
    : `SELECT p.id,p.name,p.credits,p.price_cents,p.enabled,
      (SELECT COUNT(*) FROM tts_credit_purchases x WHERE x.package_id=p.id) AS purchase_count
      FROM tts_credit_packages p ORDER BY p.price_cents,p.id`).all();

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
    const item = typeof req.body?.package_id === "string"
      ? db.db.prepare("SELECT * FROM tts_credit_packages WHERE id=? AND enabled=1").get(req.body.package_id) : null;
    if (!user || user.status !== "active" || !item)
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
    const search = String(req.query?.search || "").trim().slice(0, 120);
    const rawLimit = Number(req.query?.limit || 0), rawOffset = Number(req.query?.offset || 0);
    const paged = Number.isSafeInteger(rawLimit) && rawLimit > 0;
    const limit = paged ? Math.max(1, Math.min(100, rawLimit)) : 0;
    const offset = Number.isSafeInteger(rawOffset) ? Math.max(0, Math.min(1000000, rawOffset)) : 0;
    const where = "WHERE COALESCE(u.role,'user')<>'admin' AND (?='' OR lower(u.name) LIKE lower(?) OR lower(u.email) LIKE lower(?))";
    const params = [search, `%${search}%`, `%${search}%`];
    const total = db.db.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`).get(...params).count;
    const accounts = db.db.prepare(`SELECT u.id,u.name,u.email,u.status,COALESCE(w.balance,0) AS balance
      FROM users u LEFT JOIN tts_credit_wallets w ON w.tenant_id=u.id
      ${where} ORDER BY lower(u.name),u.id ${paged ? "LIMIT ? OFFSET ?" : ""}`).all(...params, ...(paged ? [limit, offset] : []));
    res.set("Cache-Control", "no-store").json({ success: true, accounts, total: Number(total || 0),
      limit: paged ? limit : null, offset: paged ? offset : 0, has_more: paged && offset + accounts.length < Number(total || 0) });
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
    const purchaseFilters = [];
    const purchaseParams = [];
    if (since) { purchaseFilters.push("datetime(COALESCE(p.paid_at,p.created_at))>=datetime('now', ?)"); purchaseParams.push(since); }
    const streamerId = Number(req.query?.streamer_id || 0);
    if (Number.isSafeInteger(streamerId) && streamerId > 0) { purchaseFilters.push("p.tenant_id=?"); purchaseParams.push(streamerId); }
    const packageId = String(req.query?.package_id || "").slice(0, 64);
    if (packageId) { purchaseFilters.push("p.package_id=?"); purchaseParams.push(packageId); }
    const purchaseStatus = String(req.query?.status || "");
    const purchaseStatuses = ["approved", "pending", "in_process", "authorized", "in_mediation", "cancelled", "rejected", "refunded", "charged_back", "checkout_failed"];
    if (purchaseStatus && !purchaseStatuses.includes(purchaseStatus))
      return res.status(400).json({ success: false, error: "Status de compra inválido." });
    if (purchaseStatus) { purchaseFilters.push("p.status=?"); purchaseParams.push(purchaseStatus); }
    const purchaseWhere = purchaseFilters.length ? `WHERE ${purchaseFilters.join(" AND ")}` : "";
    const purchaseTotals = db.db.prepare(`SELECT
      SUM(CASE WHEN p.status IN ('approved','refunded') THEN 1 ELSE 0 END) AS confirmed_count,
      SUM(CASE WHEN p.status IN ('approved','refunded') THEN p.price_cents ELSE 0 END) AS gross_cents,
      SUM(CASE WHEN p.status IN ('approved','refunded') THEN p.credits ELSE 0 END) AS sold_credits,
      SUM(CASE WHEN p.status IN ('pending','in_process','authorized','in_mediation') THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN p.status IN ('cancelled','rejected','refunded','charged_back','checkout_failed') THEN 1 ELSE 0 END) AS cancelled_count
      FROM tts_credit_purchases p ${purchaseWhere}`).get(...purchaseParams);
    const purchasesTotal = Number(db.db.prepare(`SELECT COUNT(*) AS count FROM tts_credit_purchases p ${purchaseWhere}`)
      .get(...purchaseParams).count || 0);
    const purchaseOffset = Number.isSafeInteger(Number(req.query?.purchase_offset))
      ? Math.max(0, Math.min(1000000, Number(req.query.purchase_offset))) : offset;
    const purchaseRows = db.db.prepare(`SELECT p.id,p.tenant_id,p.package_id,p.package_name,p.credits,p.price_cents,
      p.status,p.payment_id,p.created_at,p.paid_at,u.name AS streamer_name,u.email AS streamer_email
      FROM tts_credit_purchases p JOIN users u ON u.id=p.tenant_id ${purchaseWhere}
      ORDER BY COALESCE(p.paid_at,p.created_at) DESC,p.id DESC LIMIT ? OFFSET ?`)
      .all(...purchaseParams, pageSize, purchaseOffset);
    const reportOptions = {
      streamers: db.db.prepare(`SELECT id,name,email FROM users WHERE COALESCE(role,'user')<>'admin' ORDER BY lower(name),id`).all(),
      packages: packages(false),
    };
    res.set("Cache-Control", "no-store").json({ success: true, range, offset, page_size: pageSize,
      total_rows: Number(totalRows || 0), has_more: offset + rows.length < Number(totalRows || 0),
      totals: {
        paid_purchase_count: Number(totals.paid_purchase_count || 0), paid_credits: Number(totals.paid_credits || 0),
        gross_paid_cents: Number(totals.gross_paid_cents || 0), refund_count: Number(totals.refund_count || 0),
        refunded_credits: Number(totals.refunded_credits || 0), refunded_cents: Number(totals.refunded_cents || 0),
        net_paid_cents: Number(totals.gross_paid_cents || 0) - Number(totals.refunded_cents || 0),
        manual_add_count: Number(totals.manual_add_count || 0), manual_added_credits: Number(totals.manual_added_credits || 0),
        manual_remove_count: Number(totals.manual_remove_count || 0), manual_removed_credits: Number(totals.manual_removed_credits || 0),
      }, rows,
      purchase_totals: { confirmed_count: Number(purchaseTotals.confirmed_count || 0),
        gross_cents: Number(purchaseTotals.gross_cents || 0), sold_credits: Number(purchaseTotals.sold_credits || 0),
        pending_count: Number(purchaseTotals.pending_count || 0), cancelled_count: Number(purchaseTotals.cancelled_count || 0) },
      purchases: purchaseRows, purchases_total: purchasesTotal, purchase_offset: purchaseOffset,
      purchases_has_more: purchaseOffset + purchaseRows.length < purchasesTotal, options: reportOptions });
  });

  app.get("/api/admin/tts/credit-movements", auth.requireAdmin, (req, res) => {
    const kind = String(req.query?.kind || "all");
    const kindMap = { purchase: ["purchase"], manual_add: ["admin_adjustment"], manual_remove: ["admin_adjustment"],
      usage: ["usage"], refund: ["purchase_reversal"] };
    if (kind !== "all" && !kindMap[kind]) return res.status(400).json({ success: false, error: "Tipo de movimentação inválido." });
    const filters = [], params = [];
    if (kind !== "all") { filters.push(`l.kind IN (${kindMap[kind].map(() => "?").join(",")})`); params.push(...kindMap[kind]); }
    if (kind === "manual_add") filters.push("l.amount>0");
    if (kind === "manual_remove") filters.push("l.amount<0");
    const streamerId = Number(req.query?.streamer_id || 0);
    if (Number.isSafeInteger(streamerId) && streamerId > 0) { filters.push("l.tenant_id=?"); params.push(streamerId); }
    const range = String(req.query?.range || "30d"), daysByRange = { "7d": 7, "30d": 30, "90d": 90 };
    if (range !== "all" && !daysByRange[range]) return res.status(400).json({ success: false, error: "Período inválido." });
    if (range !== "all") { filters.push("datetime(l.created_at)>=datetime('now', ?)"); params.push(`-${daysByRange[range]} days`); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rawLimit = Number(req.query?.limit || 50), rawOffset = Number(req.query?.offset || 0);
    const limit = Number.isSafeInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 50;
    const offset = Number.isSafeInteger(rawOffset) ? Math.max(0, Math.min(1000000, rawOffset)) : 0;
    const total = Number(db.db.prepare(`SELECT COUNT(*) AS count FROM tts_credit_ledger l ${where}`).get(...params).count || 0);
    const rows = db.db.prepare(`SELECT l.id,l.tenant_id,l.amount,l.kind,l.model_id,l.unit_count,l.reference_id,l.actor_id,l.reason,l.created_at,
      u.name AS streamer_name,u.email AS streamer_email,a.name AS actor_name,a.email AS actor_email,
      p.package_name,p.payment_id
      FROM tts_credit_ledger l JOIN users u ON u.id=l.tenant_id LEFT JOIN users a ON a.id=l.actor_id
      LEFT JOIN tts_credit_purchases p ON p.payment_id=l.reference_id ${where}
      ORDER BY l.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const streamers = db.db.prepare(`SELECT id,name,email FROM users WHERE COALESCE(role,'user')<>'admin' ORDER BY lower(name),id`).all();
    res.set("Cache-Control", "no-store").json({ success: true, rows, total, limit, offset,
      has_more: offset + rows.length < total, streamers });
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
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!Number.isSafeInteger(amount) || amount === 0 || reason.length > 500
        || (req.body?.reason !== undefined && reason.length > 0 && reason.length < 3)) {
      report("notice", "warning", "tts.credits.adjustment_rejected", "Ajuste de créditos inválido.",
        { tenant_id: tenantId, actor_id: req.user.id, code: "INVALID_ADJUSTMENT" }, "INVALID_ADJUSTMENT");
      return res.status(400).json({ success: false, error: "Informe uma quantidade inteira e um motivo válido." });
    }
    const referenceId = crypto.randomUUID();
    try {
      const result = wallet.adjust(db, { tenantId, amount, actorId: req.user.id, referenceId, reason });
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
