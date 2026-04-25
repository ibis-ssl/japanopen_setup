FROM python:3.11-slim AS builder

ARG SSL_GC_PROTO_REF=v3.20.3

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    curl \
    protobuf-compiler \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN curl -fsSL \
    "https://codeload.github.com/robocup-ssl/ssl-game-controller/tar.gz/${SSL_GC_PROTO_REF}" \
  | tar -xz --strip-components=1 -C /build

RUN mkdir -p /gen \
 && protoc \
    --proto_path=/build/proto \
    --python_out=/gen \
    geom/ssl_gc_geometry.proto \
    state/ssl_gc_common.proto \
    state/ssl_gc_game_event.proto \
    state/ssl_gc_referee_message.proto \
    vision/ssl_vision_detection.proto \
    vision/ssl_vision_geometry.proto \
    vision/ssl_vision_wrapper.proto \
    tracker/ssl_vision_detection_tracked.proto \
    tracker/ssl_vision_wrapper_tracked.proto \
 && find /gen -type d -exec touch {}/__init__.py \;

RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"

COPY ssl_playback/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt


FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PATH="/venv/bin:$PATH"

WORKDIR /app

COPY --from=builder /venv /venv
COPY --from=builder /gen /app/proto_gen
COPY ssl_playback /app/ssl_playback

ENV PYTHONPATH="/app/proto_gen"

CMD ["sh", "-c", "exec python -m uvicorn ssl_playback.app:app --host 0.0.0.0 --port ${PLAYBACK_UI_PORT:-8086} --log-level info"]
