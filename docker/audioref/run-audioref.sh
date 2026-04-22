#!/bin/sh
set -eu

pack_dir="${AUDIOREF_PACK_DIR:-${AUDIOREF_HOME}/sounds/en}"

set -- python3 ./audioref.py \
  --gc_ip "${REFEREE_ADDRESS:-224.5.23.1}" \
  --gc_port "${REFEREE_PORT:-10003}" \
  --vision_ip "${VISION_ADDRESS:-224.5.23.2}" \
  --vision_port "${VISION_PORT:-10006}" \
  --pack "${pack_dir}" \
  --max_queue_len "${AUDIOREF_MAX_QUEUE_LEN:-3}"

if [ "${AUDIOREF_ANTI_STANDBY_SOUND:-false}" = "true" ]; then
  set -- "$@" --anti_standby_sound
fi

exec "$@"
