#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "用法: $0 <备份目录或备份db文件路径>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${ROOT_DIR}/data/exam.db"
SOURCE_INPUT="$1"
SOURCE_DB=""

if [[ -d "${SOURCE_INPUT}" && -f "${SOURCE_INPUT}/exam.db" ]]; then
  SOURCE_DB="${SOURCE_INPUT}/exam.db"
elif [[ -f "${SOURCE_INPUT}" ]]; then
  SOURCE_DB="${SOURCE_INPUT}"
else
  echo "找不到备份源: ${SOURCE_INPUT}" >&2
  exit 1
fi

TMP_COPY="${ROOT_DIR}/data/exam.db.restore-tmp"
cp -f "${SOURCE_DB}" "${TMP_COPY}"
mv -f "${TMP_COPY}" "${DB_PATH}"
rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"

echo "[restore] restored ${SOURCE_DB} -> ${DB_PATH}"
echo "[restore] 请执行: docker restart exam-system-api"
