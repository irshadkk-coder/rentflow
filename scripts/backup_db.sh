#!/usr/bin/env bash
# ==============================================================================
# RentFlow Safe PostgreSQL Backup Shell Script
# Creates a compressed binary archive without modifying any data.
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/rentflow_backup_${TIMESTAMP}.dump"

echo "[*] Starting PostgreSQL backup..."
echo "[*] Destination: ${BACKUP_FILE}"

pg_dump -h "${PGHOST:-localhost}" \
        -p "${PGPORT:-5432}" \
        -U "${PGUSER:-postgres}" \
        -F c -b -v \
        -f "${BACKUP_FILE}" \
        "${PGDATABASE:-rentflow}"

echo "[✓] Backup completed: ${BACKUP_FILE}"
echo "[i] To restore: pg_restore -h <host> -U <user> -d <dbname> -v ${BACKUP_FILE}"
