// Módulo Ajuda e Suporte — chamados, sugestões, respostas rápidas e Central de Ajuda.
// Registrado por server.js com o contexto (db, auth, multer, fs, path).
//
// Escopo/papéis:
//   - Streamer (requireAuth): vê/responder/fecha APENAS os próprios chamados e
//     acessa APENAS os anexos dos próprios chamados.
//   - Admin (requireAdmin): vê e opera todos os chamados/sugestões/categorias/artigos.
//   - Central de Ajuda (GET /api/help/*): leitura pública, somente artigos publicados.
//
// Anexos: somente imagens, até 5 MB cada, gravados em node/data/support-files/<tenant>/
// (fora de public/, ignorado pelo git) e servidos só por endpoint autenticado.

const crypto = require("crypto");

module.exports = function registerSupportRoutes(app, ctx = {}) {
  const { db, auth, multer, fs, path } = ctx;

  const SUPPORT_FILES_DIR = path.join(__dirname, "..", "data", "support-files");
  fs.mkdirSync(SUPPORT_FILES_DIR, { recursive: true });

  const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB por imagem
  const MAX_ATTACHMENTS_PER_REQUEST = 5;
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;

  const attachmentUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(SUPPORT_FILES_DIR, String(req.user.id));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const ext = (path.extname(file.originalname) || "").toLowerCase();
        cb(null, `t${req.params.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
      },
    }),
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS_PER_REQUEST },
    fileFilter: (req, file, cb) => {
      const ok = IMAGE_EXT.test(file.originalname || "") && /^image\//i.test(file.mimetype || "");
      cb(null, ok); // false = ignora silenciosamente; tratamos a lista vazia depois
    },
  });

  // Envolve o middleware do multer para converter erros (ex.: tamanho) em JSON.
  function uploadImages() {
    const middleware = attachmentUpload.array("files", MAX_ATTACHMENTS_PER_REQUEST);
    return (req, res, next) => {
      middleware(req, res, (err) => {
        if (err) {
          const msg = err.code === "LIMIT_FILE_SIZE"
            ? "Imagem maior que o limite de 5 MB"
            : "Falha no upload da imagem";
          return res.status(400).json({ success: false, error: msg });
        }
        next();
      });
    };
  }

  function cleanupFiles(files) {
    for (const f of files || []) {
      try { fs.unlinkSync(f.path); } catch {}
    }
  }

  // Carrega o chamado garantindo que o usuário é dono (ou admin). Responde e retorna null se não puder.
  function loadOwnedTicket(req, res, id = req.params.id) {
    const ticket = db.getSupportTicket(id);
    if (!ticket) {
      res.status(404).json({ success: false, error: "Chamado não encontrado" });
      return null;
    }
    if (req.user.role !== "admin" && ticket.user_id !== req.user.id) {
      res.status(403).json({ success: false, error: "Acesso negado a este chamado" });
      return null;
    }
    return ticket;
  }

  function resolveSourceArticle(body) {
    if (!body) return null;
    if (body.source_article_id != null && body.source_article_id !== "") {
      const art = db.getHelpArticleById(parseInt(body.source_article_id, 10));
      if (art) return art.id;
    }
    if (body.source_article_slug) {
      const art = db.getHelpArticleBySlug(String(body.source_article_slug), { publishedOnly: false });
      if (art) return art.id;
    }
    return null;
  }

  // ==================== Streamer: categorias / jogos ====================

  app.get("/api/support/categories", auth.requireAuth, (req, res) => {
    res.json({ success: true, categories: db.listSupportCategories({ activeOnly: true }) });
  });

  app.get("/api/support/games", auth.requireAuth, (req, res) => {
    const games = db.SUPPORT_VISIBLE_GAME_SLUGS.map((slug) => ({ slug, name: db.SUPPORT_GAME_LABELS[slug] || slug }));
    res.json({
      success: true,
      games,
      game_labels: db.SUPPORT_GAME_LABELS,
      ticket_statuses: db.SUPPORT_TICKET_STATUSES,
      ticket_priorities: db.SUPPORT_TICKET_PRIORITIES,
      suggestion_types: db.SUPPORT_SUGGESTION_TYPES,
      suggestion_statuses: db.SUPPORT_SUGGESTION_STATUSES,
    });
  });

  // ==================== Streamer: chamados ====================

  app.post("/api/support/tickets", auth.requireAuth, (req, res) => {
    const b = req.body || {};
    const subject = String(b.subject || "").trim();
    const message = String(b.message || "").trim();
    if (subject.length < 3 || subject.length > 140) {
      return res.status(400).json({ success: false, error: "Assunto deve ter entre 3 e 140 caracteres" });
    }
    if (message.length < 5 || message.length > 5000) {
      return res.status(400).json({ success: false, error: "Descreva o problema com 5 a 5000 caracteres" });
    }
    let categoryId = null;
    if (b.category_id != null && b.category_id !== "") {
      const cat = db.getSupportCategoryById(parseInt(b.category_id, 10));
      if (!cat || !cat.active) return res.status(400).json({ success: false, error: "Categoria inválida" });
      categoryId = cat.id;
    }
    const gameId = String(b.game_id || "").trim();
    if (gameId && !db.SUPPORT_GAME_SLUGS.includes(gameId)) {
      return res.status(400).json({ success: false, error: "Jogo inválido" });
    }
    const priority = db.SUPPORT_TICKET_PRIORITIES.includes(b.priority) ? b.priority : "normal";
    const ticket = db.createSupportTicket({
      user_id: req.user.id,
      category_id: categoryId,
      game_id: gameId,
      subject,
      message,
      priority,
      source_article_id: resolveSourceArticle(b),
    });
    res.status(201).json({ success: true, ticket });
  });

  app.get("/api/support/tickets", auth.requireAuth, (req, res) => {
    const data = db.listSupportTicketsByUser(req.user.id, {
      status: req.query.status,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ success: true, ...data, counts: db.countSupportTicketsByUser(req.user.id) });
  });

  app.get("/api/support/tickets/:id", auth.requireAuth, (req, res) => {
    const ticket = loadOwnedTicket(req, res);
    if (!ticket) return;
    res.json({
      success: true,
      ticket,
      messages: db.listSupportTicketMessages(ticket.id),
      attachments: db.listSupportAttachments(ticket.id),
    });
  });

  app.post("/api/support/tickets/:id/messages", auth.requireAuth, (req, res) => {
    const ticket = loadOwnedTicket(req, res);
    if (!ticket) return;
    if (ticket.status === "fechado") {
      return res.status(400).json({ success: false, error: "Este chamado está fechado. Aguarde o suporte reabri-lo para continuar." });
    }
    const message = String((req.body || {}).message || "").trim();
    if (message.length < 1 || message.length > 5000) {
      return res.status(400).json({ success: false, error: "Mensagem inválida" });
    }
    const msg = db.addSupportMessage({ ticket_id: ticket.id, sender_id: req.user.id, sender_type: "user", message });
    // O usuário respondeu: se estava aguardando ele, volta para atendimento.
    if (ticket.status === "aguardando_usuario") db.setSupportTicketStatus(ticket.id, "em_atendimento");
    res.json({ success: true, message: msg, ticket: db.getSupportTicket(ticket.id) });
  });

  app.post("/api/support/tickets/:id/close", auth.requireAuth, (req, res) => {
    const ticket = loadOwnedTicket(req, res);
    if (!ticket) return;
    const updated = db.setSupportTicketStatus(ticket.id, "fechado");
    res.json({ success: true, ticket: updated });
  });

  app.post("/api/support/tickets/:id/attachments", auth.requireAuth, uploadImages(), (req, res) => {
    const files = req.files || [];
    const ticket = db.getSupportTicket(req.params.id);
    if (!ticket) {
      cleanupFiles(files);
      return res.status(404).json({ success: false, error: "Chamado não encontrado" });
    }
    if (req.user.role !== "admin" && ticket.user_id !== req.user.id) {
      cleanupFiles(files);
      return res.status(403).json({ success: false, error: "Acesso negado a este chamado" });
    }
    if (!files.length) {
      return res.status(400).json({ success: false, error: "Envie ao menos uma imagem (png, jpg, gif ou webp), até 5 MB cada" });
    }
    const messageId = (req.body && req.body.message_id) ? parseInt(req.body.message_id, 10) : null;
    const saved = [];
    for (const f of files) {
      const rel = path.relative(SUPPORT_FILES_DIR, f.path).split(path.sep).join("/");
      saved.push(db.addSupportAttachment({
        ticket_id: ticket.id,
        message_id: Number.isFinite(messageId) ? messageId : null,
        file_path: rel,
        mime_type: f.mimetype || "",
        size: f.size || 0,
      }));
    }
    res.status(201).json({ success: true, attachments: saved });
  });

  app.get("/api/support/attachments/:id", auth.requireAuth, (req, res) => {
    const att = db.getSupportAttachment(req.params.id);
    if (!att) return res.status(404).json({ success: false, error: "Anexo não encontrado" });
    const ticket = db.getSupportTicket(att.ticket_id);
    if (!ticket) return res.status(404).json({ success: false, error: "Anexo não encontrado" });
    if (req.user.role !== "admin" && ticket.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: "Acesso negado a este anexo" });
    }
    const base = path.resolve(SUPPORT_FILES_DIR);
    const abs = path.resolve(base, att.file_path);
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      return res.status(400).json({ success: false, error: "Caminho inválido" });
    }
    if (!fs.existsSync(abs)) return res.status(404).json({ success: false, error: "Arquivo indisponível" });
    res.setHeader("Content-Type", att.mime_type || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.sendFile(abs);
  });

  // ==================== Streamer: sugestões ====================

  app.post("/api/support/suggestions", auth.requireAuth, (req, res) => {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (title.length < 3 || title.length > 140) {
      return res.status(400).json({ success: false, error: "Título deve ter entre 3 e 140 caracteres" });
    }
    const description = String(b.description || "").trim();
    if (description.length > 5000) {
      return res.status(400).json({ success: false, error: "Descrição muito longa (máx. 5000 caracteres)" });
    }
    const type = db.SUPPORT_SUGGESTION_TYPES.includes(b.type) ? b.type : "outro";
    const gameId = String(b.game_id || "").trim();
    if (gameId && !db.SUPPORT_GAME_SLUGS.includes(gameId)) {
      return res.status(400).json({ success: false, error: "Jogo inválido" });
    }
    const suggestion = db.createSupportSuggestion({ user_id: req.user.id, type, game_id: gameId, title, description });
    res.status(201).json({ success: true, suggestion });
  });

  app.get("/api/support/suggestions", auth.requireAuth, (req, res) => {
    const data = db.listSupportSuggestionsByUser(req.user.id, {
      status: req.query.status,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ success: true, ...data });
  });

  // ==================== Central de Ajuda (leitura pública) ====================

  app.get("/api/help/categories", (req, res) => {
    res.json({ success: true, categories: db.listHelpCategories({ activeOnly: true }) });
  });

  app.get("/api/help/articles", (req, res) => {
    const data = db.listHelpArticles({
      category_id: req.query.category_id,
      game_id: req.query.game_id,
      q: req.query.q,
      published: true,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ success: true, ...data });
  });

  app.get("/api/help/articles/:slug", (req, res) => {
    const article = db.getHelpArticleBySlug(String(req.params.slug || ""), { publishedOnly: true });
    if (!article) return res.status(404).json({ success: false, error: "Artigo não encontrado" });
    res.json({ success: true, article });
  });

  // ==================== Admin: visão geral ====================

  app.get("/api/admin/support/overview", auth.requireAdmin, (req, res) => {
    res.json({ success: true, ...db.getSupportOverview() });
  });

  // ==================== Admin: chamados ====================

  app.get("/api/admin/support/tickets", auth.requireAdmin, (req, res) => {
    const data = db.listAllSupportTickets({
      status: req.query.status,
      category_id: req.query.category_id,
      game_id: req.query.game_id,
      priority: req.query.priority,
      q: req.query.q,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ success: true, ...data });
  });

  app.get("/api/admin/support/tickets/:id", auth.requireAdmin, (req, res) => {
    const ticket = db.getSupportTicket(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: "Chamado não encontrado" });
    res.json({
      success: true,
      ticket,
      messages: db.listSupportTicketMessages(ticket.id),
      attachments: db.listSupportAttachments(ticket.id),
      quick_replies: db.listSupportQuickReplies({ activeOnly: true }),
    });
  });

  app.post("/api/admin/support/tickets/:id/messages", auth.requireAdmin, (req, res) => {
    const ticket = db.getSupportTicket(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, error: "Chamado não encontrado" });
    const b = req.body || {};
    const message = String(b.message || "").trim();
    if (message.length < 1 || message.length > 5000) {
      return res.status(400).json({ success: false, error: "Mensagem inválida" });
    }
    const msg = db.addSupportMessage({ ticket_id: ticket.id, sender_id: req.user.id, sender_type: "staff", message });
    if (db.SUPPORT_TICKET_STATUSES.includes(b.status)) {
      db.setSupportTicketStatus(ticket.id, b.status);
    } else if (ticket.status === "novo") {
      db.setSupportTicketStatus(ticket.id, "em_atendimento");
    }
    res.json({ success: true, message: msg, ticket: db.getSupportTicket(ticket.id) });
  });

  app.post("/api/admin/support/tickets/:id/status", auth.requireAdmin, (req, res) => {
    const status = (req.body || {}).status;
    if (!db.SUPPORT_TICKET_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: "Status inválido" });
    }
    const ticket = db.setSupportTicketStatus(req.params.id, status);
    if (!ticket) return res.status(404).json({ success: false, error: "Chamado não encontrado" });
    res.json({ success: true, ticket });
  });

  // ==================== Admin: sugestões ====================

  app.get("/api/admin/support/suggestions", auth.requireAdmin, (req, res) => {
    const data = db.listAllSupportSuggestions({
      status: req.query.status,
      type: req.query.type,
      game_id: req.query.game_id,
      q: req.query.q,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ success: true, ...data });
  });

  app.post("/api/admin/support/suggestions/:id/status", auth.requireAdmin, (req, res) => {
    const status = (req.body || {}).status;
    if (!db.SUPPORT_SUGGESTION_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: "Status inválido" });
    }
    const suggestion = db.setSupportSuggestionStatus(req.params.id, status);
    if (!suggestion) return res.status(404).json({ success: false, error: "Sugestão não encontrada" });
    res.json({ success: true, suggestion });
  });

  // ==================== Admin: categorias de chamado ====================

  app.get("/api/admin/support/categories", auth.requireAdmin, (req, res) => {
    res.json({ success: true, categories: db.listSupportCategories({ activeOnly: false }) });
  });

  app.post("/api/admin/support/categories", auth.requireAdmin, (req, res) => {
    const b = req.body || {};
    const saved = db.saveSupportCategory({
      id: b.id ? parseInt(b.id, 10) : null,
      name: b.name,
      slug: b.slug,
      icon: b.icon,
      sort_order: b.sort_order,
      active: b.active !== false,
    });
    if (!saved) return res.status(400).json({ success: false, error: "Nome inválido" });
    res.json({ success: true, category: saved });
  });

  app.delete("/api/admin/support/categories/:id", auth.requireAdmin, (req, res) => {
    const ok = db.deleteSupportCategory(parseInt(req.params.id, 10));
    if (!ok) return res.status(404).json({ success: false, error: "Categoria não encontrada" });
    res.json({ success: true });
  });

  // ==================== Admin: respostas rápidas ====================

  app.get("/api/admin/support/quick-replies", auth.requireAdmin, (req, res) => {
    res.json({ success: true, quick_replies: db.listSupportQuickReplies({ activeOnly: false }) });
  });

  app.post("/api/admin/support/quick-replies", auth.requireAdmin, (req, res) => {
    const b = req.body || {};
    const saved = db.saveSupportQuickReply({
      id: b.id ? parseInt(b.id, 10) : null,
      title: b.title,
      body: b.body,
      sort_order: b.sort_order,
      active: b.active !== false,
    });
    if (!saved) return res.status(400).json({ success: false, error: "Título inválido" });
    res.json({ success: true, quick_reply: saved });
  });

  app.delete("/api/admin/support/quick-replies/:id", auth.requireAdmin, (req, res) => {
    const ok = db.deleteSupportQuickReply(parseInt(req.params.id, 10));
    if (!ok) return res.status(404).json({ success: false, error: "Resposta não encontrada" });
    res.json({ success: true });
  });

  // ==================== Admin: categorias da Central de Ajuda ====================

  app.get("/api/admin/help/categories", auth.requireAdmin, (req, res) => {
    res.json({ success: true, categories: db.listHelpCategories({ activeOnly: false }) });
  });

  app.post("/api/admin/help/categories", auth.requireAdmin, (req, res) => {
    const b = req.body || {};
    const saved = db.saveHelpCategory({
      id: b.id ? parseInt(b.id, 10) : null,
      name: b.name,
      slug: b.slug,
      icon: b.icon,
      sort_order: b.sort_order,
      active: b.active !== false,
    });
    if (!saved) return res.status(400).json({ success: false, error: "Nome inválido" });
    res.json({ success: true, category: saved });
  });

  app.delete("/api/admin/help/categories/:id", auth.requireAdmin, (req, res) => {
    const ok = db.deleteHelpCategory(parseInt(req.params.id, 10));
    if (!ok) return res.status(404).json({ success: false, error: "Categoria não encontrada" });
    res.json({ success: true });
  });

  // ==================== Admin: artigos da Central de Ajuda ====================

  app.get("/api/admin/help/articles", auth.requireAdmin, (req, res) => {
    const data = db.listHelpArticles({
      category_id: req.query.category_id,
      game_id: req.query.game_id,
      q: req.query.q,
      published: req.query.published === "1" ? true : (req.query.published === "0" ? false : null),
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ success: true, ...data });
  });

  app.get("/api/admin/help/articles/:id", auth.requireAdmin, (req, res) => {
    const article = db.getHelpArticleById(parseInt(req.params.id, 10));
    if (!article) return res.status(404).json({ success: false, error: "Artigo não encontrado" });
    res.json({ success: true, article });
  });

  app.post("/api/admin/help/articles", auth.requireAdmin, (req, res) => {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (title.length < 3 || title.length > 160) {
      return res.status(400).json({ success: false, error: "Título deve ter entre 3 e 160 caracteres" });
    }
    const saved = db.saveHelpArticle({
      id: b.id ? parseInt(b.id, 10) : null,
      category_id: b.category_id,
      game_id: b.game_id,
      title,
      slug: b.slug,
      summary: b.summary,
      content: b.content,
      keywords: b.keywords,
      published: b.published === true,
      sort_order: b.sort_order,
    });
    if (!saved) return res.status(400).json({ success: false, error: "Dados inválidos (título/slug)" });
    res.json({ success: true, article: saved });
  });

  app.delete("/api/admin/help/articles/:id", auth.requireAdmin, (req, res) => {
    const ok = db.deleteHelpArticle(parseInt(req.params.id, 10));
    if (!ok) return res.status(404).json({ success: false, error: "Artigo não encontrado" });
    res.json({ success: true });
  });
};
