import base64
import asyncio
import secrets
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import qrcode
from aiohttp import WSServerHandshakeError, WSMsgType
from aiohttp.test_utils import TestClient, TestServer

from server import MAX_ROOMS_PER_IP, PROTOCOL_VERSION, clock_ms, create_app

ORIGIN = "https://timer.example"
WS = "/timer/remote/ws"


class RelayTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = TestClient(TestServer(create_app(ORIGIN)))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def connect(self, message, ip=None):
        headers = {"Origin": ORIGIN}
        if ip:
            headers["X-Real-IP"] = ip
        socket = await self.client.ws_connect(WS, headers=headers)
        await socket.send_json({"version": PROTOCOL_VERSION, **message})
        return socket

    async def ready(self, socket, **expected):
        message = await socket.receive_json(timeout=2)
        self.assertEqual(message.pop("type"), "ready")
        self.assertIs(type(message.pop("clockMs")), int)
        for name, value in expected.items():
            self.assertEqual(message[name], value)
        return message

    async def host(self):
        with patch("server.qrcode.make", wraps=qrcode.make) as make_qr:
            socket = await self.connect({"type": "create"})
            ready = await self.ready(socket, phone="waiting")
            code = await socket.receive_json(timeout=2)
            url = urlsplit(make_qr.call_args.args[0])
        self.assertEqual(url.path, "/timer/remote/")
        self.assertIn(b"<svg", base64.b64decode(code["qr"]))
        self.assertGreater(code["expiresIn"], 0)
        return socket, ready["key"], parse_qs(url.fragment)["pair"][0]

    async def test_pair_control_reconnect_and_end(self):
        host, host_key, pairing = await self.host()
        room_id = pairing.split(".")[0]
        phone_key = f"{room_id}.{secrets.token_urlsafe(24)}"
        phone = await self.connect({"type": "pair", "key": pairing, "phoneKey": phone_key})
        await self.ready(phone, host=True)
        self.assertEqual(await host.receive_json(timeout=2), {"type": "peer", "connected": True})

        other_key = f"{room_id}.{secrets.token_urlsafe(24)}"
        other = await self.connect({"type": "pair", "key": pairing, "phoneKey": other_key})
        self.assertEqual(await other.receive_json(timeout=2), {"type": "error", "code": "expired"})
        await other.close()

        for action in ("start", "pause", "add", "subtract"):
            command = {"type": "command", "action": action, "id": action + "-1", "expiresAt": clock_ms() + 3900}
            await phone.send_json(command)
            self.assertEqual(await host.receive_json(timeout=2), command)
            snapshot = {"type": "state", "state": {
                "phase": "paused", "remainingMs": 2000, "durationMs": 5000, "canSubtract": True
            }, "ack": command["id"], "outcome": "applied"}
            await host.send_json(snapshot)
            self.assertEqual(await phone.receive_json(timeout=2), snapshot)

        await phone.close()
        self.assertEqual(await host.receive_json(timeout=2), {"type": "peer", "connected": False})
        phone = await self.connect({"type": "phone", "key": phone_key})
        await self.ready(phone, host=True)
        self.assertEqual(await host.receive_json(timeout=2), {"type": "peer", "connected": True})

        await host.close()
        self.assertEqual(await phone.receive_json(timeout=2), {"type": "peer", "connected": False})
        host = await self.connect({"type": "host", "key": host_key})
        await self.ready(host, phone="connected")
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

    async def test_pair_waits_for_disconnected_host(self):
        host, host_key, pairing = await self.host()
        await host.close()
        phone = await self.connect({
            "type": "pair", "key": pairing,
            "phoneKey": f"{pairing.split('.')[0]}.{secrets.token_urlsafe(24)}",
        })
        await self.ready(phone, host=False)
        host = await self.connect({"type": "host", "key": host_key})
        await self.ready(host, phone="connected")
        self.assertEqual(await phone.receive_json(timeout=2), {"type": "peer", "connected": True})

    async def test_disconnected_rooms_still_count_against_ip_quota(self):
        for _ in range(MAX_ROOMS_PER_IP):
            host = await self.connect({"type": "create"}, ip="192.0.2.1")
            await self.ready(host, phone="waiting")
            await host.receive_json(timeout=2)
            await host.close()
        blocked = await self.connect({"type": "create"}, ip="192.0.2.1")
        self.assertEqual(await blocked.receive_json(timeout=2), {"type": "error", "code": "busy"})
        other = await self.connect({"type": "create"}, ip="192.0.2.2")
        await self.ready(other, phone="waiting")

    async def test_expired_commands_are_not_relayed(self):
        host, _, pairing = await self.host()
        phone = await self.connect({
            "type": "pair", "key": pairing,
            "phoneKey": f"{pairing.split('.')[0]}.{secrets.token_urlsafe(24)}",
        })
        await self.ready(phone, host=True)
        await host.receive_json(timeout=2)
        await phone.send_json({"type": "ping"})
        pong = await phone.receive_json(timeout=2)
        self.assertEqual(pong["type"], "pong")
        self.assertIs(type(pong["clockMs"]), int)
        for expires_at in (clock_ms() - 1, clock_ms() + 5000, None):
            await phone.send_json({"type": "command", "action": "add", "id": "old", "expiresAt": expires_at})
            self.assertEqual(await phone.receive_json(timeout=2), {
                "type": "result", "id": "old", "outcome": "expired",
            })
        await host.send_json({"type": "ping"})
        self.assertEqual((await host.receive_json(timeout=2))["type"], "pong")

    async def test_incompatible_clients_are_asked_to_upgrade(self):
        socket = await self.connect({"type": "create", "version": 1})
        self.assertEqual(await socket.receive_json(timeout=2), {"type": "error", "code": "upgrade"})
