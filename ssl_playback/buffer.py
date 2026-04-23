from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass


@dataclass
class TrackerSample:
    t: float
    x: float
    y: float
    speed: float


@dataclass
class VisionSpeedSample:
    t: float
    camera_id: int
    speed: float


@dataclass
class EventSample:
    t: float
    kind: str
    origin: list[str]


_MIN_TRACKER_INTERVAL = 1 / 30  # cap at 30 Hz
_MIN_VISION_INTERVAL = 1 / 30


class RingBuffer:
    def __init__(self, max_seconds: float = 60.0) -> None:
        self._max_s = max_seconds
        self._tracker: deque[TrackerSample] = deque()
        self._vision: deque[VisionSpeedSample] = deque()
        self._events: deque[EventSample] = deque()
        self._lock = asyncio.Lock()
        self._last_tracker_t: float = 0.0
        self._last_vision_t: float = 0.0

    async def add_tracker(self, sample: TrackerSample) -> None:
        if sample.t - self._last_tracker_t < _MIN_TRACKER_INTERVAL:
            return
        async with self._lock:
            self._last_tracker_t = sample.t
            self._tracker.append(sample)
            self._evict(self._tracker)

    async def add_vision(self, sample: VisionSpeedSample) -> None:
        if sample.t - self._last_vision_t < _MIN_VISION_INTERVAL:
            return
        async with self._lock:
            self._last_vision_t = sample.t
            self._vision.append(sample)
            self._evict(self._vision)

    async def add_event(self, sample: EventSample) -> None:
        async with self._lock:
            self._events.append(sample)
            self._evict(self._events)

    def _evict(self, dq: deque) -> None:
        cutoff = time.monotonic() - self._max_s
        while dq and dq[0].t < cutoff:
            dq.popleft()

    async def snapshot(self, window_s: float) -> dict:
        now = time.monotonic()
        cutoff = now - window_s
        async with self._lock:
            tracker = [
                {"dt": s.t - now, "x": s.x, "y": s.y, "speed": s.speed}
                for s in self._tracker
                if s.t >= cutoff
            ]
            vision = [
                {"dt": s.t - now, "camera": s.camera_id, "speed": s.speed}
                for s in self._vision
                if s.t >= cutoff
            ]
            events = [
                {"dt": s.t - now, "kind": s.kind, "origin": s.origin}
                for s in self._events
                if s.t >= cutoff
            ]
        return {
            "tracker": tracker,
            "vision": vision,
            "events": events,
            "t_ref": now,
            "window_s": window_s,
        }
