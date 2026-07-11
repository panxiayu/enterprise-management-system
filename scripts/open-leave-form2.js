require('dotenv').config();
const puppeteer = require('puppeteer');
const path = require('path');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  
  // 登录
  await page.goto('http://112.16.178.98:8088/', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.type('#loginid', process.env.OA_USERNAME, { delay: 50 });
  await page.type('#userpassword', process.env.OA_PASSWORD, { delay: 50 });
  await page.click('#submit');
  await sleep(5000);
  console.log('登录成功');
  
  // 点击"新建流程"按钮
  console.log('点击"新建流程"...');
  await page.evaluate(() => {
    const items = document.querySelectorAll('a, span, div, li, button');
    for (const item of items) {
      if (item.textContent?.trim() === '新建流程') {
        item.click();
        return;
      }
    }
  });
  await sleep(3000);
  
  // 检查新标签页
  const pages = await browser.pages();
  let formPage = pages.length > 1 ? pages[pages.length - 1] : page;
  if (pages.length > 1) {
    await formPage.setViewport({ width: 1920, height: 1080 });
    console.log('已切换到新标签页');
  }
  await sleep(3000);
  
  // 截图
  await formPage.screenshot({ path: 'data/oa-export/leave-form-01.png', fullPage: true });
  console.log('截图已保存');
  console.log('当前URL: ' + formPage.url());
  
  // 获取页面中所有文本内容
  const pageTexts = await formPage.evaluate(() => {
    const results = [];
    document.querySelectorAll('a, span, div, li, button, h1, h2, h3, h4').forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length < 50 && text.length > 0) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.y > 50) {
          results.push({
            text,
            tag: el.tagName,
            x: Math.round(rect.x),
            y: Math.round(rect.y)
          });
        }
      }
    });
    // 去重
    const seen = new Set();
    return results.filter(item => {
      if (seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    });
  });
  
  console.log('\n页面元素:');
  pageTexts.forEach(item => {
    if (item.text.includes('流程') || item.text.includes('人事') || item.text.includes('请假') ||
        item.text.includes('申请') || item.text.includes('考勤') || item.text.includes('假')) {
      console.log(`  [${item.tag}] "${item.text}" at (${item.x}, ${item.y})`);
    }
  });
  
  await browser.close();
})();
