/**
 * Admin 子页面批量截图脚本
 * 
 * 原理：每页打开 → 截图列表 → 点击按钮/行 → 截图子页面 → 关闭子页面 → 关浏览器释放内存
 * 
 * 用法： node scripts/admin-subpages.mjs
 * 输出： .ui-audit/admin-vision/sub-*.jpeg
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE = 'http://localhost:5173';
const OUT = '.ui-audit/admin-vision';
const CREDS = { name: 'admin', password: 'ChangeMe_2026_Admin' };

mkdirSync(OUT, { recursive: true });

// ── 页面配置：每页定义要点击的元素和关闭方式 ──
const pages = [
  {
    name: 'users',
    url: '/admin/users',
    clicks: [
      { selector: '.mk-icon-btn[title="详情"]', label: 'user-detail', close: 'back' },
      { selector: '.mk-menu__btn', label: 'user-menu', close: 'escape' },
    ],
  },
  {
    name: 'learner-center',
    url: '/admin/learner-center',
    clicks: [
      { selector: '.mk-icon-btn[title="详情"]', label: 'learner-detail', close: 'back' },
    ],
  },
  {
    name: 'teaching-sessions',
    url: '/admin/teaching-sessions',
    clicks: [
      { selector: 'tbody tr', label: 'session-cockpit', close: 'back' },
    ],
  },
  {
    name: 'goal-conversations',
    url: '/admin/goal-conversations',
    clicks: [
      { selector: 'tbody tr', label: 'goal-detail', close: 'escape' },
    ],
  },
  {
    name: 'virtual-learners',
    url: '/admin/virtual-learners',
    clicks: [
      { selector: '.mk-icon-btn[title="画像"]', label: 'virtual-profile', close: 'back' },
    ],
  },
  {
    name: 'skills',
    url: '/admin/skills',
    clicks: [
      { selector: 'tbody tr', label: 'skill-drawer', close: 'escape' },
    ],
  },
  {
    name: 'execution-logs',
    url: '/admin/execution-logs',
    clicks: [
      { selector: '.tline', label: 'exec-expand', close: 'escape' },
    ],
  },
  {
    name: 'audit-logs',
    url: '/admin/audit-logs',
    clicks: [
      { selector: 'tbody tr', label: 'audit-expand', close: 'escape' },
    ],
  },
  {
    name: 'announcements',
    url: '/admin/announcements',
    clicks: [
      { selector: 'button.mk-link', label: 'announce-edit', close: 'escape' },
    ],
  },
  {
    name: 'feedback',
    url: '/admin/feedback',
    clicks: [
      { selector: 'button.mk-link', label: 'feedback-handle', close: 'escape' },
    ],
  },
];

// ── 工具函数 ──
async function login(page) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type=text], input:not([type])', CREDS.name);
  await page.fill('input[type=password]', CREDS.password);
  await page.click('button:has-text("登录后台")');
  await page.waitForURL('**/admin/overview', { timeout: 15000 });
}

async function shot(page, label) {
  const file = join(OUT, `sub-${label}.jpeg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 75 });
  console.log(`  📸 ${label} → ${file}`);
  return file;
}

async function closeSub(closeType, page) {
  if (closeType === 'escape') {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } else if (closeType === 'back') {
    await page.goBack({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  }
}

// ── 主流程：每 2 页关浏览器释放内存 ──
async function run() {
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    // 每 2 页重启浏览器
    if (i % 2 === 0) {
      if (i > 0) { await browser.close(); console.log('  🔒 浏览器关闭（释放内存）'); }
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      page = await ctx.newPage();
      await login(page);
      console.log(`\n=== 浏览器会话 ${Math.floor(i/2)+1} ===`);
    }

    console.log(`\n📄 [${i+1}/${pages.length}] ${p.name}`);
    await page.goto(`${BASE}${p.url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await shot(page, `${p.name}-list`);

    for (const c of p.clicks) {
      try {
        const el = page.locator(c.selector).first();
        if (await el.count() === 0) {
          console.log(`  ⚠️ ${c.label}: 元素未找到 (${c.selector})`);
          continue;
        }
        await el.click({ timeout: 5000 });
        await page.waitForTimeout(2000);
        await shot(page, c.label);
        await closeSub(c.close, page);
      } catch (e) {
        console.log(`  ⚠️ ${c.label}: ${e.message.slice(0, 80)}`);
        // 尝试恢复
        await page.goto(`${BASE}${p.url}`, { waitUntil: 'networkidle' }).catch(() => {});
      }
    }
  }
  await browser.close();
  console.log('\n✅ 全部完成');
}

let browser, page;
run().catch(console.error);
