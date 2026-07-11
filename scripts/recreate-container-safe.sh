#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-staff-server:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-exam-system-api}"

echo "[safe-recreate] 1/4 先备份数据库"
BACKUP_DIR="$("${ROOT_DIR}/scripts/backup-live-db.sh")"
echo "[safe-recreate] backup=${BACKUP_DIR}"

echo "[safe-recreate] 2/4 停止旧容器"
docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true

echo "[safe-recreate] 3/4 重新创建容器（bind mount 数据库）"
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV="${NODE_ENV:-production}" \
  -e PORT="${PORT:-3000}" \
  -e TZ="${TZ:-Asia/Shanghai}" \
  -e JWT_SECRET="${JWT_SECRET:-change-this-secret-in-production}" \
  -e SYNC_SECRET="${SYNC_SECRET:-sync-secret-change-me}" \
  -e SMB_HOST="${SMB_HOST:-192.168.110.4}" \
  -e SMB_SHARE="${SMB_SHARE:-办公部门数据盘$}" \
  -e SMB_SUBDIR="${SMB_SUBDIR:-行政部/行政部共享数据}" \
  -e SMB_USER="${SMB_USER:-xlmould\\HMCTB}" \
  -e SMB_PASS="${SMB_PASS:-HMCTB123}" \
  -e EXCEL_PASSWORD="${EXCEL_PASSWORD:-1111}" \
  -e WECHAT_MINIAPP_APP_ID="${WECHAT_MINIAPP_APP_ID:-wx4a0fd7786a7ece59}" \
  -e WECHAT_MINIAPP_APP_SECRET="${WECHAT_MINIAPP_APP_SECRET:-}" \
  -e SIX_S_UPLOAD_DIR="${SIX_S_UPLOAD_DIR:-/app/uploads/6s}" \
  -e WORKWEAR_PDF_MODE="${WORKWEAR_PDF_MODE:-windows_excel}" \
  -e WORKWEAR_WINDOWS_PDF_URL="${WORKWEAR_WINDOWS_PDF_URL:-http://192.168.110.4:3010/convert/excel-to-pdf}" \
  -e WORKWEAR_WINDOWS_PDF_TOKEN="${WORKWEAR_WINDOWS_PDF_TOKEN:-XLmould}" \
  --mount type=bind,source="${ROOT_DIR}/data/exam.db",destination=/app/data/exam.db,readonly=false \
  -v "${ROOT_DIR}/src:/app/src" \
  -v "${ROOT_DIR}/public:/app/public" \
  -v "${ROOT_DIR}/uploads:/app/uploads" \
  -v "${ROOT_DIR}/scripts:/app/scripts" \
  "${IMAGE_NAME}"

echo "[safe-recreate] 4/4 完成"
echo "[safe-recreate] 如有异常，可执行:"
echo "  ${ROOT_DIR}/scripts/restore-db.sh ${BACKUP_DIR}"
