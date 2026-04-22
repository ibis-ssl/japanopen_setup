FROM docker:28-cli AS docker_cli

FROM docker/compose-bin:v2.39.4 AS docker_compose

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker_compose /docker-compose /usr/libexec/docker/cli-plugins/docker-compose

RUN chmod +x /usr/local/bin/docker /usr/libexec/docker/cli-plugins/docker-compose \
 && apt-get update \
 && apt-get install -y --no-install-recommends bash \
 && rm -rf /var/lib/apt/lists/*

COPY admin_server/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /workspace
