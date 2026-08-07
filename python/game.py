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


DEFAULT_HISTORY_PATH = os.path.join(os.path.dirname(__file__), "..", "node", "public", "history.json")
DEFAULT_GIFT_TAGS_PATH = os.path.join(os.path.dirname(__file__), "..", "node", "gift-tags.json")


def strip_accents(s: str) -> str:
    if not s:
        return ""
    s = s.lower().strip()
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


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

    def start_new_game(self, hint_gifts: list = None, riddle_gifts: list = None, size_gift: str = None) -> str:
        available = [w for w in self.word_pool if w not in self.played_words]
        if not available:
            self.played_words.clear()
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

    def process_riddle_gift(self, user: str, gift_name: str, force: bool = False) -> dict:
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
            norm_incoming = strip_accents(gift_name.strip().lower())
            norm_expected_en = strip_accents(expected_gift.strip().lower())
            norm_expected_pt = strip_accents(GIFT_PT_MAP.get(expected_gift.strip().lower(), "").lower())

            if norm_incoming not in (norm_expected_en, norm_expected_pt) and (not norm_expected_pt or norm_incoming != norm_expected_pt):
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

    def process_gift(self, user: str, gift_name: str, diamond_count: int = 0, nickname: str = None, avatar: str = None) -> dict:
        if self.finished or not self.secret_word:
            return None

        # Presente de tamanho: revela o nº de letras da palavra secreta
        if self.size_gift and not self.size_revealed:
            norm_in = strip_accents(gift_name.strip().lower())
            if norm_in in self._gift_aliases(self.size_gift):
                self.size_revealed = True
                return {
                    "user": user,
                    "nickname": nickname or user,
                    "avatar": avatar or "",
                    "gift": gift_name,
                    "size_revealed": True,
                    "secret_length": len(self.secret_word),
                }

        norm_incoming = strip_accents(gift_name.strip().lower())
        matched_gift = None
        for hg in self.hint_gifts:
            hg_lower = hg.strip().lower()
            norm_en = strip_accents(hg_lower)
            norm_pt = strip_accents(GIFT_PT_MAP.get(hg_lower, "").lower())
            if norm_incoming in (norm_en, norm_pt) or (norm_pt and norm_incoming == norm_pt):
                matched_gift = hg
                break

        if not matched_gift:
            return None
        self._ensure_hint_pool()
        if not self.all_scored:
            return {"user": user, "gift": gift_name, "hint": None, "rank": None}

        gift_diamonds = []
        for g in self.hint_gifts:
            g_lower = g.lower()
            for tag in self._gift_tags:
                if tag["name"].lower() == g_lower:
                    gift_diamonds.append(tag["diamond_count"])
                    break

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


class CacaPalavras:
    """Jogo CAÇA PALAVRAS: grade de letras com palavras escondidas.

    Cada palavra tem posição inicial/final (ex: A1:A4) no formato
    linha (letra) + coluna (número). Jogadores acertam pelo chat.
    """

    DIRS = {
        "H": (0, 1),   # horizontal ->
        "V": (1, 0),   # vertical baixo
        "D": (1, 1),   # diagonal baixo-direita
    }

    def __init__(self, size=10):
        self.size = size
        self.active = False
        self.board = []
        self.words = []
        self.found_count = 0
        self.finished = False

    # ---------------------------------------------------------------
    # Geração
    # ---------------------------------------------------------------
    def _can_place(self, row, col, dr, dc, word):
        for i, ch in enumerate(word):
            r = row + dr * i
            c = col + dc * i
            if not (0 <= r < self.size and 0 <= c < self.size):
                return False
            cell = self.board[r][c]
            if cell and cell != ch:
                return False
        return True

    def _place(self, row, col, dr, dc, word):
        for i, ch in enumerate(word):
            self.board[row + dr * i][col + dc * i] = ch
        er = row + dr * (len(word) - 1)
        ec = col + dc * (len(word) - 1)
        start = self._coord(row, col)
        end = self._coord(er, ec)
        self.words.append({
            "id": len(self.words) + 1,
            "text": word,
            "row": row,
            "col": col,
            "dr": dr,
            "dc": dc,
            "start": start,
            "end": end,
            "found": False,
            "finder": "",
            "finder_nickname": "",
            "finder_avatar": "",
        })

    def _coord(self, row, col):
        return chr(ord("A") + row) + str(col + 1)

    def start(self, word_pool=None, count=10, min_len=3, max_len=8):
        self.size = 10
        self.board = [["" for _ in range(self.size)] for _ in range(self.size)]
        self.words = []
        self.found_count = 0
        self.finished = False

        pool = word_pool or []
        norm_pool = []
        seen = set()
        for w in pool:
            n = strip_accents(w).upper()
            if min_len <= len(n) <= max_len and n not in seen:
                norm_pool.append(n)
                seen.add(n)
        random.shuffle(norm_pool)
        self._norm_pool = set(norm_pool)

        placed = 0
        for word in norm_pool:
            if placed >= count:
                break
            if len(word) > self.size:
                continue
            dirs = list(self.DIRS.values())
            random.shuffle(dirs)
            ok = False
            for dr, dc in dirs:
                for _ in range(150):
                    row = random.randint(0, self.size - 1)
                    col = random.randint(0, self.size - 1)
                    if self._can_place(row, col, dr, dc, word):
                        self._place(row, col, dr, dc, word)
                        ok = True
                        placed += 1
                        break
                if ok:
                    break

        # Preenche vazios com letras aleatórias (evitando formar palavras fantasmas)
        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        self._placed_words = set(w["text"] for w in self.words)
        for r in range(self.size):
            for c in range(self.size):
                if not self.board[r][c]:
                    for _ in range(12):
                        ch = random.choice(letters)
                        self.board[r][c] = ch
                        if not self._creates_ghost(r, c):
                            break
                    else:
                        self.board[r][c] = random.choice(letters)

        # Marca células que pertencem a palavras oficiais (não mexer nelas)
        self._official_cells = set()
        for w in self.words:
            for i in range(len(w["text"])):
                self._official_cells.add((w["row"] + w["dr"] * i, w["col"] + w["dc"] * i))

        # Pós-processamento: elimina fantasmas restantes trocando letras não-oficiais
        self._fix_ghosts()

        # Se ainda houver fantasma formada só por células oficiais, regenera a grade
        for _ in range(12):
            if self._has_ghost():
                self._regenerate(word_pool, count, min_len, max_len)
            else:
                break

        self.active = True
        return self.state(public=False)

    def _has_ghost(self):
        """True se houver alguma palavra fantasma (substring) na grade."""
        for dr, dc in [(0, 1), (1, 0), (1, 1), (1, -1)]:
            for r in range(self.size):
                for c in range(self.size):
                    sr, sc, er, ec = self._ghost_len(r, c, dr, dc)
                    ln = max(er - sr, ec - sc) + 1
                    if ln < 3:
                        continue
                    text = "".join(self.board[sr + dr * k][sc + dc * k] for k in range(ln))
                    for k in range(ln - 2):
                        for L in range(3, ln - k + 1):
                            wd = text[k:k + L]
                            if strip_accents(wd).upper() in self._placed_words:
                                continue
                            if wd.upper() in self._norm_pool:
                                return True
        return False

    def _regenerate(self, word_pool, count, min_len, max_len):
        pool = word_pool or []
        norm_pool = []
        seen = set()
        for w in pool:
            n = strip_accents(w).upper()
            if min_len <= len(n) <= max_len and n not in seen:
                norm_pool.append(n)
                seen.add(n)
        random.shuffle(norm_pool)

        self.board = [["" for _ in range(self.size)] for _ in range(self.size)]
        self.words = []
        self.found_count = 0
        self.finished = False
        self._norm_pool = set(norm_pool)

        placed = 0
        for word in norm_pool:
            if placed >= count:
                break
            if len(word) > self.size:
                continue
            dirs = list(self.DIRS.values())
            random.shuffle(dirs)
            ok = False
            for dr, dc in dirs:
                for _ in range(150):
                    row = random.randint(0, self.size - 1)
                    col = random.randint(0, self.size - 1)
                    if self._can_place(row, col, dr, dc, word):
                        self._place(row, col, dr, dc, word)
                        ok = True
                        placed += 1
                        break
                if ok:
                    break

        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        self._placed_words = set(w["text"] for w in self.words)
        for r in range(self.size):
            for c in range(self.size):
                if not self.board[r][c]:
                    for _ in range(12):
                        ch = random.choice(letters)
                        self.board[r][c] = ch
                        if not self._creates_ghost(r, c):
                            break
                    else:
                        self.board[r][c] = random.choice(letters)

        self._official_cells = set()
        for w in self.words:
            for i in range(len(w["text"])):
                self._official_cells.add((w["row"] + w["dr"] * i, w["col"] + w["dc"] * i))

        self._fix_ghosts()

    def _fix_ghosts(self):
        """Elimina palavras fantasmas trocando letras de células não-oficiais."""
        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

        def scan():
            """Retorna (texto, cells, trocaveis) de cada palavra fantasma encontrada."""
            out = []
            for dr, dc in [(0, 1), (1, 0), (1, 1), (1, -1)]:
                for r in range(self.size):
                    for c in range(self.size):
                        sr, sc, er, ec = self._ghost_len(r, c, dr, dc)
                        ln = max(er - sr, ec - sc) + 1
                        if ln < 3:
                            continue
                        text = "".join(self.board[sr + dr * k][sc + dc * k] for k in range(ln))
                        for k in range(ln - 2):
                            for L in range(3, ln - k + 1):
                                wd = text[k:k + L]
                                if strip_accents(wd).upper() in self._placed_words:
                                    continue
                                if wd.upper() in self._norm_pool:
                                    cells = [(sr + dr * (k + m), sc + dc * (k + m)) for m in range(L)]
                                    troc = [c0 for c0 in cells if c0 not in self._official_cells]
                                    if troc:
                                        out.append((wd, troc))
            return out

        for _ in range(8):
            ghosts = scan()
            if not ghosts:
                return
            fixed = False
            for wd, troc in ghosts:
                if not troc:
                    continue
                tr, tc = troc[0]
                orig = self.board[tr][tc]
                for _ in range(24):
                    nch = random.choice(letters)
                    if nch == orig:
                        continue
                    self.board[tr][tc] = nch
                    # confirma que a fantasma quebrou e não criou outra passando por (tr,tc)
                    if not self._creates_ghost(tr, tc):
                        fixed = True
                        break
                    self.board[tr][tc] = orig
            if not fixed:
                break

    def _ghost_len(self, r, c, dr, dc):
        """Segmento contíguo de letras que passa por (r,c) na direção (dr,dc).

        Retorna (start_r, start_c, end_r, end_c) onde end é a ÚLTIMA célula ocupada.
        """
        i, j = r, c
        while 0 <= i - dr < self.size and 0 <= j - dc < self.size and self.board[i - dr][j - dc]:
            i -= dr
            j -= dc
        start_r, start_c = i, j
        while 0 <= i + dr < self.size and 0 <= j + dc < self.size and self.board[i + dr][j + dc]:
            i += dr
            j += dc
        return (start_r, start_c, i, j)

    def _is_ghost(self, r, c):
        """Retorna True se a célula (r,c) faz parte de uma palavra do pool que NÃO é oficial."""
        for dr, dc in [(0, 1), (1, 0), (1, 1), (1, -1)]:
            sr, sc, er, ec = self._ghost_len(r, c, dr, dc)
            ln = max(er - sr, ec - sc) + 1
            if ln < 3:
                continue
            text = "".join(self.board[sr + dr * k][sc + dc * k] for k in range(ln))
            if strip_accents(text).upper() in self._placed_words:
                continue
            if text.upper() in self._norm_pool:
                return True
        return False

    def _creates_ghost(self, r, c):
        """Verifica se a célula (r,c) participa de alguma palavra fantasma.

        Testa todas as substrings de 3+ nas 4 direções que passam por (r,c).
        """
        for dr, dc in [(0, 1), (1, 0), (1, 1), (1, -1)]:
            sr, sc, er, ec = self._ghost_len(r, c, dr, dc)
            ln = max(er - sr, ec - sc) + 1
            if ln < 3:
                continue
            for k in range(ln - 2):
                for L in range(3, ln - k + 1):
                    cr = sr + dr * k
                    cc = sc + dc * k
                    if not (0 <= cr < self.size and 0 <= cc < self.size):
                        continue
                    text = "".join(self.board[sr + dr * (k + m)][sc + dc * (k + m)] for m in range(L))
                    if strip_accents(text).upper() in self._placed_words:
                        continue
                    if text.upper() in self._norm_pool:
                        return True
        return False

    def stop(self):
        self.active = False
        self.board = []
        self.words = []
        self.found_count = 0
        self.finished = False

    # ---------------------------------------------------------------
    # Coordenadas
    # ---------------------------------------------------------------
    def _parse_coord(self, coord):
        coord = (coord or "").strip().upper().replace(" ", "")
        if len(coord) < 2:
            return None
        letter = coord[0]
        num = coord[1:]
        if not ("A" <= letter <= chr(ord("A") + self.size - 1)):
            return None
        if not num.isdigit():
            return None
        row = ord(letter) - ord("A")
        col = int(num) - 1
        if not (0 <= row < self.size and 0 <= col < self.size):
            return None
        return (row, col)

    def _segment_text(self, p1, p2):
        r1, c1 = p1
        r2, c2 = p2
        dr = (r2 - r1)
        dc = (c2 - c1)
        if dr != 0 and dc != 0 and abs(dr) != abs(dc):
            return None
        length = max(abs(dr), abs(dc)) + 1
        sr = 1 if dr > 0 else -1 if dr < 0 else 0
        sc = 1 if dc > 0 else -1 if dc < 0 else 0
        text = []
        for i in range(length):
            text.append(self.board[r1 + sr * i][c1 + sc * i])
        return "".join(text)

    def try_word(self, start, end):
        """Tenta acertar uma palavra dados os pontos inicial/final.

        Retorna o dict da palavra se bater (qualquer ordem), senão None.
        """
        if not self.active or self.finished:
            return None
        p1 = self._parse_coord(start)
        p2 = self._parse_coord(end)
        if p1 is None or p2 is None:
            return None
        text = self._segment_text(p1, p2)
        if not text:
            return None
        for w in self.words:
            if w["found"]:
                continue
            target = strip_accents(w["text"]).upper()
            if target == text or target == text[::-1]:
                return w
        return None

    def find_word(self, start, end, finder="", nickname="", avatar=""):
        w = self.try_word(start, end)
        if not w:
            return None
        w["found"] = True
        w["finder"] = finder
        w["finder_nickname"] = nickname or finder
        w["finder_avatar"] = avatar or ""
        self.found_count += 1
        if self.found_count >= len(self.words):
            self.finished = True
            self.active = False
        return w

    # ---------------------------------------------------------------
    # Estado / serialização
    # ---------------------------------------------------------------
    def state(self, public=False):
        words_out = []
        for w in self.words:
            entry = {
                "id": w["id"],
                "text": w["text"] if (w["found"] or not public) else None,
                "start": w["start"],
                "end": w["end"],
                "found": w["found"],
                "finder": w["finder"],
                "finder_nickname": w["finder_nickname"],
                "finder_avatar": w["finder_avatar"],
            }
            words_out.append(entry)
        return {
            "active": self.active,
            "size": self.size,
            "board": self.board,
            "words": words_out,
            "found_count": self.found_count,
            "total": len(self.words),
            "finished": self.finished,
        }


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
        tick_count = 0
        try:
            while True:
                await asyncio.sleep(VPET_TICK)
                tick_count += 1
                try:
                    await self._tick()
                except Exception as e:
                    self._emit_log(f"[Bichinho] ERRO no tick: {type(e).__name__}: {e}")
                if tick_count % 5 == 0:
                    self._emit_log(f"[Bichinho] tick ativo ({tick_count}) battle.state={self.state.get('battle', {}).get('state', '?')}")
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


# =====================================================================
# Jogo dos 3 Pontinhos — adivinhação de palavra com 3 dicas progressivas
# Dica 1 (difícil): 120s / 30 pts | Dica 2 (contextual): 60s / 20 pts |
# Dica 3 (fácil): 30s / 10 pts. Presentes revelam tamanho e primeira letra.
# =====================================================================

TRES_STAGE_TIMES = {1: 120, 2: 60, 3: 30}
TRES_STAGE_POINTS = {1: 30, 2: 20, 3: 10}
TRES_PAUSE_AFTER_END = 10  # pausa entre rodadas
TRES_COUNTDOWN = 5         # cronômetro pré-jogo (dicas ocultas)


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
        self._emit_log(f"[3 Pontinhos] Rodada {self.round_id} em {TRES_COUNTDOWN}s... preparem-se!")
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
        self._emit_log("[3 Pontinhos] Jogo parado")

    def pause(self):
        self.paused = True
        self._emit("tres_state", self.state(public=False))
        self._emit_log("[3 Pontinhos] Pausado")

    def resume(self):
        self.paused = False
        self._emit("tres_state", self.state(public=False))
        self._emit_log("[3 Pontinhos] Retomado")

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
        self._emit_log(f"[3 Pontinhos] 🎉 @{user} acertou '{self.palavra}' na Dica {self.stage} ({pontos} pts{' 2x' if mult == 2 else ''})")
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

    def _gift_matches(self, incoming_norm: str, configured: str) -> bool:
        """Match de gift aceitando nome EN ou PT (padrão Palavra Secreta)."""
        return bool(configured) and incoming_norm in self._gift_aliases(configured)

    def process_gift(self, user, nickname, avatar, gift_name, gift_id=None, repeat=1):
        if not self.active or self.finished:
            return
        # Apoiador: qualquer gift na rodada vale multiplicador 2x
        self.supporter_users.add(user)
        n = self._norm(gift_name)
        cfg = self.gift_config
        if self._gift_matches(n, cfg.get("size")) and not self.size_revealed:
            self.size_revealed = True
            self._emit("tres_reveal_size", {"user": user, "nickname": nickname or user, "len": len(self.palavra)})
            self._emit_log(f"[3 Pontinhos] @{user} revelou o TAMANHO ({len(self.palavra)} letras)")
        elif self._gift_matches(n, cfg.get("letter")) and self.size_revealed and not self.first_letter_revealed:
            self.first_letter_revealed = True
            self._emit("tres_reveal_letter", {"user": user, "nickname": nickname or user, "letter": self.palavra[0] if self.palavra else "", "palavra_len": len(self.palavra)})
            self._emit_log(f"[3 Pontinhos] @{user} revelou a PRIMEIRA LETRA")
        elif self._gift_matches(n, cfg.get("letter")) and not self.size_revealed:
            self._emit_log(f"[3 Pontinhos] @{user} enviou o presente da 1ª letra, mas o TAMANHO ainda não foi revelado")

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
                self._emit_log("[3 Pontinhos] Nova rodada iniciada automaticamente")
        except Exception as e:
            self._emit_log(f"[3 Pontinhos] Erro ao auto-iniciar rodada: {e}")

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
                self._emit_log(f"[3 Pontinhos] Dica 1: {self.dicas[0]} ({self.stage_times[1]}s, {self.stage_points[1]} pts)")
            return
        self.stage_remaining -= 1
        # Tick visual a cada segundo (cronômetro fluido)
        self._emit("tres_tick", {"phase": "play", "stage": self.stage, "remaining": self.stage_remaining})
        if self.stage_remaining <= 0:
            if self.stage < 3:
                self.stage += 1
                self.stage_remaining = self.stage_times[self.stage]
                self._emit("tres_dica", {"stage": self.stage, "dica": self.dicas[self.stage - 1], "remaining": self.stage_remaining, "points": self.stage_points[self.stage]})
                self._emit_log(f"[3 Pontinhos] Dica {self.stage}: {self.dicas[self.stage - 1]} ({self.stage_times[self.stage]}s, {self.stage_points[self.stage]} pts)")
            else:
                # Tempo esgotado coletivamente
                self.timeout = True
                self.finished = True
                self.phase = "pause"
                self.pause_remaining = TRES_PAUSE_AFTER_END
                self._emit("tres_timeout", {"palavra": self.palavra})
                self._emit("tres_state", self.state(public=False))
                self._emit_log(f"[3 Pontinhos] ⏰ TEMPO ESGOTADO — a palavra era '{self.palavra}'")

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
