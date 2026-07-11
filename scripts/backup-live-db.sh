#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${ROOT_DIR}/data/exam.db"
BACKUP_DIR="${ROOT_DIR}/data/backups/db"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TARGET_DIR="${BACKUP_DIR}/${TIMESTAMP}"
BACKUP_DB="${TARGET_DIR}/exam.db"
META_FILE="${TARGET_DIR}/meta.txt"
FORCE_BACKUP="${FORCE_BACKUP:-0}"

compute_file_sha() {
  local file_path="$1"
  if [[ -f "${file_path}" ]]; then
    sha256sum "${file_path}" | awk '{print $1}'
  else
    echo "-"
  fi
}

compute_source_fingerprint() {
  local db_sha wal_sha shm_sha wal_size shm_size
  db_sha="$(compute_file_sha "${DB_PATH}")"
  wal_sha="$(compute_file_sha "${DB_PATH}-wal")"
  shm_sha="$(compute_file_sha "${DB_PATH}-shm")"
  wal_size="$(stat -c '%s' "${DB_PATH}-wal" 2>/dev/null || echo 0)"
  shm_size="$(stat -c '%s' "${DB_PATH}-shm" 2>/dev/null || echo 0)"
  printf '%s' "${db_sha}|${wal_sha}|${shm_sha}|${wal_size}|${shm_size}" | sha256sum | awk '{print $1}'
}

LATEST_BACKUP_DIR="$(
  find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1
)"
LAST_SOURCE_FINGERPRINT=""
CURRENT_SOURCE_FINGERPRINT=""

mkdir -p "${TARGET_DIR}"

if [[ ! -f "${DB_PATH}" ]]; then
  echo "数据库不存在: ${DB_PATH}" >&2
  exit 1
fi

CURRENT_SOURCE_FINGERPRINT="$(compute_source_fingerprint)"
if [[ -n "${LATEST_BACKUP_DIR}" && -f "${LATEST_BACKUP_DIR}/meta.txt" ]]; then
  LAST_SOURCE_FINGERPRINT="$(
    sed -n 's/^source_fingerprint=//p' "${LATEST_BACKUP_DIR}/meta.txt" | head -1
  )"
fi

if [[ "${FORCE_BACKUP}" != "1" && -n "${LAST_SOURCE_FINGERPRINT}" && "${CURRENT_SOURCE_FINGERPRINT}" == "${LAST_SOURCE_FINGERPRINT}" ]]; then
  rmdir "${TARGET_DIR}" 2>/dev/null || true
  echo "[backup] no change detected, skipped"
  echo "[backup] latest=${LATEST_BACKUP_DIR}"
  echo "${LATEST_BACKUP_DIR}"
  exit 0
fi

echo "[backup] source=${DB_PATH}"
echo "[backup] target=${BACKUP_DB}"

BACKUP_MODE="sqlite-backup"

# 优先使用 sqlite 在线备份；若数据库当前存在镜像异常，则退回原始文件快照
if ! python3 - "${DB_PATH}" "${BACKUP_DB}" <<'PY'
import sqlite3
import sys

source_path = sys.argv[1]
target_path = sys.argv[2]

src = sqlite3.connect(source_path, timeout=5)
dst = sqlite3.connect(target_path)
try:
    src.backup(dst)
finally:
    dst.close()
    src.close()
PY
then
  BACKUP_MODE="raw-snapshot"
  cp -f "${DB_PATH}" "${BACKUP_DB}"
fi

cp -f "${DB_PATH}-wal" "${TARGET_DIR}/exam.db-wal" 2>/dev/null || true
cp -f "${DB_PATH}-shm" "${TARGET_DIR}/exam.db-shm" 2>/dev/null || true

{
  echo "timestamp=${TIMESTAMP}"
  echo "source_db=${DB_PATH}"
  echo "backup_db=${BACKUP_DB}"
  echo "backup_mode=${BACKUP_MODE}"
  echo "source_fingerprint=${CURRENT_SOURCE_FINGERPRINT}"
  echo "host=$(hostname)"
  echo "pwd=${ROOT_DIR}"
  echo "db_mtime=$(stat -c '%y' "${DB_PATH}")"
  echo "db_size=$(stat -c '%s' "${DB_PATH}")"
  echo "sha256=$(sha256sum "${BACKUP_DB}" | awk '{print $1}')"
} > "${META_FILE}"

echo "[backup] done"
echo "${TARGET_DIR}"
