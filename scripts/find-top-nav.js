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
  
  // 获取页面中所有链接和按钮
  const allLinks = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('a, button, [onclick], [role="button"], [role="link"]').forEach(el => {
      const text = el.textContent?.trim();
      const href = el.href || '';
      const onclick = el.getAttribute('onclick') || '';
      const title = el.getAttribute('title') || '';
      
      if (text || href || onclick) {
        results.push({
          tag: el.tagName,
          text: (text || '').substring(0, 100),
          href: href,
          onclick: onclick.substring(0, 100),
          title: title
        });
      }
    });
    return results;
  });
  
  // 筛选有意义的链接
  const meaningfulLinks = allLinks.filter(link => {
    const keywords = ['人事', '考勤', 'HR', 'hrm', '签到', '打卡', '人员', '组织', '流程', '审批', '假', '勤'];
    return keywords.some(kw => 
      link.text.includes(kw) || link.href.includes(kw) || link.onclick.includes(kw) || link.title.includes(kw)
    );
  });
  
  console.log('有意义的链接:');
  meaningfulLinks.forEach(link => {
    console.log(`- [${link.tag}] text="${link.text}" href="${link.href}" onclick="${link.onclick}"`);
  });
  
  // 检查所有iframe
  const iframeInfo = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map(iframe => ({
      src: iframe.src,
      id: iframe.id,
      name: iframe.name,
      width: iframe.width,
      height: iframe.height
    }));
  });
  
  console.log('\niframe信息:');
  iframeInfo.forEach(iframe => {
    console.log(`- src="${iframe.src}" id="${iframe.id}" name="${iframe.name}"`);
  });
  
  // 如果有iframe，切换到iframe中查找
  if (iframeInfo.length > 0) {
    console.log('\n尝试访问iframe内容...');
    for (const iframe of iframeInfo) {
      if (iframe.src && iframe.src !== 'about:blank') {
        console.log(`\n访问iframe: ${iframe.src}`);
        // 在新标签页中打开iframe URL
        const newPage = await browser.newPage();
        await newPage.goto(iframe.src, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);
        
        // 获取iframe中的链接
        const iframeLinks = await newPage.evaluate(() => {
          const results = [];
          document.querySelectorAll('a, button, [onclick]').forEach(el => {
            const text = el.textContent?.trim();
            if (text && text.length < 50) {
              results.push({
                text: text,
                href: el.href || '',
                onclick: (el.getAttribute('onclick') || '').substring(0, 100)
              });
            }
          });
          return results;
        });
        
        console.log('iframe中的链接:');
        iframeLinks.slice(0, 20).forEach(link => {
          console.log(`  - ${link.text} href="${link.href}" onclick="${link.onclick}"`);
        });
        
        // 截图
        await newPage.screenshot({ path: path.join(__dirname, '..', 'data', 'oa-export', `iframe-${iframe.id || 'main'}.png`), fullPage: true });
        
        await newPage.close();
      }
    }
  }
  
  await browser.close();
})();
