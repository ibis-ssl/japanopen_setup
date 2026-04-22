#!/bin/sh
set -eu

pack_dir="${AUDIOREF_PACK_DIR:-${AUDIOREF_HOME}/sounds/en}"
output_pcm="${AUDIOREF_OUTPUT_PCM:-default}"
resolved_output_pcm="${output_pcm}"

strip_leading_zeros() {
  value="${1}"
  while [ "${value#0}" != "${value}" ]; do
    value="${value#0}"
  done
  if [ -z "${value}" ]; then
    value="0"
  fi
  printf '%s\n' "${value}"
}

autodetect_output_pcm() {
  pcm_file="/proc/asound/pcm"
  best_non_hdmi=""
  best_any=""

  if [ ! -r "${pcm_file}" ]; then
    return 1
  fi

  # Container ALSA defaults often assume card 0 / device 0, which may not
  # exist on hosts where the first card only exposes HDMI playback endpoints.
  while IFS= read -r line; do
    device_id="${line%%:*}"
    if [ "${device_id}" = "${line}" ]; then
      continue
    fi

    rest="${line#*: }"
    pcm_name="${rest%% : *}"
    rest="${rest#* : }"
    device_label="${rest%% : *}"
    capabilities="${rest#* : }"

    case "${capabilities}" in
      *playback*)
        card_index="$(strip_leading_zeros "${device_id%-*}")"
        device_index="$(strip_leading_zeros "${device_id#*-}")"
        pcm="plughw:${card_index},${device_index}"
        label="$(printf '%s %s' "${pcm_name}" "${device_label}" | tr '[:upper:]' '[:lower:]')"

        if [ -z "${best_any}" ]; then
          best_any="${pcm}"
        fi

        case "${label}" in
          *analog*|*speaker*|*headphone*|*headset*|*line*out*)
            printf '%s\n' "${pcm}"
            return 0
            ;;
          *hdmi*|*displayport*)
            ;;
          *)
            if [ -z "${best_non_hdmi}" ]; then
              best_non_hdmi="${pcm}"
            fi
            ;;
        esac
        ;;
    esac
  done < "${pcm_file}"

  if [ -n "${best_non_hdmi}" ]; then
    printf '%s\n' "${best_non_hdmi}"
    return 0
  fi

  if [ -n "${best_any}" ]; then
    printf '%s\n' "${best_any}"
    return 0
  fi

  return 1
}

if [ "${output_pcm}" = "default" ] || [ -z "${output_pcm}" ]; then
  resolved_output_pcm=""
  if resolved_output_pcm="$(autodetect_output_pcm)"; then
    printf 'Auto-selected AudioRef output PCM: %s\n' "${resolved_output_pcm}"
  else
    printf 'Unable to auto-detect a playback PCM; falling back to container ALSA default\n' >&2
    rm -f /etc/asound.conf
  fi
fi

if [ -n "${resolved_output_pcm}" ]; then
  card_index=""
  case "${resolved_output_pcm}" in
    plughw:*,*|hw:*,*)
      card_index="${resolved_output_pcm#*:}"
      card_index="${card_index%%,*}"
      ;;
  esac

  {
    printf 'pcm.!default {\n'
    printf '  type plug\n'
    printf '  slave.pcm "%s"\n' "${resolved_output_pcm}"
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
