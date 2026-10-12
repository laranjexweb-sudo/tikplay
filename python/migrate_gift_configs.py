"""Migração one-shot das configs de gifts (nomes → IDs) — execução única.

Converte referências por nome (EN/PT) para o ID canônico do TikTok quando o catálogo
reconhece o gift E a linha já possui `id` sincronizado. Quando não há ID (ex.: seed
ainda não sincronizado), preserva o valor original (fallback por nome continua ativo).

Configs cobertas (tabelas no node/data.db):
  - tenant_gift_config: hint_gifts, riddle_gifts, size_gift, letter_gift,
    tres_gifts (size/letter/ticket), sound_alerts (chaves)
  - duelo_config: gifts[] (preenche gift_id vazio), settings.{main_gifts, extra_gifts,
    supporters, special_attacks} (preenche gift_id vazio)

Uso:
  python migrate_gift_configs.py --dry-run    # mostra o que mudaria (padrão)
  python migrate_gift_configs.py --apply      # aplica e regenera os derivados
"""
import argparse
import copy
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gifts_catalog as catalog  # noqa: E402


def _json_loads(raw, fallback):
    try:
        return json.loads(raw) if raw else fallback
    except Exception:
        return fallback


class Migrator:
    def __init__(self, dry_run=True):
        self.dry_run = dry_run
        self.cat = catalog.GiftCatalog()
        self.rows_changed = 0

    def _resolve(self, ref):
        """Retorna o ID canônico quando o catálogo reconhece o gift e tem id; senão o original."""
        ref = str(ref or "").strip()
        if not ref:
            return ref
        row = self.cat.resolve_ref(ref)
        if row and row.get("id"):
            return str(row["id"])
        return ref

    def _map_list(self, arr):
        return [self._resolve(x) for x in (arr or [])]

    def _log_col(self, where, key, before, after):
        if before != after:
            print(f"  [migra] {where}.{key}: {json.dumps(before)[:70]} -> {json.dumps(after)[:70]}")

    def migrate_tenant_gift_config(self, conn):
        rows = conn.execute(
            "SELECT tenant_id, hint_gifts, riddle_gifts, size_gift, letter_gift, tres_gifts, sound_alerts "
            "FROM tenant_gift_config"
        ).fetchall()
        for r in rows:
            tid = r["tenant_id"]
            hint = _json_loads(r["hint_gifts"], [])
            riddle = _json_loads(r["riddle_gifts"], [])
            new_hint = self._map_list(hint)
            new_riddle = self._map_list(riddle)
            new_size = self._resolve(r["size_gift"])
            new_letter = self._resolve(r["letter_gift"])

            tres_raw = _json_loads(r["tres_gifts"], {})
            new_tres = dict(tres_raw)
            for k in ("size", "letter", "ticket"):
                if k in new_tres:
                    new_tres[k] = self._resolve(new_tres[k])

            alerts_raw = _json_loads(r["sound_alerts"], {})
            new_alerts = {self._resolve(k): val for k, val in (alerts_raw or {}).items()}

            if (
                new_hint == hint and new_riddle == riddle
                and new_size == (r["size_gift"] or "") and new_letter == (r["letter_gift"] or "")
                and new_tres == tres_raw and new_alerts == (alerts_raw or {})
            ):
                continue
            self.rows_changed += 1
            self._log_col(f"tenant {tid}", "config", {"hint": hint, "tres": tres_raw}, {"hint": new_hint, "tres": new_tres})
            if self.dry_run:
                continue
            conn.execute(
                "UPDATE tenant_gift_config SET hint_gifts=?, riddle_gifts=?, size_gift=?, letter_gift=?, tres_gifts=?, sound_alerts=? WHERE tenant_id=?",
                (
                    json.dumps(new_hint, ensure_ascii=False),
                    json.dumps(new_riddle, ensure_ascii=False),
                    str(new_size or ""),
                    str(new_letter or ""),
                    json.dumps(new_tres, ensure_ascii=False),
                    json.dumps(new_alerts, ensure_ascii=False),
                    tid,
                ),
            )

    def _fill_gift_ids(self, node):
        """Shape-agnóstico: percorre listas/dicts e preenche gift_id vazio apenas quando
        o catálogo resolve o gift_name para um ID real (não preenche com o próprio nome)."""
        if isinstance(node, dict):
            if "gift_name" in node:
                name = str(node.get("gift_name") or "").strip()
                gid = str(node.get("gift_id") or "").strip()
                res = self._resolve(name)
                # normaliza gift_id textual (ex.: duelo "White Rose") para o id real do TikTok
                if res and res != name and (not gid or gid == name):
                    node["gift_id"] = res
                    return True
                return False
            changed = False
            for v in list(node.values()):
                if self._fill_gift_ids(v):
                    changed = True
            return changed
        if isinstance(node, list):
            changed = False
            for v in node:
                if isinstance(v, (dict, list)) and self._fill_gift_ids(v):
                    changed = True
            return changed
        return False

    def migrate_duelo_config(self, conn):
        rows = conn.execute("SELECT tenant_id, gifts, settings FROM duelo_config").fetchall()
        for r in rows:
            tid = r["tenant_id"]
            gifts = _json_loads(r["gifts"], [])
            settings = _json_loads(r["settings"], {})

            new_gifts = copy.deepcopy(gifts or [])
            new_settings = copy.deepcopy(settings or {})
            g_changed = self._fill_gift_ids(new_gifts)
            s_changed = self._fill_gift_ids(new_settings)

            if not g_changed and not s_changed:
                continue
            self.rows_changed += 1
            self._log_col(f"duelo tenant {tid}", "gifts/settings", {"gifts": len(gifts or [])}, {"gifts": len(new_gifts or [])})
            if self.dry_run:
                continue
            conn.execute(
                "UPDATE duelo_config SET gifts=?, settings=? WHERE tenant_id=?",
                (json.dumps(new_gifts, ensure_ascii=False), json.dumps(new_settings, ensure_ascii=False), tid),
            )


def main():
    ap = argparse.ArgumentParser(description="Migra nomes de gifts para IDs nas configs (one-shot).")
    ap.add_argument("--dry-run", action="store_true", help="apenas mostra o que mudaria (padrão)")
    ap.add_argument("--apply", action="store_true", help="aplica e regenera os derivados")
    args = ap.parse_args()
    dry_run = not args.apply

    catalog.ensure_schema()
    m = Migrator(dry_run=dry_run)
    conn = catalog._conn()
    conn.row_factory = sqlite3.Row
    try:
        m.migrate_tenant_gift_config(conn)
        m.migrate_duelo_config(conn)
        if not dry_run and m.rows_changed:
            conn.commit()
    finally:
        conn.close()

    print(f"[migra] {'DRY-RUN' if dry_run else 'Aplicado'}: {m.rows_changed} configs a alterar/alteradas")
    if not dry_run:
        catalog.regenerate_derived_files()
        print("[migra] derivados regenerados (gift-tags.json / gift-image-map.json)")


if __name__ == "__main__":
    main()