"""Catálogo de presentes — acesso ao banco + resolução ID-first (com fallback por nome).

O SQLite é o mesmo usado por node (`node/data.db`). A DDL é "propriedade" de `node/db.js`,
mas aqui garantimos a existência das tabelas (idempotente) para uso standalone.

Escrita do catálogo: `sync_gifts.py`. Leitura: este módulo (usado pelos motores na Fase 2).
"""
import json
import os
import sqlite3
import sys
import time
import unicodedata

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH") or os.path.join(_HERE, "..", "node", "data.db")
GIFT_TAGS_PATH = os.path.join(_HERE, "..", "node", "gift-tags.json")
GIFT_IMAGE_MAP_PATH = os.path.join(_HERE, "..", "node", "public", "gift-image-map.json")

SCHEMA = """
CREATE TABLE IF NOT EXISTS gifts (
  gid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE,
  name TEXT NOT NULL,
  name_pt TEXT,
  diamond_count INTEGER DEFAULT 0,
  icon_url TEXT DEFAULT '',
  icon_local TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  first_seen INTEGER DEFAULT 0,
  last_seen INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gifts_name ON gifts(name);
CREATE TABLE IF NOT EXISTS gift_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_sync INTEGER DEFAULT 0,
  last_sync_result TEXT DEFAULT ''
);
"""


def norm(s):
    if not s:
        return ""
    s = str(s).lower().strip()
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _conn():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA busy_timeout=5000")
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema():
    conn = _conn()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def now_ts():
    return int(time.time())


# ---------------- Seed a partir dos arquivos legados ----------------

def seed_from_files(max_age_ok=True):
    """Insere gifts do gift-tags.json (sem id) + icon_local do gift-image-map.json.

    Idempotente: só insere nomes ainda ausentes. Não sobrescreve linhas já sincronizadas.
    """
    if not os.path.exists(GIFT_TAGS_PATH):
        return {"inserted": 0, "skipped": True, "reason": "gift-tags.json ausente"}
    try:
        with open(GIFT_TAGS_PATH, "r", encoding="utf-8") as fh:
            tags = json.load(fh)
    except Exception as exc:
        return {"inserted": 0, "skipped": True, "reason": f"gift-tags.json inválido: {exc}"}
    image_map = {}
    try:
        with open(GIFT_IMAGE_MAP_PATH, "r", encoding="utf-8") as fh:
            image_map = json.load(fh) or {}
    except Exception:
        image_map = {}

    ensure_schema()
    inserted = 0
    ts = now_ts()
    conn = _conn()
    try:
        cur = conn.cursor()
        for g in tags if isinstance(tags, list) else []:
            name = str((g or {}).get("name") or "").strip()
            if not name:
                continue
            exists = cur.execute("SELECT gid FROM gifts WHERE lower(name) = lower(?) LIMIT 1", (name,)).fetchone()
            if exists:
                continue
            cur.execute(
                "INSERT INTO gifts (id, name, diamond_count, icon_local, status, first_seen, last_seen) "
                "VALUES (NULL, ?, ?, ?, 'active', ?, ?)",
                (name, int((g or {}).get("diamond_count") or 0), str(image_map.get(name) or ""), ts, ts),
            )
            inserted += 1
        conn.commit()
    finally:
        conn.close()
    return {"inserted": inserted, "skipped": False}


# ---------------- Escrita (usada pelo sincronizador) ----------------

def upsert_gifts(rows):
    """Insere/atualiza gifts vindos do TikTok.

    Casamento **somente por id** (o TikTok tem gifts com o MESMO nome e ids/preços
    diferentes — ex.: dois "Heart", de 1 e 10 moedas). Nunca mesclar linhas distintas
    por compartilharem o nome.

    Linhas legadas do seed (id NULL) são "adotadas" pelo primeiro sync que traga aquele
    nome: em vez de criar uma duplicata, preenche o id da linha existente.

    `rows`: lista de dicts {id, name, name_pt, diamond_count, icon_url, icon_local}.
    Retorna {inserted, updated}.
    """
    ensure_schema()
    ts = now_ts()
    inserted = updated = 0
    conn = _conn()
    try:
        cur = conn.cursor()
        for g in rows or []:
            gid = str((g or {}).get("id") or "").strip() or None
            name = str((g or {}).get("name") or "").strip()
            if not name:
                continue
            diamond = int((g or {}).get("diamond_count") or 0)
            icon_url = str((g or {}).get("icon_url") or "")
            icon_local = str((g or {}).get("icon_local") or "")
            name_pt = (g or {}).get("name_pt") or None

            row = None
            if gid:
                row = cur.execute("SELECT gid FROM gifts WHERE id = ?", (gid,)).fetchone()
            if not row and gid:
                # Adota (não duplica) uma linha de seed sem id com o mesmo nome.
                row = cur.execute(
                    "SELECT gid FROM gifts WHERE id IS NULL AND lower(name) = lower(?) LIMIT 1",
                    (name,),
                ).fetchone()
            if row:
                cur.execute(
                    "UPDATE gifts SET id = COALESCE(?, id), name = ?, "
                    "diamond_count = ?, icon_url = ?, "
                    "icon_local = CASE WHEN ? <> '' THEN ? ELSE icon_local END, "
                    "status = 'active', last_seen = ? WHERE gid = ?",
                    (gid, name, diamond, icon_url, icon_local, icon_local, ts, row["gid"]),
                )
                updated += 1
            else:
                cur.execute(
                    "INSERT INTO gifts (id, name, name_pt, diamond_count, icon_url, icon_local, status, first_seen, last_seen) "
                    "VALUES (?,?,?,?,?,?, 'active', ?, ?)",
                    (gid, name, name_pt, diamond, icon_url, icon_local, ts, ts),
                )
                inserted += 1
        conn.commit()
    finally:
        conn.close()
    return {"inserted": inserted, "updated": updated}


def mark_missing_unavailable(seen_ids):
    """Marca como 'unavailable' os gifts com id que NÃO apareceram na última sync.

    Linhas sem id (seed) são preservadas.
    """
    seen = {str(x).strip() for x in (seen_ids or []) if str(x).strip()}
    conn = _conn()
    try:
        cur = conn.cursor()
        rows = cur.execute("SELECT gid, id FROM gifts WHERE id IS NOT NULL AND status = 'active'").fetchall()
        missing = [r["gid"] for r in rows if r["id"] not in seen]
        for gid in missing:
            cur.execute("UPDATE gifts SET status = 'unavailable' WHERE gid = ?", (gid,))
        conn.commit()
        return len(missing)
    finally:
        conn.close()


def set_meta(last_sync=None, last_sync_result=None):
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO gift_meta (id, last_sync, last_sync_result) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET "
            "last_sync = COALESCE(excluded.last_sync, last_sync), "
            "last_sync_result = COALESCE(excluded.last_sync_result, last_sync_result)",
            (last_sync, last_sync_result),
        )
        conn.commit()
    finally:
        conn.close()


def regenerate_derived_files():
    """Regenera node/gift-tags.json e node/public/gift-image-map.json a partir do catálogo."""
    conn = _conn()
    try:
        rows = conn.execute(
            "SELECT id, name, diamond_count, icon_local FROM gifts "
            "WHERE status = 'active' AND name <> '' ORDER BY diamond_count, name"
        ).fetchall()
    finally:
        conn.close()
    tags = [{"name": r["name"], "diamond_count": int(r["diamond_count"] or 0)} for r in rows]
    image_map = {}
    for r in rows:
        if r["icon_local"]:
            if r["name"]:
                # Nome pode repetir (ex.: dois "Heart"): mantém o primeiro (menor preço)
                # sem sobrescrever; a resolução correta é por id.
                image_map.setdefault(r["name"], r["icon_local"])
            if r["id"]:
                image_map[r["id"]] = r["icon_local"]
    try:
        with open(GIFT_TAGS_PATH, "w", encoding="utf-8") as fh:
            json.dump(tags, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        with open(GIFT_IMAGE_MAP_PATH, "w", encoding="utf-8") as fh:
            json.dump(image_map, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
    except Exception as exc:
        print(f"[gifts_catalog] falha ao regenerar derivados: {exc}", file=sys.stderr)


# ---------------- Leitura / resolução (Fase 2) ----------------

class GiftCatalog:
    """Cache em memória do catálogo para resolução ID-first."""

    def __init__(self, auto_load=True):
        self._by_id = {}
        self._by_name = {}
        self._rows = []
        if auto_load:
            self.refresh()

    def refresh(self):
        ensure_schema()
        conn = _conn()
        try:
            self._rows = [dict(r) for r in conn.execute("SELECT * FROM gifts").fetchall()]
        finally:
            conn.close()
        self._by_id = {}
        self._by_name = {}
        for r in self._rows:
            if r.get("id"):
                self._by_id[str(r["id"])] = r
            for key in (r.get("name"), r.get("name_pt")):
                n = norm(key)
                if n:
                    self._by_name.setdefault(n, r)

    def by_id(self, gift_id):
        if gift_id is None:
            return None
        return self._by_id.get(str(gift_id).strip())

    def by_name(self, name):
        return self._by_name.get(norm(name))

    def resolve_ref(self, ref):
        """Resolve uma referência (ID ou nome EN/PT) para a linha do catálogo."""
        r = str(ref or "").strip()
        if not r:
            return None
        return self.by_id(r) or self.by_name(r)

    def canonical_id(self, ref):
        row = self.resolve_ref(ref)
        return str(row.get("id")) if row and row.get("id") else ""

    def reference_matches(self, incoming_id, incoming_name, ref):
        """Match ID-first com fallback por nome/alias. Usado pelos jogos (Fase 2).

        Quando o id do evento E a linha da config têm id, o id é **autoritativo**:
        decide só por ele (evita casar gifts de MESMO nome e ids/preços diferentes,
        ex.: `Heart` de 1 e de 10 moedas). O fallback por nome só vale quando falta id.
        """
        row = self.resolve_ref(ref)
        if row:
            rid = str(row.get("id") or "")
            incoming = str(incoming_id or "").strip()
            if rid and incoming:
                return incoming == rid
            names = {norm(row.get("name")), norm(row.get("name_pt"))}
            names.discard("")
            if norm(incoming_name) and norm(incoming_name) in names:
                return True
            return False
        # ref desconhecida: compara direto por nome normalizado
        return bool(norm(ref)) and norm(ref) == norm(incoming_name)


if __name__ == "__main__":
    # Uso rápido: python gifts_catalog.py [--seed] [--list]
    ensure_schema()
    if "--seed" in sys.argv:
        print(seed_from_files())
    if "--list" in sys.argv:
        for r in GiftCatalog()._rows[:20]:
            print(r.get("id"), "-", r.get("name"), "-", r.get("diamond_count"))
    if len(sys.argv) <= 1:
        print(f"DB: {DB_PATH}")
        print(f"gifts cadastrados: {len(GiftCatalog()._rows)}")

_catalog_instance = None


def get_catalog():
    """Singleton preguiçoso do catálogo (compatível com o antigo game._gift_catalog)."""
    global _catalog_instance
    if _catalog_instance is None:
        try:
            _catalog_instance = GiftCatalog()
        except Exception:
            _catalog_instance = False
    return _catalog_instance if _catalog_instance is not False else None
