// 云存储工具模块
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const fs = require('fs');
const config = require('../config/cloud-storage');

let s3Client = null;

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: true
    });
  }
  return s3Client;
}

/**
 * 上传文件到云存储
 * @param {Buffer|string} fileContent - 文件内容或文件路径
 * @param {string} fileName - 原始文件名
 * @param {string} folder - 存储文件夹（如 'learning/'）
 * @returns {Promise<string>} - 返回云存储的公开访问URL
 */
async function uploadToCloud(fileContent, fileName, folder = 'learning/') {
  const client = getS3Client();

  // 生成唯一文件名
  const ext = path.extname(fileName);
  const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
  const key = `${folder}${uniqueName}`;

  // 如果是文件路径，读取内容
  let body = fileContent;
  if (typeof fileContent === 'string' && fs.existsSync(fileContent)) {
    body = fs.readFileSync(fileContent);
  }

  try {
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: getContentType(ext),
      ACL: 'public-read'  // 永久公开访问
    }));

    // 返回公开访问URL
    return `${config.publicUrl}/${key}`;
  } catch (err) {
    console.error('上传到云存储失败:', err);
    throw err;
  }
}

/**
 * 从云存储删除文件
 * @param {string} fileUrl - 云存储的文件URL
 */
async function deleteFromCloud(fileUrl) {
  if (!fileUrl || !fileUrl.includes(config.bucket)) {
    return; // 不是云存储的文件
  }

  const client = getS3Client();
  // 从URL中提取key
  const key = fileUrl.replace(`${config.publicUrl}/`, '');

  try {
    await client.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key
    }));
    console.log('云存储文件已删除:', key);
  } catch (err) {
    console.error('删除云存储文件失败:', err);
  }
}

/**
 * 根据文件扩展名获取Content-Type
 */
function getContentType(ext) {
  const types = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.wmv': 'video/x-ms-wmv',
    '.webm': 'video/webm',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif'
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}

module.exports = {
  uploadToCloud,
  deleteFromCloud
};
