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
  
  // 点击展开菜单的图标（通常是左上角的汉堡菜单图标）
  console.log('点击展开菜单图标...');
  await page.click('.anticon-menu-fold');
  await sleep(2000);
  
  // 截图
  await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', 'expanded-menu.png'), fullPage: true });
  console.log('展开菜单截图已保存');
  
  // 获取展开后的菜单项
  const menuItems = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('.ant-menu-item, [role="menuitem"], .menu-item').forEach(el => {
      const text = el.textContent?.trim();
      if (text) {
        results.push({
          text: text.substring(0, 50),
          class: el.className?.substring(0, 100) || ''
        });
      }
    });
    return results;
  });
  
  console.log('\n展开后的菜单项:');
  menuItems.forEach(item => {
    console.log(`- ${item.text}`);
  });
  
  // 查找考勤、人事、HR相关菜单
  const attendanceKeywords = ['考勤', '人事', 'HR', 'hrm', '签到', '打卡', '人员'];
  const foundItems = menuItems.filter(item => 
    attendanceKeywords.some(kw => item.text.includes(kw))
  );
  
  console.log('\n考勤/人事相关菜单:');
  foundItems.forEach(item => {
    console.log(`- ${item.text}`);
  });
  
  // 如果找到人事菜单，点击它
  if (foundItems.length > 0) {
    console.log(`\n点击菜单: "${foundItems[0].text}"`);
    await page.evaluate((text) => {
      const items = Array.from(document.querySelectorAll('.ant-menu-item, [role="menuitem"]'));
      const target = items.find(el => el.textContent?.trim() === text);
      if (target) target.click();
    }, foundItems[0].text);
    await sleep(3000);
    await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', 'attendance-page.png'), fullPage: true });
    console.log('考勤页面截图已保存');
  }
  
  await browser.close();
})();
