/**
 * Admin 页面可点击元素探索脚本
 * 
 * 扫描每个页面的所有 button / 可点击行 / 链接，输出 JSON 清单
 * 不截图，不吃内存——纯 DOM 检查
 */

import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const CREDS = { name: 'admin', password: 'ChangeMe_2026_Admin' };

const pageUrls = [
  { name: 'overview', url: '/admin/overview' },
  { name: 'users', url: '/admin/users' },
  { name: 'learner-center', url: '/admin/learner-center' },
  { name: 'teaching-sessions', url: '/admin/teaching-sessions' },
  { name: 'goal-conversations', url: '/admin/goal-conversations' },
  { name: 'feedback', url: '/admin/feedback' },
  { name: 'virtual-learners', url: '/admin/virtual-learners' },
  { name: 'skills', url: '/admin/skills' },
  { name: 'orchestrator', url: '/admin/orchestrator' },
  { name: 'skill-workbench', url: '/admin/skill-workbench' },
  { name: 'health-center', url: '/admin/health-center' },
  { name: 'execution-logs', url: '/admin/execution-logs' },
  { name: 'trace-waterfall', url: '/admin/trace-waterfall' },
  { name: 'audit-logs', url: '/admin/audit-logs' },
  { name: 'api-config', url: '/admin/api-config' },
  { name: 'addons', url: '/admin/addons' },
  { name: 'session-security', url: '/admin/session-security' },
  { name: 'announcements', url: '/admin/announcements' },
];

async function login(page) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'networkidle' });
  const inputs = await page.locator('input').all();
  if (inputs.length >= 2) {
    await inputs[0].fill(CREDS.name);
    await inputs[1].fill(CREDS.password);
  }
  await page.click('button:has-text("登录后台")');
  await page.waitForURL('**/admin/overview', { timeout: 15000 });
}

async function scanPage(page, pageName) {
  const result = await page.evaluate(() => {
    const items = [];
    
    // 1. 所有 button 元素
    document.querySelectorAll('button').forEach((el, i) => {
      const text = el.textContent.trim().slice(0, 30);
      const title = el.getAttribute('title') || '';
      const cls = el.className.slice(0, 40);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return; // 跳过隐藏元素
      items.push({
        type: 'button',
        idx: i,
        text: text || `(title: ${title})` || `(class: ${cls})`,
        selector: `button:has-text("${text}")`,
        cls,
        visible: rect.width > 0,
      });
    });
    
    // 2. 可点击的行 (cursor:pointer 或 click 事件)
    document.querySelectorAll('tbody tr').forEach((el, i) => {
      const cs = getComputedStyle(el);
      if (cs.cursor === 'pointer' || el.onclick) {
        const text = el.textContent.trim().slice(0, 40);
        items.push({
          type: 'clickable-row',
          idx: i,
          text,
          selector: `tbody tr:nth-child(${i+1})`,
        });
      }
    });
    
    // 3. 链接
    document.querySelectorAll('a[href]').forEach((el) => {
      const text = el.textContent.trim().slice(0, 30);
      const href = el.getAttribute('href');
      if (text && !text.includes('跳到主要')) {
        items.push({ type: 'link', text, selector: `a:has-text("${text}")`, href });
      }
    });
    
    // 4. 切换/折叠按钮 (aria-expanded, summary, details)
    document.querySelectorAll('[aria-expanded], details, summary, .mk-pill, .mk-collapse__btn').forEach((el, i) => {
      const text = el.textContent.trim().slice(0, 30);
      const expanded = el.getAttribute('aria-expanded');
      items.push({ type: 'toggle', idx: i, text, selector: `[aria-expanded]`, expanded });
    });
    
    return items;
  });
  
  return result;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  
  await login(page);
  console.log('Login OK\n');
  
  for (const p of pageUrls) {
    await page.goto(`${BASE}${p.url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    
    const items = await scanPage(page, p.name);
    
    // 按类型分组
    const buttons = items.filter(i => i.type === 'button');
    const rows = items.filter(i => i.type === 'clickable-row');
    const links = items.filter(i => i.type === 'link');
    const toggles = items.filter(i => i.type === 'toggle');
    
    console.log(`\n=== ${p.name} (${p.url}) ===`);
    console.log(`  buttons: ${buttons.length}, rows: ${rows.length}, links: ${links.length}, toggles: ${toggles.length}`);
    
    if (buttons.length) {
      console.log('  [buttons]');
      buttons.forEach((b, i) => {
        if (b.text && b.text.length < 30) {
          console.log(`    ${i}: "${b.text}" [${b.cls.slice(0,20)}]`);
        }
      });
    }
    if (rows.length) {
      console.log(`  [clickable-rows] first: "${rows[0]?.text?.slice(0,30)}"`);
    }
    if (toggles.length) {
      console.log('  [toggles]');
      toggles.forEach((t, i) => {
        if (t.text && t.text.length < 30) {
          console.log(`    ${i}: "${t.text}" expanded=${t.expanded}`);
        }
      });
    }
  }
  
  await browser.close();
  console.log('\n✅ Done');
}

run().catch(console.error);
