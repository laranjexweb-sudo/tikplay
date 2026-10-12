"""Sincronizador do catálogo de presentes do TikTok → tabela `gifts` (node/data.db).

Uso standalone:
    python sync_gifts.py --once [--user @usuario] [--no-download] [--seed]

Fontes (em ordem):
  1. Rota global `GET /gift/list/` via TikTokWebClient (não exige live).
  2. Fallback: conecta a uma LIVE com TikTokLiveClient(fetch_gift_info=True).

A escrita é feita aqui (único escritor do catálogo).
"""
import asyncio
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gifts_catalog as catalog  # noqa: E402

PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "node", "public")
IMAGES_DIR = os.path.join(PUBLIC_DIR, "gift-images")

_EXT_BY_TYPE = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _log_default(msg):
    print(msg, flush=True)


def _first_url(obj):
    """Extrai a primeira URL de estruturas tipo {url_list:[...]} / {urls:[...]}."""
    if not obj:
        return ""
    if isinstance(obj, str):
        return obj
    for key in ("url_list", "urls", "urlList"):
        v = obj.get(key) if isinstance(obj, dict) else getattr(obj, key, None)
        if v:
            if isinstance(v, (list, tuple)) and v:
                return str(v[0])
            return str(v)
    return ""


def normalize_gift(g):
    """Normaliza um gift bruto do TikTok para o formato interno."""
    if not isinstance(g, dict):
        return None
    gid = g.get("id") or g.get("gift_id") or g.get("giftId")
    name = str(g.get("name") or g.get("gift_name") or "").strip()
    if not gid or not name:
        return None
    diamond = g.get("diamond_count")
    if diamond is None:
        diamond = g.get("diamondCount") or g.get("diamond")
    try:
        diamond = int(diamond or 0)
    except (TypeError, ValueError):
        diamond = 0
    icon = _first_url(g.get("image")) or _first_url(g.get("icon")) or _first_url(g.get("gift_image"))
    return {
        "id": str(gid).strip(),
        "name": name,
        "name_pt": None,
        "diamond_count": diamond,
        "icon_url": icon,
        "icon_local": "",
    }


def extract_gift_list(data):
    """Aceita múltiplas formas do payload e devolve a lista de gifts brutos."""
    if not data:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("gifts", "gift_list", "giftList", "list"):
            v = data.get(key)
            if isinstance(v, list):
                return v
    return []


async def fetch_gift_info(username=None, log=_log_default):
    """Retorna lista de gifts normalizados. Lança RuntimeError se nada for obtido."""
    raw = None
    # 1) Rota global (sem live)
    try:
        from TikTokLive.client.web.web_client import TikTokWebClient
        web = TikTokWebClient()
        data = await web.fetch_gift_list()
        raw = extract_gift_list(data)
        if raw:
            log(f"[sync_gifts] rota global /gift/list/: {len(raw)} gifts")
    except Exception as exc:
        log(f"[sync_gifts] rota global falhou ({type(exc).__name__}: {exc}); tentando via LIVE...")
        raw = None

    # 2) Fallback: conectar a uma LIVE e ler gift_info
    if not raw and username:
        try:
            from TikTokLive import TikTokLiveClient
            client = TikTokLiveClient(unique_id=str(username).lstrip("@"))
            await client.start(fetch_gift_info=True, process_connect_events=False)
            info = client.gift_info
            try:
                await client.disconnect()
            except Exception:
                pass
            raw = extract_gift_list(info)
            if raw:
                log(f"[sync_gifts] gift_info via LIVE @{username}: {len(raw)} gifts")
        except Exception as exc:
            log(f"[sync_gifts] fetch via LIVE falhou ({type(exc).__name__}: {exc})")

    if not raw:
        raise RuntimeError("Não foi possível obter a lista de gifts (rota global e LIVE falharam)")

    rows = []
    for g in raw:
        item = normalize_gift(g)
        if item:
            rows.append(item)
    if not rows:
        raise RuntimeError("Lista de gifts recebida vazia após normalização")
    return rows


def _ext_from(url, content_type):
    if content_type:
        ext = _EXT_BY_TYPE.get(str(content_type).split(";")[0].strip().lower())
        if ext:
            return ext
    base = str(url).split("?")[0]
    ext = os.path.splitext(base)[1].lower()
    if ext in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        return ".jpg" if ext == ".jpeg" else ext
    return ".webp"


def download_icons(rows, log=_log_default):
    """Baixa ícones para node/public/gift-images/<id>.<ext> e preenche icon_local."""
    try:
        import httpx
    except Exception as exc:
        log(f"[sync_gifts] httpx indisponível, pulando ícones ({exc})")
        return 0
    os.makedirs(IMAGES_DIR, exist_ok=True)
    count = 0
    with httpx.Client(timeout=20.0, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as http:
        for r in rows:
            url = r.get("icon_url")
            if not url:
                continue
            gid = r.get("id")
            # reaproveita arquivo local já baixado para este id
            existing = None
            for ext in (".webp", ".png", ".jpg", ".gif"):
                if os.path.exists(os.path.join(IMAGES_DIR, f"{gid}{ext}")):
                    existing = f"{gid}{ext}"
                    break
            if existing:
                r["icon_local"] = existing
                continue
            try:
                resp = http.get(url)
                resp.raise_for_status()
                ext = _ext_from(url, resp.headers.get("content-type"))
                filename = f"{gid}{ext}"
                with open(os.path.join(IMAGES_DIR, filename), "wb") as fh:
                    fh.write(resp.content)
                r["icon_local"] = filename
                count += 1
            except Exception as exc:
                log(f"[sync_gifts] ícone {gid} falhou: {type(exc).__name__}: {exc}")
    return count


def apply_sync(rows, log=_log_default):
    """Faz upsert, marca ausentes como indisponíveis, regenera derivados e meta."""
    seen_ids = [r["id"] for r in rows if r.get("id")]
    res = catalog.upsert_gifts(rows)
    unavailable = catalog.mark_missing_unavailable(seen_ids)
    catalog.regenerate_derived_files()
    result = {
        "fetched": len(rows),
        "inserted": res.get("inserted", 0),
        "updated": res.get("updated", 0),
        "unavailable": unavailable,
        "synced_at": catalog.now_ts(),
    }
    catalog.set_meta(last_sync=result["synced_at"], last_sync_result=str(result))
    log(f"[sync_gifts] ok: {result}")
    return result


async def sync(username=None, download=True, log=_log_default, seed=True):
    """Executa uma sincronização completa e retorna o resultado (dict)."""
    catalog.ensure_schema()
    if seed:
        seed_res = catalog.seed_from_files()
        if seed_res.get("inserted"):
            log(f"[sync_gifts] seed inicial: {seed_res['inserted']} gifts")
    rows = await fetch_gift_info(username=username, log=log)
    if download:
        got = download_icons(rows, log=log)
        log(f"[sync_gifts] ícones baixados: {got}")
    return apply_sync(rows, log=log)


def main():
    ap = argparse.ArgumentParser(description="Sincroniza o catálogo de gifts do TikTok.")
    ap.add_argument("--once", action="store_true", help="executa uma sincronização e sai")
    ap.add_argument("--user", default="", help="usuário (@handle) para fallback via LIVE")
    ap.add_argument("--no-download", action="store_true", help="não baixar ícones")
    ap.add_argument("--seed", action="store_true", help="apenas faz o seed dos arquivos legados")
    args = ap.parse_args()

    catalog.ensure_schema()
    if args.seed and not args.once:
        print(catalog.seed_from_files())
        return

    try:
        result = asyncio.run(sync(
            username=args.user or None,
            download=not args.no_download,
            seed=True,
        ))
        print(result)
    except Exception as exc:
        print(f"[sync_gifts] ERRO: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
