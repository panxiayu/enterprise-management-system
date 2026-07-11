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
  
  // 输入用户名
  console.log('输入用户名: ' + process.env.OA_USERNAME);
  await page.type('#loginid', process.env.OA_USERNAME, { delay: 50 });
  
  // 输入密码
  console.log('输入密码...');
  await page.type('#userpassword', process.env.OA_PASSWORD, { delay: 50 });
  
  // 截图（登录前）
  await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', 'before-login.png') });
  console.log('登录前截图已保存');
  
  // 点击登录按钮
  console.log('点击登录按钮...');
  await page.click('#submit');
  
  // 等待页面跳转
  await sleep(5000);
  
  // 截图（登录后）
  await page.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', 'after-login.png'), fullPage: true });
  console.log('登录后截图已保存');
  
  // 获取当前URL
  console.log('当前URL: ' + page.url());
  
  // 获取页面标题
  const title = await page.title();
  console.log('页面标题: ' + title);
  
  // 检查是否有错误信息
  const errorText = await page.evaluate(() => {
    const errorEl = document.querySelector('.e9login-form-error, .error-message, .ant-message-error');
    return errorEl ? errorEl.textContent : '没有发现错误信息';
  });
  console.log('错误信息: ' + errorText);
  
  await browser.close();
  console.log('测试完成');
})();
