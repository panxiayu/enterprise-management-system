const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MAX_WIDTH = Number(process.env.SIX_S_IMAGE_MAX_WIDTH || 1600);
const JPEG_QUALITY = Number(process.env.SIX_S_IMAGE_JPEG_QUALITY || 6);
const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.heic', '.heif']);

function canCompressImage(filePath) {
  return SUPPORTED_EXTS.has(path.extname(String(filePath || '')).toLowerCase());
}

function compressToJpeg(sourcePath) {
  return new Promise((resolve, reject) => {
    const tempPath = path.join(
      os.tmpdir(),
      `s6-compressed-${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`
    );
    const args = [
      '-y',
      '-i',
      sourcePath,
      '-vf',
      `scale=${MAX_WIDTH}:-2:force_original_aspect_ratio=decrease`,
      '-q:v',
      String(JPEG_QUALITY),
      '-frames:v',
      '1',
      tempPath
    ];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
        return;
      }
      resolve(tempPath);
    });
  });
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('删除 6S 压缩临时文件失败:', filePath, err.message);
  }
}

module.exports = {
  canCompressImage,
  compressToJpeg,
  safeUnlink
};
