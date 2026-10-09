"""Duelo 1x1 — engine isolada.

O Python apenas valida o presente (por ID, com fallback por nome) e emite um
evento `duelo_attack`. Toda a animação/estados idle->golpe->defesa->impacto->idle
vive no frontend (`duelo.html`), mantendo o daemon simples e sem contaminar outros jogos.
"""


class DueloEngine:
    VALID_CHARACTERS = ("flavio", "lula")
    VALID_ACTIONS = ("punch", "kick", "uppercut")

    def __init__(self, tenant_id=None, emit_cb=None):
        self.tenant_id = tenant_id
        self.emit_cb = emit_cb or (lambda type_, payload: None)
        self.active = False
        self.gifts = []

    def _emit(self, type_, payload):
        self.emit_cb(type_, payload)

    # ---------------- Config ----------------
    def set_config(self, gifts):
        self.gifts = list(gifts or [])

    def start(self, gifts=None):
        if gifts is not None:
            self.gifts = list(gifts or [])
        self.active = True

    def stop(self):
        self.active = False

    def state(self):
        return {"active": self.active}

    # ---------------- Match ----------------
    def _norm(self, s):
        return str(s or "").strip().lower()

    def _matches(self, gift, gift_id, gift_name):
        if not gift:
            return False
        gi = self._norm(gift.get("gift_id") or "")
        if gift_id and gi and gi == self._norm(gift_id):
            return True
        cfg_name = self._norm(gift.get("name") or "")
        return bool(cfg_name and cfg_name == self._norm(gift_name))

    # ---------------- Gift ----------------
    def on_gift(self, gift_id, gift_name, combo=1, user=None, nickname=None):
        if not self.active:
            return
        match = None
        for g in self.gifts:
            if g and g.get("active", True) and self._matches(g, gift_id, gift_name):
                match = g
                break
        if not match:
            return

        character = self._norm(match.get("character") or "")
        action = self._norm(match.get("action") or "")
        if character not in self.VALID_CHARACTERS or action not in self.VALID_ACTIONS:
            return

        audio = str(match.get("audio") or "")
        audio_url = f"/duelo-audio/{self.tenant_id}/{audio}" if audio else ""
        combo = max(1, int(combo or 1))
        self._emit("duelo_attack", {
            "attacker": character,
            "action": action,
            "combo": combo,
            "gift_id": str(match.get("gift_id") or ""),
            "gift": str(match.get("name") or gift_name or ""),
            "audio_url": audio_url,
            "user": user or "",
            "nickname": nickname or user or "",
        })