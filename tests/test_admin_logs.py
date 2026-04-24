from __future__ import annotations

import unittest
from pathlib import Path

from admin_server.logs import (
    DEFAULT_LOG_TAIL,
    MAX_LOG_TAIL,
    MIN_LOG_TAIL,
    compose_logs_command,
    normalize_log_service,
    normalize_log_tail,
)


class AdminLogsTest(unittest.TestCase):
    def test_normalize_log_service_accepts_all_and_known_services(self) -> None:
        allowed = {"admin-ui", "audioref"}

        self.assertIsNone(normalize_log_service(None, allowed))
        self.assertIsNone(normalize_log_service("all", allowed))
        self.assertEqual(normalize_log_service("audioref", allowed), "audioref")

    def test_normalize_log_service_rejects_unknown_services(self) -> None:
        with self.assertRaises(ValueError):
            normalize_log_service("not-a-service", {"admin-ui"})

    def test_normalize_log_tail_defaults_and_clamps(self) -> None:
        self.assertEqual(normalize_log_tail(None), DEFAULT_LOG_TAIL)
        self.assertEqual(normalize_log_tail(""), DEFAULT_LOG_TAIL)
        self.assertEqual(normalize_log_tail("1"), MIN_LOG_TAIL)
        self.assertEqual(normalize_log_tail("250"), 250)
        self.assertEqual(normalize_log_tail("5000"), MAX_LOG_TAIL)

    def test_normalize_log_tail_rejects_non_integer_values(self) -> None:
        with self.assertRaises(ValueError):
            normalize_log_tail("lots")

    def test_compose_logs_command_builds_project_scoped_command(self) -> None:
        root_dir = Path("/workspace")

        self.assertEqual(
            compose_logs_command(root_dir, "admin-ui", 100),
            [
                "docker",
                "compose",
                "-p",
                "japanopen-ssl",
                "-f",
                "/workspace/compose.yaml",
                "--project-directory",
                "/workspace",
                "logs",
                "--no-color",
                "--timestamps",
                "--tail",
                "100",
                "admin-ui",
            ],
        )
        self.assertEqual(compose_logs_command(root_dir, None, 100)[-1], "100")


if __name__ == "__main__":
    unittest.main()
