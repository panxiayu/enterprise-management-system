/**
 * 泛微OA考勤数据下载脚本
 *
 * 流程：
 * 1. 登录泛微OA (http://112.16.178.98:8088/)
 * 2. 点击通知公告区域的"考勤"标签
 * 3. 点击最新的考勤数据链接
 * 4. 点击"下载"按钮下载Excel文件
 * 5. 保存到 data/oa-export/ 目录
 *
 * 使用方法：
 *   node scripts/oa-attendance-sync.js
 *
 * 环境变量：
 *   OA_USERNAME - OA登录账号
 *   OA_PASSWORD - OA登录密码
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 配置
const CONFIG = {
  oaUrl: 'http://112.16.178.98:8088/',
  username: process.env.OA_USERNAME,
  password: process.env.OA_PASSWORD,
  outputDir: path.join(__dirname, '..', 'data', 'oa-export'),
  browser: {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 1920, height: 1080 },
    timeout: 60000
  }
};

/**
 * 登录泛微OA
 */
async function loginToOA(page) {
  await page.goto(CONFIG.oaUrl, { waitUntil: 'networkidle2', timeout: CONFIG.browser.timeout });
  await page.waitForSelector('#loginid', { timeout: 10000 });
  await page.type('#loginid', CONFIG.username, { delay: 50 });
  await page.type('#userpassword', CONFIG.password, { delay: 50 });
  await page.click('#submit');
  await sleep(5000);
  console.log('登录成功');
}

/**
 * 下载考勤文件
 * @returns {string} 下载的文件路径
 */
async function downloadAttendanceFile(page) {
  // 点击"考勤"标签
  console.log('点击"考勤"标签...');
  await page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent?.trim() === '考勤') {
        span.click();
        return;
      }
    }
  });
  await sleep(2000);

  // 查找最新的考勤数据链接
  console.log('查找最新考勤数据链接...');
  const latestLink = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    let latest = null;
    for (const link of links) {
      const text = link.textContent?.trim();
      if (text && text.includes('考勤') && text.includes('-')) {
        if (!latest || text > latest.text) {
          latest = { text, href: link.href || '' };
        }
      }
    }
    return latest;
  });

  if (!latestLink) {
    throw new Error('未找到考勤数据链接');
  }

  console.log(`找到考勤数据: ${latestLink.text}`);

  // 点击考勤数据链接
  await page.evaluate((linkText) => {
    const links = document.querySelectorAll('a');
    for (const link of links) {
      if (link.textContent?.trim() === linkText) {
        link.click();
        return;
      }
    }
  }, latestLink.text);
  await sleep(3000);

  // 查找并点击"下载"按钮（可能在主页面或iframe中）
  console.log('查找下载按钮...');
  let downloadClicked = false;

  // 先在主页面查找
  downloadClicked = await page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent?.trim() === '下载') {
        span.click();
        return true;
      }
    }
    return false;
  });

  // 如果主页面没找到，在iframe中查找
  if (!downloadClicked) {
    const frames = page.frames();
    for (const frame of frames) {
      try {
        downloadClicked = await frame.evaluate(() => {
          const spans = document.querySelectorAll('span');
          for (const span of spans) {
            if (span.textContent?.trim() === '下载') {
              span.click();
              return true;
            }
          }
          return false;
        });
        if (downloadClicked) break;
      } catch (e) {
        // 跨域frame无法访问
      }
    }
  }

  if (!downloadClicked) {
    throw new Error('未找到下载按钮');
  }

  console.log('已点击下载按钮');

  // 等待下载完成
  await sleep(10000);

  // 查找下载的文件
  const files = fs.readdirSync(CONFIG.outputDir);
  const xlsxFiles = files
    .filter(f => f.endsWith('.xlsx') && f.includes('考勤'))
    .map(f => ({
      name: f,
      time: fs.statSync(path.join(CONFIG.outputDir, f)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  if (xlsxFiles.length === 0) {
    throw new Error('未找到下载的考勤文件');
  }

  const downloadedFile = xlsxFiles[0].name;
  const downloadedPath = path.join(CONFIG.outputDir, downloadedFile);

  // 重命名为标准格式
  const now = new Date();
  const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const newPath = path.join(CONFIG.outputDir, `attendance-${month}.xlsx`);

  if (downloadedPath !== newPath) {
    if (fs.existsSync(newPath)) {
      fs.unlinkSync(newPath);
    }
    fs.renameSync(downloadedPath, newPath);
    console.log(`考勤文件已保存: ${newPath}`);
    return newPath;
  }

  console.log(`考勤文件已保存: ${downloadedPath}`);
  return downloadedPath;
}

/**
 * 主函数
 */
async function main() {
  console.log('=== 泛微OA考勤数据下载 ===');
  console.log(`开始时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

  if (!CONFIG.username || !CONFIG.password) {
    console.error('错误: 请设置 OA_USERNAME 和 OA_PASSWORD 环境变量');
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  let browser = null;
  try {
    console.log('启动浏览器...');
    browser = await puppeteer.launch(CONFIG.browser);
    const page = await browser.newPage();

    // 设置下载目录
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: CONFIG.outputDir
    });

    // 登录
    await loginToOA(page);

    // 下载考勤文件
    const filePath = await downloadAttendanceFile(page);

    console.log('=== 考勤数据下载完成 ===');
    return filePath;

  } catch (error) {
    console.error('执行失败:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// 执行主函数
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('=== 执行失败 ===');
    console.error(error);
    process.exit(1);
  });
