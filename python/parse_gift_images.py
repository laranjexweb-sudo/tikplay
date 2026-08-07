import re
import json
import shutil
import html as html_mod
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML_PATH = Path(r"F:\Programação\Jogo TikTok\pagina\TikTok gifts list for Brazil.html")
FILES_DIR = HTML_PATH.parent / "TikTok gifts list for Brazil_files"
TAGS_PATH = ROOT / "node" / "gift-tags.json"
MAP_PATH = ROOT / "node" / "public" / "gift-image-map.json"
IMAGES_DIR = ROOT / "node" / "public" / "gift-images"

SKIP_FILES = {"logo-coin.png", "default-gift.jpg"}

PATTERN = re.compile(
    r'<div class="gift"[^>]*data-price="([^"]*)"[^>]*>\s*'
    r'<img src="\./TikTok gifts list for Brazil_files/([^"]+)"[^>]*>\s*'
    r'<p class="gift-name">([^<]+)</p>\s*'
    r'<p class="gift-price">\s*(\d+)\s*',
    re.I,
)


def main():
    html = HTML_PATH.read_text(encoding="utf-8")
    rows = PATTERN.findall(html)
    if not rows:
        raise SystemExit("Nenhum gift encontrado no HTML")

    # Duplicatas: fica a ocorrencia com MAIOR diamond_count
    by_lower = {}
    for bucket, filename, raw_name, diamonds in rows:
        name = html_mod.unescape(raw_name).strip()
        if not name or filename in SKIP_FILES:
            continue
        key = name.lower()
        entry = {
            "name": name,
            "diamond_count": int(diamonds),
            "file": filename,
            "bucket": bucket,
        }
        prev = by_lower.get(key)
        if prev is None or entry["diamond_count"] > prev["diamond_count"]:
            by_lower[key] = entry

    gifts = sorted(by_lower.values(), key=lambda g: (g["diamond_count"], g["name"].lower()))
    tags = [{"name": g["name"], "diamond_count": g["diamond_count"]} for g in gifts]
    image_map = {g["name"]: g["file"] for g in gifts}

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    copied = 0
    missing_files = []
    used_files = set(image_map.values())
    for filename in used_files:
        src = FILES_DIR / filename
        dst = IMAGES_DIR / filename
        if not src.exists():
            missing_files.append(filename)
            continue
        if not dst.exists() or src.stat().st_size != dst.stat().st_size:
            shutil.copy2(src, dst)
            copied += 1

    # remove imagens orfas que nao estao no mapa (opcional: so as antigas nao usadas)
    # nao apaga tudo automaticamente para nao quebrar mid-deploy se mapa falhar

    TAGS_PATH.write_text(json.dumps(tags, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    MAP_PATH.write_text(json.dumps(image_map, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"HTML rows: {len(rows)}")
    print(f"Unique gifts: {len(gifts)}")
    print(f"Diamonds: {gifts[0]['diamond_count']} .. {gifts[-1]['diamond_count']}")
    print(f"Images copied/updated: {copied}")
    print(f"Missing image files: {len(missing_files)}")
    if missing_files[:5]:
        print("  sample:", missing_files[:5])
    print(f"Tags -> {TAGS_PATH}")
    print(f"Map  -> {MAP_PATH}")
    print(f"Imgs -> {IMAGES_DIR}")


if __name__ == "__main__":
    main()
