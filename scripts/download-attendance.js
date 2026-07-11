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
  
  // 点击考勤数据链接
  console.log('点击考勤数据链接...');
  await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    for (const link of links) {
      const text = link.textContent?.trim();
      if (text && text.includes('2026.6.15') && text.includes('考勤')) {
        link.click();
        return;
      }
    }
  });
  await sleep(3000);
  
  // 滚动到底部
  console.log('滚动到底部...');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(2000);
  
  // 截图底部区域
  await page.screenshot({ path: 'data/oa-export/attendance-bottom.png', fullPage: true });
  
  // 查找下载按钮/链接
  console.log('查找下载按钮...');
  const downloadElements = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a, button, [onclick], [class*="download"], [class*="export"]').forEach(el => {
      const text = el.textContent?.trim();
      const onclick = el.getAttribute('onclick') || '';
      const href = el.href || '';
      const classAttr = el.className || '';
      
      if (text?.includes('下载') || text?.includes('导出') || text?.includes('Download') ||
          onclick.includes('download') || onclick.includes('export') ||
          href.includes('download') || href.includes('export') ||
          classAttr.includes('download') || classAttr.includes('export')) {
        results.push({
          tag: el.tagName,
          text: (text || '').substring(0, 50),
          href: href,
          onclick: onclick.substring(0, 200),
          class: classAttr.substring(0, 100)
        });
      }
    });
    return results;
  });
  
  console.log('下载相关元素:');
  downloadElements.forEach(el => {
    console.log(`- [${el.tag}] text="${el.text}" href="${el.href}" onclick="${el.onclick}"`);
  });
  
  // 查找iframe中的下载按钮
  const frames = page.frames();
  console.log(`\n页面共有 ${frames.length} 个frame`);
  
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    try {
      const frameUrl = frame.url();
      console.log(`Frame ${i}: ${frameUrl}`);
      
      // 在每个frame中查找下载按钮
      const frameDownloadBtns = await frame.evaluate(() => {
        const results = [];
        document.querySelectorAll('a, button').forEach(el => {
          const text = el.textContent?.trim();
          if (text?.includes('下载') || text?.includes('导出')) {
            results.push({
              tag: el.tagName,
              text: text.substring(0, 50),
              href: el.href || '',
              onclick: (el.getAttribute('onclick') || '').substring(0, 200)
            });
          }
        });
        return results;
      });
      
      if (frameDownloadBtns.length > 0) {
        console.log(`  Frame ${i} 中的下载按钮:`);
        frameDownloadBtns.forEach(btn => {
          console.log(`  - [${btn.tag}] "${btn.text}" href="${btn.href}" onclick="${btn.onclick}"`);
        });
      }
    } catch (e) {
      // 跨域frame无法访问
    }
  }
  
  await browser.close();
})();
