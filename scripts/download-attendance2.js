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
  console.log('直接访问考勤文档页面...');
  await page.goto('http://112.16.178.98:8088/spa/document/index.jsp?openAttachment=0&id=55914&newsDataType=sql&router=1#/main/document/detail?_key=sndfqx', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  await sleep(3000);
  
  // 截图
  await page.screenshot({ path: 'data/oa-export/attendance-doc.png', fullPage: true });
  console.log('文档页面截图已保存');
  
  // 滚动到底部
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1000);
  
  // 查找所有链接和按钮
  const allElements = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a, button, [onclick], [class*="download"], [class*="attach"], [class*="file"]').forEach(el => {
      const text = el.textContent?.trim();
      const href = el.href || '';
      const onclick = el.getAttribute('onclick') || '';
      const classAttr = el.className || '';
      
      if (text || href || onclick) {
        results.push({
          tag: el.tagName,
          text: (text || '').substring(0, 80),
          href: href,
          onclick: onclick.substring(0, 200),
          class: classAttr.substring(0, 100)
        });
      }
    });
    return results;
  });
  
  console.log('\n页面元素:');
  allElements.forEach(el => {
    console.log(`- [${el.tag}] "${el.text}" href="${el.href}" onclick="${el.onclick}"`);
  });
  
  // 截图底部
  await page.screenshot({ path: 'data/oa-export/attendance-doc-bottom.png', fullPage: true });
  
  await browser.close();
})();
