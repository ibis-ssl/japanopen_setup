#!/bin/sh
set -eu

pack_dir="${AUDIOREF_PACK_DIR:-${AUDIOREF_HOME}/sounds/en}"
output_pcm="${AUDIOREF_OUTPUT_PCM:-default}"

if [ "${output_pcm}" = "default" ] || [ -z "${output_pcm}" ]; then
  rm -f /etc/asound.conf
else
  card_index=""
  case "${output_pcm}" in
    plughw:*,*|hw:*,*)
      card_index="${output_pcm#*:}"
      card_index="${card_index%%,*}"
      ;;
  esac

  {
    printf 'pcm.!default {\n'
    printf '  type plug\n'
    printf '  slave.pcm "%s"\n' "${output_pcm}"
    printf '}\n'
    if [ -n "${card_index}" ]; then
      printf 'ctl.!default {\n'
      printf '  type hw\n'
      printf '  card %s\n' "${card_index}"
      printf '}\n'
    fi
  } > /etc/asound.conf
fi

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
