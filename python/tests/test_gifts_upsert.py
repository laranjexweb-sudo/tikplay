import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_TMP = tempfile.mkdtemp(prefix="gifts_upsert_test_")
# Redireciona DB e derivados para o diretório temporário ANTES de importar o módulo,
# para não tocar em node/data.db nem nos arquivos reais de gifts.
os.environ["DB_PATH"] = os.path.join(_TMP, "data.db")

import gifts_catalog as catalog  # noqa: E402

catalog.GIFT_TAGS_PATH = os.path.join(_TMP, "gift-tags.json")
catalog.GIFT_IMAGE_MAP_PATH = os.path.join(_TMP, "gift-image-map.json")


def tearDownModule():
    shutil.rmtree(_TMP, ignore_errors=True)


class GiftsUpsertTests(unittest.TestCase):
    def setUp(self):
        if os.path.exists(catalog.DB_PATH):
            os.remove(catalog.DB_PATH)
        catalog.ensure_schema()

    def _rows(self):
        conn = catalog._conn()
        try:
            return [dict(r) for r in conn.execute(
                "SELECT id, name, diamond_count, status, icon_local FROM gifts "
                "ORDER BY diamond_count, name"
            ).fetchall()]
        finally:
            conn.close()

    def test_duplicate_names_distinct_ids_coexist(self):
        # O TikTok tem dois gifts "Heart" (1 e 10 moedas): ambos devem coexistir.
        res = catalog.upsert_gifts([
            {"id": "6247", "name": "Heart", "diamond_count": 1, "icon_url": "u1", "icon_local": "6247.webp"},
            {"id": "9999", "name": "Heart", "diamond_count": 10, "icon_url": "u2", "icon_local": "9999.webp"},
        ])
        self.assertEqual(res["inserted"], 2)
        hearts = [r for r in self._rows() if r["name"] == "Heart"]
        self.assertEqual(len(hearts), 2, hearts)
        self.assertEqual({r["id"] for r in hearts}, {"6247", "9999"})
        self.assertEqual({r["diamond_count"] for r in hearts}, {1, 10})

    def test_seed_null_id_row_is_adopted_not_duplicated(self):
        # Linha de seed (id NULL) com nome repetido deve ser ADOTADA pelo sync, não duplicada.
        conn = catalog._conn()
        try:
            conn.execute(
                "INSERT INTO gifts (id, name, diamond_count, status, first_seen, last_seen) "
                "VALUES (NULL, 'Rose', 1, 'active', 0, 0)"
            )
            conn.commit()
        finally:
            conn.close()
        catalog.upsert_gifts([
            {"id": "5655", "name": "Rose", "diamond_count": 1, "icon_url": "u", "icon_local": "5655.webp"},
        ])
        roses = [r for r in self._rows() if r["name"] == "Rose"]
        self.assertEqual(len(roses), 1, roses)
        self.assertEqual(roses[0]["id"], "5655")

    def test_regenerate_keeps_id_keys_and_name_not_overwritten(self):
        catalog.upsert_gifts([
            {"id": "6247", "name": "Heart", "diamond_count": 1, "icon_url": "u", "icon_local": "6247.webp"},
            {"id": "9999", "name": "Heart", "diamond_count": 10, "icon_url": "u", "icon_local": "9999.webp"},
        ])
        catalog.regenerate_derived_files()
        with open(catalog.GIFT_IMAGE_MAP_PATH, encoding="utf-8") as fh:
            m = json.load(fh)
        # Resolução correta por id (ambos preservados)
        self.assertEqual(m.get("6247"), "6247.webp")
        self.assertEqual(m.get("9999"), "9999.webp")
        # Chave de nome é ambígua: mantém a primeira (menor preço), sem sobrescrever
        self.assertEqual(m.get("Heart"), "6247.webp")

    def test_reference_matches_is_id_first_strict(self):
        catalog.upsert_gifts([
            {"id": "6247", "name": "Heart", "diamond_count": 1, "icon_url": "u", "icon_local": "6247.webp"},
            {"id": "5327", "name": "Heart", "diamond_count": 10, "icon_url": "u", "icon_local": "5327.webp"},
        ])
        cat = catalog.GiftCatalog()
        # id igual ao da config → casa
        self.assertTrue(cat.reference_matches("6247", "Heart", "6247"))
        self.assertTrue(cat.reference_matches("5327", "Heart", "5327"))
        # id DIFERENTE do config → NÃO casa, mesmo com nome igual (Heart 10 ≠ Heart 1)
        self.assertFalse(cat.reference_matches("5327", "Heart", "6247"))
        self.assertFalse(cat.reference_matches("6247", "Heart", "5327"))
        # sem id no evento → fallback por nome (dados legados)
        self.assertTrue(cat.reference_matches("", "Heart", "6247"))
        self.assertTrue(cat.reference_matches(None, "Heart", "5327"))


if __name__ == "__main__":
    unittest.main()
