from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

COMPOSE_PROJECT_NAME = "japanopen-ssl"
DEFAULT_LOG_TAIL = 200
MIN_LOG_TAIL = 20
MAX_LOG_TAIL = 1000


def normalize_log_service(value: str | None, allowed_services: set[str]) -> str | None:
    service = (value or "all").strip()
    if service in {"", "all"}:
        return None
    if service not in allowed_services:
        raise ValueError(f"unknown service: {service}")
    return service


def normalize_log_tail(value: str | int | None) -> int:
    if value in {None, ""}:
        return DEFAULT_LOG_TAIL

    try:
        tail = int(str(value), 10)
    except ValueError as exc:
        raise ValueError("tail must be an integer") from exc

    return min(max(tail, MIN_LOG_TAIL), MAX_LOG_TAIL)


def compose_logs_command(root_dir: Path, service: str | None, tail: int) -> list[str]:
    command = [
        "docker",
        "compose",
        "-p",
        COMPOSE_PROJECT_NAME,
        "-f",
        str(root_dir / "compose.yaml"),
        "--project-directory",
        str(root_dir),
        "logs",
        "--no-color",
        "--timestamps",
        "--tail",
        str(tail),
    ]
    if service:
        command.append(service)
    return command


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
