require('dotenv').config();
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const downloadPath = path.join(__dirname, '..', 'data', 'oa-export');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  
  // 设置下载目录
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadPath
  });
  
  // 登录
  await page.goto('http://112.16.178.98:8088/', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.type('#loginid', process.env.OA_USERNAME, { delay: 50 });
  await page.type('#userpassword', process.env.OA_PASSWORD, { delay: 50 });
  await page.click('#submit');
  await sleep(5000);
  
  // 直接访问考勤文档页面
  console.log('访问考勤文档页面...');
  await page.goto('http://112.16.178.98:8088/spa/document/index.jsp?openAttachment=0&id=55914&newsDataType=sql&router=1#/main/document/detail?_key=sndfqx', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  await sleep(3000);
  
  // 点击"下载"按钮
  console.log('点击下载按钮...');
  const clicked = await page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent?.trim() === '下载') {
        span.click();
        return true;
      }
    }
    return false;
  });
  
  if (clicked) {
    console.log('已点击下载按钮');
  } else {
    console.log('未找到下载按钮，尝试其他方式...');
    // 尝试点击包含"下载"的元素
    await page.evaluate(() => {
      document.querySelectorAll('a, button, div, span').forEach(el => {
        if (el.textContent?.trim() === '下载') {
          el.click();
        }
      });
    });
  }
  
  // 等待下载完成
  console.log('等待下载完成...');
  await sleep(10000);
  
  // 检查下载的文件
  const files = fs.readdirSync(downloadPath);
  console.log('\n下载目录中的文件:');
  files.forEach(file => {
    const stat = fs.statSync(path.join(downloadPath, file));
    console.log(`- ${file} (${(stat.size / 1024).toFixed(1)} KB)`);
  });
  
  // 查找新下载的xlsx文件
  const xlsxFiles = files.filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
  if (xlsxFiles.length > 0) {
    console.log('\n找到Excel文件:');
    xlsxFiles.forEach(f => console.log('- ' + f));
  }
  
  await browser.close();
})();
