#!/bin/sh
set -eu

cd /opt/potolki-kp
/bin/sh /opt/potolki-kp/ops/ensure-up.sh

unhealthy="$(docker ps --filter 'label=com.docker.compose.project=potolki-kp' --filter 'health=unhealthy' --format '{{.Names}}')"
for container in $unhealthy; do
    docker restart "$container"
done

for service in app caddy; do
    container="$(docker compose ps -q "$service")"
    [ -n "$container" ]
    [ "$(docker inspect -f '{{.State.Running}}' "$container")" = true ]
done
