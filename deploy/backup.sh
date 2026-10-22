#!/bin/sh
# Kunlik PostgreSQL zaxira nusxasi, 14 kun saqlanadi. BACKUP_DIR alohida diskka ulangan bo'lishi kerak.
set -eu
BACKUP_DIR=${BACKUP_DIR:-/backups}
while true; do
  STAMP=$(date +%Y-%m-%d_%H%M)
  pg_dump -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$BACKUP_DIR/db_$STAMP.dump"
  tar -czf "$BACKUP_DIR/storage_$STAMP.tar.gz" -C /data storage
  find "$BACKUP_DIR" -name 'db_*.dump' -mtime +14 -delete
  find "$BACKUP_DIR" -name 'storage_*.tar.gz' -mtime +14 -delete
  echo "backup ok: $STAMP"
  sleep 86400
done
