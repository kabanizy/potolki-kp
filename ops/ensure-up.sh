#!/bin/sh
set -eu

cd /opt/potolki-kp
archive=/opt/potolki-kp/runtime-images.tar.gz

if ! docker image inspect potolki-kp-app:latest >/dev/null 2>&1 || ! docker image inspect caddy:2-alpine >/dev/null 2>&1; then
  if [ ! -r "$archive" ]; then
    echo "Required Docker image is missing and $archive is unavailable" >&2
    exit 1
  fi
  docker load -i "$archive"
fi

# Never build or pull during recovery: startup must work even when external DNS
# or Docker Hub is temporarily unavailable.
docker compose up -d --no-build --remove-orphans
