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
  
  // 获取顶部导航栏的所有元素
  const headerElements = await page.evaluate(() => {
    const results = [];
    // 查找顶部区域（y < 100）的所有元素
    document.querySelectorAll('a, button, [onclick], [role="button"], [role="link"], span, div').forEach(el => {
      const rect = el.getBoundingClientRect();
      // 只获取顶部区域的元素
      if (rect.y < 100 && rect.y > 30 && rect.width > 10 && rect.height > 10) {
        const text = el.textContent?.trim();
        if (text && text.length < 50) {
          results.push({
            tag: el.tagName,
            text: text.substring(0, 50),
            href: el.href || '',
            onclick: (el.getAttribute('onclick') || '').substring(0, 100),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            class: el.className?.substring(0, 50) || ''
          });
        }
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
  
  console.log('顶部导航栏元素:');
  headerElements.forEach(item => {
    console.log(`- "${item.text}" at (${item.x}, ${item.y}) ${item.width}x${item.height}`);
  });
  
  // 点击顶部导航栏中的不同元素
  const topNavItems = headerElements.filter(item => 
    item.y < 80 && item.y > 30 && item.width > 20
  );
  
  for (const item of topNavItems) {
    console.log(`\n点击: "${item.text}" at (${item.x + item.width/2}, ${item.y + item.height/2})`);
    await page.mouse.click(item.x + item.width/2, item.y + item.height/2);
    await sleep(2000);
    
    // 检查页面内容
    const pageContent = await page.evaluate(() => document.body.textContent);
    const hasAttendance = pageContent.includes('考勤') || pageContent.includes('签到') || pageContent.includes('打卡');
    
    if (hasAttendance) {
      console.log('  -> 发现考勤相关内容！');
      await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', `header-${item.text}.png`), fullPage: true });
    }
    
    // 截图
    await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', `header-click-${item.text}.png`), fullPage: true });
  }
  
  await browser.close();
})();
