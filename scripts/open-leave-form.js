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
  
  // 点击"XL-请假申请流程"
  console.log('点击"XL-请假申请流程"...');
  await page.evaluate(() => {
    const items = document.querySelectorAll('a, span, div, li');
    for (const item of items) {
      if (item.textContent?.trim() === 'XL-请假申请流程') {
        item.click();
        return;
      }
    }
  });
  await sleep(5000);
  
  // 检查是否打开了新标签页
  const pages = await browser.pages();
  console.log(`打开的标签页数量: ${pages.length}`);
  
  // 切换到新标签页
  let formPage = page;
  if (pages.length > 1) {
    formPage = pages[pages.length - 1];
    await formPage.setViewport({ width: 1920, height: 1080 });
    console.log('已切换到新标签页');
  }
  
  await sleep(3000);
  
  // 截图
  await formPage.screenshot({ path: 'data/oa-export/leave-form-01.png', fullPage: true });
  console.log('截图: 请假申请表单');
  console.log('当前URL: ' + formPage.url());
  
  // 获取表单元素
  const formElements = await formPage.evaluate(() => {
    const results = [];
    document.querySelectorAll('input, select, textarea, button').forEach(el => {
      results.push({
        tag: el.tagName,
        type: el.type || '',
        id: el.id || '',
        name: el.name || '',
        placeholder: el.placeholder || '',
        value: el.value?.substring(0, 50) || '',
        class: el.className?.substring(0, 80) || ''
      });
    });
    return results;
  });
  
  console.log('\n表单元素:');
  formElements.forEach(el => {
    console.log(`  [${el.tag}] id="${el.id}" name="${el.name}" placeholder="${el.placeholder}" class="${el.class}"`);
  });
  
  await browser.close();
})();
