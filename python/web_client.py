import json
import websockets

class WebClient:
    def __init__(self, uri="ws://localhost:3100"):
        self.uri = uri
        self.ws = None

    async def connect(self):
        self.ws = await websockets.connect(self.uri)

    async def send(self, action_type, data=None):
        payload = {"type": action_type}
        if data:
            payload.update(data)
        if self.ws:
            await self.ws.send(json.dumps(payload))

    async def close(self):
        if self.ws:
            await self.ws.close()
