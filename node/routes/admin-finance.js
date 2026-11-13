const crypto = require("crypto");

const EXPENSE_CATEGORIES = new Set([
  "APIs e serviços", "Hospedagem", "Infraestrutura", "Software", "Tarifas e impostos", "Marketing", "Outros",
]);

module.exports = function registerAdminFinance(app, { db, auth, log }) {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS finance_suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Outros',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS finance_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      supplier_id INTEGER REFERENCES finance_suppliers(id) ON DELETE SET NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','cancelled')),
      paid_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_by INTEGER,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_finance_expenses_status_due ON finance_expenses(status,due_date,id DESC);
    CREATE INDEX IF NOT EXISTS idx_finance_expenses_paid_at ON finance_expenses(paid_at,id DESC);
    CREATE TABLE IF NOT EXISTS finance_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor_id INTEGER,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_finance_audit_entity ON finance_audit_log(entity_type,entity_id,id DESC);
  `);

  const audit = db.db.prepare(`INSERT INTO finance_audit_log(entity_type,entity_id,action,actor_id,before_json,after_json)
    VALUES(?,?,?,?,?,?)`);
  const logEvent = (req, event, message, details = {}) => {
    if (typeof log !== "function") return;
    log({ category: "billing", level: "info", event, message, trace_id: crypto.randomUUID(),
      details: { actor_id: Number(req.user.id), ...details } });
  };
  const reject = (req, event, code, message) => {
    if (typeof log !== "function") return;
    log({ category: "billing", level: "warning", event, code, trace_id: crypto.randomUUID(), message,
      details: { actor_id: Number(req.user.id), code } });
  };
  const safeExpense = row => row ? {
    ...row,
    amount_cents: Number(row.amount_cents),
    supplier_id: row.supplier_id == null ? null : Number(row.supplier_id),
  } : null;
  const validDate = value => {
    if (!value) return true;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };

  app.get("/api/admin/finance/summary", auth.requireAdmin, (req, res) => {
    const range = String(req.query?.range || "30d");
    const days = { "7d": 7, "30d": 30, "90d": 90 };
    if (range !== "all" && !days[range]) return res.status(400).json({ success: false, error: "Período inválido." });
    const since = range === "all" ? null : `-${days[range]} days`;
    const purchasePeriod = since ? "AND datetime(l.created_at)>=datetime('now', ?)" : "";
    const expensePeriod = since ? "AND datetime(paid_at)>=datetime('now', ?)" : "";
    const income = db.db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN l.kind='purchase' THEN p.price_cents ELSE 0 END),0) AS gross_cents,
      COALESCE(SUM(CASE WHEN l.kind='purchase_reversal' THEN p.price_cents ELSE 0 END),0) AS refunded_cents,
      SUM(CASE WHEN l.kind='purchase' THEN 1 ELSE 0 END) AS paid_count,
      SUM(CASE WHEN l.kind='purchase_reversal' THEN 1 ELSE 0 END) AS refund_count
      FROM tts_credit_ledger l LEFT JOIN tts_credit_purchases p ON p.payment_id=l.reference_id
      WHERE l.kind IN ('purchase','purchase_reversal') ${purchasePeriod}`).get(...(since ? [since] : []));
    const expenses = db.db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS paid_cents,COUNT(*) AS paid_count
      FROM finance_expenses WHERE status='paid' ${expensePeriod}`).get(...(since ? [since] : []));
    const payables = db.db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS cents,COUNT(*) AS count
      FROM finance_expenses WHERE status='pending'`).get();
    const pendingPurchases = db.db.prepare(`SELECT COUNT(*) AS count FROM tts_credit_purchases WHERE status IN ('pending','in_process','authorized','in_mediation')`).get();
    const gross = Number(income.gross_cents || 0), refunds = Number(income.refunded_cents || 0), paidExpenses = Number(expenses.paid_cents || 0);
    res.set("Cache-Control", "no-store").json({ success: true, range, summary: {
      recharge_gross_cents: gross, recharge_refunds_cents: refunds, recharge_net_cents: gross - refunds,
      recharge_count: Number(income.paid_count || 0), refund_count: Number(income.refund_count || 0),
      paid_expenses_cents: paidExpenses, paid_expense_count: Number(expenses.paid_count || 0),
      operating_result_cents: gross - refunds - paidExpenses,
      payable_cents: Number(payables.cents || 0), payable_count: Number(payables.count || 0),
      pending_recharges: Number(pendingPurchases.count || 0),
    } });
  });

  app.get("/api/admin/finance/expenses", auth.requireAdmin, (req, res) => {
    const status = String(req.query?.status || "pending");
    if (!new Set(["all", "pending", "paid", "cancelled", "overdue"]).has(status))
      return res.status(400).json({ success: false, error: "Filtro de situação inválido." });
    const search = String(req.query?.search || "").trim().slice(0, 120);
    const rawLimit = Number(req.query?.limit || 50), rawOffset = Number(req.query?.offset || 0);
    const limit = Number.isSafeInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 50;
    const offset = Number.isSafeInteger(rawOffset) ? Math.max(0, Math.min(1000000, rawOffset)) : 0;
    const filters = [], params = [];
    if (status === "overdue") filters.push("e.status='pending' AND e.due_date < date('now','localtime')");
    else if (status !== "all") { filters.push("e.status=?"); params.push(status); }
    if (search) { filters.push("(lower(e.description) LIKE lower(?) OR lower(e.category) LIKE lower(?) OR lower(COALESCE(s.name,'')) LIKE lower(?))"); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = Number(db.db.prepare(`SELECT COUNT(*) AS count FROM finance_expenses e LEFT JOIN finance_suppliers s ON s.id=e.supplier_id ${where}`).get(...params).count || 0);
    const rows = db.db.prepare(`SELECT e.*,s.name AS supplier_name,u.name AS created_by_name
      FROM finance_expenses e LEFT JOIN finance_suppliers s ON s.id=e.supplier_id
      LEFT JOIN users u ON u.id=e.created_by ${where}
      ORDER BY CASE e.status WHEN 'pending' THEN 0 WHEN 'paid' THEN 1 ELSE 2 END,
      COALESCE(e.due_date,e.paid_at,e.created_at) ASC,e.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset).map(safeExpense);
    res.set("Cache-Control", "no-store").json({ success: true, rows, total, limit, offset, has_more: offset + rows.length < total });
  });

  app.post("/api/admin/finance/expenses", auth.requireAdmin, (req, res) => {
    const body = req.body || {};
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const category = String(body.category || "");
    const amount = body.amount_cents;
    const supplierId = body.supplier_id == null || body.supplier_id === "" ? null : Number(body.supplier_id);
    const dueDate = body.due_date || null;
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const status = body.status === "paid" ? "paid" : "pending";
    if (description.length < 2 || description.length > 180 || !EXPENSE_CATEGORIES.has(category)
        || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000000000
        || !validDate(dueDate) || notes.length > 2000
        || (supplierId != null && (!Number.isSafeInteger(supplierId) || !db.db.prepare("SELECT id FROM finance_suppliers WHERE id=? AND active=1").get(supplierId))))
      { reject(req, "finance.expense.create_rejected", "INVALID_EXPENSE", "Cadastro de despesa rejeitado por dados inválidos.");
        return res.status(400).json({ success: false, error: "Confira descrição, categoria, fornecedor, vencimento e valor da despesa." }); }
    const insert = db.db.prepare(`INSERT INTO finance_expenses(description,category,supplier_id,amount_cents,due_date,status,paid_at,notes,created_by,updated_by)
      VALUES(?,?,?,?,?,?,CASE WHEN ?='paid' THEN CURRENT_TIMESTAMP ELSE NULL END,?,?,?)`);
    const tx = db.db.transaction(() => {
      const result = insert.run(description, category, supplierId, amount, dueDate, status, status, notes, req.user.id, req.user.id);
      const id = Number(result.lastInsertRowid);
      const after = safeExpense(db.db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(id));
      audit.run("expense", id, "created", req.user.id, null, JSON.stringify(after));
      return after;
    });
    try {
      const expense = tx.immediate();
      logEvent(req, "finance.expense.created", "Despesa financeira cadastrada.", { expense_id: expense.id, category, amount_cents: amount, status });
      res.status(201).json({ success: true, expense });
    } catch {
      res.status(500).json({ success: false, error: "Não foi possível registrar a despesa." });
    }
  });

  app.put("/api/admin/finance/expenses/:id", auth.requireAdmin, (req, res) => {
    const id = Number(req.params.id), current = db.db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(id);
    if (!Number.isSafeInteger(id) || !current) return res.status(404).json({ success: false, error: "Despesa não encontrada." });
    const body = req.body || {};
    const nextStatus = body.status == null ? current.status : String(body.status);
    if (!new Set(["pending", "paid", "cancelled"]).has(nextStatus)
        || (current.status !== "pending" && nextStatus !== current.status))
      { reject(req, "finance.expense.update_rejected", "INVALID_STATUS_TRANSITION", "Alteração de situação rejeitada.");
        return res.status(409).json({ success: false, error: "Uma conta paga ou cancelada não pode voltar a ficar pendente." }); }
    const description = body.description == null ? current.description : String(body.description).trim();
    const category = body.category == null ? current.category : String(body.category);
    const amount = body.amount_cents == null ? Number(current.amount_cents) : body.amount_cents;
    const supplierId = body.supplier_id === undefined ? current.supplier_id : body.supplier_id == null || body.supplier_id === "" ? null : Number(body.supplier_id);
    const dueDate = body.due_date === undefined ? current.due_date : body.due_date || null;
    const notes = body.notes == null ? current.notes : String(body.notes).trim();
    if (description.length < 2 || description.length > 180 || !EXPENSE_CATEGORIES.has(category)
        || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000000000 || !validDate(dueDate) || notes.length > 2000
        || (supplierId != null && (!Number.isSafeInteger(supplierId) || (() => {
          const supplier = db.db.prepare("SELECT id,active FROM finance_suppliers WHERE id=?").get(supplierId);
          return !supplier || (!Number(supplier.active) && Number(current.supplier_id) !== supplierId);
        })())))
      { reject(req, "finance.expense.update_rejected", "INVALID_EXPENSE", "Atualização de despesa rejeitada por dados inválidos.");
        return res.status(400).json({ success: false, error: "Confira os dados da despesa." }); }
    const tx = db.db.transaction(() => {
      db.db.prepare(`UPDATE finance_expenses SET description=?,category=?,supplier_id=?,amount_cents=?,due_date=?,status=?,
        paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,CURRENT_TIMESTAMP) WHEN ?='pending' THEN NULL ELSE paid_at END,
        notes=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(description, category, supplierId, amount, dueDate, nextStatus, nextStatus, nextStatus, notes, req.user.id, id);
      const after = safeExpense(db.db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(id));
      const action = current.status !== nextStatus ? nextStatus === "paid" ? "paid" : "cancelled" : "updated";
      audit.run("expense", id, action, req.user.id, JSON.stringify(safeExpense(current)), JSON.stringify(after));
      return { after, action };
    });
    try {
      const result = tx.immediate();
      logEvent(req, `finance.expense.${result.action}`, result.action === "paid" ? "Conta a pagar marcada como paga." : result.action === "cancelled" ? "Despesa cancelada." : "Despesa atualizada.",
        { expense_id: id, amount_cents: amount, category });
      res.json({ success: true, expense: result.after });
    } catch {
      res.status(500).json({ success: false, error: "Não foi possível atualizar a despesa." });
    }
  });

  app.get("/api/admin/finance/suppliers", auth.requireAdmin, (req, res) => {
    const rows = db.db.prepare(`SELECT s.*,COUNT(e.id) AS expense_count FROM finance_suppliers s
      LEFT JOIN finance_expenses e ON e.supplier_id=s.id WHERE (?=1 OR s.active=1)
      GROUP BY s.id ORDER BY s.active DESC,lower(s.name),s.id`).all(req.query?.all === "1" ? 1 : 0);
    res.set("Cache-Control", "no-store").json({ success: true, rows });
  });

  app.post("/api/admin/finance/suppliers", auth.requireAdmin, (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const category = String(req.body?.category || "Outros");
    if (name.length < 2 || name.length > 120 || !EXPENSE_CATEGORIES.has(category))
      return res.status(400).json({ success: false, error: "Informe o nome e a categoria do fornecedor." });
    try {
      const result = db.db.prepare("INSERT INTO finance_suppliers(name,category,created_by) VALUES(?,?,?)").run(name, category, req.user.id);
      const id = Number(result.lastInsertRowid), after = db.db.prepare("SELECT * FROM finance_suppliers WHERE id=?").get(id);
      audit.run("supplier", id, "created", req.user.id, null, JSON.stringify(after));
      logEvent(req, "finance.supplier.created", "Fornecedor cadastrado.", { supplier_id: id, category });
      res.status(201).json({ success: true, supplier: after });
    } catch {
      res.status(500).json({ success: false, error: "Não foi possível cadastrar o fornecedor." });
    }
  });

  app.put("/api/admin/finance/suppliers/:id", auth.requireAdmin, (req, res) => {
    const id = Number(req.params.id), current = db.db.prepare("SELECT * FROM finance_suppliers WHERE id=?").get(id);
    if (!Number.isSafeInteger(id) || !current) return res.status(404).json({ success: false, error: "Fornecedor não encontrado." });
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : current.name;
    const category = req.body?.category == null ? current.category : String(req.body.category);
    const active = req.body?.active == null ? Number(current.active) : req.body.active ? 1 : 0;
    if (name.length < 2 || name.length > 120 || !EXPENSE_CATEGORIES.has(category))
      return res.status(400).json({ success: false, error: "Confira o nome e a categoria do fornecedor." });
    const tx = db.db.transaction(() => {
      db.db.prepare("UPDATE finance_suppliers SET name=?,category=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(name, category, active, id);
      const after = db.db.prepare("SELECT * FROM finance_suppliers WHERE id=?").get(id);
      audit.run("supplier", id, active ? "updated" : "archived", req.user.id, JSON.stringify(current), JSON.stringify(after));
      return after;
    });
    const supplier = tx.immediate();
    logEvent(req, active ? "finance.supplier.updated" : "finance.supplier.archived", active ? "Fornecedor atualizado." : "Fornecedor arquivado.", { supplier_id: id, category });
    res.json({ success: true, supplier });
  });
};
