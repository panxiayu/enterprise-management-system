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
  
  // 获取所有在左侧区域（x < 100）的可点击元素
  const leftElements = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a, button, [onclick], [role="button"], [role="link"], [role="menuitem"], li, [class*="icon"]').forEach(el => {
      const rect = el.getBoundingClientRect();
      // 只获取左侧边栏的元素（x < 100）
      if (rect.x < 100 && rect.width > 10 && rect.height > 10) {
        results.push({
          tag: el.tagName,
          text: el.textContent?.trim()?.substring(0, 50) || '',
          title: el.getAttribute('title') || '',
          href: el.href || '',
          onclick: (el.getAttribute('onclick') || '').substring(0, 100),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          class: el.className?.substring(0, 100) || ''
        });
      }
    });
    return results;
  });
  
  console.log('左侧区域可点击元素:');
  leftElements.forEach(item => {
    console.log(`- [${item.tag}] "${item.text || item.title}" at (${item.x}, ${item.y}) ${item.width}x${item.height} class="${item.class}"`);
  });
  
  // 点击每个左侧元素并截图
  for (let i = 0; i < leftElements.length; i++) {
    const item = leftElements[i];
    if (item.y > 50 && item.y < 800 && item.width > 20) {
      console.log(`\n点击: "${item.text || item.title}" at (${item.x + item.width/2}, ${item.y + item.height/2})`);
      await page.mouse.click(item.x + item.width/2, item.y + item.height/2);
      await sleep(2000);
      
      // 检查是否出现考勤相关内容
      const pageContent = await page.evaluate(() => document.body.textContent);
      if (pageContent.includes('考勤') || pageContent.includes('签到') || pageContent.includes('打卡') || pageContent.includes('attendance')) {
        console.log('  -> 可能包含考勤相关内容！');
        await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', `found-attendance-${i}.png`), fullPage: true });
      }
    }
  }
  
  // 截图最终状态
  await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', 'final-state.png'), fullPage: true });
  console.log('\n最终状态截图已保存');
  
  await browser.close();
})();
