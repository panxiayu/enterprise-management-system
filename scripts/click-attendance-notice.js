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
  
  console.log('当前URL: ' + page.url());
  
  // 点击"考勤"标签
  console.log('点击"考勤"标签...');
  const clicked = await page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent?.trim() === '考勤') {
        span.click();
        return true;
      }
    }
    return false;
  });
  
  if (clicked) {
    console.log('已点击"考勤"标签');
    await sleep(2000);
    
    // 截图
    await page.screenshot({ path: 'data/oa-export/attendance-tab-clicked.png', fullPage: true });
    
    // 查找"2026.6.15-2026.6.21考勤数据"链接
    console.log('查找考勤数据链接...');
    const attendanceLink = await page.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const link of links) {
        const text = link.textContent?.trim();
        if (text && text.includes('2026.6.15') && text.includes('考勤')) {
          return {
            text: text,
            href: link.href || '',
            onclick: link.getAttribute('onclick') || ''
          };
        }
      }
      return null;
    });
    
    if (attendanceLink) {
      console.log('找到考勤数据链接:', attendanceLink);
      
      // 点击链接
      console.log('点击考勤数据链接...');
      await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const link of links) {
          const text = link.textContent?.trim();
          if (text && text.includes('2026.6.15') && text.includes('考勤')) {
            link.click();
            return true;
          }
        }
        return false;
      });
      
      await sleep(3000);
      
      // 截图
      await page.screenshot({ path: 'data/oa-export/attendance-data-page.png', fullPage: true });
      console.log('考勤数据页面截图已保存');
      console.log('当前URL: ' + page.url());
      
      // 获取页面内容
      const content = await page.evaluate(() => document.body.textContent.substring(0, 3000));
      console.log('\n页面内容:');
      console.log(content);
    } else {
      console.log('未找到"2026.6.15-2026.6.21考勤数据"链接');
      
      // 列出所有链接
      const allLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).map(a => a.textContent?.trim()).filter(t => t && t.length > 5 && t.length < 100);
      });
      console.log('\n页面上的链接:');
      allLinks.forEach(link => console.log('- ' + link));
    }
  } else {
    console.log('未找到"考勤"标签');
  }
  
  await browser.close();
})();
