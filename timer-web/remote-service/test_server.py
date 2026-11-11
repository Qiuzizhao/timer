import base64
import asyncio
import secrets
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import qrcode
from aiohttp import WSServerHandshakeError, WSMsgType
from aiohttp.test_utils import TestClient, TestServer

from server import create_app

ORIGIN = "https://timer.example"
WS = "/timer/remote/ws"


class RelayTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = TestClient(TestServer(create_app(ORIGIN)))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def connect(self, message):
        socket = await self.client.ws_connect(WS, headers={"Origin": ORIGIN})
        await socket.send_json(message)
        return socket

    async def host(self):
        with patch("server.qrcode.make", wraps=qrcode.make) as make_qr:
            socket = await self.connect({"type": "create"})
            ready = await socket.receive_json(timeout=2)
            code = await socket.receive_json(timeout=2)
            url = urlsplit(make_qr.call_args.args[0])
        self.assertEqual(ready["phone"], "waiting")
        self.assertEqual(url.path, "/timer/remote/")
        self.assertIn(b"<svg", base64.b64decode(code["qr"]))
        self.assertGreater(code["expiresIn"], 0)
        return socket, ready["key"], parse_qs(url.fragment)["pair"][0]

    async def test_pair_control_reconnect_and_end(self):
        host, host_key, pairing = await self.host()
        room_id = pairing.split(".")[0]
        phone_key = f"{room_id}.{secrets.token_urlsafe(24)}"
        phone = await self.connect({"type": "pair", "key": pairing, "phoneKey": phone_key})
        self.assertEqual(await phone.receive_json(timeout=2), {"type": "ready", "host": True})
        self.assertEqual(await host.receive_json(timeout=2), {"type": "peer", "connected": True})

        other_key = f"{room_id}.{secrets.token_urlsafe(24)}"
        other = await self.connect({"type": "pair", "key": pairing, "phoneKey": other_key})
        self.assertEqual(await other.receive_json(timeout=2), {"type": "error", "code": "expired"})
        await other.close()

        for action in ("start", "pause", "add", "subtract"):
            command = {"type": "command", "action": action, "id": action + "-1"}
            await phone.send_json(command)
            self.assertEqual(await host.receive_json(timeout=2), command)
            snapshot = {"type": "state", "state": {
                "phase": "paused", "remainingMs": 2000, "durationMs": 5000, "canSubtract": True
            }, "ack": command["id"]}
            await host.send_json(snapshot)
            self.assertEqual(await phone.receive_json(timeout=2), snapshot)

        await phone.close()
        self.assertEqual(await host.receive_json(timeout=2), {"type": "peer", "connected": False})
        phone = await self.connect({"type": "phone", "key": phone_key})
        self.assertEqual(await phone.receive_json(timeout=2), {"type": "ready", "host": True})
        self.assertEqual(await host.receive_json(timeout=2), {"type": "peer", "connected": True})

        await host.close()
        self.assertEqual(await phone.receive_json(timeout=2), {"type": "peer", "connected": False})
        host = await self.connect({"type": "host", "key": host_key})
        self.assertEqual((await host.receive_json(timeout=2))["phone"], "connected")
        self.assertEqual(await phone.receive_json(timeout=2), {"type": "peer", "connected": True})
        await host.send_json({"type": "end"})
        closed = await phone.receive(timeout=2)
        self.assertEqual((closed.type, closed.data), (WSMsgType.CLOSE, 4002))

    async def test_renewed_qr_rejects_previous_code(self):
        host, _, pairing = await self.host()
        await host.send_json({"type": "renew"})
        self.assertEqual((await host.receive_json(timeout=2))["type"], "code")
        room_id = pairing.split(".")[0]
        phone = await self.connect({
            "type": "pair", "key": pairing, "phoneKey": f"{room_id}.{secrets.token_urlsafe(24)}"
        })
        self.assertEqual(await phone.receive_json(timeout=2), {"type": "error", "code": "expired"})

    async def test_expired_qr_cannot_pair(self):
        with patch("server.PAIR_SECONDS", 1):
            _, _, pairing = await self.host()
        await asyncio.sleep(1.05)
        room_id = pairing.split(".")[0]
        phone = await self.connect({
            "type": "pair", "key": pairing, "phoneKey": f"{room_id}.{secrets.token_urlsafe(24)}"
        })
        self.assertEqual(await phone.receive_json(timeout=2), {"type": "error", "code": "expired"})

    async def test_rejects_other_origin(self):
        with self.assertRaises(WSServerHandshakeError) as error:
            await self.client.ws_connect(WS, headers={"Origin": "https://other.example"})
        self.assertEqual(error.exception.status, 403)
