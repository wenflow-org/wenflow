/**
 * Admin 子页面批量截图脚本 v2
 * 
 * 基于探索脚本发现的全部可点击元素，逐页逐交互截图
 * 每 2 页关浏览器释放内存，JPEG quality 70
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:5173';
const OUT = '.ui-audit/admin-vision/sub2';
const CREDS = { name: 'admin', password: 'ChangeMe_2026_Admin' };
mkdirSync(OUT, { recursive: true });

// ── 每页定义：截图列表 + 逐个点击的交互 ──
const pages = [
  {
    name: 'users',
    url: '/admin/users',
    shots: [
      { label: 'users-list', selector: null },
      { label: 'users-new-user', selector: 'button:has-text("新建用户")', close: 'escape' },
      { label: 'users-detail', selector: '.mk-icon-btn[title="详情"]', close: 'back' },
      { label: 'users-more-menu', selector: '.mk-menu__btn', close: 'escape' },
      { label: 'users-filter-admin', selector: 'button.mk-pill:has-text("管理员")', close: 'none' },
    ],
  },
  {
    name: 'learner-center',
    url: '/admin/learner-center',
    shots: [
      { label: 'learner-list', selector: null },
      { label: 'learner-detail', selector: '.mk-icon-btn[title="详情"]', close: 'back' },
      { label: 'learner-recompute', selector: '.mk-icon-btn[title="重算"]', close: 'none', waitMs: 3000 },
    ],
  },
  {
    name: 'teaching-sessions',
    url: '/admin/teaching-sessions',
    shots: [
      { label: 'sessions-list', selector: null },
      { label: 'session-cockpit', selector: 'tbody tr', close: 'back' },
      { label: 'session-trace', selector: '.mk-icon-btn[title="链路"]', close: 'back' },
      { label: 'session-console', selector: '.mk-icon-btn[title="控制台"]', close: 'back' },
    ],
  },
  {
    name: 'goal-conversations',
    url: '/admin/goal-conversations',
    shots: [
      { label: 'goal-list', selector: null },
      { label: 'goal-detail', selector: 'tbody tr', close: 'escape' },
      { label: 'goal-trace', selector: '.mk-icon-btn[title="链路"]', close: 'back' },
      { label: 'goal-rebuild', selector: '.mk-icon-btn[title="重建路径"]', close: 'none', waitMs: 3000 },
      { label: 'goal-more-menu', selector: '.mk-menu__btn', close: 'escape' },
    ],
  },
  {
    name: 'virtual-learners',
    url: '/admin/virtual-learners',
    shots: [
      { label: 'vl-list', selector: null },
      { label: 'vl-profile', selector: '.mk-icon-btn[title="画像"]', close: 'back' },
      { label: 'vl-batch-panel', selector: 'button:has-text("展开面板")', close: 'none' },
      { label: 'vl-running-chip', selector: '.vl-running__chip', close: 'back' },
    ],
  },
  {
    name: 'skills',
    url: '/admin/skills',
    shots: [
      { label: 'skills-list', selector: null },
      { label: 'skill-drawer', selector: 'tbody tr', close: 'escape' },
      { label: 'skills-grid-view', selector: 'button.mk-pill:has-text("网格")', close: 'none' },
    ],
  },
  {
    name: 'orchestrator',
    url: '/admin/orchestrator',
    shots: [
      { label: 'orch-list', selector: null },
      { label: 'orch-stage-02', selector: 'button:has-text("02")', close: 'none' },
      { label: 'orch-tab-routing', selector: 'button.orch-tab:has-text("字段路由")', close: 'none' },
      { label: 'orch-tab-topology', selector: 'button.orch-tab:has-text("拓扑")', close: 'none' },
    ],
  },
  {
    name: 'skill-workbench',
    url: '/admin/skill-workbench',
    shots: [
      { label: 'workbench-list', selector: null },
      { label: 'workbench-design', selector: 'a.mk-link:has-text("协议")', close: 'back' },
    ],
  },
  {
    name: 'health-center',
    url: '/admin/health-center',
    shots: [
      { label: 'health-list', selector: null },
      { label: 'health-detail-toggle', selector: '[aria-expanded]:has-text("明细")', close: 'none' },
    ],
  },
  {
    name: 'execution-logs',
    url: '/admin/execution-logs',
    shots: [
      { label: 'exec-list', selector: null },
      { label: 'exec-expand', selector: '.tline', close: 'escape' },
      { label: 'exec-advanced-filter', selector: 'button:has-text("高级筛选")', close: 'escape' },
    ],
  },
  {
    name: 'trace-waterfall',
    url: '/admin/trace-waterfall',
    shots: [
      { label: 'trace-list', selector: null },
      { label: 'trace-session-view', selector: 'button.mk-pill:has-text("会话")', close: 'none' },
      { label: 'trace-failed-only', selector: 'button.mk-pill:has-text("仅失败")', close: 'none' },
    ],
  },
  {
    name: 'audit-logs',
    url: '/admin/audit-logs',
    shots: [
      { label: 'audit-list', selector: null },
      { label: 'audit-expand', selector: 'tbody tr', close: 'escape' },
      { label: 'audit-login-tab', selector: 'button.mk-pill:has-text("登录审计")', close: 'none' },
    ],
  },
  {
    name: 'api-config',
    url: '/admin/api-config',
    shots: [
      { label: 'config-list', selector: null },
      { label: 'config-key-visible', selector: '.ac-key-toggle', close: 'none' },
      { label: 'config-test', selector: 'button:has-text("运行测试")', close: 'none', waitMs: 5000 },
    ],
  },
  {
    name: 'addons',
    url: '/admin/addons',
    shots: [
      { label: 'addons-list', selector: null },
      { label: 'addons-detail', selector: 'a.mk-link:has-text("详情")', close: 'escape' },
    ],
  },
  {
    name: 'session-security',
    url: '/admin/session-security',
    shots: [
      { label: 'security-list', selector: null },
      { label: 'security-expired-tab', selector: 'button.mk-pill:has-text("已过期")', close: 'none' },
    ],
  },
  {
    name: 'announcements',
    url: '/admin/announcements',
    shots: [
      { label: 'announce-list', selector: null },
      { label: 'announce-new', selector: 'button:has-text("新建公告")', close: 'escape' },
      { label: 'announce-edit', selector: 'button.mk-link:has-text("编辑")', close: 'escape' },
    ],
  },
];

async function login(page) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  const inputs = await page.locator('input').all();
  if (inputs.length >= 2) { await inputs[0].fill(CREDS.name); await inputs[1].fill(CREDS.password); }
  await page.click('button:has-text("登录后台")');
  await page.waitForURL('**/admin/overview', { timeout: 15000 });
}

async function shot(page, label) {
  const file = `${OUT}/${label}.jpeg`;
  await page.screenshot({ path: file, type: 'jpeg', quality: 70 });
  console.log(`  📸 ${label}`);
}

async function run() {
  let browser, page;
  
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    
    // 每 2 页重启浏览器
    if (i % 2 === 0) {
      if (i > 0) { await browser.close(); console.log('  🔒 内存释放'); }
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      page = await ctx.newPage();
      await login(page);
      console.log(`\n=== 会话 ${Math.floor(i/2)+1} ===`);
    }
    
    console.log(`\n📄 [${i+1}/${pages.length}] ${p.name}`);
    await page.goto(`${BASE}${p.url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    
    for (const s of p.shots) {
      try {
        if (s.selector) {
          const el = page.locator(s.selector).first();
          if (await el.count() === 0) { console.log(`  ⚠️ ${s.label}: 未找到`); continue; }
          await el.click({ timeout: 5000 });
          await page.waitForTimeout(s.waitMs || 2000);
        }
        await shot(page, s.label);
        
        if (s.close === 'escape') { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
        else if (s.close === 'back') { await page.goBack({ waitUntil: 'networkidle' }).catch(()=>{}); await page.waitForTimeout(500); }
        else if (s.close === 'none') { /* 留在当前状态，下个 shot 会叠加 */ }
      } catch (e) {
        console.log(`  ⚠️ ${s.label}: ${e.message?.slice(0, 60)}`);
        await page.goto(`${BASE}${p.url}`, { waitUntil: 'networkidle' }).catch(()=>{});
        await page.waitForTimeout(1000);
      }
    }
  }
  await browser.close();
  console.log('\n✅ 全部完成');
}

run().catch(console.error);
