"""Pair one timer tab with one phone and relay their messages."""

import asyncio
import base64
import json
import os
import re
import secrets
import time
from dataclasses import dataclass

import qrcode
from aiohttp import WSMsgType, web
from qrcode.image.svg import SvgPathFillImage

PAIR_SECONDS = 120
RECONNECT_SECONDS = 90
MAX_ROOMS = 128
MAX_ROOMS_PER_IP = 8
MAX_CONNECTIONS = MAX_ROOMS * 3
MAX_CONNECTIONS_PER_IP = 16
PROTOCOL_VERSION = 2
COMMAND_TTL_MS = 4000
KEY = re.compile(r"[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{32,64}")
COMMAND_ID = re.compile(r"[A-Za-z0-9-]{1,64}")
COMMANDS = ("start", "pause", "add", "subtract")
PHASES = ("ready", "running", "paused", "finished")
OUTCOMES = ("applied", "expired", "unchanged")
MAX_TIME_MS = 2**53 - 1


def token(room_id):
    return f"{room_id}.{secrets.token_urlsafe(24)}"


def clock_ms():
    return time.monotonic_ns() // 1_000_000


def parse_message(message):
    if message.type != WSMsgType.TEXT:
        return {}
    try:
        data = json.loads(message.data)
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def valid_key(value):
    return isinstance(value, str) and KEY.fullmatch(value)


def valid_id(value):
    return isinstance(value, str) and COMMAND_ID.fullmatch(value)


async def send(socket, message):
    if socket is None or socket.closed:
        return False
    try:
        await socket.send_json(message)
        return True
    except ConnectionError:
        return False


@dataclass
class Room:
    id: str
    host_key: str
    host: web.WebSocketResponse | None
    creator_ip: str | None
    phone: web.WebSocketResponse | None = None
    phone_key: str | None = None
    pair_key: str | None = None
    pair_deadline: float = 0
    host_deadline: float = 0

    def new_code(self):
        self.pair_key = token(self.id)
        self.pair_deadline = time.monotonic() + PAIR_SECONDS


class Relay:
    def __init__(self, origin):
        self.origin = origin.rstrip("/")
        self.rooms = {}
        self.connections = {}

    async def send_code(self, room):
        seconds = max(0, round(room.pair_deadline - time.monotonic()))
        if not room.pair_key or not seconds:
            await send(room.host, {"type": "code", "expiresIn": 0})
            return
        url = f"{self.origin}/timer/remote/?v={PROTOCOL_VERSION}#pair={room.pair_key}"
        qr = qrcode.make(url, image_factory=SvgPathFillImage, box_size=6)
        svg = base64.b64encode(qr.to_string()).decode("ascii")
        await send(room.host, {"type": "code", "qr": svg, "expiresIn": seconds})

    async def end(self, room):
        if self.rooms.get(room.id) is not room:
            return
        del self.rooms[room.id]
        for socket in (room.phone, room.host):
            if socket is not None:
                await socket.close(code=4002, message=b"session ended")

    async def prune(self):
        while True:
            await asyncio.sleep(5)
            now = time.monotonic()
            for room in list(self.rooms.values()):
                if room.host is None and room.host_deadline <= now:
                    await self.end(room)

    def join(self, socket, data, client):
        kind = data.get("type")
        if data.get("version") != PROTOCOL_VERSION:
            return None, None, "upgrade"
        if kind == "create":
            if (len(self.rooms) >= MAX_ROOMS or
                    sum(room.creator_ip == client for room in self.rooms.values()) >= MAX_ROOMS_PER_IP):
                return None, None, "busy"
            room_id = secrets.token_urlsafe(12)
            room = Room(room_id, token(room_id), socket, client)
            room.new_code()
            self.rooms[room_id] = room
            return room, "host", None

        key = data.get("key")
        if not valid_key(key):
            return None, None, "invalid"
        room = self.rooms.get(key.split(".", 1)[0])
        now = time.monotonic()
        if room is None or (room.host is None and room.host_deadline <= now):
            return None, None, "expired"
        if kind == "host" and secrets.compare_digest(key, room.host_key):
            previous, room.host = room.host, socket
            return room, "host", previous
        if kind == "phone" and room.phone_key and secrets.compare_digest(key, room.phone_key):
            previous, room.phone = room.phone, socket
            return room, "phone", previous
        if kind == "pair":
            phone_key = data.get("phoneKey")
            if not valid_key(phone_key) or not phone_key.startswith(room.id + "."):
                return None, None, "invalid"
            if room.phone_key and secrets.compare_digest(phone_key, room.phone_key):
                previous, room.phone = room.phone, socket
                return room, "phone", previous
            if (room.pair_key and now < room.pair_deadline
                    and secrets.compare_digest(key, room.pair_key)):
                room.pair_key = None
                room.phone_key = phone_key
                room.phone = socket
                return room, "phone", None
            return None, None, "expired"
        return None, None, "invalid"

    async def announce(self, room, role, socket):
        if role == "host":
            phone = "connected" if room.phone is not None else "disconnected" if room.phone_key else "waiting"
            await send(socket, {"type": "ready", "key": room.host_key, "phone": phone, "clockMs": clock_ms()})
            if not room.phone_key:
                await self.send_code(room)
            await send(room.phone, {"type": "peer", "connected": True})
        else:
            await send(socket, {"type": "ready", "host": room.host is not None, "clockMs": clock_ms()})
            await send(room.host, {"type": "peer", "connected": True})

    async def relay(self, room, role, data):
        kind = data.get("type")
        if kind == "ping":
            await send(getattr(room, role), {"type": "pong", "clockMs": clock_ms()})
            return True
        if role == "host":
            if kind == "end":
                return False
            if kind == "renew" and not room.phone_key:
                room.new_code()
                await self.send_code(room)
            if kind == "state":
                snapshot = data.get("state")
                if not isinstance(snapshot, dict) or snapshot.get("phase") not in PHASES:
                    return True
                times = (snapshot.get("remainingMs"), snapshot.get("durationMs"))
                if any(type(value) is not int or not 0 <= value <= MAX_TIME_MS for value in times):
                    return True
                if type(snapshot.get("canSubtract")) is not bool:
                    return True
                message = {"type": "state", "state": {
                    "phase": snapshot["phase"], "remainingMs": times[0],
                    "durationMs": times[1], "canSubtract": snapshot["canSubtract"],
                }}
                if valid_id(data.get("ack")) and data.get("outcome") in OUTCOMES:
                    message["ack"] = data["ack"]
                    message["outcome"] = data["outcome"]
                await send(room.phone, message)
        elif kind == "command" and data.get("action") in COMMANDS and valid_id(data.get("id")):
            now = clock_ms()
            expiry = data.get("expiresAt")
            if type(expiry) is not int or not now < expiry <= now + COMMAND_TTL_MS:
                await send(room.phone, {"type": "result", "id": data["id"], "outcome": "expired"})
            elif not await send(room.host, {
                "type": "command", "action": data["action"], "id": data["id"], "expiresAt": expiry,
            }):
                await send(room.phone, {"type": "peer", "connected": False})
        return True

    async def websocket(self, request):
        if request.headers.get("Origin") != self.origin:
            raise web.HTTPForbidden()
        client = request.headers.get("X-Real-IP") or request.remote
        if (len(self.connections) >= MAX_CONNECTIONS or
                sum(ip == client for ip in self.connections.values()) >= MAX_CONNECTIONS_PER_IP):
            raise web.HTTPServiceUnavailable()
        socket = web.WebSocketResponse(timeout=2, heartbeat=15, max_msg_size=2048, compress=False)
        self.connections[socket] = client
        room = role = None
        replaced = None
        try:
            await socket.prepare(request)
            try:
                hello = parse_message(await socket.receive(timeout=8))
            except asyncio.TimeoutError:
                return socket
            room, role, previous = self.join(socket, hello, client)
            if room is None:
                await send(socket, {"type": "error", "code": previous})
                await socket.close(code=4003)
                return socket
            if previous is not None:
                replaced = asyncio.create_task(previous.close(code=4001, message=b"replaced", drain=False))
            await self.announce(room, role, socket)
            window = time.monotonic()
            count = 0
            async for message in socket:
                if getattr(room, role) is not socket or room.id not in self.rooms:
                    break
                now = time.monotonic()
                if now - window >= 1:
                    window, count = now, 0
                count += 1
                if count > 100:
                    await socket.close(code=1008)
                    break
                if not await self.relay(room, role, parse_message(message)):
                    await self.end(room)
                    break
        finally:
            self.connections.pop(socket, None)
            if room is not None and self.rooms.get(room.id) is room and getattr(room, role) is socket:
                setattr(room, role, None)
                if role == "host":
                    room.host_deadline = time.monotonic() + RECONNECT_SECONDS
                    await send(room.phone, {"type": "peer", "connected": False})
                else:
                    await send(room.host, {"type": "peer", "connected": False})
            if replaced is not None:
                await asyncio.gather(replaced, return_exceptions=True)
        return socket


async def health(_request):
    return web.json_response({"ok": True})


def create_app(origin):
    relay = Relay(origin)
    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_get("/timer/remote/ws", relay.websocket)

    async def manage_rooms(_app):
        task = asyncio.create_task(relay.prune())
        yield
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    async def close_connections(_app):
        await asyncio.gather(*(socket.close(code=1001) for socket in list(relay.connections)))

    app.cleanup_ctx.append(manage_rooms)
    app.on_shutdown.append(close_connections)
    return app


if __name__ == "__main__":
    web.run_app(
        create_app(os.environ["TIMER_ORIGIN"]), host="127.0.0.1",
        port=int(os.environ.get("TIMER_PORT", "8765")), access_log=None,
    )
