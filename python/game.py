"""game.py - fachada de compatibilidade (re-exports) apos a separacao estrutural (Fase A-3).

Mantem a API antiga: from game import JogoContexto, CacaPalavras, VPetEngine, TresPontinhos, strip_accents, GIFT_PT_MAP.
"""
from service_common import strip_accents, GIFT_PT_MAP
from jogos.caca import CacaPalavras
from jogos.vpet import VPetEngine
from jogos.tres import TresPontinhos
from jogos.palavra import JogoContexto
