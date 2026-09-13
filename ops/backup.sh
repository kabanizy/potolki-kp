#!/bin/sh
set -eu

database=/opt/potolki-kp/data/data.sqlite
backup_dir=/opt/potolki-kp/backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$backup_dir/.data-$stamp.sqlite.tmp"
target="$backup_dir/data-$stamp.sqlite"

mkdir -p "$backup_dir"
sqlite3 "$database" ".backup '$temporary'"
mv "$temporary" "$target"
find "$backup_dir" -type f -name 'data-*.sqlite' -mtime +14 -delete

