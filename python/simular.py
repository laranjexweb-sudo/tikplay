import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from game import JogoContexto
from web_client import WebClient
from similarity import rank_guess


async def main():
    web = WebClient("ws://localhost:3100")
    await web.connect()
    print("Conectado ao servidor Node.js")

    default_gifts = ["Rose", "Lion", "TikTok", "GG"]
    game = JogoContexto()
    secret = game.start_new_game(hint_gifts=default_gifts)
    print(f"\nPalavra secreta: {secret.upper()}")
    print(f"Dicas disponiveis via gifts: {', '.join(game.hint_gifts)}\n")

    await web.send("game_start", {
        "game_id": game.game_id,
        "secret_length": len(secret),
        "hint_gifts": game.hint_gifts,
    })

    print("Digite palpites no terminal ('gift' para simular presente, 'sair' para encerrar):\n")

    while not game.finished:
        cmd = input("> ").strip()
        if not cmd:
            continue
        if cmd.lower() == "sair":
            break
        if cmd.lower() == "gift":
            r = game.process_gift("viewer1", "Rose", 1)
            if r and r["hint"]:
                await web.send("gift_hint", {
                    "user": r["user"],
                    "nickname": "Viewer 1",
                    "avatar": "https://via.placeholder.com/50",
                    "gift": r["gift"],
                    "hint_word": r["hint"],
                    "hint_rank": r["rank"],
                })
                print(f"  Dica revelada: {r['hint']} (#{r['rank']})")
            else:
                print("  Nenhuma dica nova disponivel")
            continue

        result = game.process_guess("viewer", cmd.lower())
        if result is None:
            print("  Palavra ja foi chutada")
            continue

        rank = result["rank"]
        if rank == 1:
            color = "green"
        elif rank <= 50:
            color = "lime"
        elif rank <= 300:
            color = "yellow"
        elif rank <= 1000:
            color = "orange"
        else:
            color = "red"

        await web.send("guess", {
            "user": "viewer",
            "nickname": "Viewer",
            "avatar": "https://via.placeholder.com/50",
            "word": result["word"],
            "rank": rank,
            "color": color,
        })
        print(f"  Rank #{rank}")

        if game.finished:
            game.save_result("viewer", "Viewer", "", len(game.guesses))
            await web.send("game_over", {
                "winner": "viewer",
                "nickname": "Viewer",
                "avatar": "",
                "secret_word": secret,
                "total_guesses": len(game.guesses),
            })
            print(f"\nVITORIA! Palavra: {secret.upper()}")
            print(f"Total de palpites: {len(game.guesses)}")

    await web.close()

if __name__ == "__main__":
    asyncio.run(main())
