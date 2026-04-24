from __future__ import annotations

import unittest

from ssl_playback.vision_quality import VisionQualityMonitor


class VisionQualityMonitorTest(unittest.IsolatedAsyncioTestCase):
    async def test_records_periods_for_source_camera_stream(self) -> None:
        monitor = VisionQualityMonitor(active_after_seconds=2.0, retain_after_seconds=30.0)

        await monitor.record(
            source_ip="192.0.2.10",
            camera_id=3,
            frame_number=100,
            capture_timestamp=1000.000,
            sent_timestamp=1000.010,
            received_at=20.000,
        )
        await monitor.record(
            source_ip="192.0.2.10",
            camera_id=3,
            frame_number=101,
            capture_timestamp=1000.016,
            sent_timestamp=1000.026,
            received_at=20.020,
        )

        snapshot = await monitor.snapshot(now=20.020)
        self.assertEqual(snapshot["summary"]["activeSources"], 1)
        self.assertEqual(snapshot["summary"]["activeStreams"], 1)
        self.assertEqual(snapshot["summary"]["totalStreams"], 1)

        row = snapshot["rows"][0]
        self.assertEqual(row["sourceIp"], "192.0.2.10")
        self.assertEqual(row["cameraId"], 3)
        self.assertEqual(row["frameNumber"], 101)
        self.assertEqual(row["packetCount"], 2)
        self.assertTrue(row["active"])
        self.assertAlmostEqual(row["sentPeriodMs"], 16.0)
        self.assertAlmostEqual(row["receivePeriodMs"], 20.0)

    async def test_max_capture_skew_uses_active_streams_only(self) -> None:
        monitor = VisionQualityMonitor(active_after_seconds=1.0, retain_after_seconds=30.0)

        await monitor.record(
            source_ip="192.0.2.10",
            camera_id=1,
            frame_number=10,
            capture_timestamp=2000.000,
            sent_timestamp=2000.002,
            received_at=50.000,
        )
        await monitor.record(
            source_ip="192.0.2.11",
            camera_id=2,
            frame_number=11,
            capture_timestamp=2000.030,
            sent_timestamp=2000.032,
            received_at=50.100,
        )
        await monitor.record(
            source_ip="192.0.2.12",
            camera_id=3,
            frame_number=12,
            capture_timestamp=2001.000,
            sent_timestamp=2001.002,
            received_at=48.000,
        )

        snapshot = await monitor.snapshot(now=50.200)
        self.assertEqual(snapshot["summary"]["activeSources"], 2)
        self.assertEqual(snapshot["summary"]["activeStreams"], 2)
        self.assertEqual(snapshot["summary"]["totalStreams"], 3)
        self.assertAlmostEqual(snapshot["summary"]["maxCaptureSkewMs"], 30.0)
        self.assertEqual([row["active"] for row in snapshot["rows"]], [True, True, False])


if __name__ == "__main__":
    unittest.main()
