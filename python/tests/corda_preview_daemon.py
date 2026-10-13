"""Fixture de integração: motor real, sem conectar ao TikTok nem carregar NLP."""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from corda import CordaEngine


async def main():
    queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    games = {}

    def emit(tid, kind, payload):
        print(json.dumps({"tenant_id": tid, "type": "game", "msg": {"type": kind, **payload}}), flush=True)

    async def commands():
        while True:
            cmd = await queue.get()
            tid = cmd.get("tenant_id", 1)
            if tid not in games:
                games[tid] = CordaEngine(lambda kind, data, tenant=tid: emit(tenant, kind, data))
            game = games[tid]
            action = cmd.get("cmd")
            if action in ("corda_start", "corda_new_match"):
                game.start(cmd.get("config"))
            elif action == "corda_stop":
                game.stop()
            elif action == "corda_test":
                game.add_force(cmd.get("side"), cmd.get("force"), "test")

    # stdin em thread; toda mutação do motor permanece no event loop.
    import threading
    def read():
        for line in sys.stdin:
            loop.call_soon_threadsafe(queue.put_nowait, json.loads(line))
    threading.Thread(target=read, daemon=True).start()
    task = asyncio.create_task(commands())
    try:
        while True:
            for game in games.values():
                game.tick()
            await asyncio.sleep(.1)
    finally:
        task.cancel()


asyncio.run(main())
