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
  
  // 获取左侧菜单结构
  const menuItems = await page.evaluate(() => {
    const results = [];
    // 查找所有可能的菜单元素
    document.querySelectorAll('a, [role="menuitem"], .menu-item, .nav-item, [class*="menu"], [class*="nav"]').forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length < 50 && text.length > 0) {
        results.push({
          tag: el.tagName,
          text: text.substring(0, 50),
          href: el.href || '',
          class: el.className?.substring(0, 100) || '',
          id: el.id || ''
        });
      }
    });
    // 去重
    const seen = new Set();
    return results.filter(item => {
      const key = item.text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  
  console.log('\n页面菜单元素:');
  menuItems.forEach(item => {
    console.log(`- ${item.text} (${item.tag}${item.href ? ', href=' + item.href : ''})`);
  });
  
  // 查找包含"考勤"、"签到"、"打卡"等关键词的元素
  const attendanceKeywords = ['考勤', '签到', '打卡', '出勤', 'attendance'];
  const attendanceElements = await page.evaluate((keywords) => {
    const results = [];
    document.querySelectorAll('*').forEach(el => {
      const text = el.textContent?.trim() || '';
      const href = el.href || '';
      for (const keyword of keywords) {
        if (text.includes(keyword) || href.includes(keyword)) {
          results.push({
            tag: el.tagName,
            text: text.substring(0, 100),
            href: href,
            class: el.className?.substring(0, 100) || '',
            id: el.id || ''
          });
          break;
        }
      }
    });
    return results;
  }, attendanceKeywords);
  
  console.log('\n考勤相关元素:');
  attendanceElements.forEach(item => {
    console.log(`- ${item.text} (${item.tag}${item.href ? ', href=' + item.href : ''})`);
  });
  
  // 截图当前页面
  await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', 'main-page.png'), fullPage: true });
  console.log('\n主页面截图已保存');
  
  await browser.close();
})();
