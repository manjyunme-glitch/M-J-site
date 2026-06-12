#!/bin/sh
set -eu

database_path="${DATABASE_PATH:-/app/data/love-journal.db}"
database_dir="$(dirname "$database_path")"
upload_dir="${UPLOAD_DIR:-/app/uploads}"

mkdir -p "$database_dir" "$upload_dir"
chown -R node:node "$database_dir" "$upload_dir"

exec setpriv --reuid=node --regid=node --init-groups "$@"
