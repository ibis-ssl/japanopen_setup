#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  ENV_FILE="${ROOT_DIR}/.env.example"
fi

compose() {
  docker compose \
    --env-file "${ENV_FILE}" \
    -f "${ROOT_DIR}/compose.yaml" \
    --project-directory "${ROOT_DIR}" \
    "$@"
}

usage() {
  cat <<'EOF'
Usage: ./scripts/ops.sh <command> [service...]

Commands:
  build    Build local images (admin-ui, AudioRef)
  pull     Pull upstream images
  up       Start the stack in detached mode
  down     Stop and remove the stack
  restart  Restart all or selected services
  logs     Follow logs for all or selected services
  ps       Show service status
EOF
}

command="${1:-}"
if [[ -z "${command}" ]]; then
  usage
  exit 1
fi
shift || true

case "${command}" in
  build)
    compose build "$@"
    ;;
  pull)
    compose pull --ignore-buildable "$@"
    ;;
  up)
    compose up -d "$@"
    ;;
  down)
    compose down "$@"
    ;;
  restart)
    compose restart "$@"
    ;;
  logs)
    compose logs -f "$@"
    ;;
  ps)
    compose ps "$@"
    ;;
  *)
    usage
    exit 1
    ;;
esac
