# Windows Excel 原生导出 PDF 服务

这个服务运行在 Windows 机器上，直接调用 `Microsoft Excel` 的 `ExportAsFixedFormat` 导出 PDF。

## 目录说明

- `server.js`
  - 接收 Linux 主服务上传的 Excel 二进制
  - 调 PowerShell 脚本转 PDF
  - 返回 PDF 文件流
- `convert-excel-to-pdf.ps1`
  - 真正调用 Excel COM 导出 PDF
- `start-service.bat`
  - 方便双击启动

## 前提

1. Windows 已安装 Microsoft Excel
2. Windows 已安装 Node.js
3. 建议用固定账号运行服务，不要频繁切换登录用户

## 启动

### 1. 打开 CMD，进入目录

```bat
cd /d D:\workwear\windows-excel-pdf-service
```

### 2. 设置环境变量

```bat
set WORKWEAR_WINDOWS_PDF_PORT=3010
set WORKWEAR_WINDOWS_PDF_HOST=0.0.0.0
set WORKWEAR_WINDOWS_PDF_TOKEN=你自己的密钥
```

### 3. 启动服务

```bat
node server.js
```

或直接双击：

```bat
start-service.bat
```

## 健康检查

浏览器访问：

```text
http://127.0.0.1:3010/health
```

返回：

```json
{"code":0,"msg":"ok","service":"windows-excel-pdf"}
```

## Linux 主服务对接配置

在 Linux / Docker 环境里增加：

```env
WORKWEAR_PDF_MODE=windows_excel
WORKWEAR_WINDOWS_PDF_URL=http://你的WindowsIP:3010/convert/excel-to-pdf
WORKWEAR_WINDOWS_PDF_TOKEN=你自己的密钥
```

## 接口协议

### 请求

- `POST /convert/excel-to-pdf`
- Body: 原始 `.xlsx` 二进制
- Header:
  - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `x-workwear-filename: URL编码后的原文件名`
  - `x-workwear-token: 访问密钥`

### 响应

- 成功：PDF 文件流
- 失败：JSON 错误

## 建议

1. 先在 Windows 本机测试模板能否手工打开并另存为 PDF
2. 再启动这个服务
3. 最后让 Linux 主服务去调它

## 注意

1. 这个服务建议串行使用，不要一次大量并发导 PDF
2. 如果 Excel 被弹框占住，自动导出会失败
3. 如果 Office 首次启动需要激活，先手工打开一次 Excel
