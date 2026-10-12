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

  app.post("/api/gifts/sync", auth.requireAuth, (req, res) => {
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
        const safe = slugifyGift(req.body && req.body.gift);
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
      broadcastToClients(getTenant(req.user.id).browserClients, { type: "sound_alerts_updated" });
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
    broadcastToClients(getTenant(req.user.id).browserClients, { type: "sound_alerts_updated" });
    res.json({ success: true });
  });
};