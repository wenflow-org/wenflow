/**
 * v4 设计体系 · 全站渲染层 UI 检查（只读）
 *
 * 为什么需要它：`npm run design:check` 是**源码扫描**，规范 §7.5.6 自己写明了
 * 「源码扫描与渲染扫描是两种不同的证据，前者会漏掉自己没遍历到的文件类型」——
 * 规则 14/15 曾经整片漏扫 `src/styles/*.css`，结论从「admin 100% 合规」变成
 * 「其实没扫」。本脚本补的就是渲染层这一半：打开真实页面，读 getComputedStyle，
 * 按 v4 硬规则逐条判。
 *
 * 判据（doc/ADMIN_VISUAL_LAYER_SPEC.md v4）：
 *   §0.5 圆角阶梯 4/6/8/12/16/999（+0 / 50% / var(--*radius-*)）
 *   §0.5 阴影：面=none、悬浮/浮层/模态=中性 slate、描边=inset / 0 0 0 Npx；禁彩色光晕
 *   §4   材质平面：禁 backdrop-filter（值非 none）
 *   §0.5 禁渐变主按钮（125/135deg 蓝→深蓝）
 *   §0.5 悬停不位移（:hover 里禁 transform translate/scale）
 *   §1   文本三档（micro/body/emphasis）；档外文本字号记为偏差
 *   §3   表格行高 ≥40px
 *   §7.5.2 / §7.5.7 对比度：正文 4.5:1、大字 3:1
 *   §2/§7 横向溢出
 *
 * 认证：离线签 JWT（JWT_SECRET 取 backend/.env）——admin 域无 DB 校验；
 *       user 域用真实 userId（validateUserRecord 只查存在性）。
 *
 * 用法：
 *   node scripts/v4-ui-audit.mjs                      # 全站亮色
 *   node scripts/v4-ui-audit.mjs --theme dark
 *   node scripts/v4-ui-audit.mjs --side admin|user
 *   node scripts/v4-ui-audit.mjs --only overview,users
 * 产出：scripts/v4-ui-audit-results/<theme>-<ts>.json（原始数据）
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const BACKEND = join(REPO, 'backend');
const BASE = process.env.AUDIT_BASE || 'http://localhost:5173';

// ── 依赖解析：playwright 被提升到仓库根 node_modules，jsonwebtoken 在 backend ──
const reqRoot = createRequire(join(REPO, 'package.json'));
const reqBackend = createRequire(join(BACKEND, 'package.json'));
const playwright = reqRoot('playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const jwt = reqBackend('jsonwebtoken');

// ── JWT_SECRET ──
function readEnv(key) {
  const env = readFileSync(join(BACKEND, '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
  }
  return '';
}
const JWT_SECRET = process.env.JWT_SECRET || readEnv('JWT_SECRET');
if (!JWT_SECRET) throw new Error('JWT_SECRET 未找到（backend/.env）');

const ADMIN_USER = { userId: 'admin_1784375139263_fxejavj', email: 'admin@wenflow.local' };
const RICH_USER = {
  id: 'b88f4354-8a90-4d77-aa56-1d6d9718fe30',
  name: '123',
  pathId: 'lp_1784533296082_tbhbyoc',
  taskId: 'st_1784533523708_05o27xb_1_0',
};

const sign = (payload, aud) =>
  jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '2h',
    issuer: 'wenflow',
    audience: aud,
  });

const ADMIN_TOKEN = sign({ ...ADMIN_USER, isAdmin: true, type: 'admin' }, 'wenflow:admin');
const USER_TOKEN = sign(
  { userId: RICH_USER.id, name: RICH_USER.name, purpose: 'access', type: 'user' },
  'wenflow:user'
);

// ── 页面清单 ──
const ADMIN_PAGES = [
  ['overview', '/admin/overview'],
  ['people-account', '/admin/people?tab=account'],
  ['people-state', '/admin/people?tab=state'],
  ['learner-state', '/admin/learner-state'],
  ['teaching-sessions', '/admin/teaching-sessions'],
  ['goal-conversations', '/admin/goal-conversations'],
  ['learning-paths', '/admin/learning-paths'],
  ['memory-review', '/admin/memory-review'],
  ['virtual-learners', '/admin/virtual-learners'],
  ['virtual-learner-cards', '/admin/virtual-learner-cards'],
  ['orchestrator', '/admin/orchestrator'],
  // 编排图三面板：?tab= 语义 = journey/routing/governance（旧表用 ?tab=flow，实测回落总览，
  // 于是 DataFlowGraph / FieldRoutingTable 从未被渲染审计）
  ['orchestrator-journey', '/admin/orchestrator?tab=journey&stage=teaching'],
  ['orchestrator-routing', '/admin/orchestrator?tab=routing&stage=teaching'],
  ['skills-run', '/admin/skills?tab=run'],
  ['skills-model-routing', '/admin/skills?tab=model-routing'],
  ['skills-health', '/admin/skills?tab=health'],
  ['skills-drift', '/admin/skills?tab=drift'],
  // Prompt 评估已折入 skills 宿主页签（旧 /admin/prompt-eval 走重定向；直接给目标 URL）
  ['prompt-eval', '/admin/skills?peTab=cases'],
  ['prompt-workbench', '/admin/prompt-workbench'],
  ['exec-logs', '/admin/execution-logs?tab=logs'],
  ['exec-trace', '/admin/execution-logs?tab=trace'],
  ['exec-cost', '/admin/execution-logs?tab=cost'],
  ['audit-logs', '/admin/audit-logs'],
  // api-config 真实页签 = connection/routing/runtime/security/overview/addons（旧表用 ?tab=model，
  // 该键不存在，静默回落默认页签）；模型总览表在 ?tab=overview，不是 ?tab=registry
  ['api-config-connection', '/admin/api-config?tab=connection'],
  ['api-config-overview', '/admin/api-config?tab=overview'],
  ['api-config-addons', '/admin/api-config?tab=addons'],
  ['ops-center-tools', '/admin/ops-center?tab=tools'],
  ['ops-center-export', '/admin/ops-center?tab=export'],
  ['ops-center-security', '/admin/ops-center?tab=security'],
  ['ops-hub-todo', '/admin/ops-hub?tab=todo'],
  ['ops-hub-feedback', '/admin/ops-hub?tab=feedback'],
  ['ops-hub-achievements', '/admin/ops-hub?tab=achievements'],
  ['ops-hub-announce', '/admin/ops-hub?tab=announce'],
  ['ops-hub-inapp', '/admin/ops-hub?tab=inapp'],
  ['health-center', '/admin/health-center'],
  ['token-cost', '/admin/token-cost'],
  // 二级页必须带 ?view=&id=（旧表 skill-detail 用 /admin/skills/teaching-turn，那条路由是
  // SkillDesignPage，量到的从来不是 SkillDetail；user-detail 用裸 /admin/people/，量的是列表页）
  ['skill-detail', '/admin/skills?view=skill&id=teaching-turn'],
  ['user-detail', `/admin/people?view=learner&id=${RICH_USER.id}`],
  ['path-detail', `/admin/learning-paths?view=path&id=${RICH_USER.pathId}`],
];

const USER_PAGES = [
  ['home', '/next'],
  ['vision', '/next/vision'],
  ['login', '/login'],
  ['register', '/register'],
  ['dashboard', '/dashboard'],
  ['learning-paths', '/learning-paths'],
  ['learning-state', '/learning-state'],
  ['knowledge-map', '/knowledge-map'],
  ['path-detail', `/learning-path/${RICH_USER.pathId}`],
  ['learn', `/learn/${RICH_USER.taskId}`],
  ['goal-conversation', '/goal-conversation'],
  ['user-account', '/user/account'],
  ['user-agent-logs', '/user/agent-logs'],
  ['user-settings', '/user/settings'],
  ['user-achievements', '/user/achievements'],
  ['user-learning-history', '/user/learning-history'],
  ['v2-dashboard', '/v2/dashboard'],
  ['v2-achievements', '/v2/achievements'],
  ['v2-learning-state', '/v2/learning-state'],
];

// ── 参数 ──
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const THEME = arg('--theme', 'light');
const SIDE = arg('--side', 'both');
// 视口：默认 1920×1080（1080p，最常见档）。此前写死 1440×900，而真实投放是
// 1080p / 2K / 4K——1440 恰好落在「≥2000 档」之下、拿不到大屏字号与列宽 token，
// 于是大屏专属缺陷（zoom 档、2000/2800/3600 镜像档）在量测里全部隐形。
const WIDTH = Number(arg('--width', '1920'));
const HEIGHT = Number(arg('--height', '1080'));
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i >= 0 ? new Set(args[i + 1].split(',').map((s) => s.trim())) : null;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────────────────────────────────────────
   页面侧测量：一次 evaluate 取回整页 v4 结论
   ───────────────────────────────────────────────────────────── */
const MEASURE = String.raw`(() => {
  const out = { vw: innerWidth, vh: innerHeight, theme: document.documentElement.dataset.theme || (document.documentElement.classList.contains('dark') ? 'dark' : 'light') };
  const seen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cls = (el) => (el.getAttribute && el.getAttribute('class') || '').toString().slice(0, 60);
  const idOf = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls(el) ? '.' + cls(el).split(/\s+/).slice(0,2).join('.') : ''));
  const inPage = (el) => !!el.closest('.mk-page, .mshell__main, .v2-app, #app, .auth, main');
  const all = () => Array.from(document.querySelectorAll('body *')).filter(inPage);

  // 1) 横向溢出
  const de = document.documentElement;
  out.overflow = { scrollW: de.scrollWidth, clientW: de.clientWidth, diff: de.scrollWidth - de.clientWidth };

  // 2) 圆角阶梯：4/6/8/12/16/999(+0/50%)。computed 值可能是 "999px" 或 "50%" 或 "16px 16px 4px 16px"
  const LADDER = new Set([0, 4, 6, 8, 12, 16, 999]);
  const radiusBad = {};
  const radiusSeen = {};
  const parseRadii = (v) => v.split(/\s+/).map((t) => {
    if (t.endsWith('%')) return { pct: parseFloat(t) };
    return { px: parseFloat(t) };
  }).filter((x) => !(x.pct !== undefined && x.pct === 0) && !(x.px !== undefined && x.px === 0));
  for (const el of all()) {
    if (!seen(el)) continue;
    if (el.tagName === 'SVG' || el.ownerSVGElement) continue;
    const br = getComputedStyle(el).borderRadius;
    if (!br || br === '0px') continue;
    const parts = parseRadii(br);
    if (!parts.length) continue;
    radiusSeen[br] = (radiusSeen[br] || 0) + 1;
    const bad = parts.filter((p) => {
      if (p.pct !== undefined) return p.pct !== 50;      // 只允许 50%
      return !LADDER.has(Math.round(p.px)) && Math.abs(p.px - 999) > 0.6;
    });
    if (bad.length) {
      const key = br;
      (radiusBad[key] ||= []).push(idOf(el));
    }
  }
  out.radiusBad = radiusBad;
  out.radiusBadCount = Object.values(radiusBad).reduce((a, b) => a + b.length, 0);
  out.radiusKinds = Object.keys(radiusSeen).length;

  // 3) 阴影：none / 中性 slate / inset / 0 0 0 Npx 环；禁彩色光晕
  const shadowBad = {};
  const shadowSeen = {};
  const spreadOf = (s) => {
    // 取所有 rgba/rgb 通道，乘 alpha，看最大推偏
    let maxSpread = 0;
    for (const m of s.matchAll(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\)/g)) {
      const a = m[4] === undefined ? 1 : +m[4];
      const p = [+m[1], +m[2], +m[3]].map((x) => x * a);
      maxSpread = Math.max(maxSpread, Math.max(...p) - Math.min(...p));
    }
    return maxSpread;
  };
  for (const el of all()) {
    if (!seen(el)) continue;
    const bs = getComputedStyle(el).boxShadow;
    if (!bs || bs === 'none') continue;
    shadowSeen[bs] = (shadowSeen[bs] || 0) + 1;
    const isRing = /(\s|^)0px\s+0px\s+0px\s+\d/.test(bs) || /inset/.test(bs);
    const colored = spreadOf(bs) > 8;
    if (colored && !isRing) (shadowBad[bs] ||= []).push(idOf(el));   // 焦点环/inset 描边是规范内的，不算彩色光晕
  }
  out.shadowBad = shadowBad;
  out.shadowBadCount = Object.values(shadowBad).reduce((a, b) => a + b.length, 0);
  out.shadowKinds = Object.keys(shadowSeen).length;

  // 4) backdrop-filter（值非 none）
  const bf = [];
  for (const el of all()) {
    const v = getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter;
    if (v && v !== 'none') bf.push({ el: idOf(el), v });
  }
  out.backdrop = bf.slice(0, 12);
  out.backdropCount = bf.length;

  // 5) 渐变主按钮（125/135deg 且 ≥2 枚蓝端）
  const isBlue = (r, g, b) => b > r + 40 && b > g + 20 && b > 110;
  const grad = [];
  for (const el of all()) {
    const bi = getComputedStyle(el).backgroundImage;
    if (!bi || !bi.includes('linear-gradient')) continue;
    for (const m of bi.matchAll(/linear-gradient\(([^)]*)\)/g)) {
      const a = m[1];
      if (!/^\s*1[23]5deg/.test(a)) continue;
      let blues = 0;
      for (const c of a.matchAll(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/g)) {
        if (isBlue(+c[1], +c[2], +c[3])) blues++;
      }
      if (blues >= 2) grad.push({ el: idOf(el), at: a.slice(0, 80) });
    }
  }
  out.gradientButtons = grad.slice(0, 12);
  out.gradientButtonCount = grad.length;

  // 6) 悬停位移：:hover 规则里出现 **位移/缩放**（translateY / translate(x,y) / scale）。
  //    纯 translateX(-50%) 是居中技巧（mk-status__dot 的 tooltip），不是 hover 抬升，放行。
  const hoverMove = [];
  const isDisplacement = (t) => {
    if (/translateY\s*\(/.test(t)) return true;
    if (/translate3d\s*\([^)]*,[^)]*,\s*(?!0px?\s*[,)])/.test(t)) return true;
    if (/translate\s*\([^)]*,[^)]*/.test(t)) {                       // translate(x, y) —— 看 y
      const m = t.match(/translate\s*\(([^)]*)\)/);
      if (m) { const parts = m[1].split(','); if (parts.length > 1 && !/^0(px)?$/.test(parts[1].trim())) return true; }
    }
    if (/scale\s*\(/.test(t)) return true;
    return false;
  };
  const walk = (rules) => {
    for (const r of rules) {
      if (r.selectorText && r.selectorText.includes(':hover') && /transform\s*:/.test(r.cssText || '')) {
        const t = (r.cssText.match(/transform\s*:\s*([^;]+)/) || [])[1] || '';
        if (isDisplacement(t)) hoverMove.push({ sel: r.selectorText.slice(0, 100), t: t.slice(0, 60) });
      }
      if (r.cssRules && r.cssRules.length) walk(r.cssRules);
    }
  };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
  out.hoverMove = hoverMove.slice(0, 20);
  out.hoverMoveCount = hoverMove.length;

  // 7) 字号：叶子文本节点字号直方图 + 角色档判定
  const rootCs = getComputedStyle(document.documentElement);
  const numv = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const role = { micro: numv(rootCs.getPropertyValue('--mk-fs-micro')), body: numv(rootCs.getPropertyValue('--mk-fs-body')), emphasis: numv(rootCs.getPropertyValue('--mk-fs-emphasis')) };
  const roleVals = Object.values(role).filter((v) => v !== null);
  const fs = {};
  for (const el of all()) {
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();
    if (!t) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const k = cs.fontSize;
    fs[k] = (fs[k] || 0) + 1;
  }
  const offScale = {}; const display = {};
  const offScaleSamples = {};
  for (const [k, c] of Object.entries(fs)) {
    const v = parseFloat(k);
    if (roleVals.length === 3 && v > role.emphasis + 0.01) { display[k] = c; continue; }
    if (roleVals.some((rv) => Math.abs(rv - v) < 0.01)) continue;
    offScale[k] = c;
  }
  for (const el of all()) {
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();
    if (!t) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const k = cs.fontSize;
    if (!(k in offScale)) continue;
    (offScaleSamples[k] ||= []);
    if (offScaleSamples[k].length < 6) offScaleSamples[k].push({ el: idOf(el), text: t.slice(0, 16), vv: cs.fontVariantNumeric });
  }
  out.role = role;
  out.fontSizes = fs;
  out.offScaleFonts = offScale;
  out.offScaleSamples = offScaleSamples;
  out.displayFonts = display;
  out.offScaleFontKinds = Object.keys(offScale).length;

  // 8) 表格行高
  const rows = Array.from(document.querySelectorAll('table tbody tr')).map((tr) => Math.round(tr.getBoundingClientRect().height)).filter((h) => h > 0);
  out.tableRows = { n: rows.length, min: rows.length ? Math.min(...rows) : null, under40: rows.filter((h) => h < 40).length };

  // 9) 对比度（合成背景链，跳过背景图/渐变祖先）
  const parseColor = (c) => {
    const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const effBg = (el) => {
    let acc = null; let node = el;
    while (node && node !== document.documentElement.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // 有图/渐变，无法可靠合成
      const c = parseColor(cs.backgroundColor);
      if (c && c.a > 0) acc = acc ? over(acc, c) : c;
      if (acc && acc.a >= 0.999) return acc;
      node = node.parentElement;
    }
    return acc && acc.a >= 0.999 ? acc : { r: 255, g: 255, b: 255, a: 1 };
  };
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const contrastBad = [];
  let contrastChecked = 0;
  for (const el of all()) {
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();
    if (t.length < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    const fg = parseColor(cs.color);
    if (!fg) continue;
    const bg = effBg(el);
    if (!bg) continue;
    const fgc = fg.a < 1 ? over(fg, bg) : fg;
    const fs = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = fs >= 24 || (fs >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const r = ratio(fgc, bg);
    contrastChecked++;
    if (r < need - 0.02) contrastBad.push({ el: idOf(el), text: t.slice(0, 22), fg: cs.color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')', fs, ratio: Math.round(r * 100) / 100, need });
  }
  // 去重（同 el 同色只留一条）+ 排序
  const seenC = new Set(); const contrastUnique = [];
  for (const c of contrastBad) { const k = c.el + c.fg + c.fs; if (seenC.has(k)) continue; seenC.add(k); contrastUnique.push(c); }
  out.contrastBad = contrastUnique.sort((a, b) => a.ratio - b.ratio).slice(0, 40);
  out.contrastBadCount = contrastUnique.length;
  out.contrastChecked = contrastChecked;

  // 10) 数字等宽：table 里的纯数字单元格是否 tabular-nums
  let numCells = 0; let numMono = 0;
  for (const td of document.querySelectorAll('table td, table th')) {
    const t = (td.textContent || '').trim();
    if (!/^[¥$]?-?[\d,]+(\.\d+)?%?$/.test(t) || t.length > 14) continue;
    numCells++;
    if (/tabular-nums/.test(getComputedStyle(td).fontVariantNumeric)) numMono++;
  }
  out.numCells = numCells; out.numMono = numMono;

  out.bodyLen = (document.body.innerText || '').trim().length;
  out.errors = window.__v4err || [];
  return out;
})()`;

async function run() {
  const browser = await chromium.launch({ headless: true });
  const pages = [
    ...(SIDE === 'user' ? [] : ADMIN_PAGES.map((p) => ({ ...p, side: 'admin' }))),
    ...(SIDE === 'admin' ? [] : USER_PAGES.map((p) => ({ ...p, side: 'user' }))),
  ].filter((p) => !ONLY || ONLY.has(p[0]));

  const results = [];
  for (const [name, url, side] of pages.map((p) => [p[0], p[1], p.side])) {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    await ctx.addCookies([
      { name: 'wenflow_admin_token', value: ADMIN_TOKEN, domain: 'localhost', path: '/' },
      { name: 'wenflow_token', value: USER_TOKEN, domain: 'localhost', path: '/' },
    ]);
    await ctx.addInitScript((th) => {
      try {
        localStorage.setItem('v2_theme', th); localStorage.setItem('wenflow-theme', th); localStorage.setItem('wf_admin_theme', th);
        // 管理端路由守卫判据 = localStorage 标记（hasAdminSession），非 cookie 本身
        localStorage.setItem('wenflow_admin_session', '1');
      } catch {}
    }, THEME);
    const page = await ctx.newPage();
    const errs = [];
    if (process.env.V4_DEBUG) {
      page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('    NAV', f.url().replace(BASE, '')); });
      page.on('request', (r) => { if (r.url().includes('/api/admin/overview/stats')) console.log('    REQ cookie=', (r.headers()['cookie'] || '(none)').slice(0, 60)); });
      page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) console.log('    APIERR', r.status(), r.url().replace(BASE, '')); });
      console.log('    CTX cookies pre-nav:', (await ctx.cookies()).map((c) => c.name).join(','));
    }
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
    let data = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        errs.length = 0;
        await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(1800);
        data = await page.evaluate(MEASURE);
        data.finalUrl = page.url();
        // 被守卫弹回登录页 = 这次会话没建起来，重试一次
        if (/\/admin\/login|\/login/.test(data.finalUrl) && !/login/i.test(url)) {
          if (attempt < 2) { await page.waitForTimeout(1500); continue; }
        }
        if (data.bodyLen > 0) break;
      } catch (e) {
        data = { error: String(e.message).slice(0, 200) };
        if (attempt < 2) { await page.waitForTimeout(1500); continue; }
      }
    }
    data.name = name; data.url = url; data.side = side; data.pageErrors = errs.slice(0, 5);
    results.push(data);
    const flag = data.error ? 'ERR' : [
      data.overflow?.diff > 1 ? 'OVF' : '',
      data.radiusBadCount ? 'R' + data.radiusBadCount : '',
      data.shadowBadCount ? 'S' + data.shadowBadCount : '',
      data.backdropCount ? 'BF' : '',
      data.gradientButtonCount ? 'G' : '',
      data.hoverMoveCount ? 'HM' : '',
      data.contrastBadCount ? 'C' + data.contrastBadCount : '',
      data.offScaleFontKinds ? 'F' + data.offScaleFontKinds : '',
    ].filter(Boolean).join(' ');
    console.log(`  ${name.padEnd(22)} ${String(data.finalUrl || '').slice(0, 46).padEnd(48)} ${flag || 'ok'}${data.bodyLen ? '' : ' [EMPTY]'}`);
    await ctx.close();
  }
  await browser.close();

  const dir = join(HERE, 'v4-ui-audit-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${THEME}-${SIDE}-${WIDTH}x${HEIGHT}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`\n→ ${file}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
