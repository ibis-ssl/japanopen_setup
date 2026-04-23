from __future__ import annotations

import asyncio
import logging
import math
import socket
import struct
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .buffer import EventSample, RingBuffer, TrackerSample, VisionSpeedSample

logger = logging.getLogger(__name__)

OnEventCallback = Callable[[dict], Awaitable[None]]

_vision_last: dict[int, tuple[float, float, float]] = {}
_seen_event_ids: set[str] = set()
_unix_offset: float | None = None
_referee_initialized: bool = False
_field_geometry: dict | None = None


def get_field_geometry() -> dict | None:
    return _field_geometry


def _parse_geometry(geom) -> None:
    global _field_geometry
    field = geom.field
    goal_x_mm = field.field_length / 2.0

    defense_len = 0.0
    defense_wid = 0.0
    for line in field.field_lines:
        if line.name == "LeftPenaltyStretch":
            defense_len = (goal_x_mm - abs(line.p1.x)) / 1000.0
            defense_wid = abs(line.p2.y - line.p1.y) / 1000.0
            break

    center_radius = 0.5
    for arc in field.field_arcs:
        if arc.name == "CenterCircle":
            center_radius = arc.radius / 1000.0
            break

    _field_geometry = {
        "field_len": field.field_length / 1000.0,
        "field_wid": field.field_width / 1000.0,
        "goal_wid": field.goal_width / 1000.0,
        "goal_depth": field.goal_depth / 1000.0,
        "defense_len": defense_len,
        "defense_wid": defense_wid,
        "center_radius": center_radius,
    }


def _get_unix_offset() -> float:
    global _unix_offset
    if _unix_offset is None:
        _unix_offset = time.time() - time.monotonic()
    return _unix_offset


def _unix_to_mono(unix_ts: float) -> float:
    return unix_ts - _get_unix_offset()


def _create_socket(group: str, port: int) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    except AttributeError:
        pass
    sock.bind(("", port))
    mreq = struct.pack("4sL", socket.inet_aton(group), socket.INADDR_ANY)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
    sock.setblocking(False)
    return sock


class _TrackerProtocol(asyncio.DatagramProtocol):
    def __init__(self, buf: RingBuffer) -> None:
        self._buf = buf
        self._count = 0

    def datagram_received(self, data: bytes, addr: Any) -> None:
        self._count += 1
        if self._count % 100 == 1:
            logger.info("tracker: received %d datagrams (last from %s, len=%d)", self._count, addr, len(data))
        asyncio.create_task(self._process(data))

    async def _process(self, data: bytes) -> None:
        try:
            from tracker.ssl_vision_wrapper_tracked_pb2 import TrackerWrapperPacket

            pkt = TrackerWrapperPacket()
            pkt.ParseFromString(data)
            if not pkt.HasField("tracked_frame"):
                return
            frame = pkt.tracked_frame
            if not frame.balls:
                return
            ball = frame.balls[0]
            pos = ball.pos
            t = time.monotonic()
            speed = 0.0
            if ball.HasField("vel"):
                v = ball.vel
                speed = math.sqrt(v.x**2 + v.y**2 + v.z**2)
            await self._buf.add_tracker(TrackerSample(t=t, x=pos.x, y=pos.y, speed=speed))
        except Exception as exc:
            logger.warning("tracker parse error: %s", exc)


class _VisionProtocol(asyncio.DatagramProtocol):
    def __init__(self, buf: RingBuffer) -> None:
        self._buf = buf
        self._count = 0

    def datagram_received(self, data: bytes, addr: Any) -> None:
        self._count += 1
        if self._count % 100 == 1:
            logger.info("vision: received %d datagrams (last from %s, len=%d)", self._count, addr, len(data))
        asyncio.create_task(self._process(data))

    async def _process(self, data: bytes) -> None:
        try:
            from vision.ssl_vision_wrapper_pb2 import SSL_WrapperPacket

            pkt = SSL_WrapperPacket()
            pkt.ParseFromString(data)
            if pkt.HasField("geometry"):
                _parse_geometry(pkt.geometry)
            if not pkt.HasField("detection"):
                return
            det = pkt.detection
            if not det.balls:
                return
            best = max(det.balls, key=lambda b: b.confidence)
            cam = det.camera_id
            t_cap = det.t_capture
            x_m = best.x / 1000.0
            y_m = best.y / 1000.0
            t_now = time.monotonic()
            prev = _vision_last.get(cam)
            if prev is not None:
                t_prev, x_prev, y_prev = prev
                dt = t_cap - t_prev
                if 0 < dt <= 0.5:
                    dx = x_m - x_prev
                    dy = y_m - y_prev
                    speed = math.sqrt(dx**2 + dy**2) / dt
                    await self._buf.add_vision(
                        VisionSpeedSample(t=t_now, camera_id=cam, speed=speed)
                    )
            _vision_last[cam] = (t_cap, x_m, y_m)
        except Exception as exc:
            logger.warning("vision parse error: %s", exc)


class _RefereeProtocol(asyncio.DatagramProtocol):
    def __init__(self, buf: RingBuffer, on_event: OnEventCallback) -> None:
        self._buf = buf
        self._on_event = on_event

    def datagram_received(self, data: bytes, addr: Any) -> None:
        asyncio.create_task(self._process(data))

    async def _process(self, data: bytes) -> None:
        try:
            from state.ssl_gc_referee_message_pb2 import Referee
            from state.ssl_gc_game_event_pb2 import GameEvent

            global _referee_initialized
            pkt = Referee()
            pkt.ParseFromString(data)
            warmup = not _referee_initialized
            _referee_initialized = True

            for game_event in pkt.game_events:
                eid = game_event.id or None
                if eid and eid in _seen_event_ids:
                    continue
                if warmup:
                    # 初回パケットの既存イベント: 永続的に抑制して callback しない
                    if eid:
                        _seen_event_ids.add(eid)
                    continue
                # 非ウォームアップ: _seen_event_ids への追加は callback 完了後に行う
                # (await 中断中に状態変化が起きても ID が永続抑制されないようにする)
                try:
                    kind = GameEvent.Type.Name(game_event.type)
                except ValueError:
                    kind = f"TYPE_{game_event.type}"
                origin = list(game_event.origin)
                t_mono = time.monotonic()
                sample = EventSample(t=t_mono, kind=kind, origin=origin)
                await self._buf.add_event(sample)
                event_dict = {"kind": kind, "origin": origin, "dt": 0.0, "id": eid or ""}
                await self._on_event(event_dict)
                if eid:
                    _seen_event_ids.add(eid)
        except Exception as exc:
            logger.warning("referee parse error: %s", exc)


async def start_receivers(
    buf: RingBuffer,
    on_event: OnEventCallback,
    *,
    vision_group: str,
    vision_port: int,
    tracker_group: str,
    tracker_port: int,
    referee_group: str,
    referee_port: int,
) -> list[asyncio.BaseTransport]:
    loop = asyncio.get_running_loop()
    transports: list[asyncio.BaseTransport] = []

    for group, port, factory in [
        (vision_group, vision_port, lambda: _VisionProtocol(buf)),
        (tracker_group, tracker_port, lambda: _TrackerProtocol(buf)),
        (referee_group, referee_port, lambda: _RefereeProtocol(buf, on_event)),
    ]:
        try:
            sock = _create_socket(group, port)
            transport, _ = await loop.create_datagram_endpoint(factory, sock=sock)
            transports.append(transport)
            logger.info("listening on %s:%d", group, port)
        except Exception as exc:
            logger.warning("could not bind %s:%d — %s", group, port, exc)

    return transports
