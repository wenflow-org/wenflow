import { test, expect, Page } from '@playwright/test';

/**
 * WenFlow Admin 页面视觉检查测试
 * 检查暗黑模式、输入框高度、卡片样式一致性
 */

// 测试的管理页面列表
const ADMIN_PAGES = [
  { name: 'Dashboard', path: '/admin/dashboard' },
  { name: 'SessionCockpit', path: '/admin/session-cockpit' },
  { name: 'Skills', path: '/admin/skills' },
  { name: 'AgentEditor', path: '/admin/agents/editor' },
  { name: 'AgentTopology', path: '/admin/agents/topology' },
  { name: 'ExecutionLogs', path: '/admin/execution-logs' },
  { name: 'OrchestratorDefinitions', path: '/admin/orchestrator-definitions' },
  { name: 'VirtualLearners', path: '/admin/virtual-learners' },
  { name: 'RegressionLab', path: '/admin/regression-lab' },
];

// 辅助函数：切换到暗黑模式
async function switchToDarkMode(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('wenflow-theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.reload();
  await page.waitForTimeout(1000);
}

// 辅助函数：切换到亮色模式
async function switchToLightMode(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('wenflow-theme', 'light');
    document.documentElement.setAttribute('data-theme', 'light');
  });
  await page.reload();
  await page.waitForTimeout(1000);
}

// 辅助函数：获取元素的计算样式
async function getComputedStyle(page: Page, selector: string, property: string) {
  return await page.evaluate(
    ({ sel, prop }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return window.getComputedStyle(el).getPropertyValue(prop);
    },
    { sel: selector, prop: property }
  );
}

// 辅助函数：获取所有匹配元素的样式
async function getAllComputedStyles(page: Page, selector: string, property: string) {
  return await page.evaluate(
    ({ sel, prop }) => {
      const elements = document.querySelectorAll(sel);
      return Array.from(elements).map((el) => 
        window.getComputedStyle(el).getPropertyValue(prop)
      );
    },
    { sel: selector, prop: property }
  );
}

test.describe('Admin 页面视觉检查', () => {
  test.beforeEach(async ({ page }) => {
    // 设置视口大小
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('所有页面能正常加载', async ({ page }) => {
    for (const adminPage of ADMIN_PAGES) {
      console.log(`检查页面：${adminPage.name} (${adminPage.path})`);
      
      const response = await page.goto(adminPage.path, { 
        waitUntil: 'domcontentloaded',
        timeout: 10000 
      });
      
      expect(response?.status()).toBeLessThan(400);
      
      // 等待页面渲染
      await page.waitForTimeout(2000);
    }
  });

  test('暗黑模式：所有页面背景色正确', async ({ page }) => {
    const results: any[] = [];

    for (const adminPage of ADMIN_PAGES) {
      await page.goto(adminPage.path, { waitUntil: 'domcontentloaded' });
      await switchToDarkMode(page);

      // 检查页面背景色
      const bgColor = await getComputedStyle(page, 'body', 'background-color');
      
      // 检查卡片背景色
      const cardBgColors = await getAllComputedStyles(
        page,
        '.el-card, [class*="card"], [class*="panel"]',
        'background-color'
      );

      results.push({
        page: adminPage.name,
        bodyBg: bgColor,
        cardBgCount: cardBgColors.length,
        cardBgSample: cardBgColors[0],
      });

      console.log(`${adminPage.name} 暗黑模式背景：`);
      console.log(`  - Body: ${bgColor}`);
      console.log(`  - 卡片数量: ${cardBgColors.length}`);
      console.log(`  - 卡片背景示例: ${cardBgColors[0]}`);
    }

    // 验证没有白色背景（暗黑模式下）
    for (const result of results) {
      expect(result.bodyBg).not.toContain('255, 255, 255');
    }
  });

  test('输入框高度一致性检查', async ({ page }) => {
    const results: any[] = [];

    for (const adminPage of ADMIN_PAGES) {
      await page.goto(adminPage.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      // 获取所有输入框的高度
      const inputHeights = await page.evaluate(() => {
        const inputs = document.querySelectorAll('.el-input__wrapper, .el-input__inner');
        return Array.from(inputs).map((el) => {
          const rect = el.getBoundingClientRect();
          return Math.round(rect.height);
        });
      });

      // 获取所有按钮的高度
      const buttonHeights = await page.evaluate(() => {
        const buttons = document.querySelectorAll('.el-button');
        return Array.from(buttons).map((el) => {
          const rect = el.getBoundingClientRect();
          return Math.round(rect.height);
        });
      });

      // 统计高度分布
      const inputHeightCounts = inputHeights.reduce((acc: any, h) => {
        acc[h] = (acc[h] || 0) + 1;
        return acc;
      }, {});

      const buttonHeightCounts = buttonHeights.reduce((acc: any, h) => {
        acc[h] = (acc[h] || 0) + 1;
        return acc;
      }, {});

      results.push({
        page: adminPage.name,
        inputHeights: inputHeightCounts,
        buttonHeights: buttonHeightCounts,
      });

      console.log(`${adminPage.name} 高度分布：`);
      console.log(`  - 输入框: ${JSON.stringify(inputHeightCounts)}`);
      console.log(`  - 按钮: ${JSON.stringify(buttonHeightCounts)}`);
    }

    // 生成报告
    console.log('\n======== 输入框高度一致性报告 ========');
    for (const result of results) {
      const inputHeightKeys = Object.keys(result.inputHeights);
      if (inputHeightKeys.length > 1) {
        console.log(`⚠️  ${result.page}: 输入框高度不一致 ${JSON.stringify(result.inputHeights)}`);
      } else {
        console.log(`✅ ${result.page}: 输入框高度统一`);
      }
    }
  });

  test('卡片 padding 一致性检查', async ({ page }) => {
    const results: any[] = [];

    for (const adminPage of ADMIN_PAGES) {
      await page.goto(adminPage.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      // 获取所有卡片的 padding
      const cardPaddings = await page.evaluate(() => {
        const cards = document.querySelectorAll(
          '.el-card__body, [class*="card"], [class*="panel"]'
        );
        return Array.from(cards).map((el) => {
          const style = window.getComputedStyle(el);
          return {
            top: style.paddingTop,
            right: style.paddingRight,
            bottom: style.paddingBottom,
            left: style.paddingLeft,
          };
        });
      });

      // 统计 padding 分布
      const paddingStrings = cardPaddings.map(
        (p) => `${p.top} ${p.right} ${p.bottom} ${p.left}`
      );
      const uniquePaddings = [...new Set(paddingStrings)];

      results.push({
        page: adminPage.name,
        cardCount: cardPaddings.length,
        uniquePaddings: uniquePaddings,
      });

      console.log(`${adminPage.name} 卡片 Padding：`);
      console.log(`  - 卡片数量: ${cardPaddings.length}`);
      console.log(`  - 不同 padding 数量: ${uniquePaddings.length}`);
      uniquePaddings.forEach((p) => console.log(`    ${p}`));
    }

    console.log('\n======== 卡片 Padding 一致性报告 ========');
    for (const result of results) {
      if (result.uniquePaddings.length > 3) {
        console.log(`⚠️  ${result.page}: Padding 种类过多 (${result.uniquePaddings.length})`);
      } else {
        console.log(`✅ ${result.page}: Padding 相对统一`);
      }
    }
  });

  test('边框圆角一致性检查', async ({ page }) => {
    const results: any[] = [];

    for (const adminPage of ADMIN_PAGES) {
      await page.goto(adminPage.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      // 获取所有卡片的圆角
      const borderRadii = await page.evaluate(() => {
        const cards = document.querySelectorAll(
          '.el-card, [class*="card"], [class*="panel"]'
        );
        return Array.from(cards).map((el) => {
          const style = window.getComputedStyle(el);
          return style.borderRadius;
        });
      });

      const uniqueRadii = [...new Set(borderRadii)];

      results.push({
        page: adminPage.name,
        uniqueRadii: uniqueRadii,
      });

      console.log(`${adminPage.name} 边框圆角：`);
      uniqueRadii.forEach((r) => console.log(`  - ${r}`));
    }

    console.log('\n======== 边框圆角一致性报告 ========');
    for (const result of results) {
      if (result.uniqueRadii.length > 3) {
        console.log(`⚠️  ${result.page}: 圆角种类过多 (${result.uniqueRadii.length})`);
      } else {
        console.log(`✅ ${result.page}: 圆角相对统一`);
      }
    }
  });

  test('暗黑模式：输入框和下拉框颜色检查', async ({ page }) => {
    const results: any[] = [];

    for (const adminPage of ADMIN_PAGES) {
      await page.goto(adminPage.path, { waitUntil: 'domcontentloaded' });
      await switchToDarkMode(page);

      // 检查输入框背景色
      const inputBgColors = await getAllComputedStyles(
        page,
        '.el-input__wrapper',
        'background-color'
      );

      // 检查输入框文字颜色
      const inputTextColors = await getAllComputedStyles(
        page,
        '.el-input__inner',
        'color'
      );

      // 检查边框颜色
      const inputBorderColors = await getAllComputedStyles(
        page,
        '.el-input__wrapper',
        'border-color'
      );

      const hasWhiteBg = inputBgColors.some((c) => c && c.includes('255, 255, 255'));
      const hasBlackText = inputTextColors.some((c) => c && c.includes('0, 0, 0'));

      results.push({
        page: adminPage.name,
        inputCount: inputBgColors.length,
        hasWhiteBg,
        hasBlackText,
        sampleBg: inputBgColors[0],
        sampleText: inputTextColors[0],
        sampleBorder: inputBorderColors[0],
      });

      console.log(`${adminPage.name} 暗黑模式输入框：`);
      console.log(`  - 输入框数量: ${inputBgColors.length}`);
      console.log(`  - 背景示例: ${inputBgColors[0]}`);
      console.log(`  - 文字示例: ${inputTextColors[0]}`);
      console.log(`  - 边框示例: ${inputBorderColors[0]}`);
    }

    console.log('\n======== 暗黑模式输入框检查报告 ========');
    for (const result of results) {
      if (result.hasWhiteBg) {
        console.log(`❌ ${result.page}: 发现白色背景输入框`);
      } else if (result.hasBlackText) {
        console.log(`❌ ${result.page}: 发现黑色文字（不可读）`);
      } else {
        console.log(`✅ ${result.page}: 暗黑模式输入框正常`);
      }
    }
  });

  test('截图对比：亮色模式 vs 暗黑模式', async ({ page }) => {
    // 只测试几个关键页面
    const keyPages = ADMIN_PAGES.slice(0, 4);

    for (const adminPage of keyPages) {
      await page.goto(adminPage.path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      // 亮色模式截图
      await switchToLightMode(page);
      await page.screenshot({
        path: `./test-results/${adminPage.name}-light.png`,
        fullPage: false,
      });

      // 暗黑模式截图
      await switchToDarkMode(page);
      await page.screenshot({
        path: `./test-results/${adminPage.name}-dark.png`,
        fullPage: false,
      });

      console.log(`✅ ${adminPage.name} 截图已保存`);
    }
  });
});
