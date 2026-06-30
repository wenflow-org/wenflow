const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/admin/dashboard');
  await page.waitForTimeout(2000);
  
  const topbarElements = await page.evaluate(() => {
    const elements = [
      { selector: '.global-search', name: '搜索框容器' },
      { selector: '.el-input__wrapper', name: 'Input Wrapper' },
      { selector: '.admin-topbar__user', name: '用户下拉框' },
      { selector: '.admin-topbar__icon-btn', name: '图标按钮' },
      { selector: '.el-avatar', name: '头像' }
    ];
    
    return elements.map(({ selector, name }) => {
      const el = document.querySelector(selector);
      if (!el) return { name, height: 'not found' };
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el);
      return { 
        name, 
        height: Math.round(rect.height),
        padding: styles.padding,
        border: styles.border
      };
    });
  });
  
  console.log('\n顶栏元素详细信息：');
  console.log('='.repeat(50));
  topbarElements.forEach(el => {
    console.log(`${el.name}:`);
    console.log(`  高度: ${el.height}px`);
    console.log(`  Padding: ${el.padding}`);
    console.log(`  Border: ${el.border}`);
    console.log('');
  });
  
  await browser.close();
})();
