/**
 * 用户侧「排印与对齐」几何巡检（只读）
 *
 * mobile-density-audit.mjs 量的是「字号绝对值 / 控件热区 / 溢出」，这个脚本量的是
 * 它量不到的另一半：元素之间的相对关系。判据全部来自「人的眼睛能看出的不一致」，
 * 每条都有明确的可视化后果，不做纯理论洁癖检查。
 *
 * 六类检查（每类都给出「看见的是什么」而不是抽象的偏离）：
 *
 *  1. 左缘轨道（rails）     正文堆的左边缘应当收敛到少数几条轨道上。同页出现
 *                           两条只差 1–3px 的轨道（如 30 与 32），视觉上就是
 *                           「没对齐」——比差 8px 更刺眼。offUnit 报不在 4px 网格上的。
 *  2. 容器内边距对称性      卡片自身 padding-left/right（以及 top/bottom）不等 → 内容偏心。
 *  3. 同排卡片参差          同一行里并列的「画了底/框」的卡片，顶边差 >2px 或高差 >2px
 *                           → 一排卡片顶不齐、底不齐。
 *  4. 横向 gap 不匀          flex row / grid row 里相邻子项的间距不等（差 >1px）
 *                           → 一行里的卡片疏密不一。
 *  5. 同角色字号漂移        同一 class 的文本（如卡片标题）在同一页出现多种字号
 *                           → 同级标题一个大一个小。
 *  6. 文本被裁               scrollWidth > clientWidth 且 overflow hidden 的文本块
 *                           → 文字被切掉（往往是字号或宽度没跟上）。
 *
 * 纪律：只读。只导航 + 读 DOM/几何，不点任何会写数据的按钮；/learn/:taskId 默认跳过
 * （onMounted 会 startSession），要量必须显式 --with-learn。
 *
 * 用法：
 *   node scripts/learner-align-audit.mjs                    # 390×844 + 1440×900
 *   node scripts/learner-align-audit.mjs --viewport 390
 *   node scripts/learner-align-audit.mjs --routes /dashboard,/user/account   # MSYS 下加 MSYS_NO_PATHCONV=1
 *   node scripts/learner-align-audit.mjs --with-learn --task <taskId> --interactive-only
 *   node scripts/learner-align-audit.mjs --with-goal --conversation <gc_id> --interactive-only
 * 产出：.ui-audit/learner-align/<档位>/*.json + interactive/ 截图与几何 + 控制台摘要
 *
 * --with-learn / --with-goal 会写库并打 LLM（课堂页 startSession 续会话、两页都发一条消息），
 * 默认关闭；开了即显式授权。它们用「一个页面 resize」覆盖 1440/390 两档，理由见下方注释。
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const CREDS = { name: process.env.SPEC_USER || 'logocheck2', password: process.env.SPEC_PASS || 'Abc123456' };
const OUT = '.ui-audit/learner-align';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const WITH_LEARN = flag('with-learn');
const WITH_GOAL = flag('with-goal');
const SKIP_STATIC = flag('interactive-only');

const STATIC_ROUTES = [
  '/dashboard',
  '/goal-conversation',
  '/learning-state',
  '/knowledge-map',
  '/user/account',
  '/user/achievements',
  '/user/learning-history',
  '/user/settings',
  '/user/agent-logs',
  '/onboarding',
];
const ANON_ROUTES = ['/login', '/register'];

const VIEWPORTS = [
  { w: 390, h: 844, mobile: true },
  { w: 1440, h: 900, mobile: false },
];

// ── 采集：几何 + 排印 ──
const COLLECT = () => {
  const root = document.querySelector('.v2-page') || document.querySelector('.uc__main') || document.body;
  const vis = (el) => el && el.getClientRects().length > 0;
  const num = (v) => Math.round(parseFloat(v) * 2) / 2;
  const r1 = (v) => Math.round(v);

  const label = (el) => {
    let s = el.tagName.toLowerCase();
    const raw = typeof el.className === 'string' ? el.className : '';
    const cls = raw.trim().split(/\s+/).filter((c) => c && !c.startsWith('router-link'));
    if (cls.length) s += '.' + cls.slice(0, 2).join('.');
    // 加一层父级，便于在多张同构卡片里区分位置
    const p = el.parentElement;
    if (p && p !== root && p.nodeType === 1) {
      const pc = typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : '';
      if (pc) s = `${p.tagName.toLowerCase()}${pc ? '.' + pc : ''} > ` + s;
    }
    return s;
  };

  // 有点击/导航副作用的一律不碰：只读几何，不需要交互
  const inScroller = (el) => {
    let p = el.parentElement;
    while (p && p !== root.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  };

  // ① 文本块：拿左缘轨道 + 字号
  const texts = [];
  const seen = new Set();
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const st = getComputedStyle(el);
    const ta = st.textAlign;
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    const key = `${label(el)}|${r1(b.left)}|${num(st.fontSize)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    texts.push({
      sel: label(el),
      text: (el.textContent || '').trim().slice(0, 26),
      left: r1(b.left),
      right: r1(b.right),
      w: r1(b.width),
      fs: num(st.fontSize),
      // 居中和右对齐的文本天然不参与左缘轨道；横滚容器里的也不参与
      railEligible: ta !== 'center' && ta !== 'right' && ta !== 'end' && !inScroller(el) && b.width > 12,
    });
  }

  // ② 画了底/框的容器：padding 对称性 + 同排参差
  const boxes = [];
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el)) continue;
    if (/^(INPUT|SELECT|TEXTAREA|IMG|SVG|PATH|HR)$/.test(el.tagName)) continue;
    const st = getComputedStyle(el);
    const radius = parseFloat(st.borderTopLeftRadius) || 0;
    const bw = parseFloat(st.borderTopWidth) || 0;
    const bg = st.backgroundColor;
    const transparent = bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
    if (transparent && bw === 0) continue;
    if (radius < 6) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 60 || b.height < 24) continue;
    const pad = [st.paddingTop, st.paddingRight, st.paddingBottom, st.paddingLeft].map(num);
    const parent = el.parentElement;
    boxes.push({
      sel: label(el),
      left: r1(b.left),
      right: r1(b.right),
      top: r1(b.top),
      bottom: r1(b.bottom),
      w: r1(b.width),
      h: r1(b.height),
      radius,
      pad,
      // 排布上下文，判定「同排」用
      parent: parent ? label(parent) : '',
      parentDisplay: parent ? getComputedStyle(parent).display : '',
      parentGap: parent ? getComputedStyle(parent).gap : '',
      siblings: parent ? parent.children.length : 0,
    });
  }

  // ③ 文本被裁
  const clipped = [];
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const st = getComputedStyle(el);
    if (st.overflowX !== 'hidden' && st.overflow !== 'hidden') continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      clipped.push({ sel: label(el), text: (el.textContent || '').trim().slice(0, 26), scroll: el.scrollWidth, client: el.clientWidth });
    }
  }

  const doc = document.documentElement;
  return {
    url: location.pathname,
    vw: doc.clientWidth,
    hOver: doc.scrollWidth - doc.clientWidth,
    height: doc.scrollHeight,
    texts,
    boxes,
    clipped: clipped.slice(0, 10),
  };
};

// ── 分析：把几何变成「看得见的问题」 ──
const n2 = (v) => String(v).replace(/^(\d+)$/, '$1');

const analyze = (d) => {
  const issues = [];

  // ① 左缘轨道：只差 1–3px 的两条轨道 = 视觉未对齐
  const railMap = new Map();
  for (const t of d.texts) {
    if (!t.railEligible) continue;
    if (!railMap.has(t.left)) railMap.set(t.left, []);
    railMap.get(t.left).push(t);
  }
  const rails = [...railMap.entries()].filter(([, v]) => v.length >= 2).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < rails.length; i++) {
    for (let j = i + 1; j < rails.length; j++) {
      const dx = rails[j][0] - rails[i][0];
      if (dx === 0) continue;
      if (dx <= 3) {
        issues.push({
          kind: 'near-rail',
          severity: 2,
          msg: `左缘 ${n2(rails[i][0])}px 与 ${n2(rails[j][0])}px 只差 ${dx}px（各 ${rails[i][1].length}/${rails[j][1].length} 处文本）`,
          detail: [rails[i][1][0], rails[j][1][0]].map((t) => `${t.sel} @${t.left} 「${t.text}」`),
        });
      }
    }
  }
  // 不在 4px 网格上的轨道（只报有多处文本的，避免单点噪声）
  const offUnit = rails.filter(([x, v]) => x % 4 !== 0 && v.length >= 2);
  for (const [x, v] of offUnit) {
    issues.push({
      kind: 'off-grid-rail',
      severity: 1,
      msg: `左缘 ${x}px 不在 4px 网格上（${v.length} 处文本）`,
      detail: v.slice(0, 3).map((t) => `${t.sel} 「${t.text}」`),
    });
  }

  // ② padding 不对称
  for (const b of d.boxes) {
    const [pt, pr, pb, pl] = b.pad;
    if (b.w < 120) continue; // 小芯片的对称性不影响阅读
    if (Math.abs(pl - pr) >= 2) {
      issues.push({
        kind: 'pad-asym-x',
        severity: 2,
        msg: `${b.sel} 左右内边距不等 ${pl}/${pr}`,
        detail: [`${b.w}×${b.h}`],
      });
    }
    if (Math.abs(pt - pb) >= 4 && b.h >= 60 && pt + pb > 0) {
      issues.push({ kind: 'pad-asym-y', severity: 1, msg: `${b.sel} 上下内边距不等 ${pt}/${pb}`, detail: [`${b.w}×${b.h}`] });
    }
  }

  // ③ 同排参差：同父、同 display 上下文、顶边接近的卡片
  const byParent = new Map();
  for (const b of d.boxes) {
    if (!b.parent) continue;
    if (!byParent.has(b.parent)) byParent.set(b.parent, []);
    byParent.get(b.parent).push(b);
  }
  for (const [parent, kids] of byParent) {
    if (kids.length < 2) continue;
    // 同一水平排：top 相差 < 6px 视为一排
    const rows = [];
    for (const k of kids.slice().sort((a, b) => a.top - b.top)) {
      const row = rows.find((r) => Math.abs(r[0].top - k.top) < 6);
      if (row) row.push(k);
      else rows.push([k]);
    }
    for (const row of rows) {
      if (row.length < 2) continue;
      const tops = row.map((k) => k.top);
      const hs = row.map((k) => k.h);
      const ws = row.map((k) => k.w);
      const topSpread = Math.max(...tops) - Math.min(...tops);
      const hSpread = Math.max(...hs) - Math.min(...hs);
      const wSpread = Math.max(...ws) - Math.min(...ws);
      if (topSpread > 2) {
        issues.push({
          kind: 'row-top',
          severity: 2,
          msg: `${parent} 同排 ${row.length} 个卡片顶边差 ${topSpread}px`,
          detail: row.map((k) => `${k.sel} top=${k.top}`),
        });
      }
      if (hSpread > 2) {
        issues.push({
          kind: 'row-height',
          severity: 1,
          msg: `${parent} 同排 ${row.length} 个卡片高差 ${hSpread}px（底边参差）`,
          detail: row.map((k) => `${k.sel} h=${k.h}`),
        });
      }
      // 等分栅格应当等宽；差 >4px 说明列宽没对齐
      if (wSpread > 4 && row.every((k) => k.w > 120)) {
        issues.push({
          kind: 'row-width',
          severity: 1,
          msg: `${parent} 同排 ${row.length} 个卡片宽差 ${wSpread}px`,
          detail: row.map((k) => `${k.sel} w=${k.w}`),
        });
      }
      // 横向 gap 不匀
      const sorted = row.slice().sort((a, b) => a.left - b.left);
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].left - sorted[i - 1].right);
      if (gaps.length >= 2) {
        const gs = Math.max(...gaps) - Math.min(...gaps);
        if (gs > 1) {
          issues.push({
            kind: 'row-gap',
            severity: 2,
            msg: `${parent} 同排卡片间距不匀：${gaps.join(' / ')}`,
            detail: sorted.map((k) => k.sel),
          });
        }
      }
    }
  }

  // ⑤ 同角色字号漂移：同一 selector 的文本出现多种字号
  const byRole = new Map();
  for (const t of d.texts) {
    if (!byRole.has(t.sel)) byRole.set(t.sel, new Set());
    byRole.get(t.sel).add(t.fs);
  }
  for (const [role, set] of byRole) {
    if (set.size < 2) continue;
    const arr = [...set].sort((a, b) => a - b);
    // 只报「差距 <6px 的小漂移」，那种 12 vs 22 是角色分工不是 bug
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] - arr[i - 1] <= 6) {
        issues.push({
          kind: 'font-drift',
          severity: 1,
          msg: `${role} 同角色字号不统一：${arr.join(' / ')}`,
          detail: d.texts.filter((t) => t.sel === role).map((t) => `${t.fs}px「${t.text}」`).slice(0, 4),
        });
        break;
      }
    }
  }

  // ⑥ 文本被裁
  for (const c of d.clipped) {
    issues.push({ kind: 'clipped', severity: 2, msg: `${c.sel} 文本被裁 ${c.scroll}>${c.client}`, detail: [`「${c.text}」`] });
  }

  return issues;
};

const SEV = { 2: '✖', 1: '△' };

/**
 * 交互式走查（--with-learn / --with-goal）：课堂页与目标规划页都必须「真的连上会话」才有
 * 完整 DOM（课堂页少消息时只有一个开场气泡，goal 页不发消息就只有引导语），所以这两页
 * 必须写库 + 打 LLM，默认关闭，开了就是显式授权。
 *
 * 单一页面 resize 覆盖两档宽度，而不是每个宽度各开一次 context：课堂页 onMounted 会
 * startSession，开两次就是续两次会话、刷两次 revision，还会撞上「教学回合中别碰页面」
 * 的可见性翻转陷阱（见 frontend-walkthrough-raf-trap / project-mobile-density）。
 */
const INTERACTIVE_LOGIN = async (page) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const ins = await page.locator('input:visible').all();
  await ins[0].fill(CREDS.name);
  await ins[1].fill(CREDS.password);
  await page.click('button:has-text("登录")');
  await page.waitForTimeout(2500);
};

const run = async () => {
  const browser = await chromium.launch();
  const only = opt('routes', '') ? opt('routes', '').split(',').map((s) => s.trim()) : null;
  const want = (r) => !only || only.some((o) => r.startsWith(o));
  const all = {};

  const settle = async (page) => {
    await page.waitForTimeout(1200);
    for (let i = 0; i < 10; i++) {
      const busy = await page.evaluate(() =>
        [...document.querySelectorAll('[class*="loading"], [class*="skeleton"]')].some((el) => el.getClientRects().length > 0)
      );
      if (!busy) break;
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(400);
  };

  for (const vp of VIEWPORTS) {
    if (SKIP_STATIC) break;
    if (opt('viewport', '') && String(vp.w) !== opt('viewport', '')) continue;
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const dir = `${OUT}/${vp.w}x${vp.h}`;
    mkdirSync(dir, { recursive: true });
    const label = `${vp.w}×${vp.h}`;

    // 匿名页先量（登录态访问 /login 会被重定向）
    const anon = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 });
    const anonPage = await anon.newPage();
    for (const route of ANON_ROUTES) {
      if (!want(route)) continue;
      await anonPage.goto(BASE + route, { waitUntil: 'domcontentloaded' });
      await settle(anonPage);
      const d = await anonPage.evaluate(COLLECT);
      const issues = analyze(d);
      writeFileSync(`${dir}/${route.replace(/\//g, '_')}.json`, JSON.stringify({ ...d, issues }, null, 1));
      all[`${label} ${route}`] = issues;
      await anonPage.screenshot({ path: `${dir}/${route.replace(/\//g, '_')}.png`, fullPage: true });
    }
    await anon.close();

    // 登录态
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const ins = await page.locator('input:visible').all();
    await ins[0].fill(CREDS.name);
    await ins[1].fill(CREDS.password);
    await page.click('button:has-text("登录")');
    await page.waitForTimeout(2500);

    for (const route of STATIC_ROUTES) {
      if (!want(route)) continue;
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
      await settle(page);
      const actual = new URL(page.url()).pathname;
      const d = await page.evaluate(COLLECT);
      const issues = analyze(d);
      const key = actual !== route ? `${route}→${actual}` : route;
      writeFileSync(`${dir}/${route.replace(/\//g, '_')}.json`, JSON.stringify({ ...d, route, actual, issues }, null, 1));
      all[`${label} ${key}`] = issues;
      await page.screenshot({ path: `${dir}/${route.replace(/\//g, '_')}.png`, fullPage: true });
    }

    // 路径列表 → 详情（纯导航点击）
    if (want('/learning-path')) {
      await page.goto(`${BASE}/learning-paths`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      const d0 = await page.evaluate(COLLECT);
      writeFileSync(`${dir}/_learning-paths.json`, JSON.stringify({ ...d0, issues: analyze(d0) }, null, 1));
      all[`${label} /learning-paths`] = analyze(d0);
      await page.screenshot({ path: `${dir}/_learning-paths.png`, fullPage: true });

      const ok = await page.evaluate(() => {
        const el = document.querySelector('.pcard');
        if (!el) return false;
        el.click();
        return true;
      });
      if (ok) {
        await settle(page);
        const d1 = await page.evaluate(COLLECT);
        writeFileSync(`${dir}/_learning-path_detail.json`, JSON.stringify({ ...d1, issues: analyze(d1) }, null, 1));
        all[`${label} /learning-path/:id`] = analyze(d1);
        await page.screenshot({ path: `${dir}/_learning-path_detail.png`, fullPage: true });
      } else {
        console.log(`  ${label} /learning-path/:id → 跳过（没有 .pcard）`);
      }
    }

    if (WITH_LEARN) {
      console.log(`  ${label} /learn/:taskId → 走交互段（见下方「交互式走查」）`);
    }

    await ctx.close();
  }

  // ══════════ 交互式走查：课堂页 / 目标规划页 ══════════
  if (WITH_LEARN || WITH_GOAL) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await INTERACTIVE_LOGIN(page);
    const dir = `${OUT}/interactive`;
    mkdirSync(dir, { recursive: true });

    /** 同一页面依次切到两档宽度各量一次 */
    const measureWidths = async (stageKey, shot) => {
      for (const w of [
        { w: 1440, h: 900 },
        { w: 390, h: 844 },
      ]) {
        await page.setViewportSize({ width: w.w, height: w.h });
        await settle(page);
        const d = await page.evaluate(COLLECT);
        const issues = analyze(d);
        writeFileSync(`${dir}/${shot}-${w.w}.json`, JSON.stringify({ ...d, issues }, null, 1));
        all[`${w.w}×${w.h} ${stageKey}`] = issues;
        await page.screenshot({ path: `${dir}/${shot}-${w.w}.png`, fullPage: w.w === 390 });
      }
    };

    /** 等一个 LLM 回合落地：消息数增加且没有「生成中」指示器 */
    const waitTurn = async (prevN, maxMs = 200000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < maxMs) {
        const st = await page.evaluate(() => ({
          n: document.querySelectorAll('.msg, .bubble, [class*="__msg"]').length,
          busy: [...document.querySelectorAll('[class*="typing"], [class*="thinking"], [class*="prepar"], [class*="loading"], [class*="skeleton"], [class*="stream"]')].some(
            (e) => e.getClientRects().length > 0
          ),
        }));
        if (st.n > prevN && !st.busy) return { ok: true, ms: Date.now() - t0, n: st.n };
        await page.waitForTimeout(2000);
      }
      return { ok: false, ms: maxMs };
    };

    const dumpStructure = async (tag) => {
      const s = await page.evaluate(() => {
        const out = {};
        for (const sel of ['main', '.v2-page', '.learn', '.learn__body', '.tutor', '.kp', '.composer', '.goal', '.gc', '.gc__body']) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const cs = getComputedStyle(el);
          out[sel] = {
            display: cs.display,
            cols: cs.gridTemplateColumns,
            rows: cs.gridTemplateRows,
            pad: cs.padding,
            w: Math.round(el.getBoundingClientRect().width),
            kids: [...el.children].slice(0, 8).map((c) => `${c.tagName.toLowerCase()}.${(typeof c.className === 'string' ? c.className : '').trim().split(/\s+/)[0]}`),
          };
        }
        return out;
      });
      console.log(`\n[结构 ${tag}]`, JSON.stringify(s, null, 1));
    };

    // ── 课堂页 ──
    if (WITH_LEARN) {
      const task = opt('task', '');
      if (!task) {
        console.log('\n⚠ --with-learn 需要 --task <taskId>（会 startSession 续会话，故不自动猜）');
      } else {
        await page.goto(`${BASE}/learn/${task}`, { waitUntil: 'domcontentloaded' });
        await settle(page);
        await page.waitForTimeout(2500);
        const before = await page.evaluate(() => document.querySelectorAll('.msg, .bubble, [class*="__msg"]').length);
        console.log(`\n════ 课堂页 /learn/${task}：连上会话后 ${before} 条消息`);
        await dumpStructure('课堂页·开场态');
        await measureWidths('课堂页·开场态', 'learn-open');

        // 发一条回复触发教学回合（会写库 + 打 LLM）
        const typed = await page.evaluate(() => {
          const ta = document.querySelector('textarea');
          if (!ta) return false;
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, '上周我把三件事记成了流水账，其中「把接口文档补完」这件事同事能直接拿去用。');
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        });
        if (typed) {
          await page.waitForTimeout(600);
          const sent = await page.evaluate(() => {
            const btn = document.querySelector('.composer__send:not(.composer__send--off), button[type="submit"]');
            if (btn) {
              btn.click();
              return 'click';
            }
            return 'none';
          });
          console.log(`  发送方式：${sent}`);
          const t = await waitTurn(before);
          console.log(`  回合落地：${t.ok ? '是' : '否'}，耗时 ${(t.ms / 1000).toFixed(1)}s，消息 ${t.n} 条`);
          await dumpStructure('课堂页·回合后');
          await measureWidths('课堂页·回合后', 'learn-turn');
        } else {
          console.log('  ⚠ 没找到输入框，跳过发消息');
        }
      }
    }

    // ── 目标规划页 ──
    if (WITH_GOAL) {
      const conv = opt('conversation', '');
      const url = conv ? `/goal-conversation/${conv}` : '/goal-conversation';
      await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await page.waitForTimeout(2500);
      console.log(`\n════ 目标规划页 ${url}`);
      await dumpStructure('目标页·开场态');
      await measureWidths('目标页·开场态', 'goal-open');

      const before = await page.evaluate(() => document.querySelectorAll('.msg, .bubble, [class*="__msg"]').length);
      const typed = await page.evaluate(() => {
        const ta = document.querySelector('textarea');
        if (!ta) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, '我想先练会判断：一页汇报里哪些内容值得写进去、哪些可以删掉。');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      });
      if (typed) {
        await page.waitForTimeout(600);
        const sent = await page.evaluate(() => {
          const btn = document.querySelector('button[class*="send"]:not([class*="off"]), button[type="submit"]');
          if (btn) {
            btn.click();
            return 'click';
          }
          return 'none';
        });
        console.log(`  发送方式：${sent}`);
        const t = await waitTurn(before);
        console.log(`  回合落地：${t.ok ? '是' : '否'}，耗时 ${(t.ms / 1000).toFixed(1)}s，消息 ${t.n} 条`);
        await dumpStructure('目标页·回合后');
        await measureWidths('目标页·回合后', 'goal-turn');
      } else {
        console.log('  ⚠ 没找到输入框，跳过发消息');
      }
    }

    await ctx.close();
  }

  await browser.close();

  // ── 打印摘要 ──
  let total = 0;
  for (const [key, issues] of Object.entries(all)) {
    total += issues.length;
    const hard = issues.filter((i) => i.severity === 2);
    console.log(`\n── ${key}  问题 ${issues.length}（硬 ${hard.length}）`);
    for (const i of issues.sort((a, b) => b.severity - a.severity)) {
      console.log(`   ${SEV[i.severity]} [${i.kind}] ${i.msg}`);
      for (const dt of i.detail || []) console.log(`        · ${dt}`);
    }
  }
  console.log(`\n════ 合计 ${total} 条 ════`);
  console.log(`原始几何：${OUT}/<档位>/*.json`);
};

await run();
