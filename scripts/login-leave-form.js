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
  
  // 登录主系统
  await page.goto('http://112.16.178.98:8088/', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.type('#loginid', process.env.OA_USERNAME, { delay: 50 });
  await page.type('#userpassword', process.env.OA_PASSWORD, { delay: 50 });
  await page.click('#submit');
  await sleep(5000);
  console.log('主系统登录成功');
  
  // 点击"XL-请假申请流程"
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
  
  await sleep(5000);
  
  // 获取所有标签页
  const pages = await browser.pages();
  const formPage = pages[pages.length - 1];
  await formPage.setViewport({ width: 1920, height: 1080 });
  
  // 等待页面加载
  await sleep(10000);
  
  // 查找iframe中的登录表单
  const iframes = formPage.frames();
  let loginFrame = null;
  
  for (const frame of iframes) {
    try {
      const hasLogin = await frame.evaluate(() => {
        return document.querySelector('#password') !== null;
      });
      if (hasLogin) {
        loginFrame = frame;
        break;
      }
    } catch (e) {}
  }
  
  if (loginFrame) {
    console.log('找到登录iframe，尝试登录...');
    
    // 填写登录名
    await loginFrame.type('input[placeholder="登录名"]', process.env.OA_USERNAME, { delay: 50 });
    
    // 填写密码
    await loginFrame.type('#password', process.env.OA_PASSWORD, { delay: 50 });
    
    // 点击登录按钮
    await loginFrame.click('button.ant-btn-primary');
    
    console.log('已提交登录');
    await sleep(10000);
    
    // 截图
    await formPage.screenshot({ path: 'data/oa-export/leave-form-after-login.png', fullPage: true });
    console.log('截图已保存');
    console.log('当前URL: ' + formPage.url());
    
    // 再次检查iframe
    const newIframes = formPage.frames();
    console.log(`iframe数量: ${newIframes.length}`);
    
    for (let i = 0; i < newIframes.length; i++) {
      const frame = newIframes[i];
      const frameUrl = frame.url();
      console.log(`Frame ${i}: ${frameUrl.substring(0, 100)}`);
      
      // 查找表单元素
      try {
        const formElements = await frame.evaluate(() => {
          const results = [];
          document.querySelectorAll('input, select, textarea, button, [role="combobox"]').forEach(el => {
            results.push({
              tag: el.tagName,
              type: el.type || '',
              id: el.id || '',
              placeholder: el.placeholder || '',
              class: el.className?.substring(0, 50) || ''
            });
          });
          return results;
        });
        
        if (formElements.length > 0) {
          console.log(`  表单元素:`);
          formElements.forEach(el => {
            console.log(`    [${el.tag}] id="${el.id}" placeholder="${el.placeholder}"`);
          });
        }
      } catch (e) {}
    }
  } else {
    console.log('未找到登录iframe');
  }
  
  await browser.close();
})();
