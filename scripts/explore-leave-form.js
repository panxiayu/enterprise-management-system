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
  
  // 点击"我的门户"
  console.log('点击"我的门户"...');
  await page.evaluate(() => {
    const items = document.querySelectorAll('li, a, span, div');
    for (const item of items) {
      if (item.textContent?.trim() === '个人门户') {
        item.click();
        return;
      }
    }
  });
  await sleep(3000);
  await page.screenshot({ path: 'data/oa-export/leave-01-myportal.png', fullPage: true });
  console.log('截图: 我的门户');
  
  // 点击"我的流程"
  console.log('查找"我的流程"...');
  const clicked = await page.evaluate(() => {
    const items = document.querySelectorAll('a, span, div, li, [onclick]');
    for (const item of items) {
      const text = item.textContent?.trim();
      if (text === '我的流程' || text?.includes('我的流程')) {
        item.click();
        return true;
      }
    }
    return false;
  });
  console.log('点击我的流程:', clicked);
  await sleep(3000);
  await page.screenshot({ path: 'data/oa-export/leave-02-myflow.png', fullPage: true });
  
  // 如果没找到，尝试在iframe中查找
  if (!clicked) {
    const frames = page.frames();
    for (const frame of frames) {
      try {
        const found = await frame.evaluate(() => {
          const items = document.querySelectorAll('a, span, div, li');
          for (const item of items) {
            if (item.textContent?.trim().includes('我的流程')) {
              item.click();
              return true;
            }
          }
          return false;
        });
        if (found) {
          console.log('在iframe中找到并点击了我的流程');
          await sleep(3000);
          await page.screenshot({ path: 'data/oa-export/leave-02-myflow.png', fullPage: true });
          break;
        }
      } catch (e) {}
    }
  }
  
  // 查找"新建流程"
  console.log('查找"新建流程"...');
  await page.evaluate(() => {
    const items = document.querySelectorAll('a, span, div, li, button');
    for (const item of items) {
      if (item.textContent?.trim().includes('新建流程') || item.textContent?.trim().includes('新建')) {
        item.click();
        return;
      }
    }
  });
  await sleep(3000);
  await page.screenshot({ path: 'data/oa-export/leave-03-newflow.png', fullPage: true });
  
  // 查找所有可点击的元素，列出菜单结构
  const menuItems = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a, span, div, li').forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length < 30 && text.length > 0) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          results.push({ text, x: Math.round(rect.x), y: Math.round(rect.y) });
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
  
  console.log('\n页面上的菜单项:');
  menuItems.forEach(item => {
    if (item.text.includes('流程') || item.text.includes('人事') || item.text.includes('请假') || 
        item.text.includes('新建') || item.text.includes('我的')) {
      console.log(`  "${item.text}" at (${item.x}, ${item.y})`);
    }
  });
  
  await browser.close();
})();
