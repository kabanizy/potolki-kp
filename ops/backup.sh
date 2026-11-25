#!/bin/sh
set -eu

database=/opt/potolki-kp/data/data.sqlite
backup_dir=/opt/potolki-kp/backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$backup_dir/.data-$stamp.sqlite.tmp"
target="$backup_dir/data-$stamp.sqlite"

mkdir -p "$backup_dir"
sqlite3 "$database" ".backup '$temporary'"
if [ "$(sqlite3 "$temporary" 'PRAGMA integrity_check;')" != ok ]; then
  rm -f "$temporary"
  echo "SQLite backup integrity check failed" >&2
  exit 1
fi
mv "$temporary" "$target"
if [ -d /opt/potolki-kp/data/photos ]; then
  tar -czf "$backup_dir/.photos-$stamp.tar.gz.tmp" -C /opt/potolki-kp/data photos
  mv "$backup_dir/.photos-$stamp.tar.gz.tmp" "$backup_dir/photos-$stamp.tar.gz"
fi
find "$backup_dir" -type f -name 'data-*.sqlite' -mtime +14 -delete
find "$backup_dir" -type f -name 'photos-*.tar.gz' -mtime +14 -delete
