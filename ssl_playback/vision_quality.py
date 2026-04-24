from __future__ import annotations

import asyncio
import math
import time
from dataclasses import dataclass


def _timestamp(value: float | int | None) -> float | None:
    if value is None:
        return None
    numeric = float(value)
    if numeric <= 0 or not math.isfinite(numeric):
        return None
    return numeric


def _period_ms(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None:
        return None
    delta = current - previous
    if delta <= 0 or not math.isfinite(delta):
        return None
    return delta * 1000.0


@dataclass
class _VisionStream:
    source_ip: str
    camera_id: int
    packet_count: int = 0
    frame_number: int | None = None
    capture_timestamp: float | None = None
    sent_timestamp: float | None = None
    received_at: float = 0.0
    previous_sent_timestamp: float | None = None
    previous_received_at: float | None = None
    sent_period_ms: float | None = None
    receive_period_ms: float | None = None

    def update(
        self,
        *,
        frame_number: int | None,
        capture_timestamp: float | None,
        sent_timestamp: float | None,
        received_at: float,
    ) -> None:
        self.packet_count += 1
        self.frame_number = frame_number
        self.capture_timestamp = capture_timestamp
        self.sent_period_ms = _period_ms(sent_timestamp, self.sent_timestamp)
        self.receive_period_ms = _period_ms(received_at, self.received_at or None)
        self.previous_sent_timestamp = self.sent_timestamp
        self.previous_received_at = self.received_at or None
        self.sent_timestamp = sent_timestamp
        self.received_at = received_at

    def payload(self, now: float, active_after_seconds: float) -> dict:
        age_ms = max(0.0, (now - self.received_at) * 1000.0)
        active = age_ms <= active_after_seconds * 1000.0
        effective_period = self.sent_period_ms
        period_source = "sent"
        if effective_period is None:
            effective_period = self.receive_period_ms
            period_source = "receive" if effective_period is not None else None

        return {
            "sourceIp": self.source_ip,
            "cameraId": self.camera_id,
            "frameNumber": self.frame_number,
            "captureTimestamp": self.capture_timestamp,
            "sentTimestamp": self.sent_timestamp,
            "sentPeriodMs": self.sent_period_ms,
            "receivePeriodMs": self.receive_period_ms,
            "periodMs": effective_period,
            "periodSource": period_source,
            "ageMs": age_ms,
            "packetCount": self.packet_count,
            "active": active,
        }


class VisionQualityMonitor:
    def __init__(
        self,
        *,
        active_after_seconds: float = 2.0,
        retain_after_seconds: float = 30.0,
    ) -> None:
        self._active_after_seconds = active_after_seconds
        self._retain_after_seconds = retain_after_seconds
        self._streams: dict[tuple[str, int], _VisionStream] = {}
        self._lock = asyncio.Lock()

    async def record(
        self,
        *,
        source_ip: str,
        camera_id: int,
        frame_number: int | None,
        capture_timestamp: float | int | None,
        sent_timestamp: float | int | None,
        received_at: float | None = None,
    ) -> None:
        now = time.monotonic() if received_at is None else received_at
        key = (source_ip, int(camera_id))
        capture_ts = _timestamp(capture_timestamp)
        sent_ts = _timestamp(sent_timestamp)

        async with self._lock:
            stream = self._streams.get(key)
            if stream is None:
                stream = _VisionStream(source_ip=source_ip, camera_id=int(camera_id))
                self._streams[key] = stream
            stream.update(
                frame_number=frame_number,
                capture_timestamp=capture_ts,
                sent_timestamp=sent_ts,
                received_at=now,
            )
            self._evict_locked(now)

    async def snapshot(self, *, now: float | None = None) -> dict:
        sample_time = time.monotonic() if now is None else now
        async with self._lock:
            self._evict_locked(sample_time)
            rows = [
                stream.payload(sample_time, self._active_after_seconds)
                for stream in self._streams.values()
            ]

        rows.sort(key=lambda row: (row["sourceIp"], row["cameraId"]))
        active_rows = [row for row in rows if row["active"]]
        capture_values = [
            row["captureTimestamp"]
            for row in active_rows
            if row["captureTimestamp"] is not None
        ]
        max_capture_skew_ms = None
        if capture_values:
            max_capture_skew_ms = (max(capture_values) - min(capture_values)) * 1000.0

        return {
            "summary": {
                "maxCaptureSkewMs": max_capture_skew_ms,
                "activeSources": len({row["sourceIp"] for row in active_rows}),
                "activeStreams": len(active_rows),
                "totalStreams": len(rows),
                "receivedPackets": sum(row["packetCount"] for row in rows),
                "activeAfterSeconds": self._active_after_seconds,
                "serverTime": time.time(),
            },
            "rows": rows,
        }

    def _evict_locked(self, now: float) -> None:
        cutoff = now - self._retain_after_seconds
        stale_keys = [
            key
            for key, stream in self._streams.items()
            if stream.received_at < cutoff
        ]
        for key in stale_keys:
            del self._streams[key]
