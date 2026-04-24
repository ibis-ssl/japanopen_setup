from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .buffer import RingBuffer
from .multicast import get_field_geometry, start_receivers
from .vision_quality import VisionQualityMonitor

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

WEB_DIR = Path(__file__).parent / "web"
BUFFER_SECONDS = float(os.environ.get("PLAYBACK_BUFFER_SECONDS", "60"))
PUSH_INTERVAL = 0.2

_buf: RingBuffer | None = None
_vision_quality: VisionQualityMonitor | None = None
_window_s: float = 5.0
_freeze: dict = {
    "armed": True,
    "frozen": False,
    "snapshot": None,
    "trigger_event": None,
}
_connections: set[WebSocket] = set()
_frozen_event_ids: set[str] = set()  # POSSIBLE_GOAL でフリーズ済みのイベント ID


async def _on_event(event_dict: dict) -> None:
    kind = event_dict.get("kind", "")
    if kind != "POSSIBLE_GOAL":
        return
    eid = event_dict.get("id", "")
    # await より前にアトミックに確認・確保し、二重フリーズを防ぐ
    if eid and eid in _frozen_event_ids:
        return
    if not (_freeze["armed"] and not _freeze["frozen"]):
        logger.info("POSSIBLE_GOAL skipped: armed=%s frozen=%s id=%s",
                    _freeze["armed"], _freeze["frozen"], eid)
        return
    if eid:
        _frozen_event_ids.add(eid)
    assert _buf is not None
    snapshot = await _buf.snapshot(_window_s)
    geo = get_field_geometry()
    if geo:
        snapshot["geometry"] = geo
    _freeze["frozen"] = True
    _freeze["armed"] = False
    _freeze["snapshot"] = snapshot
    _freeze["trigger_event"] = event_dict
    await _broadcast({"type": "frozen", "trigger_event": event_dict, "snapshot": snapshot})


async def _broadcast(msg: dict) -> None:
    text = json.dumps(msg)
    dead: set[WebSocket] = set()
    for ws in set(_connections):
        try:
            await ws.send_text(text)
        except Exception:
            dead.add(ws)
    _connections.difference_update(dead)


async def _push_loop() -> None:
    while True:
        await asyncio.sleep(PUSH_INTERVAL)
        if _freeze["frozen"] or not _connections:
            continue
        assert _buf is not None
        snapshot = await _buf.snapshot(_window_s)
        geo = get_field_geometry()
        if geo:
            snapshot["geometry"] = geo
        await _broadcast({"type": "live", **snapshot})


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _buf, _vision_quality
    _buf = RingBuffer(BUFFER_SECONDS)
    _vision_quality = VisionQualityMonitor()
    transports = await start_receivers(
        _buf,
        _on_event,
        vision_group=os.environ.get("VISION_ADDRESS", "224.5.23.2"),
        vision_port=int(os.environ.get("VISION_PORT", "10006")),
        tracker_group=os.environ.get("TRACKER_ADDRESS", "224.5.23.2"),
        tracker_port=int(os.environ.get("TRACKER_PORT", "10010")),
        referee_group=os.environ.get("REFEREE_ADDRESS", "224.5.23.1"),
        referee_port=int(os.environ.get("REFEREE_PORT", "10003")),
        vision_quality=_vision_quality,
    )
    push_task = asyncio.create_task(_push_loop())
    yield
    push_task.cancel()
    for t in transports:
        t.close()


app = FastAPI(title="SSL Playback", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


@app.get("/")
async def root() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True}


@app.get("/api/vision-quality")
async def vision_quality() -> dict:
    if _vision_quality is None:
        return {
            "summary": {
                "maxCaptureSkewMs": None,
                "activeSources": 0,
                "activeStreams": 0,
                "totalStreams": 0,
                "receivedPackets": 0,
                "activeAfterSeconds": 2.0,
            },
            "rows": [],
        }
    return await _vision_quality.snapshot()


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    _connections.add(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            mtype = msg.get("type")
            if mtype == "resume":
                _freeze["frozen"] = False
                _freeze["armed"] = True
            elif mtype == "rearm":
                _freeze["armed"] = True
                _freeze["frozen"] = False
            elif mtype == "set_window":
                global _window_s
                val = float(msg.get("seconds", 15))
                _window_s = max(5.0, min(60.0, val))
    except WebSocketDisconnect:
        pass
    finally:
        _connections.discard(ws)
