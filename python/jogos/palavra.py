"""Jogo Palavra Secreta (JogoContexto) - motor isolado (extraido de game.py, Fase A-3).

Sem mudanca de comportamento. Dependencias: similarity.nlp, db, service_common
(strip_accents/GIFT_PT_MAP), gifts_catalog.get_catalog e stdlib.
"""
import asyncio
import bisect
import hashlib
import json
import os
import random
import re
import time
import unicodedata
from datetime import datetime

from similarity import nlp
import db
from service_common import strip_accents, GIFT_PT_MAP, get_rank_color
from gifts_catalog import get_catalog


_HEREDIR = os.path.dirname(os.path.abspath(__file__))
_PYROOT = os.path.dirname(_HEREDIR)  # python/


DEFAULT_HISTORY_PATH = os.path.join(_PYROOT, "..", "node", "public", "history.json")
DEFAULT_GIFT_TAGS_PATH = os.path.join(_PYROOT, "..", "node", "gift-tags.json")


# Versão do método/modelo de similaridade: subir quando mudar o cálculo
# (ex.: troca do spaCy, fórmula de rank, pool de palavras) para invalidar o cache.
METHOD_VERSION = "sim-v1"


def _pool_signature() -> str:
    """Assinatura do catálogo ativo para invalidar rankings após edição no painel."""
    try:
        return db.get_word_catalog_version()
    except Exception:
        return "desconhecido"




# Cache de índices por palavra secreta (evita recalcular ~6s a cada partida repetida).
# Chave: (assinatura do catálogo, palavra secreta normalizada).
# Limitado a um número razoável de entradas para não crescer sem limite.
_INDEX_CACHE = {}
_INDEX_CACHE_MAX = 200

# Sinônimos / variantes populares -> palavra canônica. O chat chuta gírias/variações
# e queremos rankear de forma justa. Chave e valor já sem acentos.
ALIAS_MAP = {
    "trampo": "trabalho",
    "empregada": "trabalho",
    "emprego": "trabalho",
    "lar": "casa",
    "moradia": "casa",
    "residencia": "casa",
    "apartamento": "casa",
    "carango": "carro",
    "veiculo": "carro",
    "automovel": "carro",
    "boi": "vaca",
    "bezerro": "vaca",
    "bicicleta": "bike",
    "celular": "telefone",
    "telemovel": "telefone",
    "smartphone": "telefone",
    "notebook": "computador",
    "pc": "computador",
    "memo": "memoria",
    "fotografia": "foto",
    "refri": "refrigerante",
    "coca": "refrigerante",
    "bolacha": "biscoito",
    "goleiro": "gol",
    "estadio": "futebol",
    "campo": "futebol",
    "pelada": "futebol",
    "bola": "futebol",
    "moto": "motocicleta",
    "geladeira": "refrigerador",
    "tv": "televisao",
    "televisor": "televisao",
    "onibus": "coletivo",
    "trem": "ferroviario",
    "aviao": "aeronave",
    "pneu": "roda",
    "bebida": "agua",
    "comida": "alimento",
    "fruta": "banana",
    "doce": "acucar",
    "gato": "felino",
    "cachorro": "canino",
    "pandemia": "doença",
    "estudante": "aluno",
    "professor": "docente",
    "vendedor": "vendas",
    "dinheiro": "real",
    "grana": "real",
    "nota": "dinheiro",
    "tiktok": "rede social",
    "instagram": "rede social",
    "whatsapp": "mensagem",
    "youtube": "video",
    "spotify": "musica",
    "netflix": "filme",
    "serie": "televisao",
    "sorvete": "gelado",
    "pizza": "comida",
    "lanche": "sanduiche",
    "salgado": "pastel",
    "cafe": "cafeina",
    "cerveja": "bebida",
    "vinho": "uva",
    "cachaca": "bebida",
    "agua": "liquido",
    "fogo": "fogueira",
    "gelo": "frio",
    "neve": "frio",
    "sol": "estrela",
    "lua": "satelite",
    "chuva": "agua",
    "tempestade": "chuva",
    "vento": "brisa",
    "praia": "mar",
    "oceano": "mar",
    "piscina": "agua",
    "piscineiro": "agua",
    "nado": "natacao",
    "corrida": "atletismo",
    "jogo": "partida",
    "time": "equipe",
    "clube": "equipe",
    "campeonato": "competicao",
    "torneio": "competicao",
    "premio": "trofeu",
    "medalha": "trofeu",
    "ouro": "medalha",
    "prata": "medalha",
    "bronze": "medalha",
    "saude": "doenca",
    "medicamento": "remedio",
    "remédio": "remedio",
    "hospital": "clinica",
    "doutor": "medico",
    "dentista": "medico",
    "enfermeira": "medico",
    "cirurgia": "operacao",
    "vacina": "imunizacao",
    "cura": "tratamento",
    "economia": "financas",
    "salario": "pagamento",
    "imposto": "taxa",
    "loja": "comercio",
    "mercado": "supermercado",
    "feira": "mercado",
    "shopping": "centro comercial",
    "padaria": "pao",
    "açougue": "carne",
    "acougue": "carne",
    "mercearia": "supermercado",
    "praça": "parque",
    "rua": "avenida",
    "estrada": "rodovia",
    "rodovia": "estrada",
    "viagem": "passeio",
    "ferias": "passeio",
    "turista": "viagem",
    "hotel": "pousada",
    "resort": "hotel",
    "restaurante": "comida",
    "cozinha": "alimento",
    "chef": "cozinheiro",
    "garçom": "restaurante",
    "pedido": "comida",
    "conta": "pagamento",
    "gorjeta": "dinheiro",
}





class JogoContexto:
    def __init__(self, tenant_id=None, history_path=None, gift_tags=None):
        self.tenant_id = tenant_id
        self.secret_word = ""
        self.guesses = []
        self.hints_given = []
        self.hint_pool = []
        self.all_scored = []
        self.hint_gifts = []
        self.riddle_gifts = []
        self.size_gift = ""
        self.size_revealed = False
        self.letter_gift = ""
        self.first_letter_revealed = False
        self.finished = False
        self.winner = None
        self.winner_nickname = None
        self.winner_avatar = None
        self.history_path = history_path or DEFAULT_HISTORY_PATH
        self._gift_tags = gift_tags if gift_tags is not None else self.load_default_gift_tags()
        self.recent_active_gifts = []
        self.boss_mode = True
        self._load_word_pool()
        self._load_history()
        self._pool_ready = True
        # Cache local deste objeto (usa o cache global por palavra)
        self._secret_index_key = None

    @staticmethod
    def load_default_gift_tags():
        try:
            with open(DEFAULT_GIFT_TAGS_PATH, encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    def _load_word_pool(self):
        self.word_pool = db.get_word_catalog()
        self._pool_version = _pool_signature()
        self.norm_to_word = {strip_accents(w): w for w in self.word_pool}
        try:
            self.banned_words = db.load_banned_words()
        except Exception:
            self.banned_words = set()

    def _load_history(self):
        if self.tenant_id is not None:
            data = db.load_tenant_history(self.tenant_id)
            self.played_words = set(data["played_words"])
            self.last_game_id = data["last_id"]
            return
        try:
            with open(self.history_path, encoding="utf-8") as f:
                data = json.load(f)
                self.played_words = set(data.get("played", []))
                self.last_game_id = data.get("last_id", 0)
        except (FileNotFoundError, json.JSONDecodeError):
            self.played_words = set()
            self.last_game_id = 0

    def _save_history(self):
        if self.tenant_id is not None:
            db.save_tenant_history(self.tenant_id, self.last_game_id, list(self.played_words))
            return
        os.makedirs(os.path.dirname(self.history_path), exist_ok=True)
        data = {"last_id": self.last_game_id, "played": list(self.played_words)}
        try:
            with open(self.history_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
            data["games"] = existing.get("games", [])
        except (FileNotFoundError, json.JSONDecodeError):
            data["games"] = []
        with open(self.history_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _build_hint_pool(self):
        self._hybrid_ranking = False
        self._build_local_hint_pool()
        generated = db.get_generated_context(self.secret_word, self._pool_version)
        if not generated:
            return
        # Copy, never mutate a local index shared by other tenants/rounds.
        local_words = list(self.all_scored)
        local_sims = list(self.all_scored_sims)
        canonical = self.norm_to_word
        ranked = []
        seen = {strip_accents(self.secret_word)}
        try:
            for item in generated['ranking']:
                key = strip_accents(item['palavra'])
                if key not in canonical or key in seen:
                    return  # Corrupt/incompatible context: retain local index.
                seen.add(key)
                ranked.append(canonical[key])
        except (KeyError, TypeError):
            return
        if len(ranked) < 50:
            return
        for word in local_words:
            key = strip_accents(word)
            if key not in seen:
                seen.add(key)
                ranked.append(word)
        self._hybrid_local_words = local_words
        self._hybrid_local_neg_sims = [-s for s in local_sims]
        self.all_scored = ranked
        sim_map = {strip_accents(w): s for w, s in zip(local_words, local_sims)}
        self.all_scored_sims = [sim_map.get(strip_accents(w), -1.0) for w in ranked]
        self._word_index = {strip_accents(w): i for i, w in enumerate(ranked)}
        self.hint_pool = ranked[:150]
        self._hybrid_ranking = True

    def _build_local_hint_pool(self):
        """Constrói (ou reutiliza do cache de memória/SQLite) o índice de proximidade
        da palavra secreta.

        Ordem: cache em memória (`_INDEX_CACHE`) → cache persistente no SQLite
        (`data.db`, chave = palavra + versão do pool + versão do método) → cálculo
        spaCy (uma única vez por palavra, gravado no SQLite).
        """
        key = strip_accents(self.secret_word)
        cache_key = (self._pool_version, key)
        cache = _INDEX_CACHE.get(cache_key)
        if cache is None:
            # Cache persistente: compartilhado entre restarts do daemon/máquinas.
            try:
                cache = db.get_palavra_index_cache(key, self._pool_version, METHOD_VERSION)
            except Exception:
                cache = None
            if cache:
                _INDEX_CACHE[cache_key] = cache
        if cache is not None:
            self.all_scored = cache["all_scored"]
            self.all_scored_sims = cache["sims"]
            self._all_scored_neg_sims = cache.get("neg_sims") or [-s for s in cache["sims"]]
            self._word_index = cache.get("word_index") or {strip_accents(w): i for i, w in enumerate(self.all_scored)}
            self.hint_pool = cache["hint_pool"]
            self._secret_index_key = cache_key
            return

        secret_doc = nlp(self.secret_word)
        scored = []
        for word in self.word_pool:
            if strip_accents(word) == key:
                continue
            doc = nlp(word)
            if doc.has_vector and secret_doc.has_vector:
                sim = doc.similarity(secret_doc)
                scored.append((word, sim))
        scored.sort(key=lambda x: -x[1])
        self.all_scored = [w for w, _ in scored]
        self.all_scored_sims = [s for _, s in scored]
        self._all_scored_neg_sims = [-s for s in self.all_scored_sims]
        self._word_index = {strip_accents(w): i for i, w in enumerate(self.all_scored)}
        self.hint_pool = [w for w, _ in scored[:150]]
        self._secret_index_key = cache_key

        # Guarda no cache global (com limite)
        if len(_INDEX_CACHE) >= _INDEX_CACHE_MAX:
            try:
                _INDEX_CACHE.pop(next(iter(_INDEX_CACHE)))
            except Exception:
                pass
        _INDEX_CACHE[cache_key] = {
            "all_scored": self.all_scored,
            "all_scored_sims": self.all_scored_sims,
            "neg_sims": self._all_scored_neg_sims,
            "word_index": self._word_index,
            "hint_pool": self.hint_pool,
        }
        # Guarda no SQLite (entre restarts): custo único por palavra.
        try:
            db.save_palavra_index_cache(
                key, self._pool_version, METHOD_VERSION,
                self.all_scored, self.all_scored_sims, self.hint_pool,
            )
        except Exception:
            pass

    def _resolve_alias(self, word: str) -> str:
        """Resolve gíria/variante para a palavra canônica (se existir no pool)."""
        norm = strip_accents(word)
        alias = ALIAS_MAP.get(norm)
        if alias:
            canonical = self.norm_to_word.get(strip_accents(alias))
            if canonical:
                return canonical
        # Se a própria palavra está no pool, retorna ela
        canonical = self.norm_to_word.get(norm)
        return canonical or word

    def _compute_rank(self, word: str) -> int:
        """Rank no estilo Contexto: 1 = a palavra secreta, N = N-1 palavras mais proximas."""
        norm_w = strip_accents(word)
        if norm_w == strip_accents(self.secret_word):
            return 1
        # 1) Tenta lookup direto no índice
        idx = self._word_index.get(norm_w)
        if idx is not None:
            return idx + 2
        # 2) Tenta resolver gíria/variante para a forma canônica
        resolved = self._resolve_alias(word)
        if resolved != word:
            norm_resolved = strip_accents(resolved)
            if norm_resolved == strip_accents(self.secret_word):
                return 1
            idx = self._word_index.get(norm_resolved)
            if idx is not None:
                return idx + 2
        # 3) Fallback: similaridade computada na hora (com sinônimos da secreta)
        doc = nlp(word)
        secret_doc = nlp(self.secret_word)
        if not doc.has_vector or not secret_doc.has_vector or not self.all_scored_sims:
            return len(self.all_scored) + 2
        sim = doc.similarity(secret_doc)
        # Tenta melhorar com sinônimos da secreta (se o chute casa com um deles)
        best_sim = sim
        for alias, canonical in ALIAS_MAP.items():
            if strip_accents(canonical) == strip_accents(self.secret_word):
                alias_doc = nlp(alias)
                if alias_doc.has_vector:
                    s2 = doc.similarity(alias_doc)
                    if s2 > best_sim:
                        best_sim = s2
        if getattr(self, '_hybrid_ranking', False):
            # Only dictionary entries can occupy the 50 curated positions.
            pos = bisect.bisect_left(self._hybrid_local_neg_sims, -best_sim)
            if pos >= len(self._hybrid_local_words):
                return len(self.all_scored) + 2
            local_key = strip_accents(self._hybrid_local_words[pos])
            return max(52, self._word_index[local_key] + 2)
        pos = bisect.bisect_left(self._all_scored_neg_sims, -best_sim)
        return pos + 2

    def start_new_game(self, hint_gifts: list = None, riddle_gifts: list = None, size_gift: str = None, letter_gift: str = None, build_pool: bool = True) -> str:
        # Reload catalog changes between rounds; active games keep their snapshot.
        self._load_word_pool()
        # Relê as palavras banidas a cada rodada (mudanças do admin valem na próxima)
        try:
            self.banned_words = db.load_banned_words()
        except Exception:
            self.banned_words = self.banned_words or set()
        if not self.word_pool:
            raise ValueError("NO_ELIGIBLE_WORDS")
        if self.tenant_id is not None:
            reservation = db.reserve_word_for_tenant(self.tenant_id, self.word_pool, self.banned_words,
                                                     game_type='palavra')
            self.secret_word = reservation['word']
            self.played_words = set(reservation['played_words'])
            self.last_game_id = reservation['last_id']
            self.game_id = reservation['game_id']
            self._word_reservation = {k: v for k, v in reservation.items() if k != 'word'}
        else:
            available = [w for w in self.word_pool
                         if w not in self.played_words and strip_accents(w) not in self.banned_words]
            if not available:
                self.played_words.clear()
                available = [w for w in self.word_pool if strip_accents(w) not in self.banned_words]
            if not available:
                available = self.word_pool[:]
            self.secret_word = random.choice(available)
            self.played_words.add(self.secret_word)
            self.last_game_id += 1
            self.game_id = self.last_game_id
        self.guesses = []
        self.hints_given = []
        self.hint_pool = []
        self.all_scored = []
        self.hint_gifts = hint_gifts or []
        self.riddle_gifts = riddle_gifts or []
        self.size_gift = size_gift or ""
        self.size_revealed = False
        self.letter_gift = letter_gift or ""
        self.first_letter_revealed = False
        self.current_riddle_stage = 0
        self.finished = False
        self.winner = None
        self.winner_nickname = None
        self.winner_avatar = None
        self._pool_ready = build_pool
        if build_pool:
            self._build_hint_pool()
            self._pool_ready = bool(self.all_scored and self.hint_pool)
        if self.tenant_id is None:
            self._save_history()
        return self.secret_word

    def get_riddle_words(self, stage: int) -> list:
        self._ensure_hint_pool()
        if not self.all_scored:
            return ["MISTÉRIO", "SEGREDO", "CHARADA"]
        n = len(self.all_scored)
        # Stage 1: Ranks 12, 11, 10 (index 11, 10, 9)
        # Stage 2: Ranks 9, 8, 7 (index 8, 7, 6)
        # Stage 3: Ranks 6, 5, 4 (index 5, 4, 3)
        if stage == 1:
            indices = [min(11, n - 1), min(10, n - 1), min(9, n - 1)]
        elif stage == 2:
            indices = [min(8, n - 1), min(7, n - 1), min(6, n - 1)]
        else:
            indices = [min(5, n - 1), min(4, n - 1), min(3, n - 1)]

        result = []
        for idx in indices:
            w = self.all_scored[idx] if idx < n else self.word_pool[idx % len(self.word_pool)]
            result.append(w)
        return result

    def process_riddle_gift(self, user: str, gift_name: str, force: bool = False, gift_id: str = None) -> dict:
        if self.finished or not self.secret_word:
            return None

        # Cooldown check to prevent duplicate gift webhook triggers
        now = datetime.now()
        if hasattr(self, "last_riddle_time"):
            elapsed = (now - self.last_riddle_time).total_seconds()
            if elapsed < 5:
                return None
        self.last_riddle_time = now

        if not force:
            if not self.riddle_gifts:
                return None
            expected_gift = self.riddle_gifts[0]
            if not self._gift_ref_match(gift_id, gift_name, expected_gift):
                return None

        # Advance stage
        self.current_riddle_stage += 1
        stage = self.current_riddle_stage
        words = self.get_riddle_words(stage)
        return {
            "stage": stage,
            "user": user,
            "gift": gift_name,
            "words": words,
            "secret_word": self.secret_word,
        }

    def process_guess(self, user: str, word: str, nickname: str = None, avatar: str = None) -> dict:
        if self.finished:
            return None

        if re.search(r"\s", word):
            return None  # frase com espaço não é palpite de palavra única

        # Clean punctuation and digits
        word = re.sub(r"[^\w]", "", word, flags=re.UNICODE)
        word = re.sub(r"\d+", "", word)

        norm_guess = strip_accents(word)
        if not norm_guess or len(norm_guess) < 2:
            return None

        # Resolve formatted display word (prioritize dictionary accentuation)
        display_word = self.norm_to_word.get(norm_guess, word.strip())

        for g in self.guesses:
            if strip_accents(g["word"]) == norm_guess:
                return {"duplicate": True, "word": g["word"], "rank": g["rank"]}

        rank = self._compute_rank(display_word)
        if norm_guess == strip_accents(self.secret_word):
            display_word = self.secret_word

        entry = {"user": user, "word": display_word, "rank": rank}
        if nickname:
            entry["nickname"] = nickname
        if avatar:
            entry["avatar"] = avatar
        self.guesses.append(entry)
        self.guesses.sort(key=lambda x: x["rank"])

        if norm_guess == strip_accents(self.secret_word):
            self.finished = True
            self.winner = user

        return entry

    def _ensure_hint_pool(self):
        if not self.hint_pool:
            self._build_hint_pool()

    def _gift_aliases(self, name: str) -> set:
        """Conjunto de nomes aceitos (EN e PT) para um gift configurado."""
        if not name:
            return set()
        base = strip_accents(name.lower().strip())
        aliases = {base}
        pt = strip_accents(GIFT_PT_MAP.get(base, "").lower())
        if pt:
            aliases.add(pt)
        for en, pt_full in GIFT_PT_MAP.items():
            if strip_accents(pt_full).lower() == base:
                aliases.add(strip_accents(en).lower())
                break
        return aliases

    def _gift_ref_match(self, incoming_id, incoming_name: str, ref: str) -> bool:
        """Match de gift ID-first (catálogo) com fallback por nome EN/PT."""
        cat = get_catalog()
        if cat is not None and incoming_id and ref:
            row = cat.resolve_ref(ref)
            if row and row.get("id"):
                return str(incoming_id).strip() == str(row["id"])
        return bool(incoming_name) and strip_accents(incoming_name.strip().lower()) in self._gift_aliases(ref)

    def _catalog_diamond(self, ref: str):
        """Valor (diamantes) de um gift configurado (ID ou nome) via catálogo."""
        cat = get_catalog()
        if cat is not None and ref:
            row = cat.resolve_ref(ref)
            if row and row.get("diamond_count") is not None:
                try:
                    return int(row["diamond_count"] or 0)
                except (TypeError, ValueError):
                    return None
        return None

    def process_gift(self, user: str, gift_name: str, diamond_count: int = 0, nickname: str = None, avatar: str = None, gift_id: str = None) -> dict:
        if self.finished or not self.secret_word:
            return None

        # Presente de tamanho: revela o nº de letras da palavra secreta
        if self.size_gift and not self.size_revealed:
            if self._gift_ref_match(gift_id, gift_name, self.size_gift):
                self.size_revealed = True
                return {
                    "user": user,
                    "nickname": nickname or user,
                    "avatar": avatar or "",
                    "gift": gift_name,
                    "size_revealed": True,
                    "secret_length": len(self.secret_word),
                }

        # Presente de primeira letra: revela a 1ª letra (exige tamanho visível, 1x)
        if self.letter_gift and not self.first_letter_revealed and (self.size_revealed or not self.size_gift):
            if self._gift_ref_match(gift_id, gift_name, self.letter_gift):
                self.first_letter_revealed = True
                return {
                    "user": user,
                    "nickname": nickname or user,
                    "avatar": avatar or "",
                    "gift": gift_name,
                    "first_letter_revealed": True,
                    "first_letter": self.secret_word[0] if self.secret_word else "",
                    "secret_length": len(self.secret_word),
                }

        # Dicas por presente NÃO são mais resolvidas aqui: a seleção (com as regras
        # de rank/zona protegida) é centralizada em `pick_hint_word` e aplicada pela
        # roleta/meta de tap/dica manual em service.py. Manter a dica aqui mutava
        # `guesses`/`hints_given` em silêncio (estado divergente do emitido).
        return None

    def finalize_game(self, room_id: str = ""):
        if not self.secret_word or self.finished:
            return None
        self.finished = True
        self.save_result(winner="Ninguém", nickname="Sem Vencedor", avatar="", total_guesses=len(self.guesses), room_id=room_id)
        return {
            "type": "game_over",
            "winner": "Ninguém",
            "nickname": "Sem Vencedor",
            "avatar": "",
            "secret_word": self.secret_word,
            "total_guesses": len(self.guesses),
            "guesses": self.get_final_guesses(),
            "post_game_summary": self.build_post_game_summary(100),
        }

    def get_final_guesses(self) -> list:
        return [{**guess, "color": get_rank_color(int(guess.get("rank", 1001)))} for guess in self.guesses]

    def save_result(self, winner: str, nickname: str, avatar: str, total_guesses: int, room_id: str = ""):
        self.winner_nickname = nickname
        self.winner_avatar = avatar
        if self.tenant_id is not None:
            db.record_game(self.secret_word, winner, nickname, avatar, total_guesses, self.tenant_id, room_id)
            return
        entry = {
            "id": self.last_game_id,
            "word": self.secret_word,
            "winner": winner,
            "nickname": nickname,
            "avatar": avatar,
            "guesses": total_guesses,
            "time": datetime.now().isoformat(),
        }
        data = {"last_id": self.last_game_id, "played": list(self.played_words), "games": []}
        try:
            with open(self.history_path, encoding="utf-8") as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        games = data.get("games", [])
        games.append(entry)
        data["games"] = games[-50:]
        data["last_id"] = self.last_game_id
        data["played"] = list(self.played_words)
        os.makedirs(os.path.dirname(self.history_path), exist_ok=True)
        with open(self.history_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def build_post_game_summary(self, limit: int = 100) -> dict:
        """Resumo hibrido pos-partida: top N palavras mais proximas da secreta
        (dicionario completo), marcando as que foram chutadas/dicas na partida."""
        guess_by_word = {g["word"]: g for g in self.guesses}
        palavras = []

        if self.finished and self.secret_word:
            winner = guess_by_word.get(self.secret_word) or {}
            palavras.append({
                "rank_proximidade": 1,
                "palavra": self.secret_word,
                "usuario": self.winner or winner.get("user") or "",
                "nickname": self.winner_nickname or winner.get("nickname") or self.winner or "",
                "avatar": self.winner_avatar or winner.get("avatar") or "",
                "is_hint": bool(winner.get("is_hint")),
                "chutado": self.secret_word in guess_by_word,
            })

        for i, w in enumerate(self.all_scored[: max(0, limit - 1)], start=2):
            g = guess_by_word.get(w)
            palavras.append({
                "rank_proximidade": i,
                "palavra": w,
                "usuario": (g or {}).get("user", ""),
                "nickname": (g or {}).get("nickname", "") or (g or {}).get("user", ""),
                "avatar": (g or {}).get("avatar", ""),
                "is_hint": bool((g or {}).get("is_hint")),
                "chutado": g is not None,
            })

        return {
            "titulo_painel": "Resumo Pos-Partida (Top 100)",
            "palavras": palavras,
            "total_palavras_capturadas": len(self.guesses),
            "total_no_ranking": len(palavras),
        }


    def _canon_gift_name(self, ref):
        """Resolve ID do TikTok para o nome canônico do catálogo (fallback mantém o valor)."""
        if not ref:
            return ref
        try:
            row = get_catalog().resolve_ref(ref)
            if row and row.get("name"):
                return str(row["name"])
        except Exception:
            pass
        return ref

    def get_active_gift(self) -> str:
        if self.finished or not self.secret_word:
            return None

        # 1. Check riddle gifts for final boss
        final_boss_gift = self.riddle_gifts[0] if self.riddle_gifts else (self.hint_gifts[-1] if self.hint_gifts else "TikTok")

        # 2. Sort configured hint_gifts por valor (catálogo aceita ID ou nome)
        available_gifts = []
        for g in self.hint_gifts:
            price = self._catalog_diamond(g)
            if price is None:
                g_lower = g.lower()
                for tag in self._gift_tags:
                    if tag["name"].lower() == g_lower:
                        price = tag["diamond_count"]
                        break
            available_gifts.append((g, price if price is not None else 1))

        available_gifts.sort(key=lambda x: x[1])  # sort by price ascending
        if not available_gifts:
            return None

        num_gifts = len(available_gifts)

        # 3. Find best rank so far (initial: 1000)
        best_rank = 1000
        if self.guesses:
            best_rank = min(g["rank"] for g in self.guesses)

        # 4. Check Final Boss overriding condition (somente com Modo Boss ativo)
        if self.boss_mode and best_rank <= 3:
            self.is_final_boss = True
            self.tension_score = 100
            fb = self._canon_gift_name(final_boss_gift)
            self.record_active_gift_shown(fb)
            return fb
        else:
            self.is_final_boss = False

        # 5. Formula calculation
        q = len(self.guesses)
        r = best_rank

        f_q = min(q / 60.0, 1.0) * 50.0
        f_r = max((100.0 - r) / 100.0, 0.0) * 50.0
        score = f_q + f_r
        self.tension_score = round(score)

        # Map dynamic gift index
        gift_idx = min(int((score / 100.0) * num_gifts), num_gifts - 1)
        active = self._canon_gift_name(available_gifts[gift_idx][0])
        self.record_active_gift_shown(active)
        return active

    def _hint_protected(self) -> bool:
        """Zona 'sem boss' ativa: com o Modo Boss desativado, ao chegar no mesmo nível de
        proximidade que ativaria o Final Boss (melhor rank <= 3), as dicas não podem
        revelar as palavras de posição 1-2 (rank 1 = palavra secreta, rank 2 = 2ª mais
        próxima) e a meta de tap dobra (x2)."""
        if self.boss_mode or self.finished or not self.secret_word:
            return False
        best_rank = 1000
        if self.guesses:
            best_rank = min(g["rank"] for g in self.guesses)
        return best_rank <= 3

    def pick_hint_word(self, target_rank: int):
        """Escolhe a palavra de uma dica, centralizando a regra compartilhada pela
        roleta de presentes, meta de tap e dica manual.

        - Pula palavras já reveladas (`hints_given`) ou já chutadas (`guesses`).
        - Na zona protegida (Modo Boss off, melhor rank <= 3): não revela rank 1-2
          e nunca revela rank pior/igual ao melhor rank já obtido — evita a dica
          "cair" num número maior do que o já exibido na partida.

        Retorna (palavra, rank) ou None quando não há dica válida.
        """
        n = len(self.all_scored)
        if n == 0:
            return None
        target_idx = max(0, min(n - 1, max(0, int(target_rank) - 2)))
        guessed_words = {g["word"] for g in self.guesses}
        protect = self._hint_protected()
        best_rank = 1000
        if self.guesses:
            best_rank = min(g["rank"] for g in self.guesses)
        for radius in range(n):
            for idx in (target_idx - radius, target_idx + radius):
                if 0 <= idx < n:
                    w = self.all_scored[idx]
                    if w in self.hints_given or w in guessed_words:
                        continue
                    rank = idx + 2
                    if protect:
                        # Não revela rank 1-2 nem dica pior/igual ao melhor rank
                        if rank <= 2 or rank >= best_rank:
                            continue
                    return w, rank
        return None

    def hint_cluster(self, target_rank: int, span: int = 2) -> list:
        """Palavras de contexto para a charada (cluster em torno do alvo).

        Na zona protegida (Modo Boss off, melhor rank <= 3) remove rank 1-2 para
        não vazar a palavra secreta/2ª mais próxima via charada.
        """
        n = len(self.all_scored)
        if n == 0:
            return []
        target_idx = max(0, min(n - 1, max(0, int(target_rank) - 2)))
        protect = self._hint_protected()
        cluster = []
        for offset in range(-span, span + 1):
            c_idx = target_idx + offset
            if 0 <= c_idx < n:
                # all_scored é ordenado por proximidade: rank = índice + 2
                if protect and c_idx + 2 <= 2:
                    continue
                cluster.append(self.all_scored[c_idx])
        return cluster

    def record_active_gift_shown(self, gift: str):
        if not gift:
            return
        now = time.time()
        self.recent_active_gifts = [e for e in self.recent_active_gifts if now - e["ts"] <= 30]
        self.recent_active_gifts.append({"gift": self._canon_gift_name(gift), "ts": now})

    def is_gift_recently_active(self, gift: str, window: float = 5.0) -> bool:
        if not gift:
            return False
        norm_incoming = strip_accents(self._canon_gift_name(gift).strip().lower())
        now = time.time()
        for e in self.recent_active_gifts:
            if now - e["ts"] > window:
                continue
            ex = self._canon_gift_name(e["gift"]).strip().lower()
            norm_en = strip_accents(ex)
            norm_pt = strip_accents(GIFT_PT_MAP.get(ex, "").lower())
            if norm_incoming in (norm_en, norm_pt) or (norm_pt and norm_incoming == norm_pt):
                return True
        return False

    def get_state(self) -> dict:
        active_gift = self.get_active_gift()
        # Tamanho oculto até o presente de tamanho ser enviado (se configurado)
        len_visible = self.finished or not self.size_gift or self.size_revealed
        return {
            "game_id": self.game_id,
            "secret_word": self.secret_word if self.finished else None,
            "secret_length": len(self.secret_word) if len_visible else 0,
            "size_gift": self.size_gift,
            "size_revealed": self.size_revealed,
            "letter_gift": self.letter_gift,
            "first_letter": self.secret_word[0] if (self.secret_word and self.first_letter_revealed) else "",
            "first_letter_revealed": self.first_letter_revealed,
            "guesses": self.get_final_guesses() if self.finished else self.guesses[:50],
            "hints": self.hints_given,
            "finished": self.finished,
            "winner": self.winner,
            "guess_count": len(self.guesses),
            "active_gift": active_gift,
            "tension_score": getattr(self, "tension_score", 0),
            "is_final_boss": getattr(self, "is_final_boss", False),
            "post_game_summary": self.build_post_game_summary(100) if self.finished else None,
        }
