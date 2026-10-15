# Testes de unidade da meta de TAP da Palavra Secreta (Final Boss).
#
# Executar (dentro de python/): python test_tap_meta.py
#
# Cobre: congelamento durante o Final Boss (taps não incrementam), ausência de
# despacho de prêmio durante o Boss, exibição "concluída" (verde) na página
# pública, prêmio despachado apenas sem Boss, valores públicos corretos e o
# Modo Boss opcional (boss_mode): sem boss, rank <= 3 não ativa o Final Boss,
# a meta de tap dobra (x2) uma única vez mantendo o progresso e a zona fica
# protegida para dicas (sem revelar rank 1-2 e sem revelar rank pior/igual ao
# melhor já exibido — pick_hint_word/hint_cluster).

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import service

# Silencia o emit (evita ruído de JSON no stdout dos testes).
service.emit = lambda *a, **k: None


class FakeHandler:
    def __init__(self, *a, **k):
        self._room_id = ""


service.TikToolsHandler = FakeHandler
service.TikTokLiveHandler = FakeHandler


class FakeDispatch:
    def __init__(self):
        self.calls = 0

    async def __call__(self):
        self.calls += 1


passed = 0
failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name} :: {extra}")


async def main():
    s = service.GameSession(tenant_id=999901, username="streamer", api_key="", history_path=None, gift_tags=[], engine="tiktools")

    print("[1] Sem Final Boss")
    s.game.is_final_boss = False
    s.tap_meta_current = 0
    await s.on_like("a", "A", "", 5)
    check("taps incrementam normalmente", s.tap_meta_current == 5, f"current={s.tap_meta_current}")

    print("[2] Final Boss ativo")
    s.game.is_final_boss = True
    s.tap_meta_current = 0
    await s.on_like("b", "B", "", 7)
    check("taps NAO incrementam (congelado)", s.tap_meta_current == 0, f"current={s.tap_meta_current}")

    s.tap_meta_current = 400
    s.tap_meta_ready = False
    pub = s._tap_meta_public()
    check("pagina ve concluido (ready True) com valor congelado 400",
          pub["tap_meta_ready"] is True and pub["tap_meta_current"] == 400,
          f"pub={pub}")
    check("total preservado (1000)", pub["tap_meta_total"] == 1000, f"total={pub['tap_meta_total']}")

    print("[3] Meta atingida durante o Boss (sem despachar)")
    fake = FakeDispatch()
    s._dispatch_tap_reward = fake
    s.tap_meta_current = s.tap_meta_total
    s.tap_meta_ready = False
    await s._check_tap_meta()
    check("Boss: premio NAO despachado", fake.calls == 0, f"calls={fake.calls}")
    check("Boss: marca pendente (ready True)", s.tap_meta_ready is True, f"ready={s.tap_meta_ready}")
    check("Boss: valor permanece congelado (nao zera)", s.tap_meta_current == s.tap_meta_total, f"current={s.tap_meta_current}")
    await s._check_tap_meta()  # segundo tick
    check("Boss: segundo tick nao re-despacha", fake.calls == 0, f"calls={fake.calls}")

    print("[4] Meta atingida SEM Boss (despacha)")
    s.game.is_final_boss = False
    s.tap_meta_ready = False
    s.tap_meta_current = s.tap_meta_total
    s._tap_meta_cooldown_until = 0
    await s._check_tap_meta()
    check("sem Boss: premio despachado", fake.calls == 1, f"calls={fake.calls}")
    check("sem Boss: zera a barra", s.tap_meta_current == 0, f"current={s.tap_meta_current}")

    print("[5] Publico sem Boss")
    s.tap_meta_current = 300
    s.tap_meta_ready = False
    s.game.is_final_boss = False
    pub = s._tap_meta_public()
    check("sem Boss: nao exibe concluido", pub["tap_meta_ready"] is False and pub["tap_meta_current"] == 300, f"pub={pub}")

    print("[6] Modo Boss: gatilho com boss ativo")
    s.game.boss_mode = True
    s.game.is_final_boss = False
    s.game.secret_word = "teste"
    s.game.finished = False
    s.game.hint_gifts = ["Rose"]
    s.game.riddle_gifts = []
    s.game.guesses = [{"word": "perto", "rank": 3}]
    ok = s.game.get_active_gift()
    check("boss ON: rank 3 ativa Final Boss", s.game.is_final_boss is True and bool(ok), f"boss={s.game.is_final_boss} gift={ok}")

    print("[7] Modo Boss OFF: sem Final Boss, zona protegida")
    s.game.boss_mode = False
    s.game.is_final_boss = True  # estado obsoleto que deve ser limpo
    ok = s.game.get_active_gift()
    check("boss OFF: rank 3 NAO ativa Final Boss", s.game.is_final_boss is False, f"boss={s.game.is_final_boss}")
    check("boss OFF: _hint_protected True na zona", s.game._hint_protected() is True, f"protect={s.game._hint_protected()}")
    s.game.guesses = [{"word": "q", "rank": 5}]
    check("boss OFF: fora da zona (rank 5) nao protege", s.game._hint_protected() is False, f"protect={s.game._hint_protected()}")

    print("[8] Meta de tap x2 (dobra mantendo progresso)")
    s.game.boss_mode = False
    s.game.secret_word = "teste"
    s.game.finished = False
    s.game.guesses = [{"word": "perto", "rank": 3}]
    s.settings["tap_meta"] = 1000
    s._tap_meta_x2 = False
    s.tap_meta_total = 1000
    s.tap_meta_current = 400
    applied = s._apply_tap_meta_x2()
    check("x2 aplicado (total dobra)", applied is True and s.tap_meta_total == 2000, f"total={s.tap_meta_total}")
    check("progresso mantido", s.tap_meta_current == 400, f"current={s.tap_meta_current}")
    check("multiplier publico = 2", s._tap_meta_public()["tap_meta_multiplier"] == 2, f"pub={s._tap_meta_public()}")
    applied2 = s._apply_tap_meta_x2()
    check("x2 unica vez (nao re-dobra)", applied2 is False and s.tap_meta_total == 2000, f"total={s.tap_meta_total}")

    print("[9] Boss ON: x2 NAO se aplica")
    s.game.boss_mode = True
    s._tap_meta_x2 = False
    s.tap_meta_total = 1000
    applied3 = s._apply_tap_meta_x2()
    check("boss ON bloqueia x2", applied3 is False and s.tap_meta_total == 1000, f"total={s.tap_meta_total}")
    check("multiplier publico = 1 com boss", s._tap_meta_public()["tap_meta_multiplier"] == 1, f"pub={s._tap_meta_public()}")

    # all_scored ordenado por proximidade: índice i => rank i+2 (rank 1 = secreta, fora da lista)
    def _pool(model, size=20):
        model.all_scored = [f"w{i}" for i in range(size)]
        model.hints_given = []
        return model

    print("[10] Zona protegida: dica nunca piora o melhor rank")
    s.game.boss_mode = False
    s.game.finished = False
    s.game.secret_word = "teste"
    _pool(s.game)
    s.game.guesses = [{"word": "w1", "rank": 3}]  # melhor rank = 3 (rank 3 já saiu)
    picked = s.game.pick_hint_word(2)
    check("zona protegida: nenhuma dica (só sobra rank 1-2)", picked is None, f"picked={picked}")

    print("[11] Dica nunca revela rank maior que o melhor já exibido")
    # melhor rank 3, rank 3 já em guesses: qualquer candidato >= 3 deve ser recusado
    s.game.hints_given = []
    picked = s.game.pick_hint_word(2)
    check("não cai em rank 4+ (evita o caso do 13)", picked is None, f"picked={picked}")

    print("[12] Fora da zona: dica continua revelando rank melhor")
    _pool(s.game)
    s.game.guesses = [{"word": "w3", "rank": 5}]  # melhor rank 5 (fora da zona)
    picked = s.game.pick_hint_word(4)
    check("fora da zona: revela rank 4 (melhor)", picked is not None and picked[1] == 4, f"picked={picked}")

    print("[13] Cluster da charada na zona protegida não contém rank 1-2")
    _pool(s.game)
    s.game.guesses = [{"word": "w1", "rank": 3}]
    cluster = s.game.hint_cluster(2)
    cluster_ranks = [s.game.all_scored.index(w) + 2 for w in cluster]
    check("cluster sem rank 1-2", cluster and all(r > 2 for r in cluster_ranks), f"cluster={cluster} ranks={cluster_ranks}")
    check("cluster não vazio na zona", len(cluster) > 0, f"cluster={cluster}")

    print(f"\nResultado: {passed} passaram, {failed} falharam.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    asyncio.run(main())