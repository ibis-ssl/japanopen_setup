FROM python:3.11-slim AS builder

ARG AUDIOREF_REF
ENV AUDIOREF_HOME=/opt/audioref \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    libasound2-dev \
 && rm -rf /var/lib/apt/lists/*

RUN python -m venv "${VIRTUAL_ENV}"

WORKDIR ${AUDIOREF_HOME}

RUN curl -fsSL "https://codeload.github.com/TIGERs-Mannheim/AudioRef/tar.gz/${AUDIOREF_REF}" \
 | tar -xz --strip-components=1 -C "${AUDIOREF_HOME}"

RUN pip install --upgrade pip \
 && pip install -r requirements.txt

FROM python:3.11-slim

ENV AUDIOREF_HOME=/opt/audioref \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    ca-certificates \
    libasound2 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR ${AUDIOREF_HOME}

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder ${AUDIOREF_HOME} ${AUDIOREF_HOME}
COPY docker/audioref/run-audioref.sh /usr/local/bin/run-audioref.sh

ENTRYPOINT ["/usr/local/bin/run-audioref.sh"]
