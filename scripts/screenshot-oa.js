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
  
  console.log('正在访问泛微OA...');
  await page.goto('http://112.16.178.98:8088/', { waitUntil: 'networkidle2', timeout: 30000 });
  
  // 等待页面加载
  await sleep(3000);
  
  // 截图保存
  const screenshotPath = path.join(__dirname, '..', 'data', 'oa-export', 'login-page.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('截图已保存: ' + screenshotPath);
  
  // 获取所有input元素
  const inputs = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('input, button, a, select, textarea, [onclick]').forEach(el => {
      results.push({
        tag: el.tagName,
        type: el.type || '',
        id: el.id || '',
        name: el.name || '',
        class: el.className?.substring(0, 100) || '',
        placeholder: el.placeholder || '',
        value: el.value?.substring(0, 50) || '',
        text: el.textContent?.trim()?.substring(0, 50) || ''
      });
    });
    return results;
  });
  console.log('\n页面元素:');
  console.log(JSON.stringify(inputs, null, 2));
  
  // 获取页面标题
  const title = await page.title();
  console.log('\n页面标题: ' + title);
  
  // 获取当前URL
  console.log('当前URL: ' + page.url());
  
  await browser.close();
})();
