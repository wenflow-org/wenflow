/**
 * Admin 桌面端全量巡检（只读）
 *
 * 仿照用户侧移动端走查的方法：先量真实渲染，再谈结论。这里量的是桌面端的
 * 「客观缺陷 + 规范偏差 + 跨档单调性」，判据对齐 doc/ADMIN_VISUAL_LAYER_SPEC.md
 * （同一视口 ≤3 个字号档、表格行高 ≥40px、卡片 padding/radius 不混档、
 *  页面级 scoped style 只允许布局），并额外检测：
 *   - 横向溢出 / 元素越界
 *   - 被裁切文本（排除有意为之的 ellipsis）
 *   - 可点元素尺寸（桌面阈值 <24px）
 *   - 仅 hover 才出现的交互（键盘/触屏不可达）
 *   - cursor:pointer 但无 tabindex/role 的行（键盘不可达）
 *   - 跨宽度档位的字号单调性（1920 档 > 2000 档这类「越大屏字越小」）
 *
 * 纪律：只做导航与 DOM/样式采集，不点任何会写数据的按钮。表格行点击只用于
 * 进入二级详情（纯导航），且遇到含变更语义的行会跳过。
 *
 * 用法：
 *   node scripts/admin-audit.mjs                 # 全量（默认宽度集）
 *   node scripts/admin-audit.mjs --only overview,audit-logs
 *   node scripts/admin-audit.mjs --no-shots      # 不截图（快）
 * 产出：
 *   scripts/admin-audit-results/audit-<date>.json   原始数据 + 派生结论
 *   .ui-audit/admin-audit-<date>/*.jpg              页面截图（1440 全量、3840 档位子集）
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:5173';
const CREDS = { name: 'admin', password: 'ChangeMe_2026_Admin' };
const DATE = new Date().toISOString().slice(0, 10);
const SHOT_DIR = `.ui-audit/admin-audit-${DATE}`;
const RESULT_DIR = 'scripts/admin-audit-results';

/** 全部场景 × tab（URL 来自 router 的重定向表与各宿主页的 TABS 常量） */
const PAGES = [
  { name: 'overview', url: '/admin/overview', tier: true },
  { name: 'people-account', url: '/admin/people?tab=account', tier: true },
  { name: 'people-state', url: '/admin/people?tab=state' },
  { name: 'sessions-teaching', url: '/admin/sessions?tab=teaching', tier: true },
  { name: 'sessions-conversations', url: '/admin/sessions?tab=conversations' },
  { name: 'sessions-paths', url: '/admin/sessions?tab=paths' },
  { name: 'memory-review', url: '/admin/memory-review' },
  { name: 'virtual-learners', url: '/admin/virtual-learners' },
  { name: 'batch-experiments', url: '/admin/batch-experiments' },
  { name: 'orchestrator', url: '/admin/orchestrator' },
  { name: 'skills-run', url: '/admin/skills?tab=run', tier: true },
  { name: 'skills-health', url: '/admin/skills?tab=health' },
  { name: 'skills-drift', url: '/admin/skills?tab=drift' },
  { name: 'skills-recon', url: '/admin/skills?tab=recon' },
  { name: 'prompt-eval', url: '/admin/prompt-eval' },
  { name: 'execution-logs', url: '/admin/execution-logs?tab=logs', tier: true },
  { name: 'execution-trace', url: '/admin/execution-logs?tab=trace' },
  { name: 'execution-cost', url: '/admin/execution-logs?tab=cost' },
  { name: 'audit-logs', url: '/admin/audit-logs', tier: true },
  { name: 'api-config-model', url: '/admin/api-config?tab=model' },
  { name: 'api-config-overview', url: '/admin/api-config?tab=overview' },
  { name: 'api-config-addons', url: '/admin/api-config?tab=addons' },
  { name: 'ops-center-tools', url: '/admin/ops-center?tab=tools' },
  { name: 'ops-center-export', url: '/admin/ops-center?tab=export' },
  { name: 'ops-center-security', url: '/admin/ops-center?tab=security' },
  { name: 'ops-hub-todo', url: '/admin/ops-hub?tab=todo' },
  { name: 'ops-hub-feedback', url: '/admin/ops-hub?tab=feedback' },
  { name: 'ops-hub-achievements', url: '/admin/ops-hub?tab=achievements' },
  { name: 'ops-hub-announce', url: '/admin/ops-hub?tab=announce' },
  { name: 'ops-hub-inapp', url: '/admin/ops-hub?tab=inapp' },
  { name: 'skill-workbench', url: '/admin/skill-workbench' },
];

/** 宽度集：1440/3840 覆盖两端（窄屏溢出 + 4K 过宽），档位子集跑全部五档 */
const WIDTHS = [1440, 3840];
const TIER_WIDTHS = [1440, 1920, 2000, 2560, 3840];

/** 跨档单调性要盯的选择器（mk 原语 + 壳层 + 状态条） */
const TIER_SELECTORS = [
  '.mk-page', '.mk-status__title', '.mk-status__meta', '.mk-status__action',
  '.mk-table th', '.mk-table td', '.mk-cell-sub', '.mk-card__title', '.mk-card__meta',
  '.mk-menu__item', '.mk-pill', '.mk-num', '.mk-btn', '.mk-btn--sm', '.mk-badge',
  '.mk-filter__input', '.mk-empty strong', '.mshell__item', '.mshell__brand',
];

/** 行内文本含这些词就不点（避免触发写操作） */
const MUTATING = /重算|重建|重置|删除|清空|应用|执行|导出|生成|发送|保存|提交|注销|下线|上线|发布/;

const args = process.argv.slice(2);
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i >= 0 ? new Set(args[i + 1].split(',').map((s) => s.trim())) : null;
})();
const NO_SHOTS = args.includes('--no-shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 页面侧测量：一次 evaluate 取回整页结论 ── */
const MEASURE = `(() => {
  const MAX = 8;
  const txt = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24);
  const cls = (el) => (el.className || '').toString().slice(0, 40);
  const rect = (el) => el.getBoundingClientRect();
  const out = { vw: innerWidth, vh: innerHeight };

  // 1) 横向溢出
  out.doc = { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
  out.doc.over = out.doc.scrollW - out.doc.clientW;
  const overflowEls = [];
  document.querySelectorAll('.mk-page *, .mshell__main *, .auth *').forEach((el) => {
    const r = rect(el);
    if (r.width === 0 || r.height === 0) return;
    if (r.right > innerWidth + 1 || r.left < -1) {
      overflowEls.push({ tag: el.tagName, cls: cls(el), text: txt(el), left: Math.round(r.left), right: Math.round(r.right) });
    }
  });
  out.overflowEls = overflowEls.slice(0, MAX);
  out.overflowCount = overflowEls.length;

  // 2) 被裁切文本（排除 ellipsis 的有意截断、装饰性单字符、<6px 的取整误差）
  const clipped = [];
  document.querySelectorAll('.mk-page *, .mshell__main *').forEach((el) => {
    if (el.children.length) return;              // 只看叶子节点
    const cs = getComputedStyle(el);
    if (cs.overflow !== 'hidden' && cs.overflowX !== 'hidden') return;
    if (cs.textOverflow === 'ellipsis') return;  // 有意为之
    const t = txt(el);
    if (t.length <= 2) return;                   // 箭头/图标类装饰字符
    if (el.scrollWidth - Math.ceil(rect(el).width) < 6) return;
    clipped.push({ tag: el.tagName, cls: cls(el), text: t, scrollW: el.scrollWidth, clientW: Math.ceil(rect(el).width), overflow: cs.overflow, ws: cs.whiteSpace });
  });
  out.clipped = clipped.slice(0, MAX);
  out.clippedCount = clipped.length;

  // 3) 可点元素尺寸（复选框等若包在 <label> 里，按 label 的实际热区算）
  const clickables = [];
  document.querySelectorAll('button, a[href], input, select, summary, [role="button"], [role="tab"]').forEach((el) => {
    const label = el.tagName === 'INPUT' ? el.closest('label') : null;
    const r = rect(label || el);
    if (r.width === 0 || r.height === 0) return;
    clickables.push({ tag: el.tagName, cls: cls(el), text: txt(el), w: Math.round(r.width), h: Math.round(r.height), via: label ? 'label' : 'self' });
  });
  out.clickTotal = clickables.length;
  out.under24 = clickables.filter((c) => c.h < 24 || c.w < 24).slice(0, 30);
  out.under24Count = clickables.filter((c) => c.h < 24 || c.w < 24).length;

  // 4) 仅 hover 才出现的交互：静态扫规则 + 运行时确认元素当前是隐藏的
  //    注意先判 selectorText 再递归：Chrome 的 CSSStyleRule 也有 cssRules（空数组是 truthy），
  //    先看 cssRules 会导致所有普通样式规则被跳过——第一版就是这么漏掉全部 hover 规则的。
  const walkRules = (rules, sink) => {
    for (const r of rules) {
      if (r.selectorText && r.selectorText.includes(':hover')) {
        const css = r.style ? r.style.cssText : '';
        if (/opacity|visibility|display/.test(css)) sink.push({ selector: r.selectorText.slice(0, 120), props: css.slice(0, 80) });
      }
      if (r.cssRules && r.cssRules.length) walkRules(r.cssRules, sink);
    }
  };
  const hoverRules = [];
  for (const sheet of document.styleSheets) {
    try { walkRules(sheet.cssRules, hoverRules); } catch { /* 跨域表跳过 */ }
  }
  out.hoverRules = hoverRules.slice(0, 12);
  out.hoverRuleCount = hoverRules.length;
  // 运行时：当前隐藏、但被某条 :hover 规则指向的元素
  const hidden = [];
  document.querySelectorAll('.mk-page *, .mshell__main *').forEach((el) => {
    if (hidden.length >= 6) return;
    const cs = getComputedStyle(el);
    if (cs.opacity !== '0' && cs.visibility !== 'hidden') return;
    if (!txt(el)) return;
    const base = el.className ? '.' + cls(el).split(' ')[0] : '';
    const hit = hoverRules.find((h) => h.selector.includes(base) && base);
    if (hit) hidden.push({ tag: el.tagName, cls: cls(el), text: txt(el), opacity: cs.opacity, visibility: cs.visibility, rule: hit.selector });
  });
  out.hoverHiddenEls = hidden;

  // 5) 键盘不可达：cursor:pointer 但不是原生可聚焦元素、也没有 tabindex/role，
  //    且不在某个可聚焦祖先内（cursor 会继承，否则按钮里的图标 span 会被误报）
  const NATIVE = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'DETAILS']);
  const kb = [];
  document.querySelectorAll('.mk-page *, .mshell__main *').forEach((el) => {
    if (NATIVE.has(el.tagName)) return;
    if (el.hasAttribute('tabindex') || el.hasAttribute('role')) return;
    if (el.closest('button, a[href], summary, label, [role="button"], [role="tab"], [tabindex]')) return;
    if (getComputedStyle(el).cursor !== 'pointer') return;
    const r = rect(el);
    if (r.width === 0 || r.height === 0) return;
    kb.push({ tag: el.tagName, cls: cls(el), text: txt(el), w: Math.round(r.width), h: Math.round(r.height) });
  });
  out.kbUnreachable = kb.slice(0, MAX);
  out.kbUnreachableCount = kb.length;

  // 6) 排版/一致性：字号档、卡片内边距、圆角种类、表格行高
  const fs = {}, pad = {}, radius = {};
  const bump = (bag, k) => { bag[k] = (bag[k] || 0) + 1; };
  document.querySelectorAll('.mk-page *, .mshell__main *').forEach((el) => {
    const r = rect(el);
    if (r.width === 0 || r.height === 0) return;
    if (el.children.length === 0 && txt(el)) bump(fs, getComputedStyle(el).fontSize);
  });
  // 卡片级容器（只取页面顶层，避免把卡内的 chip 内边距也算成「卡片内边距」）
  document.querySelectorAll('.mk-card, .mk-status, .mk-page > section, .mk-page > article, .mk-page > div[class*="card"]').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.padding !== '0px') bump(pad, cs.padding);
    if (cs.borderRadius !== '0px') bump(radius, cs.borderRadius);
  });
  out.fontSizes = fs;
  out.fontTierCount = Object.keys(fs).length;
  out.cardPaddings = pad;
  out.cardPaddingKinds = Object.keys(pad).length;
  out.radii = radius;
  out.radiusKinds = Object.keys(radius).length;
  const rowH = [];
  document.querySelectorAll('table.mk-table tbody tr').forEach((tr) => {
    const h = Math.round(rect(tr).height);
    if (h > 0) rowH.push(h);
  });
  out.tableRows = { count: rowH.length, min: rowH.length ? Math.min(...rowH) : null, under40: rowH.filter((h) => h < 40).length };

  // 7) 跨档字号序列（外部按宽度聚合后判单调）
  const tiers = {};
  for (const sel of ${JSON.stringify(TIER_SELECTORS)}) {
    const el = document.querySelector(sel);
    if (el) tiers[sel] = getComputedStyle(el).fontSize;
  }
  out.tiers = tiers;
  return out;
})()`;

/* ── 登录 ── */
async function login(page) {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  const inputs = await page.locator('input').all();
  if (inputs.length < 2) throw new Error('登录页输入框不足 2 个');
  await inputs[0].fill(CREDS.name);
  await inputs[1].fill(CREDS.password);
  await page.click('button:has-text("登录后台")');
  await page.waitForURL('**/admin/**', { timeout: 15000 });
  await sleep(600);
}

/**
 * 导航到页面并等到「真的渲染出来」：页面容器出现 + 骨架屏消失。
 * 管理端首屏模块多（冷启动 4–5s），只等固定毫秒会量到骨架态——第一版就踩了这个坑。
 * 超时不算失败：记 stuckSkeleton，量到的就是当时的真实状态（这本身就是一条结论）。
 */
async function gotoReady(page, url, w) {
  await page.setViewportSize({ width: w, height: w >= 2560 ? 1440 : 900 });
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  let stuck = false;
  try {
    await page.waitForFunction(
      () => document.querySelector('.mk-page, .auth') !== null
        && document.querySelectorAll('.mk-skeleton').length === 0,
      null,
      { timeout: 12000 },
    );
  } catch {
    stuck = true;
  }
  await sleep(400); // 图表/异步小块的收尾
  return { stuck };
}

/* ── 二级详情：从列表页进入 ?view=&id= 深链（纯导航，不点任何写操作）──
   三种入口依次尝试：可点行 → 「详情」图标按钮 → 行内链接。 */
async function discoverDetail(page, listUrl, name) {
  try {
    await gotoReady(page, listUrl, 1440);
    const row = page.locator('table.mk-table tbody tr').first();
    if ((await row.count()) > 0) {
      const rowText = (await row.innerText()).slice(0, 60);
      if (!MUTATING.test(rowText)) {
        await row.click({ timeout: 5000 }).catch(() => {});
        await sleep(1800);
        if (page.url().includes('view=')) return { name, url: page.url().replace(BASE, '') };
      }
    }
    const icon = page.locator('.mk-icon-btn[title="详情"]').first();
    if ((await icon.count()) > 0) {
      await icon.click({ timeout: 5000 }).catch(() => {});
      await sleep(1800);
      if (page.url().includes('view=')) return { name, url: page.url().replace(BASE, '') };
    }
    const link = page.locator('tbody tr a[href*="view="]').first();
    if ((await link.count()) > 0) {
      const href = await link.getAttribute('href');
      if (href) return { name, url: href };
    }
    return null;
  } catch {
    return null;
  }
}

/* ── 主流程 ── */
async function run() {
  mkdirSync(SHOT_DIR, { recursive: true });
  mkdirSync(RESULT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  let curTag = 'init';
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ tag: curTag, text: m.text().slice(0, 200) }); });
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push({ tag: curTag, status: r.status(), url: r.url().replace(BASE, '').slice(0, 120) }); });
  page.on('pageerror', (e) => consoleErrors.push({ tag: curTag, text: 'pageerror: ' + String(e).slice(0, 200) }));

  const results = [];
  const target = (p) => !ONLY || ONLY.has(p.name);

  // 登录页（未登录态）
  if (target({ name: 'login' })) {
    curTag = 'login';
    try {
      await gotoReady(page, '/admin/login', 1440);
      const m = await page.evaluate(MEASURE);
      results.push({ name: 'login', url: '/admin/login', width: 1440, measure: m });
      if (!NO_SHOTS) await page.screenshot({ path: `${SHOT_DIR}/login-1440.jpg`, type: 'jpeg', quality: 70 });
    } catch (e) {
      results.push({ name: 'login', url: '/admin/login', width: 1440, error: String(e).slice(0, 160) });
    }
  }

  await login(page);
  console.log('登录成功');
  // 冷启动预热：先把总览页跑热，后续每页的模块请求都命中 Vite 缓存
  await gotoReady(page, '/admin/overview', 1440);
  console.log('预热完成\n');

  // 侧栏场景 × tab
  for (const p of PAGES) {
    if (!target(p)) continue;
    const widths = p.tier ? TIER_WIDTHS : WIDTHS;
    for (const w of widths) {
      curTag = `${p.name}@${w}`;
      try {
        const { stuck } = await gotoReady(page, p.url, w);
        const m = await page.evaluate(MEASURE);
        results.push({ name: p.name, url: p.url, width: w, stuckSkeleton: stuck, measure: m });
        if (!NO_SHOTS && (w === 1440 || (p.tier && w === 3840))) {
          await page.screenshot({ path: `${SHOT_DIR}/${p.name}-${w}.jpg`, type: 'jpeg', quality: 70 });
        }
      } catch (e) {
        results.push({ name: p.name, url: p.url, width: w, error: String(e).slice(0, 160) });
      }
    }
    process.stdout.write(`  ✓ ${p.name} (${widths.length} 档)\n`);
  }

  // 二级详情（4 个视图）：先从列表页点行进深链，再按 1440 量
  const details = [];
  if (!ONLY) {
    const found = [
      await discoverDetail(page, '/admin/people?tab=account', 'detail-user'),
      await discoverDetail(page, '/admin/people?tab=state', 'detail-learner'),
      await discoverDetail(page, '/admin/virtual-learners', 'detail-virtual'),
      await discoverDetail(page, '/admin/sessions?tab=teaching', 'detail-session'),
    ].filter(Boolean);
    for (const d of found) {
      curTag = d.name;
      try {
        const { stuck } = await gotoReady(page, d.url, 1440);
        const m = await page.evaluate(MEASURE);
        results.push({ name: d.name, url: d.url, width: 1440, stuckSkeleton: stuck, measure: m });
        if (!NO_SHOTS) await page.screenshot({ path: `${SHOT_DIR}/${d.name}-1440.jpg`, type: 'jpeg', quality: 70 });
        details.push(d);
      } catch (e) {
        results.push({ name: d.name, url: d.url, width: 1440, error: String(e).slice(0, 160) });
      }
    }
    // Skill 设计页：从 Skill 列表拿一个 agentId
    try {
      curTag = 'skill-design';
      await gotoReady(page, '/admin/skills?tab=run', 1440);
      const href = await page.evaluate(() => {
        const a = document.querySelector('a[href*="/admin/skills/"]');
        return a ? a.getAttribute('href') : null;
      });
      if (href) {
        const { stuck } = await gotoReady(page, href, 1440);
        const m = await page.evaluate(MEASURE);
        results.push({ name: 'skill-design', url: href, width: 1440, stuckSkeleton: stuck, measure: m });
        if (!NO_SHOTS) await page.screenshot({ path: `${SHOT_DIR}/skill-design-1440.jpg`, type: 'jpeg', quality: 70 });
        details.push({ name: 'skill-design', url: href });
      } else {
        results.push({ name: 'skill-design', url: '/admin/skills/<id>', width: 1440, error: '未找到 Skill 设计页入口链接' });
      }
    } catch (e) {
      results.push({ name: 'skill-design', url: '/admin/skills/<id>', width: 1440, error: String(e).slice(0, 160) });
    }
  }

  await browser.close();

  /* ── 派生结论 ── */
  const ok = results.filter((r) => r.measure);
  // 跨档单调性：按 (页面, 选择器) 归集字号序列，找「更宽的档反而更小」
  const tierSeries = {};
  for (const r of ok) {
    for (const [sel, v] of Object.entries(r.measure.tiers || {})) {
      const key = `${r.name}|${sel}`;
      (tierSeries[key] ||= []).push({ width: r.width, px: parseFloat(v) });
    }
  }
  const tierViolations = [];
  for (const [key, series] of Object.entries(tierSeries)) {
    const s = series.sort((a, b) => a.width - b.width);
    for (let i = 1; i < s.length; i++) {
      if (s[i].px < s[i - 1].px) {
        const [page, sel] = key.split('|');
        tierViolations.push({ page, selector: sel, from: s[i - 1], to: s[i] });
      }
    }
  }

  const report = {
    date: DATE,
    widths: { all: WIDTHS, tier: TIER_WIDTHS },
    pages: results.map((r) => ({
      name: r.name, url: r.url, width: r.width, error: r.error || null,
      stuckSkeleton: r.stuckSkeleton || false,
      docOver: r.measure ? r.measure.doc.over : null,
      overflowCount: r.measure ? r.measure.overflowCount : null,
      overflowEls: r.measure ? r.measure.overflowEls : null,
      clippedCount: r.measure ? r.measure.clippedCount : null,
      clipped: r.measure ? r.measure.clipped : null,
      under24Count: r.measure ? r.measure.under24Count : null,
      under24: r.measure ? r.measure.under24 : null,
      hoverRuleCount: r.measure ? r.measure.hoverRuleCount : null,
      hoverRules: r.measure ? r.measure.hoverRules : null,
      hoverHiddenEls: r.measure ? r.measure.hoverHiddenEls : null,
      kbUnreachableCount: r.measure ? r.measure.kbUnreachableCount : null,
      kbUnreachable: r.measure ? r.measure.kbUnreachable : null,
      fontTierCount: r.measure ? r.measure.fontTierCount : null,
      fontSizes: r.measure ? r.measure.fontSizes : null,
      cardPaddingKinds: r.measure ? r.measure.cardPaddingKinds : null,
      cardPaddings: r.measure ? r.measure.cardPaddings : null,
      radiusKinds: r.measure ? r.measure.radiusKinds : null,
      tableRows: r.measure ? r.measure.tableRows : null,
      tiers: r.measure ? r.measure.tiers : null,
    })),
    tierViolations,
    consoleErrors: consoleErrors.slice(0, 60),
    failedRequests: failedRequests.slice(0, 60),
    details,
  };
  const file = `${RESULT_DIR}/audit-${DATE}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');

  /* ── 控制台摘要 ── */
  console.log(`\n结果写入 ${file}`);
  const over = report.pages.filter((p) => p.docOver > 0);
  console.log(`横向溢出页：${over.length ? over.map((p) => `${p.name}@${p.width}(+${p.docOver})`).join(', ') : '无'}`);
  const clip = report.pages.filter((p) => p.clippedCount > 0);
  console.log(`裁切文本页：${clip.length ? clip.map((p) => `${p.name}@${p.width}(${p.clippedCount})`).join(', ') : '无'}`);
  const small = report.pages.filter((p) => p.under24Count > 0);
  console.log(`<24px 可点：${small.length ? small.map((p) => `${p.name}@${p.width}(${p.under24Count})`).join(', ') : '无'}`);
  const kb = report.pages.filter((p) => p.kbUnreachableCount > 0);
  console.log(`键盘不可达：${kb.length ? kb.map((p) => `${p.name}@${p.width}(${p.kbUnreachableCount})`).join(', ') : '无'}`);
  console.log(`档位非单调违规：${tierViolations.length} 条`);
  for (const v of tierViolations.slice(0, 20)) console.log(`  ${v.page} ${v.selector}: ${v.from.width}→${v.from.px}px 但 ${v.to.width}→${v.to.px}px`);
  const tiers3 = report.pages.filter((p) => p.fontTierCount > 3);
  console.log(`字号档 >3 的页：${tiers3.length} 个（最多 ${Math.max(0, ...tiers3.map((p) => p.fontTierCount))} 档）`);
  const rows = report.pages.filter((p) => p.tableRows && p.tableRows.under40 > 0);
  console.log(`表格行 <40px：${rows.length ? rows.map((p) => `${p.name}(${p.tableRows.min}px×${p.tableRows.under40})`).join(', ') : '无'}`);
  console.log(`控制台错误 ${report.consoleErrors.length} 条 / 失败请求 ${report.failedRequests.length} 条`);
  if (details.length) console.log(`二级详情已采集：${details.map((d) => d.name).join(', ')}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
