/**
 * 用户侧移动端密度巡检（只读）
 *
 * 先量真实渲染，再谈结论。判据是「移动端密度基线（≤900px）」，出处：Material 3
 * （body 14sp / 输入 16sp / 按钮 14sp / 触控 48dp）、Apple HIG（body 17pt / 触控 44pt）、
 * 业界共识「移动端任何文字 ≥12px」、卡片内边距 16px + 栅格间距 12–16px；
 * 以及仓库内既有先例（.uc__head h1 22px、uc 卡内边距 14px、控件 38px、
 * LearningEvaluationPage 自带的移动密度层「正文不低于 12.5px、可点区域不低于 32px」）。
 *
 *   页面 h1 / hero 标题   22px
 *   区块/卡片主标题        15–17px
 *   正文                  13–14px
 *   次级/说明              12–12.5px
 *   微标签/徽章            ≥12px（硬下限，装饰性字形除外）
 *   KPI 大数字             20–22px
 *   卡片内边距             大卡 16 / 常规 14 / 小卡 12
 *   卡片间距               12–14px
 *   空态/加载留白          ≤32px；整页上下留白 ≤40px
 *   圆角                   只用 token 刻度（…10/12/16/pill），不引入 20px
 *   控件                   视觉 34–38px、热区 ≥40px
 *
 * 刻意不在压缩范围的（脚本会照常列出，判断时忽略）：输入框字号 16px（iOS Safari
 * 聚焦缩放阈值）、.btn-primary--block 全宽提交键、底部 tab 标签 10.5px 与图标
 * （iOS tab bar 惯例，导航 chrome 不属于内容密度）；以及各页桌面基线里本就
 * 10–11.5px 的长尾微标签（.ai-note 11px、页脚 tag 11px 之类），只盯「移动端块
 * 主动压低」的那些。
 *
 * 纪律：只导航与读 DOM/样式，不点任何会写数据的按钮。带 id 的路由（路径详情、
 * 学习页、评估页）靠「点上一页的卡片/任务」到达——pcard 与 task__cta 都是纯导航，
 * 评估页入口「查看反馈」只发一个 GET。唯一会写库的是学习页（onMounted 会
 * startSession 续上同一会话），所以它默认跳过，要量得显式加 --with-learn。
 *
 * 用法：
 *   node scripts/mobile-density-audit.mjs                        # 390×844 + 1440×900 两档
 *   node scripts/mobile-density-audit.mjs --viewport 390
 *   node scripts/mobile-density-audit.mjs --routes /dashboard,/user/settings
 *   node scripts/mobile-density-audit.mjs --with-learn           # 连 /learn/:taskId 一起量
 *   node scripts/mobile-density-audit.mjs --verbose              # 额外打印全量卡片/控件
 * 产出：.ui-audit/mobile-density/<档位>/<路由>.json + 控制台表格
 *
 * Windows 注意：Git Bash（MSYS）会把以 / 开头的参数当路径改写成 C:/Program Files/Git/...，
 * 于是 --routes 匹配不到任何路由（表格会是空的）。要么直接跑全量，要么加 MSYS_NO_PATHCONV=1。
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:5173';
const CREDS = { name: 'logocheck2', password: 'Abc123456' };
const FLOOR = 12; // 移动端最小可读字号

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const VERBOSE = flag('verbose');
const WITH_LEARN = flag('with-learn');
const OUT = opt('out', '.ui-audit/mobile-density');

// 静态页（能直接 goto 的）
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
// 匿名可看的页面（登录态访问 /login 会被重定向，量不到表单本身）
const ANON_ROUTES = ['/login', '/register', '/reset-password', '/', '/vision', '/docs', '/no-such-page-404'];

const VIEWPORTS = [
  { w: 390, h: 844, label: '390x844', mobile: true },
  { w: 1440, h: 900, label: '1440x900', mobile: false },
];

// ── 页面内采集：字号直方图 + 卡片 + 控件 + 溢出 ──
const COLLECT = () => {
  const root = document.querySelector('.v2-page') || document.querySelector('.uc__main') || document.body;
  const sel = (el) => {
    const parts = [];
    let cur = el;
    for (let i = 0; i < 3 && cur && cur.nodeType === 1; i++) {
      let s = cur.tagName.toLowerCase();
      const raw = typeof cur.className === 'string' ? cur.className : '';
      const cls = raw
        .trim()
        .split(/\s+/)
        .filter((c) => c && !c.startsWith('router-link'));
      if (cls.length) s += '.' + cls.slice(0, 2).join('.');
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const vis = (el) => el && el.getClientRects().length > 0;
  const num = (v) => Math.round(parseFloat(v) * 2) / 2;

  const texts = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!vis(el)) continue;
    const st = getComputedStyle(el);
    const fs = num(st.fontSize);
    if (!fs) continue;
    texts.push({ fs, sel: sel(el), text: t.slice(0, 30) });
  }

  // 卡片/面板：有圆角 + 有底或边 + 有宽度。
  // 表单控件不算卡片——输入框的 padding-right 42/56 是密码可见性图标的预留槽位，不是内边距。
  const cards = [];
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el)) continue;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) continue;
    const st = getComputedStyle(el);
    const r = parseFloat(st.borderTopLeftRadius) || 0;
    if (r < 10) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 80 || b.height < 28) continue;
    const bg = st.backgroundColor;
    const transparent = bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
    if (transparent && parseFloat(st.borderTopWidth) === 0) continue;
    const pad = [st.paddingTop, st.paddingRight, st.paddingBottom, st.paddingLeft].map(num);
    if (!pad.some((p) => p > 0)) continue;
    cards.push({ sel: sel(el), pad, radius: r, w: Math.round(b.width), h: Math.round(b.height), gap: st.gap });
  }

  // 控件与热区
  const ctrls = [];
  for (const el of root.querySelectorAll('button, input, select, textarea, a[href], [role="button"]')) {
    if (!vis(el)) continue;
    const st = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    ctrls.push({
      sel: sel(el),
      w: Math.round(b.width),
      h: Math.round(b.height),
      fs: num(st.fontSize),
      tag: el.tagName.toLowerCase(),
    });
  }

  const vw = document.documentElement.clientWidth;
  // 滚动容器里的内容本来就可以更宽（.uc-table-wrap 的横滚、<pre> 的代码横滚），
  // 只报「没有任何祖先在裁剪」的越界元素，否则每页都是假阳性。
  const inScroller = (el) => {
    let p = el.parentElement;
    while (p && p !== root.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
      p = p.parentElement;
    }
    return false;
  };
  const overflowing = [];
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.right > vw + 1 && !inScroller(el))
      overflowing.push({ sel: sel(el), right: Math.round(b.right), w: Math.round(b.width) });
  }

  return {
    url: location.pathname,
    height: document.documentElement.scrollHeight,
    overflow: document.documentElement.scrollWidth - vw,
    texts,
    cards,
    ctrls,
    overflowing: overflowing.slice(0, 8),
  };
};

const run = async () => {
  const browser = await chromium.launch();
  const report = {};

  // 等页面稳定：路由切换 + 数据加载完成后才采集（loading 标记消失，最多等 8s）
  const settle = async (page) => {
    await page.waitForTimeout(1200);
    for (let i = 0; i < 10; i++) {
      const busy = await page.evaluate(() =>
        [...document.querySelectorAll('[class*="loading"]')].some((el) => el.getClientRects().length > 0)
      );
      if (!busy) break;
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(400);
  };

  const snap = async (page, route) => {
    const d = await page.evaluate(COLLECT);
    const actual = new URL(page.url()).pathname;
    return { ...d, route, actual, redirected: actual !== route };
  };

  const visit = async (page, route) => {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    await settle(page);
    return snap(page, route);
  };

  const clickTo = async (page, selector) => {
    const ok = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.click();
      return true;
    }, selector);
    if (ok) await settle(page);
    return ok;
  };

  const only = opt('routes', '') ? opt('routes', '').split(',').map((s) => s.trim()) : null;
  const want = (r) => !only || only.some((o) => r.startsWith(o));

  for (const vp of VIEWPORTS) {
    if (opt('viewport', '') && String(vp.w) !== opt('viewport', '')) continue;
    const results = [];
    const size = { width: vp.w, height: vp.h };

    // 登录态
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const ins = await page.locator('input').all();
    await ins[0].fill(CREDS.name);
    await ins[1].fill(CREDS.password);
    await page.click('button:has-text("登录")');
    await page.waitForTimeout(2500);

    for (const route of STATIC_ROUTES) {
      if (!want(route)) continue;
      results.push(await visit(page, route));
    }

    // 路径列表 → 路径详情 → 评估页 → 学习页（靠点击逐级到达）
    if (want('/learning-path')) {
      results.push(await visit(page, '/learning-paths'));
      if (await clickTo(page, '.pcard')) {
        results.push(await snap(page, '/learning-path/:id'));
        const detailUrl = page.url();

        if (want('/learn/:taskId/evaluation') && (await clickTo(page, '.task__done-label'))) {
          results.push(await snap(page, '/learn/:taskId/evaluation/:sessionId'));
        } else {
          console.log('  /learn/:taskId/evaluation/:sessionId → 跳过（当前路径里没有「查看反馈」入口）');
        }

        await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
        await settle(page);
        if (!WITH_LEARN) {
          console.log('  /learn/:taskId → 跳过（onMounted 会 startSession 写库；加 --with-learn 才量）');
        } else if (await clickTo(page, '.task__cta')) {
          results.push(await snap(page, '/learn/:taskId'));
        } else {
          console.log('  /learn/:taskId → 跳过（没有可点的 task__cta）');
        }
      } else {
        console.log('  /learning-path/:id → 跳过（路径列表里没有可用卡片）');
      }
    }
    await ctx.close();

    // 匿名上下文（入口页与落地页）
    const anonCtx = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
    const anonPage = await anonCtx.newPage();
    for (const route of ANON_ROUTES) {
      if (!want(route)) continue;
      results.push(await visit(anonPage, route));
    }
    await anonCtx.close();

    report[vp.label] = results;
    mkdirSync(`${OUT}/${vp.label}`, { recursive: true });
    for (const r of results) {
      const name = (r.actual || r.route).replace(/[^a-z0-9-]/gi, '_') || 'root';
      writeFileSync(`${OUT}/${vp.label}/${name}.json`, JSON.stringify(r, null, 2));
    }

    // ── 控制台表格：只列需要行动的东西 ──
    console.log(`\n════════ ${vp.label} ════════`);
    for (const r of results) {
      const hist = {};
      for (const t of r.texts) hist[t.fs] = (hist[t.fs] || 0) + 1;
      const histStr = Object.keys(hist)
        .map(Number)
        .sort((a, b) => b - a)
        .map((k) => `${k}:${hist[k]}`)
        .join(' ');
      const tiny = r.texts.filter((t) => t.fs < FLOOR);
      const tinyUniq = [...new Map(tiny.map((t) => [t.sel + t.fs, t])).values()];
      const fatCards = [...new Map(r.cards.filter((c) => Math.max(...c.pad) >= 18).map((c) => [c.sel, c])).values()];
      const offRadius = [
        ...new Map(r.cards.filter((c) => c.radius >= 18 && c.radius !== 999).map((c) => [c.sel, c])).values(),
      ];
      const smallCtrls = [...new Map(r.ctrls.filter((c) => c.h < 32 && c.h > 0).map((c) => [c.sel, c])).values()];

      console.log(
        `\n── ${r.actual}${r.redirected ? `  (← ${r.route}，被重定向)` : ''}  高度 ${r.height}px  溢出 ${r.overflow}px`
      );
      console.log(`   字号 ${histStr}`);
      if (tinyUniq.length)
        console.log(
          `   ⚠ <${FLOOR}px × ${tiny.length}（${tinyUniq.length} 处）: ` +
            tinyUniq
              .slice(0, 8)
              .map((t) => `${t.sel} ${t.fs}px「${t.text}」`)
              .join(' ｜ ')
        );
      if (fatCards.length)
        console.log(
          `   ⚠ 内边距 ≥18px × ${fatCards.length}: ` +
            fatCards
              .slice(0, 8)
              .map((c) => `${c.sel} ${c.pad.join('/')}`)
              .join(' ｜ ')
        );
      if (offRadius.length)
        console.log(
          `   ⚠ 圆角 ≥18px（非 pill）× ${offRadius.length}: ` +
            offRadius
              .slice(0, 8)
              .map((c) => `${c.sel} r${c.radius}`)
              .join(' ｜ ')
        );
      if (smallCtrls.length)
        console.log(
          `   ⚠ 控件高 <32px × ${smallCtrls.length}: ` +
            smallCtrls
              .slice(0, 8)
              .map((c) => `${c.sel} ${c.w}×${c.h}`)
              .join(' ｜ ')
        );
      if (r.overflowing.length)
        console.log(`   ⚠ 越界元素: ` + r.overflowing.map((o) => `${o.sel} right=${o.right} w=${o.w}`).join(' ｜ '));
      if (VERBOSE) {
        console.log('   卡片: ' + r.cards.map((c) => `${c.sel} ${c.pad.join('/')} r${c.radius}`).join(' ｜ '));
        console.log('   控件: ' + r.ctrls.map((c) => `${c.sel} ${c.w}×${c.h}`).join(' ｜ '));
      }
    }

    // ── 汇总表：前后对比就看这张 ──
    console.log(`\n──── ${vp.label} 汇总（高度 / 溢出 / <12px / 卡内边距≥18 / 圆角≥18 / 控件<32）────`);
    for (const r of results) {
      const tiny = r.texts.filter((t) => t.fs < FLOOR).length;
      const fat = r.cards.filter((c) => Math.max(...c.pad) >= 18).length;
      const rad = r.cards.filter((c) => c.radius >= 18 && c.radius !== 999).length;
      const ctl = r.ctrls.filter((c) => c.h < 32 && c.h > 0).length;
      console.log(
        `  ${(r.actual || r.route).padEnd(38)} ${String(r.height).padStart(5)}  ${String(r.overflow).padStart(3)}  ` +
          `${String(tiny).padStart(3)}  ${String(fat).padStart(3)}  ${String(rad).padStart(3)}  ${String(ctl).padStart(3)}`
      );
    }
  }

  await browser.close();
  console.log(`\n原始数据：${OUT}/<档位>/*.json`);
};

run();
