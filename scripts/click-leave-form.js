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
  
  // 点击"XL-请假申请流程" (在常用流程区域)
  console.log('点击"XL-请假申请流程"...');
  await page.evaluate(() => {
    const items = document.querySelectorAll('span');
    for (const item of items) {
      if (item.textContent?.trim() === 'XL-请假申请流程') {
        item.click();
        return;
      }
    }
  });
  
  // 等待新标签页打开
  await sleep(5000);
  
  // 获取所有标签页
  const pages = await browser.pages();
  console.log(`标签页数量: ${pages.length}`);
  
  // 切换到最新打开的标签页
  const formPage = pages[pages.length - 1];
  await formPage.setViewport({ width: 1920, height: 1080 });
  
  // 等待页面加载
  await sleep(10000);
  
  // 截图
  await formPage.screenshot({ path: 'data/oa-export/leave-form-actual.png', fullPage: true });
  console.log('截图已保存');
  console.log('当前URL: ' + formPage.url());
  
  // 获取页面标题
  const title = await formPage.title();
  console.log('页面标题: ' + title);
  
  // 获取所有iframe
  const iframes = formPage.frames();
  console.log(`iframe数量: ${iframes.length}`);
  
  for (let i = 0; i < iframes.length; i++) {
    const frame = iframes[i];
    const frameUrl = frame.url();
    console.log(`Frame ${i}: ${frameUrl}`);
    
    // 在每个frame中查找表单元素
    try {
      const formElements = await frame.evaluate(() => {
        const results = [];
        document.querySelectorAll('input, select, textarea, button, [role="combobox"], [role="button"]').forEach(el => {
          results.push({
            tag: el.tagName,
            type: el.type || '',
            id: el.id || '',
            name: el.name || '',
            placeholder: el.placeholder || '',
            class: el.className?.substring(0, 80) || '',
            text: el.textContent?.trim()?.substring(0, 30) || ''
          });
        });
        return results;
      });
      
      if (formElements.length > 0) {
        console.log(`  Frame ${i} 表单元素:`);
        formElements.forEach(el => {
          console.log(`    [${el.tag}] id="${el.id}" placeholder="${el.placeholder}" class="${el.class}"`);
        });
      }
    } catch (e) {}
  }
  
  await browser.close();
})();
