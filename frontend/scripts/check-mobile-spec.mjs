/* 移动端规格守卫（2026-09-26 批14 入库 / 2026-09-26 对齐走查校准）：
   在 375×812 视口扫描用户侧核心页，断言四类指标不越阈值——
   - lt44：交互元素（宽或高）< 44px 的数量（分级口径：主操作须 ≥44；文字链/紧凑芯片 36-40，
     各页阈值即按当前分级保留量设定，新增 <44 元素必须走口径评审）
   - lt36：交互元素 < 36px 的数量，阈值一律 0 —— 这是"36-40 紧凑带"的下沿，比 lt44 更硬：
     lt44 按页留了分级保留量，lt36 则编码"任何可点元素都不许低于 36px"
   - fonts：计算字号 < 12px 的文本数（下限 token 见 styles/main.css --mk-fs-*）
   - hOver：横向溢出（scrollWidth - innerWidth > 2 视为破版）

   两条测量校准（2026-09-26，否则会把不是问题的东西报成问题）：
   ① 移出视口的 position:fixed 元素不计——App.vue 的 .skip-link 用 transform:translateY(-200%)
      藏起来、只在键盘聚焦时可见，但它永远有 bounding box，会白占掉 dashboard 的 lt44 预算；
   ② checkbox/radio 若包在 <label> 里，按 **label 的盒子**量——点 label 任意处都能切换，
      真正的手势目标就是 label，不是那个 18px 的原生方框。

   运行前提：前端 dev server（默认 http://localhost:5173）与后端在跑。
   用法：npm run mobile:spec            （BASE=env BASE_URL，账号=env SPEC_USER/SPEC_PASS）
   越阈值退出码 1，供 CI/本地护栏使用；--json 输出原始计数。 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const USER = process.env.SPEC_USER || 'logocheck2';
const PASS = process.env.SPEC_PASS || 'Abc123456';
const W = 375, H = 812;
/* 桌面比例档（2026-09-27 新增）：用户侧桌面视觉比例测试也在这条门禁里 */
const DW = 1440, DH = 900;

/* 阈值 = 2026-09-26 四批整改 + 对齐走查后的分级保留量；只许收紧，不许放松。

   2026-09-26 对齐走查补的四页（原来只覆盖五个核心页，这四页是门禁盲区）：
   achievements / onboarding / learning-history / agent-logs 的 fonts 预算非 0，
   因为它们有一批「桌面本来就 10–11.5px」的微标签（见 project-mobile-density 里记的
   边界②：单方面放大会让手机上同一个元素比桌面还大、卡片还更高）。这些值是两个断点
   同值的基础声明，不是移动块压下去的，故按当前量登记、只许收紧：
     .ach-rarity 10 / .ach-card__badge 10.5 / .ach-card__date 11.5 / .ach-card__prog 11
     .ob__flow-item 的序号与说明 11 / 表格 th 11 / .ai-note 11（页脚 AI 声明，登记保留项）
   新增 <12px 必须走分级口径评审，不许把登记值往上调。 */
const PAGES = [
  /* dashboard lt44 3→10（2026-09-27）：学习节奏改常显后七个星期格进入口径。375 下 7 列每格几何上限 ~44px，
   实测 39px 宽×92px 高（含 3 个 link-muted/path__detail-link 的 36px 紧凑带）。星期格是日历型次级交互，
   按分级口径登记；格内数字块 28px、点击热区为整格高度。 */
  { key: 'dashboard', path: '/dashboard', gate: '.dash__main .card', budget: { lt36: 0, lt44: 10, fonts: 0, hOver: 0 } },
  { key: 'paths', path: '/learning-paths', gate: '.pcard, .empty', budget: { lt36: 0, lt44: 8, fonts: 0, hOver: 0 } },
  { key: 'path-detail', path: '/learning-path/lp_1790165713901_bigjo2r', gate: '.hero', budget: { lt36: 0, lt44: 4, fonts: 1, hOver: 0 } },
  { key: 'state', path: '/learning-state', gate: '.metrics, main .card', budget: { lt36: 0, lt44: 6, fonts: 0, hOver: 0 } },
  { key: 'kmap', path: '/knowledge-map', gate: 'main', budget: { lt36: 0, lt44: 7, fonts: 0, hOver: 0 } },
  { key: 'achievements', path: '/user/achievements', gate: '.grid, .empty, .ov', budget: { lt36: 0, lt44: 13, fonts: 30, hOver: 0 } },
  { key: 'account', path: '/user/account', gate: '.uc-card, .profile-hero, .empty', budget: { lt36: 0, lt44: 16, fonts: 0, hOver: 0 } },
  /* onboarding fonts 0→6（2026-09-27）：P0-6 修复把 ob__flow 从 aria-hidden 里放出来（三步流程是信息内容，读屏必须可读），其中已登记的 11px 序号/说明（6 处）随之进入 fonts 口径。登记保留，只许收紧。 */
  { key: 'onboarding', path: '/onboarding', gate: '.ob__card, .ob', budget: { lt36: 0, lt44: 2, fonts: 6, hOver: 0 } },
  { key: 'history', path: '/user/learning-history', gate: '.history__items, .empty', budget: { lt36: 0, lt44: 10, fonts: 1, hOver: 0 } },
  { key: 'agent-logs', path: '/user/agent-logs', gate: '.uc-table, .empty, main', budget: { lt36: 0, lt44: 33, fonts: 0, hOver: 0 } },
  /* 2026-09-27 UI 审计 P0-8② 补盲：课堂页与目标对话页是用户主链路，此前从未纳入度量。
     learn 用 logocheck2 名下已完结会话走只读续读（驱动配方见 project-mobile-density），
     goal 量的是入口态（无进行中对话的确定性状态）。 */
  { key: 'learn', path: '/learn/teaching_user_c2aad129-66b3-4783-a125-bf7dd7981283_6fb99ca2-1379-4986-a3fa-dfc5278a1048', gate: '.learn, .learn__gate, main', budget: { lt36: 0, lt44: 0, fonts: 0, hOver: 0 } },
  { key: 'goal', path: '/goal-conversation', gate: '.goal, .entry, main', budget: { lt36: 0, lt44: 2, fonts: 0, hOver: 0 } },
];
const EVAL_PATH = process.env.SPEC_EVAL_URL || '';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, storageState: undefined, hasTouch: true, isMobile: true });
const p = await ctx.newPage();

/* 登录（失败重试三次；账号环境变量可覆盖） */
for (let a = 0; a < 3; a++) {
  await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  if (!p.url().includes('/login')) break;
  const ins = await p.locator('input:visible').all();
  if (ins.length < 2) { await p.waitForTimeout(6000); continue; }
  await ins[0].fill(USER); await ins[1].fill(PASS);
  await p.click('button:has-text("登录")');
  if (await p.waitForURL((u) => !String(u).includes('/login'), { timeout: 20000 }).then(() => true).catch(() => false)) break;
  await p.waitForTimeout(8000);
}

async function scan() {
  return p.evaluate(() => {
    const SEL = 'button, a, [role="button"], [role="radio"], [role="tab"], [role="option"], input, textarea, select, [onclick]';
    let lt36 = 0, lt44 = 0, lt32 = 0, fonts = 0;
    const hOver = Math.round(document.documentElement.scrollWidth - window.innerWidth);
    for (const el of document.querySelectorAll(SEL)) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      // ① 移出视口的 fixed 元素（.skip-link）不算手势目标
      const fb = el.getBoundingClientRect();
      if (cs.position === 'fixed' && (fb.bottom <= 0 || fb.right <= 0)) continue;
      // ② checkbox/radio 按包着它的 label 量
      const target =
        /^(checkbox|radio)$/.test(el.type || '') && el.closest('label') ? el.closest('label') : el;
      const r = target.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (Math.round(r.height) < 36 || Math.round(r.width) < 36) lt36++;
      if (Math.round(r.height) < 44 || Math.round(r.width) < 44) { lt44++; if (r.height < 32 || r.width < 32) lt32++; }
    }
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg') || el.closest('[aria-hidden="true"]')) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      if (parseFloat(getComputedStyle(el).fontSize) < 12) fonts++;
    }
    return { lt36, lt44, lt32, fonts, hOver };
  });
}

const results = {};
let failed = false;
const run = async (key, path, gate, budget) => {
  await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  for (let a = 0; a < 3; a++) {
    if (await p.waitForSelector(gate, { timeout: 40000 }).then(() => true).catch(() => false)) break;
    await p.waitForTimeout(8000);
    await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await p.waitForTimeout(2200);
  const m = await scan();
  const over = [];
  for (const k of ['lt36', 'lt44', 'fonts', 'hOver']) {
    if (budget[k] !== undefined && m[k] > budget[k]) over.push(`${k} ${m[k]}>${budget[k]}`);
  }
  if (over.length) failed = true;
  results[key] = { ...m, budget, over };
  console.log(`${over.length ? '✖' : '✓'} ${key}: lt36=${m.lt36}/${budget.lt36} lt44=${m.lt44}/${budget.lt44} fonts=${m.fonts}/${budget.fonts} hOver=${m.hOver}${over.length ? ' → ' + over.join(', ') : ''}`);
};

for (const pg of PAGES) await run(pg.key, pg.path, pg.gate, pg.budget);
if (EVAL_PATH) await run('evaluation', EVAL_PATH, '.evaluation-shell .completion-card', { lt36: 0, lt44: 1, fonts: 0, hOver: 0 });

/* ── 桌面视觉比例档（2026-09-27）────────────────────────────────────────
   用户反馈「大的大、小的小，没有视觉比例测试」。标准（GitHub Primer body 14、
   2025 仪表盘共识 13–15 基座 + ~1.2 模数 + 6–8 级 + token 化）落地为三条硬指标：
   - max ≤ 24：桌面用户侧不允许出现展示字（原 34px KPI / 28px 页标题已收进
     页标题 20 / 卡片大标题 18 / KPI 24 / 统计卡 20 / 行内数字 16 五档）
   - steps ≤ 10：一页的不同字号档数。修复前 9–13 档、最多 22 种字号散布全站；
     先按现状登记，只许收紧
   - small：登记的桌面长尾（.ach-rarity 10 / .ach-card__badge 10.5 / 表头 11 /
     .ai-note 11 / 时间戳 11.5），边界②登记项，新增需评审 */
const DESKTOP = [
  { key: 'dashboard', path: '/dashboard', gate: '.dash__main .card', budget: { max: 24, steps: 10, small: 0 } },
  { key: 'paths', path: '/learning-paths', gate: '.pcard, .empty', budget: { max: 24, steps: 8, small: 0 } },
  { key: 'path-detail', path: '/learning-path/lp_1790165713901_bigjo2r', gate: '.hero', budget: { max: 24, steps: 9, small: 0 } },
  { key: 'state', path: '/learning-state', gate: '.metrics, main .card', budget: { max: 24, steps: 10, small: 0 } },
  { key: 'kmap', path: '/knowledge-map', gate: 'main', budget: { max: 24, steps: 7, small: 0 } },
  { key: 'achievements', path: '/user/achievements', gate: '.grid, .empty, .ov', budget: { max: 24, steps: 13, small: 30 } },
  { key: 'account', path: '/user/account', gate: '.uc-card, .profile-hero, .empty', budget: { max: 24, steps: 10, small: 0 } },
  { key: 'history', path: '/user/learning-history', gate: '.history__items, .empty', budget: { max: 24, steps: 10, small: 1 } },
  { key: 'settings', path: '/user/settings', gate: '.uc-card, main', budget: { max: 24, steps: 10, small: 1 } },
  { key: 'agent-logs', path: '/user/agent-logs', gate: '.uc-table, .empty, main', budget: { max: 24, steps: 10, small: 24 } },
  { key: 'learn', path: '/learn/teaching_user_c2aad129-66b3-4783-a125-bf7dd7981283_6fb99ca2-1379-4986-a3fa-dfc5278a1048', gate: '.learn, .learn__gate, main', budget: { max: 22, steps: 7, small: 0 } },
  { key: 'goal', path: '/goal-conversation', gate: '.goal, .entry, main', budget: { max: 20, steps: 8, small: 0 } },
];

const dctx = await b.newContext({ viewport: { width: DW, height: DH } });
const dp = await dctx.newPage();
{
  for (let a = 0; a < 3; a++) {
    await dp.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await dp.waitForTimeout(2000);
    if (!dp.url().includes('/login')) break;
    const ins = await dp.locator('input:visible').all();
    if (ins.length < 2) { await dp.waitForTimeout(6000); continue; }
    await ins[0].fill(USER); await ins[1].fill(PASS);
    await dp.click('button:has-text("登录")');
    if (await dp.waitForURL((u) => !String(u).includes('/login'), { timeout: 20000 }).then(() => true).catch(() => false)) break;
    await dp.waitForTimeout(8000);
  }
}

const dscan = () =>
  dp.evaluate(() => {
    const sizes = new Map();
    let max = 0, small = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      if (el.closest('svg') || el.closest('[aria-hidden="true"]')) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const fs = Math.round(parseFloat(getComputedStyle(el).fontSize) * 2) / 2;
      sizes.set(fs, (sizes.get(fs) || 0) + 1);
      if (fs > max) max = fs;
      if (fs < 12) small++;
    }
    return { max, small, steps: sizes.size };
  });

for (const pg of DESKTOP) {
  await dp.goto(`${BASE}${pg.path}`, { waitUntil: 'domcontentloaded' });
  for (let a = 0; a < 3; a++) {
    if (await dp.waitForSelector(pg.gate, { timeout: 40000 }).then(() => true).catch(() => false)) break;
    await dp.waitForTimeout(8000);
    await dp.goto(`${BASE}${pg.path}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await dp.waitForTimeout(2200);
  const m = await dscan();
  const over = [];
  for (const k of ['max', 'steps', 'small']) {
    if (m[k] > pg.budget[k]) over.push(`${k} ${m[k]}>${pg.budget[k]}`);
  }
  if (over.length) failed = true;
  results['桌面 ' + pg.key] = { ...m, budget: pg.budget, over };
  console.log(`${over.length ? '✖' : '✓'} 桌面 ${pg.key}: max=${m.max}/${pg.budget.max} steps=${m.steps}/${pg.budget.steps} small=${m.small}/${pg.budget.small}${over.length ? ' → ' + over.join(', ') : ''}`);
}
await dctx.close();

await b.close();
if (process.argv.includes('--json')) console.log(JSON.stringify(results));
if (failed) {
  console.error('\nmobile-spec：存在越阈值页面（见上 ✖）。新增 <44px 交互元素或 <12px 文本需走分级口径评审。');
  process.exit(1);
}
console.log('\nmobile-spec：全部页面在阈值内。');

