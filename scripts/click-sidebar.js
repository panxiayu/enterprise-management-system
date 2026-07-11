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
  
  // 获取左侧菜单栏的所有元素（包括图标）
  const sidebarItems = await page.evaluate(() => {
    const results = [];
    // 查找左侧边栏的所有可点击元素
    document.querySelectorAll('.e9sidebar-nav-item, .sidebar-item, [class*="sidebar"] a, [class*="sidebar"] li, [class*="sidebar"] div[class*="icon"]').forEach(el => {
      const text = el.textContent?.trim();
      const title = el.getAttribute('title') || '';
      const onclick = el.getAttribute('onclick') || '';
      const dataId = el.getAttribute('data-id') || '';
      const href = el.href || '';
      
      results.push({
        tag: el.tagName,
        text: (text || '').substring(0, 50),
        title: title,
        onclick: onclick.substring(0, 100),
        dataId: dataId,
        href: href,
        class: el.className?.substring(0, 100) || ''
      });
    });
    return results;
  });
  
  console.log('左侧边栏元素:');
  sidebarItems.forEach(item => {
    console.log(`- [${item.tag}] text="${item.text}" title="${item.title}" class="${item.class}"`);
  });
  
  // 尝试查找并点击带"人事"、"考勤"、"HR"等关键词的菜单
  console.log('\n尝试点击左侧菜单图标...');
  
  // 获取所有左侧菜单项的边界框
  const menuPositions = await page.evaluate(() => {
    const items = document.querySelectorAll('[class*="sidebar"] li, [class*="sidebar"] a, [class*="sidebar"] > div > div');
    return Array.from(items).map((el, index) => {
      const rect = el.getBoundingClientRect();
      return {
        index,
        text: el.textContent?.trim()?.substring(0, 30) || '',
        title: el.getAttribute('title') || '',
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0
      };
    }).filter(item => item.visible && item.x < 100); // 只获取左侧边栏的元素
  });
  
  console.log('\n左侧菜单位置:');
  menuPositions.forEach(item => {
    console.log(`- [${item.index}] "${item.text || item.title}" at (${Math.round(item.x)}, ${Math.round(item.y)}) size=${Math.round(item.width)}x${Math.round(item.height)}`);
  });
  
  // 点击左侧菜单中的不同图标（通常在左侧边栏的垂直菜单）
  // 从上到下依次点击每个菜单项
  for (let i = 0; i < Math.min(10, menuPositions.length); i++) {
    const item = menuPositions[i];
    if (item.y > 50 && item.y < 800) { // 在合理范围内
      console.log(`\n点击菜单项 #${i}: "${item.text || item.title}" at (${Math.round(item.x + item.width/2)}, ${Math.round(item.y + item.height/2)})`);
      await page.mouse.click(item.x + item.width/2, item.y + item.height/2);
      await sleep(1500);
      
      // 截图
      await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', `menu-click-${i}.png`), fullPage: true });
      
      // 检查页面中是否出现"考勤"相关内容
      const hasAttendance = await page.evaluate(() => {
        return document.body.textContent.includes('考勤') || 
               document.body.textContent.includes('签到') ||
               document.body.textContent.includes('打卡');
      });
      
      if (hasAttendance) {
        console.log('  -> 发现考勤相关内容！');
      }
    }
  }
  
  await browser.close();
})();
