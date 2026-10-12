# Testes de unidade da meta de TAP da Palavra Secreta (Final Boss).
#
# Executar (dentro de python/): python test_tap_meta.py
#
# Cobre: congelamento durante o Final Boss (taps não incrementam), ausência de
# despacho de prêmio durante o Boss, exibição "concluída" (verde) na página
# pública, prêmio despachado apenas sem Boss e valores públicos corretos.

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

    print(f"\nResultado: {passed} passaram, {failed} falharam.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    asyncio.run(main())