from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT_DIR = Path(os.environ.get("WORKSPACE_DIR", Path(__file__).resolve().parents[1]))
WEB_DIR = ROOT_DIR / "admin_web"
OPS_SCRIPT = ROOT_DIR / "scripts" / "ops.sh"
HOST_PROC_ASOUND = Path(os.environ.get("HOST_PROC_ASOUND", "/host/proc/asound"))


@dataclass(frozen=True)
class ServiceDef:
    service: str
    label: str
    category: str
    tab_id: str | None = None
    embeddable: bool = False
    port_env: str | None = None
    path: str = "/"
    summary: str = ""


SERVICE_DEFS = [
    ServiceDef(
        service="admin-ui",
        label="Admin UI",
        category="core",
        port_env="ADMIN_UI_PORT",
        summary="管理画面本体",
    ),
    ServiceDef(
        service="ssl-game-controller",
        label="Game Controller",
        category="web",
        tab_id="game-controller",
        embeddable=True,
        port_env="GC_UI_PORT",
        summary="試合制御",
    ),
    ServiceDef(
        service="ssl-vision-client",
        label="Vision Client",
        category="web",
        tab_id="vision-client",
        embeddable=True,
        port_env="VISION_CLIENT_UI_PORT",
        summary="フィールド可視化",
    ),
    ServiceDef(
        service="ssl-status-board",
        label="Status Board",
        category="web",
        tab_id="status-board",
        embeddable=True,
        port_env="STATUS_BOARD_UI_PORT",
        summary="試合ステータス表示",
    ),
    ServiceDef(
        service="ssl-remote-control-yellow",
        label="Remote Yellow",
        category="web",
        tab_id="remote-yellow",
        embeddable=True,
        port_env="REMOTE_CONTROL_YELLOW_UI_PORT",
        summary="Yellow 側 remote control",
    ),
    ServiceDef(
        service="ssl-remote-control-blue",
        label="Remote Blue",
        category="web",
        tab_id="remote-blue",
        embeddable=True,
        port_env="REMOTE_CONTROL_BLUE_UI_PORT",
        summary="Blue 側 remote control",
    ),
    ServiceDef(
        service="autoref-tigers",
        label="TIGERs AutoRef",
        category="background",
        summary="TIGERs Mannheim auto referee",
    ),
    ServiceDef(
        service="autoref-erforce",
        label="ER-Force AutoRef",
        category="background",
        summary="ER-Force auto referee",
    ),
    ServiceDef(
        service="ssl-auto-recorder",
        label="Auto Recorder",
        category="background",
        summary="公式ログ記録",
    ),
    ServiceDef(
        service="ssl-playback",
        label="Playback",
        category="web",
        tab_id="playback",
        embeddable=True,
        port_env="PLAYBACK_UI_PORT",
        summary="POSSIBLE_GOAL 判定用プレイバック",
    ),
    ServiceDef(
        service="audioref",
        label="AudioRef",
        category="background",
        summary="音声案内",
    ),
]

TAB_DEFS = [
    {"id": "overview", "label": "Overview"},
    {"id": "game-controller", "label": "Game Controller"},
    {"id": "vision-client", "label": "Vision Client"},
    {"id": "status-board", "label": "Status Board"},
    {"id": "remote-yellow", "label": "Remote Yellow"},
    {"id": "remote-blue", "label": "Remote Blue"},
    {"id": "playback", "label": "Playback"},
    {"id": "settings", "label": "Settings"},
]

app = FastAPI(title="Japan Open Admin UI")
app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


def run_ops(*args: str, timeout: int = 60, check: bool = True) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            [str(OPS_SCRIPT), *args],
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail=f"compose command timed out: {' '.join(exc.cmd)}") from exc

    if check and result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "compose command failed"
        raise HTTPException(status_code=500, detail=detail)
    return result


def load_compose_services() -> dict[str, dict[str, Any]]:
    result = run_ops("config", "--format", "json", timeout=30)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="docker compose config returned invalid JSON") from exc

    services = payload.get("services")
    if not isinstance(services, dict):
        raise HTTPException(status_code=500, detail="docker compose config did not include services")
    return {
        str(name): config
        for name, config in services.items()
        if isinstance(config, dict)
    }


def service_environment(service_config: dict[str, Any] | None) -> dict[str, str]:
    if not service_config:
        return {}

    environment = service_config.get("environment") or {}
    if isinstance(environment, dict):
        return {
            str(key): str(value)
            for key, value in environment.items()
            if value is not None
        }

    if isinstance(environment, list):
        values: dict[str, str] = {}
        for item in environment:
            if not isinstance(item, str) or "=" not in item:
                continue
            key, value = item.split("=", 1)
            values[key] = value
        return values

    return {}


def service_command(service_config: dict[str, Any] | None) -> list[str]:
    if not service_config:
        return []

    command = service_config.get("command") or []
    if isinstance(command, list):
        return [str(item) for item in command]
    if isinstance(command, str):
        return command.split()
    return []


def service_port(service: ServiceDef, compose_services: dict[str, dict[str, Any]]) -> str | None:
    service_config = compose_services.get(service.service)
    env_values = service_environment(service_config)
    if service.port_env:
        port = env_values.get(service.port_env)
        if port:
            return port

    command = service_command(service_config)
    for index, token in enumerate(command[:-1]):
        if token == "--port":
            return command[index + 1].lstrip(":")

    for token in command:
        match = re.fullmatch(r":(\d{2,5})", token)
        if match:
            return match.group(1)

    return None


def service_url(service: ServiceDef, compose_services: dict[str, dict[str, Any]]) -> str | None:
    port = service_port(service, compose_services)
    if not port:
        return None
    return f"http://127.0.0.1:{port}{service.path}"


def service_state_payload(
    service: ServiceDef,
    compose_services: dict[str, dict[str, Any]],
    containers_by_service: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    container = containers_by_service.get(service.service)
    state = "not-created"
    status_text = "Not created"
    health = None
    container_name = None

    if container:
        state = (container.get("State") or "unknown").lower()
        status_text = container.get("Status") or state
        health = container.get("Health") or None
        container_name = container.get("Name")

    return {
        "id": service.service,
        "label": service.label,
        "category": service.category,
        "tabId": service.tab_id,
        "embeddable": service.embeddable,
        "summary": service.summary,
        "url": service_url(service, compose_services),
        "state": state,
        "statusText": status_text,
        "health": health,
        "containerName": container_name,
    }


def parse_compose_ps_output(stdout: str) -> list[dict[str, Any]]:
    text = stdout.strip()
    if not text:
        return []

    parsed = json.loads(text)
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        return [parsed]
    raise json.JSONDecodeError("unsupported docker compose ps format", text, 0)


def load_compose_state() -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]], str | None]:
    errors: list[str] = []
    compose_services: dict[str, dict[str, Any]] = {}
    containers: list[dict[str, Any]] = []

    try:
        compose_services = load_compose_services()
    except HTTPException as exc:
        errors.append(str(exc.detail))

    try:
        result = run_ops("ps", "--all", "--format", "json", timeout=30)
        stdout = result.stdout.strip()
        if stdout:
            try:
                containers = parse_compose_ps_output(stdout)
            except json.JSONDecodeError:
                containers = [json.loads(line) for line in stdout.splitlines() if line.strip()]
    except HTTPException as exc:
        errors.append(str(exc.detail))
    except json.JSONDecodeError:
        errors.append("docker compose ps returned invalid JSON")

    return compose_services, containers, "; ".join(errors) or None


def list_services_payload() -> dict[str, Any]:
    compose_services, containers, error = load_compose_state()
    containers_by_service = {
        item.get("Service"): item for item in containers if item.get("Service")
    }
    services = [
        service_state_payload(service, compose_services, containers_by_service)
        for service in SERVICE_DEFS
    ]
    running_count = sum(1 for service in services if service["state"] == "running")

    return {
        "tabs": TAB_DEFS,
        "services": services,
        "summary": {
            "running": running_count,
            "total": len(services),
            "error": error,
        },
    }


def parse_cards() -> dict[int, dict[str, Any]]:
    cards_file = HOST_PROC_ASOUND / "cards"
    cards: dict[int, dict[str, Any]] = {}
    if not cards_file.exists():
        return cards

    pattern = re.compile(r"^\s*(\d+)\s+\[([^\]]+)\]:\s+(.+?)\s+-\s+(.+)$")
    for line in cards_file.read_text(encoding="utf-8").splitlines():
        match = pattern.match(line)
        if not match:
            continue
        index = int(match.group(1))
        cards[index] = {
            "index": index,
            "cardId": match.group(2).strip(),
            "label": match.group(4).strip(),
        }
    return cards


def parse_playback_outputs() -> list[dict[str, Any]]:
    pcm_file = HOST_PROC_ASOUND / "pcm"
    cards = parse_cards()
    outputs: list[dict[str, Any]] = [
        {
            "value": "default",
            "label": "Auto detect (recommended)",
            "cardIndex": None,
            "deviceIndex": None,
            "cardId": None,
        }
    ]
    if not pcm_file.exists():
        return outputs

    pattern = re.compile(r"^(\d+)-(\d+):\s+(.+?)\s+:\s+(.+?)\s+:\s+(.+)$")
    for line in pcm_file.read_text(encoding="utf-8").splitlines():
        match = pattern.match(line)
        if not match:
            continue
        capabilities = match.group(5)
        if "playback" not in capabilities:
            continue

        card_index = int(match.group(1))
        device_index = int(match.group(2))
        card = cards.get(card_index, {})
        card_label = card.get("label", f"Card {card_index}")
        device_label = match.group(4).strip()
        outputs.append(
            {
                "value": f"plughw:{card_index},{device_index}",
                "label": f"{card_label} / {device_label}",
                "cardIndex": card_index,
                "deviceIndex": device_index,
                "cardId": card.get("cardId"),
            }
        )

    return outputs


def current_settings_payload() -> dict[str, Any]:
    compose_services = load_compose_services()
    audioref_env = service_environment(compose_services.get("audioref"))
    return {
        "audioref": {
            "outputPcm": audioref_env.get("AUDIOREF_OUTPUT_PCM", "default"),
        }
    }


@app.get("/")
async def root() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    return {"ok": True, "service": "admin-ui"}


@app.get("/api/services")
async def get_services() -> dict[str, Any]:
    return list_services_payload()


@app.get("/api/settings")
async def get_settings() -> dict[str, Any]:
    return current_settings_payload()


@app.get("/api/audioref/outputs")
async def get_audioref_outputs() -> dict[str, Any]:
    return {"outputs": parse_playback_outputs()}
