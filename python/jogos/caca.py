"""Jogo CAҪA PALAVRAS - motor isolado (extraido de game.py, Fase A-3).

Sem mudanca de comportamento. Dependencias: random + strip_accents (service_common).
"""
import random

from service_common import strip_accents

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
        return self._mark_found(w, finder, nickname, avatar)

    def try_word_text(self, text):
        """Retorna palavra não encontrada que corresponda ao texto exato."""
        if not self.active or self.finished:
            return None
        target = strip_accents(text or "").strip().upper()
        if not target:
            return None
        for w in self.words:
            if not w["found"] and strip_accents(w["text"]).upper() == target:
                return w
        return None

    def find_word_text(self, text, finder="", nickname="", avatar=""):
        return self._mark_found(self.try_word_text(text), finder, nickname, avatar)

    def _mark_found(self, w, finder="", nickname="", avatar=""):
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
