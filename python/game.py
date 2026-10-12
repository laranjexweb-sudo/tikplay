import json
import random
import os
import bisect
import time
import unicodedata
import re
import asyncio
from datetime import datetime
from similarity import nlp
import db
from service_common import strip_accents
from jogos.caca import CacaPalavras
from jogos.vpet import VPetEngine

# Catálogo de gifts sincronizado (ID-first). Carregado de forma preguiçosa (DB).
try:
    from gifts_catalog import GiftCatalog
except Exception:
    GiftCatalog = None

_gift_catalog_obj = None


def _gift_catalog():
    """Retorna o GiftCatalog cacheado, ou None se indisponível."""
    global _gift_catalog_obj
    if GiftCatalog is None:
        return None
    if _gift_catalog_obj is None:
        try:
            _gift_catalog_obj = GiftCatalog()
        except Exception:
            _gift_catalog_obj = False
    return _gift_catalog_obj if _gift_catalog_obj is not False else None


DEFAULT_HISTORY_PATH = os.path.join(os.path.dirname(__file__), "..", "node", "public", "history.json")
DEFAULT_GIFT_TAGS_PATH = os.path.join(os.path.dirname(__file__), "..", "node", "gift-tags.json")




# Cache de índices por palavra secreta (evita recalcular ~6s a cada partida repetida).
# Chave: palavra secreta normalizada. Valor: dict com all_scored, sims, neg_sims, word_index, hint_pool.
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


GIFT_PT_MAP = {
    "rose": "Rosa",
    "finger heart": "Coração com os Dedos",
    "hand heart": "Coração com as Mãos",
    "tiktok": "TikTok",
    "ice cream": "Casquinha de Sorvete",
    "doughnut": "Rosquinha",
    "donut": "Rosquinha",
    "coffee": "Café",
    "weights": "Halteres",
    "paper crane": "Ave de Papel (Tsuru)",
    "cap": "Boné",
    "panda": "Panda",
    "perfume": "Perfume",
    "microphone": "Microfone",
    "crown": "Coroa",
    "gg": "GG",
    "love bear": "Ursinho do Amor",
    "sunglasses": "Óculos de Sol",
    "gold mine": "Mina de Ouro",
    "lion": "Leão",
    "galaxy": "Galáxia",
    "universe": "Universo",
    "rosa": "Rosa",
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
        self._load_word_pool()
        self._load_history()
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
        path = os.path.join(os.path.dirname(__file__), "words.json")
        with open(path, encoding="utf-8") as f:
            self.word_pool = json.load(f)
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
        """Constrói (ou reutiliza do cache) o índice de proximidade para a palavra secreta."""
        key = strip_accents(self.secret_word)
        cached = _INDEX_CACHE.get(key)
        if cached:
            self.all_scored = cached["all_scored"]
            self.all_scored_sims = cached["all_scored_sims"]
            self._all_scored_neg_sims = cached["neg_sims"]
            self._word_index = cached["word_index"]
            self.hint_pool = cached["hint_pool"]
            self._secret_index_key = key
            return

        secret_doc = nlp(self.secret_word)
        scored = []
        for word in self.word_pool:
            if strip_accents(word) == strip_accents(self.secret_word):
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
        self._secret_index_key = key

        # Guarda no cache global (com limite)
        if len(_INDEX_CACHE) >= _INDEX_CACHE_MAX:
            try:
                _INDEX_CACHE.pop(next(iter(_INDEX_CACHE)))
            except Exception:
                pass
        _INDEX_CACHE[key] = {
            "all_scored": self.all_scored,
            "all_scored_sims": self.all_scored_sims,
            "neg_sims": self._all_scored_neg_sims,
            "word_index": self._word_index,
            "hint_pool": self.hint_pool,
        }

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
        pos = bisect.bisect_left(self._all_scored_neg_sims, -best_sim)
        return pos + 2

    def start_new_game(self, hint_gifts: list = None, riddle_gifts: list = None, size_gift: str = None, letter_gift: str = None) -> str:
        # Relê as palavras banidas a cada rodada (mudanças do admin valem na próxima)
        try:
            self.banned_words = db.load_banned_words()
        except Exception:
            self.banned_words = self.banned_words or set()
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
        self._build_hint_pool()
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
        cat = _gift_catalog()
        if cat is not None and incoming_id and ref:
            row = cat.resolve_ref(ref)
            if row and row.get("id"):
                return str(incoming_id).strip() == str(row["id"])
        return bool(incoming_name) and strip_accents(incoming_name.strip().lower()) in self._gift_aliases(ref)

    def _catalog_diamond(self, ref: str):
        """Valor (diamantes) de um gift configurado (ID ou nome) via catálogo."""
        cat = _gift_catalog()
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

        norm_incoming = strip_accents(gift_name.strip().lower())
        matched_gift = None
        for hg in self.hint_gifts:
            if self._gift_ref_match(gift_id, gift_name, hg):
                matched_gift = hg
                break

        if not matched_gift:
            return None
        self._ensure_hint_pool()
        if not self.all_scored:
            return {"user": user, "gift": gift_name, "hint": None, "rank": None}

        gift_diamonds = []
        for g in self.hint_gifts:
            d = self._catalog_diamond(g)
            if d is None:
                g_lower = str(g).lower()
                for tag in self._gift_tags:
                    if tag["name"].lower() == g_lower:
                        d = tag["diamond_count"]
                        break
            if d is not None:
                gift_diamonds.append(d)

        if not gift_diamonds:
            return {"user": user, "gift": gift_name, "hint": None, "rank": None}

        min_d = min(gift_diamonds)
        max_d = max(gift_diamonds)
        if max_d == min_d:
            ratio = 0.5
        else:
            ratio = (diamond_count - min_d) / (max_d - min_d)
        ratio = max(0.0, min(1.0, ratio))

        n = len(self.all_scored)
        min_index = 4  # dica mais cara: ~rank 6 (posicao 6), nao a palavra mais proxima
        max_index = min(n - 1, 299)
        target_index = round(min_index + (max_index - min_index) * (1 - ratio))

        guessed_words = {g["word"] for g in self.guesses}
        best_word = None
        for radius in range(n):
            for idx in (target_index - radius, target_index + radius):
                if 0 <= idx < n:
                    w = self.all_scored[idx]
                    if w in self.hints_given or w in guessed_words:
                        continue
                    best_word = w
                    break
            if best_word is not None:
                break

        if best_word is None:
            return {"user": user, "gift": gift_name, "hint": None, "rank": None}

        hint_rank = self._compute_rank(best_word)
        self.hints_given.append(best_word)
        entry = {"user": user, "word": best_word, "rank": hint_rank, "is_hint": True, "gift": matched_gift}
        if nickname:
            entry["nickname"] = nickname
        if avatar:
            entry["avatar"] = avatar
        self.guesses.append(entry)
        self.guesses.sort(key=lambda x: x["rank"])
        return {"user": user, "gift": gift_name, "hint": best_word, "rank": hint_rank, "gift_canonical": matched_gift}

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
            "post_game_summary": self.build_post_game_summary(100),
        }

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


    def get_active_gift(self) -> str:
        if self.finished or not self.secret_word:
            return None

        # 1. Check riddle gifts for final boss
        final_boss_gift = self.riddle_gifts[0] if self.riddle_gifts else (self.hint_gifts[-1] if self.hint_gifts else "TikTok")

        # 2. Sort configured hint_gifts by diamond value
        available_gifts = []
        for g in self.hint_gifts:
            g_lower = g.lower()
            price = 1
            for tag in self._gift_tags:
                if tag["name"].lower() == g_lower:
                    price = tag["diamond_count"]
                    break
            available_gifts.append((g, price))

        available_gifts.sort(key=lambda x: x[1])  # sort by price ascending
        if not available_gifts:
            return None

        num_gifts = len(available_gifts)

        # 3. Find best rank so far (initial: 1000)
        best_rank = 1000
        if self.guesses:
            best_rank = min(g["rank"] for g in self.guesses)

        # 4. Check Final Boss overriding condition
        if best_rank <= 3:
            self.is_final_boss = True
            self.tension_score = 100
            self.record_active_gift_shown(final_boss_gift)
            return final_boss_gift
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
        active = available_gifts[gift_idx][0]
        self.record_active_gift_shown(active)
        return active

    def record_active_gift_shown(self, gift: str):
        if not gift:
            return
        now = time.time()
        self.recent_active_gifts = [e for e in self.recent_active_gifts if now - e["ts"] <= 30]
        self.recent_active_gifts.append({"gift": gift, "ts": now})

    def is_gift_recently_active(self, gift: str, window: float = 5.0) -> bool:
        if not gift:
            return False
        norm_incoming = strip_accents(gift.strip().lower())
        now = time.time()
        for e in self.recent_active_gifts:
            if now - e["ts"] > window:
                continue
            ex = e["gift"].strip().lower()
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
            "guesses": self.guesses[:50],
            "hints": self.hints_given,
            "finished": self.finished,
            "winner": self.winner,
            "guess_count": len(self.guesses),
            "active_gift": active_gift,
            "tension_score": getattr(self, "tension_score", 0),
            "is_final_boss": getattr(self, "is_final_boss", False),
            "post_game_summary": self.build_post_game_summary(100) if self.finished else None,
        }


class TresPontinhos:
    """Motor do Jogo dos 3 Pontinhos. Orquestrado pelo GameSession."""

    def __init__(self, tenant_id, emit_cb=None, palavra_provider=None):
        self.tenant_id = tenant_id
        self._emit_cb = emit_cb or (lambda type_, payload: None)
        # palavra_provider() -> (palavra, dicas) usado no auto-reinício da rodada
        self._palavra_provider = palavra_provider
        self.active = False
        self.round_id = 0
        self.phase = "idle"          # idle | countdown | play | pause
        self.countdown_remaining = 0
        self.pause_remaining = 0
        self.palavra = ""
        self.dicas = []
        self.stage = 0
        self.stage_remaining = 0
        self.paused = False
        self.finished = False
        self.timeout = False
        self.winner = None
        self.size_revealed = False
        self.first_letter_revealed = False
        self.supporter_users = set()
        self.gift_config = {"size": "", "letter": "", "ticket": ""}
        # Tempos e pontos configuráveis por rodada
        self.stage_times = dict(TRES_STAGE_TIMES)
        self.stage_points = dict(TRES_STAGE_POINTS)
        self.task = None
        self._last_emit = 0
        self._last_wrong_emit = 0

    def _emit(self, type_, payload):
        self._emit_cb(type_, payload)

    def _emit_log(self, text):
        self._emit("log", text)

    # -------------------------------------------------------------
    # Configuração (presentes A/B/C por nome)
    # -------------------------------------------------------------
    def set_gift_config(self, config: dict):
        if not isinstance(config, dict):
            return
        self.gift_config = {
            "size": str(config.get("size") or ""),
            "letter": str(config.get("letter") or ""),
            "ticket": str(config.get("ticket") or ""),
        }
        # Tempos e pontos configuráveis (listas de 3 inteiros)
        times = config.get("stage_times")
        if isinstance(times, list) and len(times) >= 3:
            self.stage_times = {1: int(times[0]), 2: int(times[1]), 3: int(times[2])}
        points = config.get("stage_points")
        if isinstance(points, list) and len(points) >= 3:
            self.stage_points = {1: int(points[0]), 2: int(points[1]), 3: int(points[2])}

    def _norm(self, s: str) -> str:
        return strip_accents(str(s or "")).strip()

    # -------------------------------------------------------------
    # Controle de rodada
    # -------------------------------------------------------------
    def start(self, palavra: str, dicas: list):
        self.active = True
        self.paused = False
        self.finished = False
        self.timeout = False
        self.round_id += 1
        self.palavra = str(palavra or "").strip()
        self.dicas = [str(d or "").strip() for d in (dicas or [])][:3]
        while len(self.dicas) < 3:
            self.dicas.append("Dica vinda a seguir...")
        # Capitaliza a primeira letra de cada dica
        self.dicas = [d[0].upper() + d[1:] if d else d for d in self.dicas]
        self.phase = "countdown"
        self.countdown_remaining = TRES_COUNTDOWN
        self.stage = 0
        self.stage_remaining = 0
        self.winner = None
        self.size_revealed = False
        self.first_letter_revealed = False
        self.supporter_users = set()
        self._emit("tres_state", self.state(public=False))
        self._emit_log(f"[3 Dicas] Rodada {self.round_id} em {TRES_COUNTDOWN}s... preparem-se!")
        if not self.task:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            self.task = loop.create_task(self._loop())

    def stop(self):
        self.active = False
        self.finished = False
        self.timeout = False
        if self.task:
            self.task.cancel()
            self.task = None
        self._emit("tres_state", self.state(public=False))
        self._emit_log("[3 Dicas] Jogo parado")

    def pause(self):
        self.paused = True
        self._emit("tres_state", self.state(public=False))
        self._emit_log("[3 Dicas] Pausado")

    def resume(self):
        self.paused = False
        self._emit("tres_state", self.state(public=False))
        self._emit_log("[3 Dicas] Retomado")

    def reset(self):
        self.stop()
        self.round_id = 0
        self.palavra = ""
        self.dicas = []
        self.stage = 0
        self.stage_remaining = 0
        self._emit("tres_state", self.state(public=False))

    # -------------------------------------------------------------
    # Palpite
    # -------------------------------------------------------------
    def guess(self, user, nickname, avatar, text) -> dict:
        if not self.active or self.finished or self.paused or self.phase != "play":
            return None
        # Palpite de palavra única (frase com espaço não é palpite — padrão Palavra Secreta)
        if re.search(r"\s", text):
            return None
        # Remove emojis, pontuação e dígitos (padrão Palavra Secreta)
        cleaned = re.sub(r"[^\w]", "", text, flags=re.UNICODE)
        cleaned = re.sub(r"\d+", "", cleaned)
        norm_guess = strip_accents(cleaned)
        if not norm_guess or len(norm_guess) < 2:
            return None
        if norm_guess != self._norm(self.palavra):
            # Aviso de palpite errado (anti-spam: throttle ~0.8s)
            now = time.time()
            if now - self._last_wrong_emit > 0.8:
                self._last_wrong_emit = now
                self._emit("tres_wrong_guess", {
                    "user": user,
                    "nickname": nickname or user,
                    "avatar": avatar or "",
                    "text": text,
                })
            return None
        mult = 2 if user in self.supporter_users else 1
        pontos = self.stage_points[self.stage] * mult
        self.finished = True
        self.phase = "pause"
        self.pause_remaining = TRES_PAUSE_AFTER_END
        self.winner = {
            "user": user,
            "nickname": nickname or user,
            "avatar": avatar or "",
            "pontos": pontos,
            "multiplicador": mult == 2,
            "stage": self.stage,
            "palavra": self.palavra,
        }
        self._emit("tres_winner", self.winner)
        self._emit("tres_state", self.state(public=False))
        self._emit_log(f"[3 Dicas] 🎉 @{user} acertou '{self.palavra}' na Dica {self.stage} ({pontos} pts{' 2x' if mult == 2 else ''})")
        return self.winner

    # -------------------------------------------------------------
    # Gifts (monetização)
    # -------------------------------------------------------------
    def _gift_aliases(self, name: str) -> set:
        """Conjunto de nomes aceitos (EN e PT) para um gift configurado."""
        if not name:
            return set()
        base = self._norm(name)
        aliases = {base}
        # Se base é EN, traduz para PT (ex: "rose" -> "Rosa")
        pt = self._norm(GIFT_PT_MAP.get(base.lower(), ""))
        if pt:
            aliases.add(pt)
        # Se base é PT, encontra o EN correspondente (ex: "Rosa" -> "rose")
        for en, pt_full in GIFT_PT_MAP.items():
            if self._norm(pt_full) == base:
                aliases.add(self._norm(en))
                break
        return aliases

    def _gift_matches(self, incoming_norm: str, configured: str, incoming_id: str = None) -> bool:
        """Match de gift ID-first (catálogo) com fallback por nome EN ou PT."""
        cat = _gift_catalog()
        if cat is not None and incoming_id and configured:
            row = cat.resolve_ref(configured)
            if row and row.get("id"):
                return str(incoming_id).strip() == str(row["id"])
        return bool(configured) and incoming_norm in self._gift_aliases(configured)

    def process_gift(self, user, nickname, avatar, gift_name, gift_id=None, repeat=1):
        if not self.active or self.finished:
            return
        # Apoiador: qualquer gift na rodada vale multiplicador 2x
        is_new_supporter = user not in self.supporter_users
        self.supporter_users.add(user)
        if is_new_supporter:
            # Evento apenas visual (faixa de apoiadores na tela) — não altera pontuação/regras
            self._emit("tres_supporter", {"user": user, "nickname": nickname or user, "avatar": avatar or ""})
        n = self._norm(gift_name)
        cfg = self.gift_config
        if self._gift_matches(n, cfg.get("size"), gift_id) and not self.size_revealed:
            self.size_revealed = True
            self._emit("tres_reveal_size", {"user": user, "nickname": nickname or user, "len": len(self.palavra)})
            self._emit_log(f"[3 Dicas] @{user} revelou o TAMANHO ({len(self.palavra)} letras)")
        elif self._gift_matches(n, cfg.get("letter"), gift_id) and self.size_revealed and not self.first_letter_revealed:
            self.first_letter_revealed = True
            self._emit("tres_reveal_letter", {"user": user, "nickname": nickname or user, "letter": self.palavra[0] if self.palavra else "", "palavra_len": len(self.palavra)})
            self._emit_log(f"[3 Dicas] @{user} revelou a PRIMEIRA LETRA")
        elif self._gift_matches(n, cfg.get("letter"), gift_id) and not self.size_revealed:
            self._emit_log(f"[3 Dicas] @{user} enviou o presente da 1ª letra, mas o TAMANHO ainda não foi revelado")

    # -------------------------------------------------------------
    # Loop asyncio (1s)
    # -------------------------------------------------------------
    async def _loop(self):
        try:
            while True:
                await asyncio.sleep(1)
                if not self.active or self.paused:
                    continue
                if self.phase == "pause":
                    self._tick_pause()
                elif not self.finished:
                    self._tick_timer()
        except asyncio.CancelledError:
            raise

    def _tick_pause(self):
        # Pausa entre rodadas (10s) — depois inicia a próxima automaticamente
        self.pause_remaining -= 1
        self._emit("tres_tick", {"phase": "pause", "remaining": self.pause_remaining})
        if self.pause_remaining <= 0:
            self.phase = "idle"
            if self._palavra_provider:
                loop = asyncio.get_running_loop()
                loop.create_task(self._autostart())

    async def _autostart(self):
        """Gera nova palavra/dicas e inicia a próxima rodada automaticamente."""
        try:
            if not self._palavra_provider:
                return
            res = self._palavra_provider()
            if asyncio.iscoroutine(res):
                res = await res
            palavra, dicas = res
            if palavra:
                self.start(palavra, dicas)
                self._emit_log("[3 Dicas] Nova rodada iniciada automaticamente")
        except Exception as e:
            self._emit_log(f"[3 Dicas] Erro ao auto-iniciar rodada: {e}")

    def _tick_timer(self):
        # Fase countdown: espera antes de revelar a Dica 1
        if self.phase == "countdown":
            self.countdown_remaining -= 1
            self._emit("tres_tick", {"phase": "countdown", "remaining": self.countdown_remaining})
            if self.countdown_remaining <= 0:
                self.phase = "play"
                self.stage = 1
                self.stage_remaining = self.stage_times[1]
                self._emit("tres_state", self.state(public=False))
                self._emit("tres_dica", {"stage": 1, "dica": self.dicas[0], "remaining": self.stage_remaining, "points": self.stage_points[1]})
                self._emit_log(f"[3 Dicas] Dica 1: {self.dicas[0]} ({self.stage_times[1]}s, {self.stage_points[1]} pts)")
            return
        self.stage_remaining -= 1
        # Tick visual a cada segundo (cronômetro fluido)
        self._emit("tres_tick", {"phase": "play", "stage": self.stage, "remaining": self.stage_remaining})
        if self.stage_remaining <= 0:
            if self.stage < 3:
                self.stage += 1
                self.stage_remaining = self.stage_times[self.stage]
                self._emit("tres_dica", {"stage": self.stage, "dica": self.dicas[self.stage - 1], "remaining": self.stage_remaining, "points": self.stage_points[self.stage]})
                self._emit_log(f"[3 Dicas] Dica {self.stage}: {self.dicas[self.stage - 1]} ({self.stage_times[self.stage]}s, {self.stage_points[self.stage]} pts)")
            else:
                # Tempo esgotado coletivamente
                self.timeout = True
                self.finished = True
                self.phase = "pause"
                self.pause_remaining = TRES_PAUSE_AFTER_END
                self._emit("tres_timeout", {"palavra": self.palavra})
                self._emit("tres_state", self.state(public=False))
                self._emit_log(f"[3 Dicas] ⏰ TEMPO ESGOTADO — a palavra era '{self.palavra}'")

    # -------------------------------------------------------------
    # Estado público
    # -------------------------------------------------------------
    def state(self, public=False):
        first = self.palavra[0] if (self.palavra and self.first_letter_revealed) else ""
        # O tamanho da palavra só aparece quando revelado (presente A/B) ou no fim
        len_visible = self.size_revealed or self.first_letter_revealed or self.finished
        return {
            "active": self.active,
            "round_id": self.round_id,
            "phase": self.phase,
            "countdown_remaining": self.countdown_remaining,
            "pause_remaining": self.pause_remaining,
            "stage": self.stage,
            "stage_remaining": self.stage_remaining,
            "stage_time": self.stage_times.get(self.stage, 0),
            "stage_points": self.stage_points.get(self.stage, 0),
            "paused": self.paused,
            "finished": self.finished,
            "timeout": self.timeout,
            "palavra": self.palavra if not public else (self.palavra if self.finished else None),
            "palavra_len": len(self.palavra) if len_visible else 0,
            "first_letter": first,
            "size_revealed": self.size_revealed,
            "first_letter_revealed": self.first_letter_revealed,
            "dicas": self.dicas,
            "winner": self.winner,
            "gift_config": self.gift_config,
            "stage_times": list(self.stage_times.values()),
            "stage_points": list(self.stage_points.values()),
        }
