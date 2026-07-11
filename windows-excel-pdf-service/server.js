const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.WORKWEAR_WINDOWS_PDF_PORT || process.env.PORT || 3010);
const HOST = process.env.WORKWEAR_WINDOWS_PDF_HOST || '0.0.0.0';
const TOKEN = String(process.env.WORKWEAR_WINDOWS_PDF_TOKEN || '').trim();
const POWERSHELL = process.env.WORKWEAR_WINDOWS_PDF_POWERSHELL || 'powershell.exe';
const SCRIPT_PATH = path.join(__dirname, 'convert-excel-to-pdf.ps1');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

function sanitizeBaseName(rawName, ext) {
  const name = String(rawName || 'workwear-export')
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'workwear-export';
  return `${name}${ext}`;
}

function decodeFilename(headerValue) {
  if (!headerValue) return 'workwear-export.xlsx';
  try {
    return decodeURIComponent(String(headerValue));
  } catch (_) {
    return String(headerValue);
  }
}

function collectRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 80 * 1024 * 1024) {
        reject(new Error('上传文件过大，超过 80MB 限制'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function convertExcelToPdf(buffer, originalName) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'workwear-windows-pdf-'));
  const inputPath = path.join(tempDir, sanitizeBaseName(originalName, '.xlsx'));
  const outputPath = path.join(tempDir, sanitizeBaseName(originalName, '.pdf'));

  try {
    await fs.promises.writeFile(inputPath, buffer);
    await execFileAsync(POWERSHELL, [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT_PATH,
      '-InputPath', inputPath,
      '-OutputPath', outputPath
    ], {
      timeout: 180000,
      maxBuffer: 20 * 1024 * 1024
    });
    return fs.promises.readFile(outputPath);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, { code: 0, msg: 'ok', service: 'windows-excel-pdf' });
  }

  if (req.method !== 'POST' || req.url !== '/convert/excel-to-pdf') {
    return sendJson(res, 404, { code: -1, msg: 'Not Found' });
  }

  if (TOKEN && String(req.headers['x-workwear-token'] || '').trim() !== TOKEN) {
    return sendJson(res, 401, { code: -1, msg: 'token 校验失败' });
  }

  try {
    const body = await collectRawBody(req);
    if (!body.length) {
      return sendJson(res, 400, { code: -1, msg: '未收到 Excel 文件内容' });
    }
    const originalName = decodeFilename(req.headers['x-workwear-filename']);
    const pdfBuffer = await convertExcelToPdf(body, originalName);
    const outputName = sanitizeBaseName(originalName, '.pdf');
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(outputName)}"`,
      'Content-Length': pdfBuffer.length
    });
    res.end(pdfBuffer);
  } catch (error) {
    console.error('[windows-excel-pdf] 转换失败:', error);
    return sendJson(res, 500, { code: -1, msg: error.message || 'Excel 转 PDF 失败' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[windows-excel-pdf] listening on http://${HOST}:${PORT}`);
  console.log(`[windows-excel-pdf] powershell=${POWERSHELL}`);
});
