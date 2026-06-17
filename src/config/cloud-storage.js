// 移动云对象存储配置
module.exports = {
  provider: 'cmcloud', // 移动云
  region: 'eos-ningbo-1',
  endpoint: 'https://eos-ningbo-1.cmecloud.cn',
  credentials: {
    accessKeyId: '7ESYMC5N4MUWFY9UFYR3',
    secretAccessKey: 'PnixdJbGoP1VSMfRd6RONZyS3zxKp7ZBoAXfIN4E'
  },
  bucket: 'company-video-files',
  // 视频访问的基础URL（公共可读）- 格式：endpoint/bucket/key
  publicUrl: 'https://eos-ningbo-1.cmecloud.cn/company-video-files'
};
