#!/bin/sh
set -eu

unhealthy="$(docker ps --filter 'label=com.docker.compose.project=potolki-kp' --filter 'health=unhealthy' --format '{{.Names}}')"
[ -z "$unhealthy" ] && exit 0

for container in $unhealthy; do
    docker restart "$container"
done

