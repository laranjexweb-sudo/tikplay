// Fase B-2b — Rotas do catálogo de gifts, gift-config e alertas sonoros.
// Registrado por server.js com o contexto (db, fs, multer, ws, daemon e helpers).

module.exports = function registerGiftRoutes(app, ctx = {}) {
  const {
    db,
    path,
    fs,
    multer,
    auth,
    getTenant,
    daemonSend,
    broadcastToClients,
    readGiftTags,
    readGiftImageMap,
    readTenantGiftConfig,
  } = ctx;

  const ACTION_ALERTS = Object.freeze({
    follow: "__action_follow__",
    share: "__action_share__",
    gifter_join: "__action_gifter_join__",
  });
  const removeAlertFile = (url) => {
    if (!url || !String(url).startsWith("/alert-audio/")) return;
    try {
      const rel = String(url).slice("/alert-audio/".length);
      const root = path.resolve(__dirname, "..", "public", "alert-audio");
      const file = path.resolve(root, rel);
      if (file.startsWith(root + path.sep) && fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  };
  const notifySoundAlertsUpdated = (tenantId) => {
    const tenant = getTenant(tenantId);
    const message = { type: "sound_alerts_updated" };
    broadcastToClients(tenant.browserClients, message);
    broadcastToClients(tenant.logClients, message);
  };

  app.get("/api/gift-tags", (req, res) => {
    res.json({ success: true, gifts: readGiftTags() });
  });

  app.get("/api/gift-image-map", (req, res) => {
    try {
      const map = readGiftImageMap();
      res.json({ success: true, map });
    } catch {
      res.json({ success: false, map: {} });
    }
  });

  // ---------------- Catálogo de gifts (sincronizado) ----------------

  app.get("/api/gifts", (req, res) => {
    const meta = db.getGiftMeta();
    const gifts = db.getGifts({ onlyActive: req.query.all === "1" ? false : true });
    res.json({
      success: true,
      gifts,
      synced_at: meta.last_sync || 0,
      last_sync_result: meta.last_sync_result || "",
    });
  });

app.post("/api/gifts/sync", auth.requireAdmin, (req, res) => {
    // Sincronização do catálogo GLOBAL é exclusiva do Super Admin (papel "admin").
    // 401 sem token (requireAuth) / 403 autenticado sem o papel (requireAdmin).
    // Valida forma: o endpoint não aceita payload/parâmetros (min/max são filtros
    // locais dos seletores, não da sincronização).
    if (req.body != null) {
      if (typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ success: false, error: "Payload invalido" });
      }
      const keys = Object.keys(req.body);
      if (keys.length > 0) {
        return res.status(400).json({ success: false, error: `Parametros invalidos: ${keys.slice(0, 5).join(", ") || "desconhecido"}` });
      }
    }
    const ok = daemonSend({ cmd: "sync_gifts", tenant_id: req.user.id });
    res.json({ success: ok, queued: ok });
  });

  // ---------------- Tenant gift config ----------------

  function normalizeHintGifts(rawList, maxCount = 5) {
    if (!Array.isArray(rawList)) {
      return { ok: false, error: "hint_gifts deve ser uma lista" };
    }
    if (rawList.length > maxCount) {
      return { ok: false, error: `Maximo de ${maxCount} gifts` };
    }
    const legacyNames = new Set(readGiftTags().map((g) => String(g && g.name || "").toLowerCase()));
    const seen = new Set();
    const normalized = [];
    for (const item of rawList) {
      const ref = String(item || "").trim();
      if (!ref) return { ok: false, error: "Nome/ID de gift vazio" };
      // Aceita ID do TikTok ou nome. Resolve para a referência canônica (ID quando sincronizado).
      let g = null;
      try { g = db.getGiftById(ref) || db.getGiftByName(ref); } catch {}
      let value;
      if (g) {
        value = g.id || g.name;
      } else if (legacyNames.has(ref.toLowerCase())) {
        value = ref; // nome legado ainda não sincronizado
      } else {
        return { ok: false, error: `Gift invalido: ${ref}` };
      }
      const key = String(value).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(value);
    }
    return { ok: true, gifts: normalized };
  }

  app.get("/api/gift-config", auth.requireAuth, (req, res) => {
    const config = readTenantGiftConfig(req.user.id);
    res.json({ success: true, ...config });
  });

  app.post("/api/gift-config", auth.requireAuth, (req, res) => {
    const { hint_gifts, riddle_gifts, size_gift, letter_gift } = req.body;
    if (hint_gifts === undefined && riddle_gifts === undefined && size_gift === undefined && letter_gift === undefined) {
      return res.json({ success: false, error: "hint_gifts, riddle_gifts, size_gift ou letter_gift obrigatorio" });
    }

    const config = readTenantGiftConfig(req.user.id);

    if (hint_gifts !== undefined) {
      const checked = normalizeHintGifts(hint_gifts);
      if (!checked.ok) return res.json({ success: false, error: checked.error });
      config.hint_gifts = checked.gifts;
    }

    if (riddle_gifts !== undefined) {
      const checkedRiddles = normalizeHintGifts(riddle_gifts, 1);
      if (!checkedRiddles.ok) return res.json({ success: false, error: "Máximo de 1 presente revelador" });
      config.riddle_gifts = checkedRiddles.gifts.slice(0, 1);
    }

    if (size_gift !== undefined) {
      config.size_gift = String(size_gift || "").trim();
    }

    if (letter_gift !== undefined) {
      config.letter_gift = String(letter_gift || "").trim();
    }

    try {
      db.saveTenantGiftConfig(req.user.id, config.hint_gifts || [], config.riddle_gifts || [], config.size_gift, config.letter_gift);
      const newGifts = config.hint_gifts || [];
      const newRiddleGifts = config.riddle_gifts || [];
      const newSizeGift = config.size_gift || "";
      const newLetterGift = config.letter_gift || "";
      const tenant = getTenant(req.user.id);
      tenant.gameState.hint_gifts = newGifts;
      tenant.gameState.riddle_gifts = newRiddleGifts;
      daemonSend({ cmd: "update_gift_config", tenant_id: req.user.id, hint_gifts: newGifts, riddle_gifts: newRiddleGifts, size_gift: newSizeGift, letter_gift: newLetterGift });
      broadcastToClients(tenant.browserClients, { type: "gift_config_updated", hint_gifts: newGifts, riddle_gifts: newRiddleGifts, size_gift: newSizeGift, letter_gift: newLetterGift });
      res.json({ success: true, hint_gifts: newGifts, riddle_gifts: newRiddleGifts, size_gift: newSizeGift, letter_gift: newLetterGift });
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  // ---------------- Alertas Sonoros (som custom por gift) ----------------

  function slugifyGift(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "gift";
  }

  const soundUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(__dirname, "..", "public", "alert-audio", String(req.user.id));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const safe = slugifyGift((req.body && (req.body.gift || req.body.action)) || "gift");
        const ext = (path.extname(file.originalname) || ".mp3").toLowerCase();
        cb(null, `${safe}-${Date.now()}${ext}`);
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const name = file.originalname || "";
      const ok = /\.(mp3|wav|ogg|m4a|aac|flac|webm|mp4|opus)$/i.test(name);
      cb(null, ok);
    },
  });

  app.post("/api/sound-alerts", auth.requireAuth, soundUpload.single("file"), (req, res) => {
    const gift = String(req.body.gift || "").trim();
    const slot = req.body.type === "combo" ? "combo" : "normal";
    if (!gift) return res.json({ success: false, error: "Gift obrigatorio" });
    if (!req.file) return res.json({ success: false, error: "Arquivo de audio obrigatorio" });
    try {
      const url = `/alert-audio/${req.user.id}/${req.file.filename}`;
      db.saveSoundAlert(req.user.id, gift, slot, url);
      notifySoundAlertsUpdated(req.user.id);
      res.json({ success: true, gift, slot, url });
    } catch (e) {
      res.json({ success: false, error: e.message });
    }
  });

  app.get("/api/sound-alerts", auth.requireAuth, (req, res) => {
    res.json({ success: true, alerts: db.getSoundAlerts(req.user.id) });
  });

  app.delete("/api/sound-alerts", auth.requireAuth, (req, res) => {
    const gift = String(req.query.gift || "").trim();
    if (!gift) return res.json({ success: false, error: "Gift obrigatorio" });
    const slot = req.query.slot === "combo" ? "combo" : (req.query.slot === "normal" ? "normal" : null);
    const alerts = db.getSoundAlerts(req.user.id);
    const entry = alerts[gift];
    if (entry) {
      const targets = slot ? [entry[slot]] : [entry.normal, entry.combo];
      for (const t of targets) {
        if (t) {
          try {
            const rel = t.replace("/alert-audio/", "");
            const file = path.join(__dirname, "..", "public", "alert-audio", rel);
            if (fs.existsSync(file)) fs.unlinkSync(file);
          } catch {}
        }
      }
    }
    if (slot) {
      db.saveSoundAlert(req.user.id, gift, slot, "");
    } else {
      db.saveSoundAlert(req.user.id, gift, "normal", "");
      db.saveSoundAlert(req.user.id, gift, "combo", "");
    }
    notifySoundAlertsUpdated(req.user.id);
    res.json({ success: true });
  });

  // ---------------- Alertas sonoros por ação ----------------
  app.get("/api/action-sound-alerts", auth.requireAuth, (req, res) => {
    const saved = db.getSoundAlerts(req.user.id);
    const alerts = Object.fromEntries(Object.entries(ACTION_ALERTS).map(([action, key]) => [action, saved[key]?.normal || ""]));
    res.json({ success: true, alerts, gifter_min_level: db.getActionGifterMinLevel(req.user.id) });
  });

  app.put("/api/action-sound-alerts/config", auth.requireAuth, (req, res) => {
    const level = db.saveActionGifterMinLevel(req.user.id, req.body?.gifter_min_level);
    notifySoundAlertsUpdated(req.user.id);
    res.json({ success: true, gifter_min_level: level });
  });

  app.post("/api/action-sound-alerts", auth.requireAuth, soundUpload.single("file"), (req, res) => {
    const action = String(req.body?.action || "");
    const key = ACTION_ALERTS[action];
    if (!key) {
      if (req.file) removeAlertFile(`/alert-audio/${req.user.id}/${req.file.filename}`);
      return res.status(400).json({ success: false, error: "Ação de alerta inválida." });
    }
    if (!req.file) return res.status(400).json({ success: false, error: "Arquivo de áudio obrigatório." });
    try {
      const previous = db.getSoundAlerts(req.user.id)[key]?.normal;
      const url = `/alert-audio/${req.user.id}/${req.file.filename}`;
      db.saveSoundAlert(req.user.id, key, "normal", url);
      if (previous && previous !== url) removeAlertFile(previous);
      notifySoundAlertsUpdated(req.user.id);
      res.json({ success: true, action, url });
    } catch (e) {
      removeAlertFile(`/alert-audio/${req.user.id}/${req.file.filename}`);
      res.status(500).json({ success: false, error: "Não foi possível salvar o áudio." });
    }
  });

  app.delete("/api/action-sound-alerts", auth.requireAuth, (req, res) => {
    const action = String(req.query.action || "");
    const key = ACTION_ALERTS[action];
    if (!key) return res.status(400).json({ success: false, error: "Ação de alerta inválida." });
    const previous = db.getSoundAlerts(req.user.id)[key]?.normal;
    db.saveSoundAlert(req.user.id, key, "normal", "");
    removeAlertFile(previous);
    notifySoundAlertsUpdated(req.user.id);
    res.json({ success: true });
  });
};
