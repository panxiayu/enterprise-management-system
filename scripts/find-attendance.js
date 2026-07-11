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
  
  // 查找左侧菜单栏的所有链接和按钮
  const leftMenuItems = await page.evaluate(() => {
    const results = [];
    // 查找左侧菜单栏（通常在左侧边栏）
    const sidebar = document.querySelector('.e9sidebar, .sidebar, [class*="sidebar"], [class*="menu-left"], [class*="left-menu"]');
    
    // 查找所有可能的菜单项
    document.querySelectorAll('a, [role="menuitem"], .menu-item, .nav-item, [class*="menu"], [class*="nav"], [class*="icon"]').forEach(el => {
      const text = el.textContent?.trim();
      const href = el.href || '';
      const onclick = el.getAttribute('onclick') || '';
      const title = el.getAttribute('title') || '';
      
      // 只获取有意义的菜单项
      if ((text && text.length < 30 && text.length > 0) || href || onclick) {
        // 检查是否包含关键词
        const keywords = ['考勤', '签到', '打卡', '人事', 'HR', 'hrm', 'attendance', '人员', '员工'];
        const isRelevant = keywords.some(kw => 
          text?.includes(kw) || href.includes(kw) || onclick.includes(kw) || title.includes(kw)
        );
        
        if (isRelevant || text === '流程' || text === '人事' || text === '通讯录') {
          results.push({
            tag: el.tagName,
            text: text?.substring(0, 50) || '',
            href: href,
            onclick: onclick.substring(0, 100),
            title: title,
            class: el.className?.substring(0, 100) || '',
            id: el.id || ''
          });
        }
      }
    });
    
    // 去重
    const seen = new Set();
    return results.filter(item => {
      const key = item.text + item.href + item.onclick;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  
  console.log('左侧菜单相关元素:');
  leftMenuItems.forEach(item => {
    console.log(`- ${item.text} (${item.tag}${item.href ? ', href=' + item.href : ''}${item.onclick ? ', onclick=' + item.onclick : ''})`);
  });
  
  // 尝试点击"人事"或"流程"菜单
  console.log('\n尝试点击"人事"菜单...');
  try {
    await page.evaluate(() => {
      // 查找并点击"人事"菜单
      const menuItems = Array.from(document.querySelectorAll('a, [role="menuitem"], .menu-item'));
      const hrMenu = menuItems.find(el => el.textContent?.trim() === '人事');
      if (hrMenu) {
        hrMenu.click();
        return true;
      }
      return false;
    });
    await sleep(2000);
    await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', 'hr-menu.png'), fullPage: true });
    console.log('人事菜单截图已保存');
  } catch (e) {
    console.log('点击人事菜单失败: ' + e.message);
  }
  
  // 查找所有iframe
  const iframes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map(iframe => ({
      src: iframe.src,
      id: iframe.id,
      name: iframe.name,
      class: iframe.className
    }));
  });
  console.log('\n页面中的iframe:');
  iframes.forEach(iframe => {
    console.log(`- src=${iframe.src}, id=${iframe.id}, name=${iframe.name}`);
  });
  
  await browser.close();
})();
