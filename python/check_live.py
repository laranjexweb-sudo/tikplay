import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tiktools_handler import check_live_status_tiktools


def load_api_key() -> str:
    key_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tiktools_key.txt")
    if os.path.exists(key_file):
        key = open(key_file, encoding="utf-8").read().strip()
        if key:
            return key
    return os.environ.get("TIKTOOL_API_KEY", "")


async def main():
    if len(sys.argv) < 2:
        print("Uso: python check_live.py <usuario>")
        return

    username = sys.argv[1].lstrip("@")
    api_key = load_api_key()
    if not api_key:
        print("Nenhuma API key encontrada. Crie python/tiktools_key.txt ou defina TIKTOOL_API_KEY.")
        return

    print(f"Verificando @{username}...")
    status = await check_live_status_tiktools(username, api_key)

    if status["live"]:
        print(f"\n[OK] @{username} ESTA AO VIVO!")
        print(f"     Room ID: {status.get('room_id')}")
    else:
        print(f"\n[!] @{username} NAO esta ao vivo")
        if status.get("error"):
            print(f"     Erro: {status['error']}")


if __name__ == "__main__":
    asyncio.run(main())
