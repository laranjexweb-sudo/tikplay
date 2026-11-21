const crypto = require("crypto");

function ensureSchema(db) {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS tts_credit_wallets (
      tenant_id INTEGER PRIMARY KEY REFERENCES users(id),
      balance INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tts_credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL CHECK(amount != 0),
      kind TEXT NOT NULL CHECK(kind IN ('purchase','purchase_reversal','usage','admin_adjustment')),
      idempotency_key TEXT NOT NULL UNIQUE,
      model_id TEXT NOT NULL DEFAULT '',
      unit_count INTEGER NOT NULL DEFAULT 0,
      reference_id TEXT NOT NULL DEFAULT '',
      actor_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tts_credit_ledger_tenant_created
      ON tts_credit_ledger(tenant_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_tts_credit_ledger_created
      ON tts_credit_ledger(created_at DESC, kind);
    CREATE TABLE IF NOT EXISTS tts_credit_packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      credits INTEGER NOT NULL CHECK(credits > 0),
      price_cents INTEGER NOT NULL CHECK(price_cents > 0),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tts_credit_purchases (
      id TEXT PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES users(id),
      package_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      credits INTEGER NOT NULL CHECK(credits > 0),
      price_cents INTEGER NOT NULL CHECK(price_cents > 0),
      status TEXT NOT NULL DEFAULT 'pending',
      payment_id TEXT UNIQUE,
      payment_method_id TEXT NOT NULL DEFAULT '',
      payment_type_id TEXT NOT NULL DEFAULT '',
      fee_details_json TEXT NOT NULL DEFAULT '[]',
      fee_cents INTEGER,
      net_received_cents INTEGER,
      provider_details_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at TEXT
    );
  `);
  const purchaseColumns = new Set(db.db.prepare("PRAGMA table_info(tts_credit_purchases)").all().map(column => column.name));
  for (const [name, definition] of Object.entries({
    payment_method_id: "TEXT NOT NULL DEFAULT ''",
    payment_type_id: "TEXT NOT NULL DEFAULT ''",
    fee_details_json: "TEXT NOT NULL DEFAULT '[]'",
    fee_cents: "INTEGER",
    net_received_cents: "INTEGER",
    provider_details_synced_at: "TEXT",
  })) if (!purchaseColumns.has(name))
    db.db.exec(`ALTER TABLE tts_credit_purchases ADD COLUMN ${name} ${definition}`);
  const ledgerColumns = new Set(db.db.prepare("PRAGMA table_info(tts_credit_ledger)").all().map(column => column.name));
  if (!ledgerColumns.has("reason"))
    db.db.exec("ALTER TABLE tts_credit_ledger ADD COLUMN reason TEXT NOT NULL DEFAULT ''");
  const seedPackage = db.db.prepare(`INSERT OR IGNORE INTO tts_credit_packages
    (id,name,credits,price_cents,enabled) VALUES(?,?,?,?,1)`);
  [
    ["71000000-0000-4000-8000-000000000001", "Inicial", 30000, 1490],
    ["71000000-0000-4000-8000-000000000002", "Criador", 100000, 3990],
    ["71000000-0000-4000-8000-000000000003", "Pro", 300000, 9990],
  ].forEach(item => seedPackage.run(...item));
}

function paymentFinancialDetails(payment) {
  const methodId = typeof payment?.payment_method_id === "string" && /^[a-z0-9_-]{1,40}$/i.test(payment.payment_method_id)
    ? payment.payment_method_id.toLowerCase() : "";
  const typeId = typeof payment?.payment_type_id === "string" && /^[a-z0-9_-]{1,40}$/i.test(payment.payment_type_id)
    ? payment.payment_type_id.toLowerCase() : "";
  const normalizeFees = items => (Array.isArray(items) ? items : []).slice(0, 12).flatMap(item => {
    const amount = item?.amount == null || item.amount === "" ? NaN : Number(item.amount), cents = Math.round(amount * 100);
    const rawType = item?.type === "fee" ? item?.name : (item?.type || item?.name);
    const type = typeof rawType === "string" && /^[a-z0-9_-]{1,48}$/i.test(rawType) ? rawType.toLowerCase() : "";
    const from = typeof item?.accounts?.from === "string" ? item.accounts.from.toLowerCase()
      : typeof item?.fee_payer === "string" ? item.fee_payer.toLowerCase() : "";
    const knownFee = ["mercadopago_fee", "financed_advance_fee", "financing_fee", "shipping_fee", "installment_fee"]
      .includes(type);
    if (from && from !== "collector") return [];
    if (!knownFee && !(item?.type === "fee" && from === "collector")) return [];
    return type && Number.isFinite(amount) && cents >= 0 && Math.abs(amount * 100 - cents) < 0.000001
      ? [{ type, amount_cents: cents, ...(typeof item?.source === "string" && /^[a-z0-9_-]{1,64}$/i.test(item.source)
        ? { source: item.source.toLowerCase() } : {}) }] : [];
  });
  const chargeFees = normalizeFees(payment?.charges_details);
  const rawNet = payment?.transaction_details?.net_received_amount;
  const net = rawNet == null || rawNet === "" ? NaN : Number(rawNet);
  const netCents = Number.isFinite(net) && net >= 0 && Math.abs(net * 100 - Math.round(net * 100)) < 0.000001
    ? Math.round(net * 100) : null;
  const amount = payment?.transaction_amount == null || payment.transaction_amount === "" ? NaN : Number(payment.transaction_amount);
  const amountCents = Number.isFinite(amount) && amount >= 0 && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001
    ? Math.round(amount * 100) : null;
  const hasChargeArray = Array.isArray(payment?.charges_details);
  const hasFeeDetailsArray = Array.isArray(payment?.fee_details);
  const useCharges = chargeFees.length > 0 || (hasChargeArray && !hasFeeDetailsArray);
  const feeSource = useCharges ? "charges_details" : hasFeeDetailsArray ? "fee_details"
    : hasChargeArray ? "charges_details" : "unavailable";
  const fees = useCharges ? chargeFees : normalizeFees(payment?.fee_details);
  const feeCents = fees.reduce((sum, fee) => sum + fee.amount_cents, 0);
  const taxes = payment?.taxes_amount == null ? null : Number(payment.taxes_amount);
  const coupon = payment?.coupon_amount == null ? null : Number(payment.coupon_amount);
  const canReconcileFees = amountCents !== null && netCents !== null && amountCents >= netCents && taxes === 0 && coupon === 0;
  const grossNetFeeCents = canReconcileFees ? amountCents - netCents : null;
  const hasFeeArray = feeSource !== "unavailable";
  const synced = Boolean((methodId || typeId) && hasFeeArray && netCents !== null && amountCents !== null);
  return { methodId, typeId, fees, feeCents: hasFeeArray
      ? canReconcileFees ? grossNetFeeCents : feeCents : null,
    listedFeeCents: hasFeeArray ? feeCents : null,
    netCents, amountCents, feeSource, grossNetFeeCents,
    feeReconciliationMismatch: canReconcileFees && feeCents !== grossNetFeeCents, synced };
}

function persistPaymentDetails(db, payment, purchaseId) {
  const details = paymentFinancialDetails(payment);
  if (!details.synced) return false;
  const hasFeeArray = details.feeSource !== "unavailable";
  db.db.prepare(`UPDATE tts_credit_purchases SET
    payment_method_id=CASE WHEN ?<>'' THEN ? ELSE payment_method_id END,
    payment_type_id=CASE WHEN ?<>'' THEN ? ELSE payment_type_id END,
    fee_details_json=CASE WHEN ? THEN ? ELSE fee_details_json END,
    fee_cents=CASE WHEN ? THEN ? ELSE fee_cents END,
    net_received_cents=COALESCE(?,net_received_cents), provider_details_synced_at=CURRENT_TIMESTAMP
    WHERE id=?`).run(details.methodId, details.methodId, details.typeId, details.typeId,
      hasFeeArray ? 1 : 0, JSON.stringify(details.fees),
      hasFeeArray ? 1 : 0, details.feeCents, details.netCents, purchaseId);
  return true;
}

function ensureWallet(db, tenantId) {
  db.db.prepare("INSERT OR IGNORE INTO tts_credit_wallets(tenant_id,balance) VALUES(?,0)").run(tenantId);
}

function getBalance(db, tenantId) {
  ensureWallet(db, tenantId);
  return Number(db.db.prepare("SELECT balance FROM tts_credit_wallets WHERE tenant_id=?").get(tenantId)?.balance || 0);
}

function ledger(db, tenantId, limit = 20) {
  return db.db.prepare(`SELECT id,amount,kind,model_id,unit_count,reference_id,actor_id,reason,created_at
    FROM tts_credit_ledger WHERE tenant_id=? ORDER BY id DESC LIMIT ?`).all(tenantId, limit);
}

function adjust(db, { tenantId, amount, actorId, referenceId, reason = "" }) {
  if (!Number.isSafeInteger(tenantId) || !Number.isSafeInteger(amount) || amount === 0
      || Math.abs(amount) > 100000000 || !db.getUserById(tenantId)
      || typeof reason !== "string" || reason.trim().length > 500)
    return { success: false, code: "INVALID_ADJUSTMENT" };
  const key = `admin:${referenceId || crypto.randomUUID()}`;
  const transaction = db.db.transaction(() => {
    ensureWallet(db, tenantId);
    const current = db.db.prepare("SELECT balance FROM tts_credit_wallets WHERE tenant_id=?").get(tenantId).balance;
    if (current + amount < 0) return { success: false, code: "INSUFFICIENT_BALANCE", balance: current };
    db.db.prepare(`UPDATE tts_credit_wallets SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?`).run(amount, tenantId);
    db.db.prepare(`INSERT INTO tts_credit_ledger(tenant_id,amount,kind,idempotency_key,reference_id,actor_id,reason)
      VALUES(?,?,'admin_adjustment',?,?,?,?)`).run(tenantId, amount, key, referenceId || "", actorId || null,
      reason.trim() || "Ajuste manual sem motivo informado (cliente legado)");
    return { success: true, balance: current + amount };
  });
  try { return transaction.immediate(); }
  catch (error) {
    if (String(error?.message || "").includes("UNIQUE constraint failed")) return { success: false, code: "DUPLICATE_ADJUSTMENT" };
    throw error;
  }
}

function settleApprovedPayment(db, payment, log) {
  const external = String(payment?.external_reference || "");
  const match = /^tts-credit:([a-f0-9-]{36})$/i.exec(external);
  if (!match) return { handled: false };
  const purchaseId = match[1];
  const purchase = db.db.prepare("SELECT * FROM tts_credit_purchases WHERE id=?").get(purchaseId);
  if (!purchase) return { handled: true, success: false, code: "PURCHASE_NOT_FOUND" };
  const paymentId = String(payment?.id || "");
  const approved = payment?.status === "approved";
  const refunded = payment?.status === "refunded";
  const amount = Number(payment?.transaction_amount);
  const rawAmountCents = amount * 100;
  const amountCents = Math.round(rawAmountCents);
  if (!paymentId || payment?.currency_id !== "BRL" || !Number.isFinite(amount)
      || Math.abs(rawAmountCents - amountCents) > 0.000001 || amountCents !== purchase.price_cents) {
    return { handled: true, success: false, code: "PAYMENT_MISMATCH", tenantId: purchase.tenant_id };
  }
  const transaction = db.db.transaction(() => {
    const current = db.db.prepare("SELECT * FROM tts_credit_purchases WHERE id=?").get(purchaseId);
    if (!current) return { mismatch: true };
    if (current.payment_id && current.payment_id !== paymentId) return { mismatch: true };
    if (!refunded) persistPaymentDetails(db, payment, purchaseId);
    if (refunded) {
      if (current.status === "refunded") return { duplicate: true, balance: getBalance(db, purchase.tenant_id) };
      if (current.status !== "approved" || current.payment_id !== paymentId) return { mismatch: true };
      ensureWallet(db, current.tenant_id);
      db.db.prepare(`UPDATE tts_credit_wallets SET balance=balance-?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?`)
        .run(current.credits, current.tenant_id);
      db.db.prepare(`INSERT INTO tts_credit_ledger(tenant_id,amount,kind,idempotency_key,reference_id)
        VALUES(?,?,'purchase_reversal',?,?)`).run(current.tenant_id, -current.credits,
        `refund:${paymentId}`, paymentId);
      db.db.prepare("UPDATE tts_credit_purchases SET status='refunded' WHERE id=?").run(purchaseId);
      return { refunded: true, balance: getBalance(db, current.tenant_id) };
    }
    if (current.status === "approved" || current.status === "refunded")
      return { duplicate: true, balance: getBalance(db, purchase.tenant_id) };
    if (!approved) {
      db.db.prepare("UPDATE tts_credit_purchases SET status=?,payment_id=? WHERE id=? AND status='pending'")
        .run(String(payment.status || "pending").slice(0, 32), paymentId, purchaseId);
      return { pending: true };
    }
    ensureWallet(db, current.tenant_id);
    db.db.prepare(`UPDATE tts_credit_wallets SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?`)
      .run(current.credits, current.tenant_id);
    db.db.prepare(`INSERT INTO tts_credit_ledger(tenant_id,amount,kind,idempotency_key,reference_id)
      VALUES(?,?,'purchase',?,?)`).run(current.tenant_id, current.credits, `payment:${paymentId}`, paymentId);
    db.db.prepare(`UPDATE tts_credit_purchases SET status='approved',payment_id=?,paid_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(paymentId, purchaseId);
    return { approved: true, balance: getBalance(db, current.tenant_id) };
  });
  const result = transaction.immediate();
  if (result.approved) log({ category: "billing", level: "info", event: "tts.credits.purchase_approved",
    message: "Pagamento de créditos confirmado.", details: { tenant_id: purchase.tenant_id, payment_id: paymentId,
      package_id: purchase.package_id, price_cents: purchase.price_cents, credits: purchase.credits, balance: result.balance } });
  if (result.refunded) log({ category: "billing", level: "info", event: "tts.credits.purchase_refunded",
    trace_id: crypto.randomUUID(), message: "Compra de créditos reembolsada e saldo ajustado.", details: {
      tenant_id: purchase.tenant_id, payment_id: paymentId, package_id: purchase.package_id,
      credits: purchase.credits, balance: result.balance } });
  if (result.mismatch || (!result.approved && !result.refunded && !result.duplicate && !result.pending))
    return { handled: true, success: false, code: "PAYMENT_MISMATCH", tenantId: purchase.tenant_id };
  return { handled: true, success: true, ...result, tenantId: purchase.tenant_id };
}

module.exports = { ensureSchema, ensureWallet, getBalance, ledger, adjust, settleApprovedPayment,
  paymentFinancialDetails, persistPaymentDetails };
