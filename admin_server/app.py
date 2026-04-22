from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

ROOT_DIR = Path(os.environ.get("WORKSPACE_DIR", Path(__file__).resolve().parents[1]))
WEB_DIR = ROOT_DIR / "admin_web"
ENV_EXAMPLE_FILE = ROOT_DIR / ".env.example"
ENV_FILE = ROOT_DIR / ".env"
OPS_SCRIPT = ROOT_DIR / "scripts" / "ops.sh"
HOST_PROC_ASOUND = Path(os.environ.get("HOST_PROC_ASOUND", "/host/proc/asound"))
SAFE_PCM_PATTERN = re.compile(r"^[A-Za-z0-9_:+.,-]+$")


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
    {"id": "settings", "label": "Settings"},
]

app = FastAPI(title="Japan Open Admin UI")
app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


class AudioRefSettingsUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    output_pcm: str = Field(alias="outputPcm", min_length=1, max_length=128)


def active_env_file() -> Path:
    if ENV_FILE.exists():
        return ENV_FILE
    return ENV_EXAMPLE_FILE


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def ensure_runtime_env_file() -> Path:
    if ENV_FILE.exists():
        return ENV_FILE
    shutil.copyfile(ENV_EXAMPLE_FILE, ENV_FILE)
    return ENV_FILE


def update_env_value(path: Path, key: str, value: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    updated = False
    rendered = f"{key}={value}"

    for index, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[index] = rendered
            updated = True
            break

    if not updated:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(rendered)

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


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


def service_url(service: ServiceDef, env_values: dict[str, str]) -> str | None:
    if not service.port_env:
        return None
    port = env_values.get(service.port_env)
    if not port:
        return None
    return f"http://127.0.0.1:{port}{service.path}"


def service_state_payload(
    service: ServiceDef,
    env_values: dict[str, str],
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
        "url": service_url(service, env_values),
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


def load_compose_state() -> tuple[dict[str, str], list[dict[str, Any]], str | None]:
    env_values = parse_env_file(active_env_file())
    error = None
    containers: list[dict[str, Any]] = []

    try:
        result = run_ops("ps", "--all", "--format", "json", timeout=30)
        stdout = result.stdout.strip()
        if stdout:
            try:
                containers = parse_compose_ps_output(stdout)
            except json.JSONDecodeError:
                containers = [json.loads(line) for line in stdout.splitlines() if line.strip()]
    except HTTPException as exc:
        error = str(exc.detail)
    except json.JSONDecodeError:
        error = "docker compose ps returned invalid JSON"

    return env_values, containers, error


def list_services_payload() -> dict[str, Any]:
    env_values, containers, error = load_compose_state()
    containers_by_service = {
        item.get("Service"): item for item in containers if item.get("Service")
    }
    services = [
        service_state_payload(service, env_values, containers_by_service)
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
            "label": "System default",
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
    env_values = parse_env_file(active_env_file())
    return {
        "audioref": {
            "outputPcm": env_values.get("AUDIOREF_OUTPUT_PCM", "default"),
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


@app.put("/api/settings/audioref")
async def update_audioref_settings(payload: AudioRefSettingsUpdate) -> dict[str, Any]:
    output_pcm = payload.output_pcm.strip()
    if output_pcm != "default" and not SAFE_PCM_PATTERN.fullmatch(output_pcm):
        raise HTTPException(status_code=400, detail="invalid AUDIOREF_OUTPUT_PCM")

    env_file = ensure_runtime_env_file()
    update_env_value(env_file, "AUDIOREF_OUTPUT_PCM", output_pcm)
    run_ops("up", "--force-recreate", "audioref", timeout=120)

    services_payload = list_services_payload()
    audioref_service = next(
        (service for service in services_payload["services"] if service["id"] == "audioref"),
        None,
    )
    return {
        "ok": True,
        "audioref": {"outputPcm": output_pcm},
        "service": audioref_service,
    }
