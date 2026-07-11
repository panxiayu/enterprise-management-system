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
  
  // 尝试直接访问泛微OA考勤模块的常见URL
  const attendanceUrls = [
    'http://112.16.178.98:8088/wui/index.html#/main/hrm/attendance',
    'http://112.16.178.98:8088/wui/index.html#/main/hrm/kq',
    'http://112.16.178.98:8088/wui/index.html#/main/attendance',
    'http://112.16.178.98:8088/wui/index.html#/main/hrm',
  ];
  
  for (const url of attendanceUrls) {
    console.log('尝试: ' + url);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await sleep(2000);
    const content = await page.evaluate(() => document.body.textContent);
    if (content.includes('考勤') || content.includes('签到') || content.includes('打卡')) {
      console.log('-> 发现考勤相关内容！');
      await page.screenshot({ path: 'data/oa-export/attendance-found.png', fullPage: true });
      console.log('当前URL: ' + page.url());
      break;
    }
  }
  
  // 回到主页
  await page.goto('http://112.16.178.98:8088/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);
  
  // 尝试在搜索框输入"考勤"
  console.log('\n尝试搜索"考勤"...');
  try {
    await page.click('[class*="search"] input, [placeholder*="搜索"], input[type="search"]');
    await page.type('[class*="search"] input, [placeholder*="搜索"], input[type="search"]', '考勤');
    await page.keyboard.press('Enter');
    await sleep(3000);
    await page.screenshot({ path: 'data/oa-export/search-attendance.png', fullPage: true });
    console.log('搜索截图已保存');
  } catch(e) {
    console.log('搜索失败: ' + e.message);
  }
  
  // 查找页面顶部的所有图标按钮
  const headerBtns = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('[class*="header"] i, [class*="header"] svg, [class*="header"] [class*="icon"], .e9header i, .e9header svg').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 5) {
        const parent = el.closest('a, button, [onclick], [role="button"]');
        results.push({
          tag: el.tagName,
          class: (el.className?.baseVal || el.className || '').substring(0, 80),
          parentText: parent?.textContent?.trim()?.substring(0, 30) || '',
          parentOnclick: (parent?.getAttribute('onclick') || '').substring(0, 80),
          x: Math.round(rect.x + rect.width/2),
          y: Math.round(rect.y + rect.height/2)
        });
      }
    });
    return results;
  });
  
  console.log('\n顶部图标按钮:');
  headerBtns.forEach(btn => {
    console.log(`- [${btn.tag}] class="${btn.class}" parent="${btn.parentText}" onclick="${btn.parentOnclick}" at (${btn.x}, ${btn.y})`);
  });
  
  // 点击每个顶部图标
  for (const btn of headerBtns) {
    if (btn.x > 100 && btn.y < 60) {
      console.log(`\n点击图标 at (${btn.x}, ${btn.y}) parent="${btn.parentText}"`);
      await page.mouse.click(btn.x, btn.y);
      await sleep(2000);
      
      // 检查是否出现新页面或弹窗
      const newContent = await page.evaluate(() => document.body.textContent);
      if (newContent.includes('人事') || newContent.includes('考勤') || newContent.includes('假')) {
        console.log('-> 发现相关内容！');
        await page.screenshot({ path: `data/oa-export/icon-click-${btn.x}.png`, fullPage: true });
      }
    }
  }
  
  await browser.close();
})();
