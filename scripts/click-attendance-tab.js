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
  
  // 查找并点击"考勤"标签
  console.log('查找"考勤"标签...');
  const clicked = await page.evaluate(() => {
    // 查找所有可能的标签元素
    const elements = document.querySelectorAll('span, div, a, li, [role="tab"]');
    for (const el of elements) {
      const text = el.textContent?.trim();
      if (text === '考勤') {
        el.click();
        return {
          tag: el.tagName,
          text: text,
          class: el.className?.substring(0, 100) || ''
        };
      }
    }
    return null;
  });
  
  if (clicked) {
    console.log('点击了"考勤"标签:', clicked);
    await sleep(3000);
    
    // 截图
    await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', 'attendance-tab.png'), fullPage: true });
    console.log('考勤标签截图已保存');
    
    // 获取页面内容
    const pageContent = await page.evaluate(() => document.body.textContent.substring(0, 2000));
    console.log('\n页面内容（前2000字符）:');
    console.log(pageContent);
  } else {
    console.log('未找到"考勤"标签');
    
    // 获取页面中所有包含"考勤"的元素
    const attendanceElements = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('*').forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.includes('考勤') && text.length < 100) {
          results.push({
            tag: el.tagName,
            text: text.substring(0, 100),
            class: el.className?.substring(0, 50) || ''
          });
        }
      });
      return results;
    });
    
    console.log('\n包含"考勤"的元素:');
    attendanceElements.forEach(item => {
      console.log(`- [${item.tag}] ${item.text}`);
    });
  }
  
  await browser.close();
})();
