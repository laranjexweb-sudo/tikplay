"""Jogo Bichinho Virtual (V-Pet) - motor isolado (extraido de game.py, Fase A-3).

Sem mudanca de comportamento. Dependencias: emit_cb, db e stdlib.
"""
import asyncio
import datetime
import json
import random
import time

import db

# =====================================================================
# Bichinho Virtual Comunitário (V-Pet estilo Digimon)
# Fases: egg -> baby -> rookie -> champion
# Loop 1s: decaimento de fome/energia, XP por cuidado, batalhas de boss.
# =====================================================================

VPET_MAX_LEVEL = 100
VPET_BATTLE_EVERY = 900                # segundos entre batalhas (15 min)
VPET_BATTLE_DURATION = 60              # cronômetro do boss
VPET_COUNTDOWN = 5                     # aviso curto antes da luta (dano já ativo)
VPET_DMG_PER_DIAMOND = 50
VPET_HATCH_NEED = 1000                 # pontos p/ chocar (Fase 0)
VPET_HATCH_GIFT_POINTS = 100           # pontos por presente durante o ovo
VPET_BAG_MAX = 3                       # limite da mochila de batalhas
VPET_BOREDOM_SECS = 60                 # segundos sem interação p/ dormir (Modo Assistente)
VPET_GREETING_COOLDOWN = 15            # cooldown de saudações de entrada (evita spam)
VPET_BATTLE_CHEER_COOLDOWN = 20        # cooldown de frases de incentivo na batalha
VPET_LIKE_THANKS_EVERY = 500           # agradecimento a cada N likes acumulados
VPET_TICK = 1.0
VPET_SAVE_INTERVAL = 15

# Fases por nível (Tiers que mudam o visual/classe do mascote)
PHASE_FROM_LEVEL = {0: 0, 1: 1, 11: 2, 31: 3, 51: 4, 100: 5}
PHASE_NAMES = {0: "ovo-estelar", 1: "filhote", 2: "guardiao", 3: "guerreiro", 4: "lorde", 5: "divindade"}

# HP base do Boss por Fase do mascote (progressão acentuada p/ viciar o chat)
BOSS_BASE_HP_BY_PHASE = {1: 100, 2: 500, 3: 2000, 4: 10000, 5: 10000}

BOSS_POOL = [
    {"name": "Golem de Ferro", "hp_mult": 1.0, "color": "#8a6f4d"},
    {"name": "Dragão Sombrio", "hp_mult": 1.4, "color": "#6b2a8a"},
    {"name": "Rei Robô", "hp_mult": 1.8, "color": "#3a6ea5"},
    {"name": "Hydra do Caos", "hp_mult": 2.2, "color": "#2a7a3a"},
    {"name": "Titã Lendário", "hp_mult": 2.8, "color": "#c0392b"},
]


def xp_to_next_level(level: int) -> int:
    """Curva de XP exponencial. Lvl 1->2 = 2.000; Lvl 29->30 ~150.000."""
    if level < 1:
        return 2000
    if level >= VPET_MAX_LEVEL:
        return 0
    return int(2000 * (1.166 ** (level - 1)))


def phase_for_level(level: int) -> int:
    """Retorna o índice da fase (0-5) para um nível."""
    idx = 0
    for thr, phase in sorted(PHASE_FROM_LEVEL.items()):
        if level >= thr:
            idx = phase
    return idx




class VPetEngine:
    """Mascote virtual dirigido pelo chat/presentes. Orquestrado pelo GameSession."""

    def __init__(self, tenant_id, emit_cb=None):
        self.tenant_id = tenant_id
        self._emit_cb = emit_cb or (lambda type_, payload: None)
        self.active = False
        self.started_at = None
        self.task = None
        self.damage_accum = 0
        self.combatants = {}
        self._last_saved = 0
        self._last_battle_end = 0
        self._last_log = 0
        self._like_since_thanks = 0
        self._last_greeting = 0
        self._last_battle_cheer = 0
        self._load()

    # -------------------------------------------------------------
    # Emissão
    # -------------------------------------------------------------
    def _emit(self, type_, payload):
        self._emit_cb(type_, payload)

    def _emit_log(self, text, throttle=0):
        if self._emit_cb is None:
            return
        now = time.time()
        if throttle and now - self._last_log < throttle:
            return
        self._last_log = now
        self._emit("log", text)

    # -------------------------------------------------------------
    # Modo Assistente (reações à live)
    # -------------------------------------------------------------
    def set_assistant_mode(self, on: bool):
        self.state["assistant_mode"] = bool(on)
        if on:
            self.state["last_interaction_time"] = time.time()
        self._save()
        self._emit("vpet_state", self.public_state())
        self._emit_log(f"[Bichinho] Modo Assistente {'ATIVADO' if on else 'desativado'}")

    def speak(self, text: str, duration: float = 4.0):
        self._emit("vpet_speak", {"text": text, "duration": duration})

    def _notify_interaction(self):
        """Registra interação (chat/like/gift/member) — quebra o sono por tédio."""
        self.state["last_interaction_time"] = time.time()
        if self.state.get("anim") == "sleep":
            self.state["anim"] = "battle" if self.state["battle"]["state"] != "idle" else "idle"
            self._emit("vpet_status", {"anim": self.state["anim"], "hunger": self.state["hunger"], "energy": self.state["energy"]})

    def greet_member(self, nickname: str):
        """Sauda um membro que entrou na live (cooldown p/ evitar spam)."""
        if not self.state.get("assistant_mode"):
            return
        now = time.time()
        if now - self._last_greeting < VPET_GREETING_COOLDOWN:
            return
        self._last_greeting = now
        self._notify_interaction()
        self.speak(f"Bem-vindo(a), {nickname}!")

    def register_like(self, like_count: int):
        """Acumula likes e agradece a cada 500 (isolado do ranking/dano)."""
        if not self.state.get("assistant_mode"):
            return
        self._like_since_thanks += max(0, int(like_count or 0))
        if self._like_since_thanks >= VPET_LIKE_THANKS_EVERY:
            self._like_since_thanks = 0
            self._notify_interaction()
            self.speak("Obrigado pelos likes! 💖")

    # -------------------------------------------------------------
    # Persistência
    # -------------------------------------------------------------
    def _load(self):
        try:
            data = db.load_vpet(self.tenant_id)
        except Exception:
            data = None
        if not data:
            data = self._default_state()
        else:
            # Migração do formato antigo (stage/egg_shakes) para o novo (level/hatch_points)
            if "stage" in data and "level" not in data:
                old_stage = int(data.get("stage") or 0)
                # baby->lvl1, rookie->lvl11, champion->lvl31 (preserva a fase)
                data["level"] = {0: 0, 1: 1, 2: 11, 3: 31}.get(old_stage, 0)
            if "egg_shakes" in data and "hatch_points" not in data:
                data["hatch_points"] = min(VPET_HATCH_NEED, int(data.get("egg_shakes") or 0) * 50)
            data.setdefault("level", 0)
            data.setdefault("xp", 0)
            data.setdefault("hatch_points", 0)
            data.setdefault("batalhas_disponiveis", 0)
        self.state = data
        self.state["phase"] = PHASE_NAMES.get(phase_for_level(self.state.get("level", 0)), "ovo-estelar")
        # Reaplica decaimento offline (fome/energia durante o tempo que a live ficou off)
        now = time.time()
        last_up = int(data.get("updated_at") or 0)
        if last_up and now > last_up and data.get("phase") != "ovo-estelar":
            dt = now - last_up
            off = min(dt, 8 * 3600)  # máx 8h de decaimento
            data["hunger"] = max(0, data.get("hunger", 100) - 0.05 * off)
            data["energy"] = max(0, data.get("energy", 100) - 0.03 * off)
        data.setdefault("active", False)
        data.setdefault("care_level", 0)
        data.setdefault("battle_wins", 0)
        data.setdefault("batalhas_disponiveis", 0)
        data.setdefault("assistant_mode", False)
        data.setdefault("last_interaction_time", time.time())
        data.setdefault("next_in", VPET_BATTLE_EVERY)
        data["last_tick"] = time.time()
        self.state = data

    @staticmethod
    def _default_state():
        return {
            "active": False,
            "level": 0,
            "xp": 0,
            "phase": "ovo-estelar",
            "hunger": 100,
            "energy": 100,
            "care_level": 0,
            "hatch_points": 0,
            "batalhas_disponiveis": 0,
            "battle_wins": 0,
            "assistant_mode": False,
            "last_interaction_time": time.time(),
            "anim": "idle",
            "hatched": False,
            "battle": {
                "state": "idle",
                "boss_name": "",
                "boss_hp": 0,
                "boss_max_hp": 0,
                "timer": 0,
                "next_in": VPET_BATTLE_EVERY,
            },
            "last_tick": time.time(),
            "updated_at": int(time.time()),
        }

    def _save(self):
        try:
            st = dict(self.state)
            st["battle"] = dict(self.state["battle"])
            st["updated_at"] = int(time.time())
            db.save_vpet(self.tenant_id, st)
        except Exception:
            pass

    def _save_if_due(self, interval=3):
        """Persiste status com throttle para não gravar a cada gift/like."""
        now = time.time()
        if now - self._last_saved >= interval:
            self._last_saved = now
            self._save()

    # -------------------------------------------------------------
    # Controle (start/stop)
    # -------------------------------------------------------------
    def start(self):
        self.active = True
        self.state["active"] = True
        self.state["last_tick"] = time.time()
        # Reseta batalha que ficou travada de uma sessão anterior
        if self.state["battle"]["state"] in ("fight", "countdown"):
            self.state["battle"] = {
                "state": "idle",
                "boss_name": "",
                "boss_hp": 0,
                "boss_max_hp": 0,
                "timer": 0,
                "next_in": VPET_BATTLE_EVERY,
            }
        self._last_saved = time.time()
        self._save()
        self._emit("vpet_state", self.public_state())
        self._emit_log("[Bichinho] Mascote ativado!")

    def stop(self):
        self.active = False
        self.state["active"] = False
        self._save()

    # -------------------------------------------------------------
    # Interações do público
    # -------------------------------------------------------------
    def egg_interact(self, user, nickname, amount=1):
        if self.state.get("level", 0) != 0:
            return
        self.state["hatch_points"] = self.state.get("hatch_points", 0) + max(1, amount)
        self._emit("vpet_egg_shake", {
            "points": self.state["hatch_points"],
            "need": VPET_HATCH_NEED,
            "user": user,
            "nickname": nickname or user,
        })
        if self.state["hatch_points"] >= VPET_HATCH_NEED:
            self.hatch()

    def hatch(self):
        self.state["level"] = 1
        self.state["phase"] = PHASE_NAMES[1]
        self.state["hatched"] = True
        self.state["anim"] = "idle"
        # Ganha 1 batalha de presente ao nascer (mochila inicial)
        self.state["batalhas_disponiveis"] = max(self.state.get("batalhas_disponiveis", 0), 1)
        self._emit("vpet_hatch", {"phase": self.state["phase"], "level": 1, "batalhas_disponiveis": self.state["batalhas_disponiveis"]})
        self._emit("vpet_bag", {"batalhas_disponiveis": self.state["batalhas_disponiveis"], "max": VPET_BAG_MAX})
        self._emit_log(f"[Bichinho] O ovo chocou! Nasceu um {self.state['phase']} (Nível 1) — ganhou 1 batalha na mochila!")
        self._save()

    def feed(self, amount):
        if self.state.get("level", 0) == 0:
            return
        self.state["hunger"] = min(100, self.state.get("hunger", 100) + amount)
        self.state["care_level"] = self.state.get("care_level", 0) + int(amount)
        self._emit("vpet_status", {
            "hunger": self.state["hunger"],
            "energy": self.state["energy"],
            "phase": self.state["phase"],
            "level": self.state.get("level", 1),
        })
        self._save_if_due()

    def play(self, amount=5):
        """Presente/like fora de batalha pode também dar energia (opcional)."""
        if self.state.get("level", 0) == 0:
            return
        self.state["energy"] = min(100, self.state.get("energy", 100) + amount)
        self.state["care_level"] = self.state.get("care_level", 0) + int(amount)
        self._emit("vpet_status", {
            "hunger": self.state["hunger"],
            "energy": self.state["energy"],
            "phase": self.state["phase"],
            "level": self.state.get("level", 1),
        })
        self._save_if_due()

    # -------------------------------------------------------------
    # Comandos de chat
    # -------------------------------------------------------------
    def handle_command(self, cmd: str, user, nickname) -> bool:
        """Retorna True se o comando foi consumido pelo bichinho."""
        if not self.active:
            return False
        key = cmd.lower().strip()
        if key in ("chocar", "chocar!"):
            self.egg_interact(user, nickname, 1)
            return True
        if key in ("abrirportal", "portal", "boss", "abrir-portal"):
            ok = self.start_battle(force=False)
            self._emit_log("[Bichinho] Portal aberto! O boss chegou!" if ok else "[Bichinho] Sem batalhas na mochila (use presentes para acumular)")
            return True
        if key in ("alimentar", "comida", "comer"):
            self.feed(8)
            self._emit_log(f"[Bichinho] @{user} alimentou o mascote (+8 fome)")
            return True
        if key in ("carinho", "cafune", "afagar", "agradar"):
            self.play(6)
            self._emit_log(f"[Bichinho] @{user} fez carinho no mascote (+6 energia)")
            return True
        if key == "falar":
            # Restrito ao streamer/admin — o texto é tratado no service.py com permissão.
            self._notify_interaction()
            return True
        return False

    # -------------------------------------------------------------
    # Presentes / likes
    # -------------------------------------------------------------
    def on_gift(self, user, nickname, avatar, gift_name, diamonds, repeat=1):
        if not self.active:
            return
        self._notify_interaction()
        repeat = max(1, repeat or 1)
        if self.state.get("level", 0) == 0:
            # Fase 0 (Ovo Estelar): presentes concedem pontos de chocagem
            self.egg_interact(user, nickname, VPET_HATCH_GIFT_POINTS * repeat)
            self._emit_log(f"[Bichinho] @{user} energizou o ovo com '{gift_name}' (+{VPET_HATCH_GIFT_POINTS * repeat} pontos)")
            return
        b = self.state["battle"]
        if b["state"] in ("fight", "countdown"):
            dmg = max(1, int(diamonds or 0)) * VPET_DMG_PER_DIAMOND * repeat
            self.damage_accum += dmg
            c = self.combatants.setdefault(user, {"dmg": 0, "nickname": nickname or user, "avatar": avatar or ""})
            c["dmg"] += dmg
            self._emit_log(f"[Bichinho] @{user} atacou o boss com '{gift_name}' (-{dmg})", 1)
        else:
            feed_amt = max(2, (diamonds or 0) * repeat)
            self.feed(feed_amt)
            self._emit_log(f"[Bichinho] @{user} alimentou com '{gift_name}' (+{feed_amt} fome)", 3)

    def on_like(self, user, nickname, avatar, like_count):
        if not self.active or self.state.get("level", 0) == 0:
            return
        self._notify_interaction()
        self.register_like(like_count)
        b = self.state["battle"]
        if b["state"] in ("fight", "countdown"):
            dmg = int(like_count or 0) * 2
            if dmg > 0:
                self.damage_accum += dmg
                c = self.combatants.setdefault(user, {"dmg": 0, "nickname": nickname or user, "avatar": avatar or ""})
                c["dmg"] += dmg
        else:
            # likes também dão um pouco de energia
            self.play(min(like_count, 4))

    # -------------------------------------------------------------
    # Batalha de boss
    # -------------------------------------------------------------
    # -------------------------------------------------------------
    # Mochila de batalhas
    # -------------------------------------------------------------
    def _bag_state(self):
        return {
            "batalhas_disponiveis": self.state.get("batalhas_disponiveis", 0),
            "max": VPET_BAG_MAX,
        }

    def _emit_bag(self):
        self._emit("vpet_bag", self._bag_state())

    def add_battle_to_bag(self):
        """Incrementa a mochila se houver espaço. Retorna True se adicionou."""
        cur = self.state.get("batalhas_disponiveis", 0)
        if cur >= VPET_BAG_MAX:
            return False
        self.state["batalhas_disponiveis"] = cur + 1
        self._emit_bag()
        self._emit_log(f"[Bichinho] Batalha guardada! Mochila: {self.state['batalhas_disponiveis']}/{VPET_BAG_MAX}")
        return True

    def start_battle(self, force=False):
        if not self.active or self.state.get("level", 0) < 1:
            return False
        if self.state["battle"]["state"] in ("fight", "countdown"):
            return False
        # Consome 1 batalha da mochila (painel ou !abrirportal)
        if self.state.get("batalhas_disponiveis", 0) < 1:
            return False
        self.state["batalhas_disponiveis"] = self.state.get("batalhas_disponiveis", 0) - 1
        self._emit_bag()
        import random as _r
        boss = _r.choice(BOSS_POOL)
        phase_idx = phase_for_level(self.state.get("level", 1))
        base = BOSS_BASE_HP_BY_PHASE.get(phase_idx, 100)
        lvl_tag = max(1, self.state.get("level", 1) + _r.randint(-2, 2))
        nome = f"{boss['name']} Lvl {lvl_tag}"
        self.state["battle"] = {
            "state": "countdown",
            "boss_name": nome,
            "boss_hp": int(base * boss["hp_mult"]),
            "boss_max_hp": int(base * boss["hp_mult"]),
            "timer": VPET_COUNTDOWN,
            "next_in": VPET_BATTLE_EVERY,
            "color": boss["color"],
            "hp_mult": boss["hp_mult"],
        }
        self.combatants = {}
        self.damage_accum = 0
        self._emit("vpet_battle_start", self.state["battle"])
        self._emit_log(f"[Bichinho] {nome} invadiu a tela! Envie presentes para derrotá-lo!")
        self._last_battle_end = time.time()
        return True

    async def _finish_battle(self, result):
        b = self.state["battle"]
        self.state["battle"] = {
            "state": "idle",
            "boss_name": "",
            "boss_hp": 0,
            "boss_max_hp": 0,
            "timer": 0,
            "next_in": VPET_BATTLE_EVERY,
        }
        if result == "victory":
            bonus = int(3600 * b.get("hp_mult", 1.0))  # 1h de cuidado perfeito × multiplicador do boss
            self.state["xp"] = self.state.get("xp", 0) + bonus
            self.state["battle_wins"] = self.state.get("battle_wins", 0) + 1
            self._emit("vpet_battle_end", {"result": "victory", "bonus_xp": bonus, "state": self.public_state()})
            self._emit_log(f"[Bichinho] Boss derrotado! +{bonus} XP de bônus!")
            await self._check_level_up()
        else:
            # Falhou: mascote ferido, status caem
            self.state["hunger"] = max(0, self.state.get("hunger", 100) - 30)
            self.state["energy"] = max(0, self.state.get("energy", 100) - 30)
            self._emit("vpet_battle_end", {"result": "defeat", "state": self.public_state()})
            self._emit_log("[Bichinho] O tempo esgotou... o mascote ficou ferido (-30 fome, -30 energia)")
        self._save()

    # -------------------------------------------------------------
    # Loop de tick (1s)
    # -------------------------------------------------------------
    async def _tick(self):
        if not self.active:
            return
        now = time.time()
        dt = now - self.state.get("last_tick", now)
        dt = min(dt, 3.0)
        self.state["last_tick"] = now

        level = self.state.get("level", 0)
        if level >= 1:
            self.state["hunger"] = max(0, self.state.get("hunger", 100) - 0.05 * dt)
            self.state["energy"] = max(0, self.state.get("energy", 100) - 0.03 * dt)
            self._update_anim()
            # XP por cuidado (status altos) — Fase 0 (ovo) não ganha XP
            if self.state["hunger"] > 60 and self.state["energy"] > 60:
                self.state["xp"] = self.state.get("xp", 0) + 1

        # Sono por tédio (Modo Assistente): sem interação por 60s → dorme
        if self.state.get("assistant_mode") and self.state["battle"]["state"] == "idle":
            idle_secs = now - self.state.get("last_interaction_time", now)
            if idle_secs > VPET_BOREDOM_SECS and self.state.get("anim") not in ("sleep", "battle"):
                self.state["anim"] = "sleep"
                self._emit("vpet_status", {"anim": "sleep", "hunger": self.state["hunger"], "energy": self.state["energy"]})

        b = self.state["battle"]
        if b["state"] == "countdown":
            b["timer"] -= 1
            # Dano já ativo durante o aviso curto
            if self.damage_accum > 0:
                b["boss_hp"] -= self.damage_accum
                top = max(self.combatants.values(), key=lambda c: c["dmg"], default=None)
                top_dmg = top["dmg"] if top else 0
                self.damage_accum = 0
            else:
                top = None
                top_dmg = 0
            self._emit("vpet_battle_tick", {
                "hp": max(0, b["boss_hp"]),
                "max": b["boss_max_hp"],
                "timer": max(0, b["timer"]),
                "top": top,
                "top_dmg": top_dmg,
            })
            if b["boss_hp"] <= 0:
                await self._finish_battle("victory")
            elif b["timer"] <= 0:
                b["state"] = "fight"
                b["timer"] = VPET_BATTLE_DURATION
                self._emit("vpet_battle_fight", {"timer": b["timer"]})
                self._emit_log(f"[Bichinho] Luta iniciada! {b['boss_name']} — {VPET_BATTLE_DURATION}s. Envie presentes!")
        elif b["state"] == "fight":
            b["timer"] -= 1
            # Frases de incentivo (Modo Assistente) — throttled p/ não poluir
            if self.state.get("assistant_mode") and now - self._last_battle_cheer > VPET_BATTLE_CHEER_COOLDOWN:
                self._last_battle_cheer = now
                import random as _r
                self.speak(_r.choice([
                    "Cuidado, mandem presentes! 💥",
                    "O boss está forte, ajudem! 🎯",
                    "Ataquem! 💪",
                    "Não deixem o boss vencer! 🔥",
                ]))
            if self.damage_accum > 0:
                b["boss_hp"] -= self.damage_accum
                top = max(self.combatants.values(), key=lambda c: c["dmg"], default=None)
                top_dmg = top["dmg"] if top else 0
                self.damage_accum = 0
            else:
                top = None
                top_dmg = 0
            self._emit("vpet_battle_tick", {
                "hp": max(0, b["boss_hp"]),
                "max": b["boss_max_hp"],
                "timer": max(0, b["timer"]),
                "top": top,
                "top_dmg": top_dmg,
            })
            if b["boss_hp"] <= 0:
                await self._finish_battle("victory")
            elif b["timer"] <= 0:
                await self._finish_battle("defeat")
        elif b["state"] == "idle" and level >= 1:
            # Mochila de batalhas: acumula até VPET_BAG_MAX; não invade sozinha.
            if self.state.get("batalhas_disponiveis", 0) >= VPET_BAG_MAX:
                b["next_in"] = VPET_BATTLE_EVERY  # mochila cheia: pausa o timer
            else:
                b["next_in"] = b.get("next_in", 0) - 1
                if b["next_in"] <= 0:
                    if self.state["hunger"] > 50 and self.state["energy"] > 50:
                        self.add_battle_to_bag()
                        b["next_in"] = VPET_BATTLE_EVERY
                    else:
                        b["next_in"] = 0  # não saudável: trava aguardando o chat alimentar

        # Evolução (níveis)
        await self._check_level_up()

        # Auto-save periódico
        if now - self._last_saved > VPET_SAVE_INTERVAL:
            self._last_saved = now
            self._save()

    def _update_anim(self):
        prev = self.state.get("anim")
        h = self.state.get("hunger", 100)
        e = self.state.get("energy", 100)
        b = self.state["battle"]["state"]
        if b in ("countdown", "fight"):
            self.state["anim"] = "battle"
        elif h <= 15 or e <= 10:
            self.state["anim"] = "sleep"
        elif h < 40:
            self.state["anim"] = "eat"
        elif e > 50:
            self.state["anim"] = "walk"
        else:
            self.state["anim"] = "idle"
        if self.state["anim"] != prev:
            self._emit("vpet_status", {"anim": self.state["anim"], "hunger": self.state["hunger"], "energy": self.state["energy"]})

    async def _check_level_up(self):
        level = self.state.get("level", 0)
        if level >= VPET_MAX_LEVEL:
            return
        xp = self.state.get("xp", 0)
        while level < VPET_MAX_LEVEL:
            need = xp_to_next_level(level)
            if need <= 0 or xp < need:
                break
            xp -= need
            level += 1
        if level != self.state.get("level"):
            self.state["level"] = level
            self.state["xp"] = xp
            self.state["phase"] = PHASE_NAMES.get(phase_for_level(level), "ovo-estelar")
            self.state["anim"] = "idle"
            self._emit("vpet_evolve", {
                "level": level,
                "phase": self.state["phase"],
                "xp": xp,
                "xp_next": xp_to_next_level(level),
            })
            self._emit_log(f"[Bichinho] SUBIU PARA O NÍVEL {level}! Fase: {self.state['phase'].upper()}!")
            self._save()

    async def run(self):
        self._emit_log("[Bichinho] V-Pet loop iniciado")
        try:
            while True:
                await asyncio.sleep(VPET_TICK)
                try:
                    await self._tick()
                except Exception as e:
                    self._emit_log(f"[Bichinho] ERRO no tick ({type(e).__name__}).")
        except asyncio.CancelledError:
            self._save()
            raise

    def cancel(self):
        if self.task:
            self.task.cancel()
            self.task = None

    # -------------------------------------------------------------
    # Estado público
    # -------------------------------------------------------------
    def public_state(self):
        b = self.state["battle"]
        level = self.state.get("level", 0)
        return {
            "active": self.active,
            "phase": self.state["phase"],
            "level": level,
            "hunger": round(self.state.get("hunger", 100), 1),
            "energy": round(self.state.get("energy", 100), 1),
            "xp": self.state.get("xp", 0),
            "xp_next": xp_to_next_level(level),
            "care_level": self.state.get("care_level", 0),
            "hatch_points": self.state.get("hatch_points", 0),
            "hatch_need": VPET_HATCH_NEED,
            "batalhas_disponiveis": self.state.get("batalhas_disponiveis", 0),
            "bag_max": VPET_BAG_MAX,
            "battle_wins": self.state.get("battle_wins", 0),
            "assistant_mode": bool(self.state.get("assistant_mode", False)),
            "anim": self.state.get("anim", "idle"),
            "hatched": self.state.get("hatched", False),
            "battle": dict(b),
        }
