const path = require('path');
const fs = require('fs');

const primaryDir = process.env.SIX_S_UPLOAD_DIR
  ? path.resolve(process.env.SIX_S_UPLOAD_DIR)
  : path.resolve(__dirname, '../../uploads/6s');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureS6UploadDirs() {
  ensureDir(primaryDir);
}

function getS6UploadDir() {
  ensureDir(primaryDir);
  return primaryDir;
}

function getS6UploadPath(fileName) {
  return path.join(primaryDir, fileName);
}

function buildS6LocalUrl(fileName) {
  return `/uploads/6s/${fileName}`;
}

function getS6FileNameFromUrl(fileUrl) {
  if (!fileUrl) return '';
  const match = String(fileUrl).match(/\/uploads\/6s\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : path.basename(String(fileUrl));
}

module.exports = {
  ensureS6UploadDirs,
  getS6UploadDir,
  getS6UploadPath,
  buildS6LocalUrl,
  getS6FileNameFromUrl
};
