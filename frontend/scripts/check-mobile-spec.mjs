/* 移动端规格守卫（2026-09-26 批14 入库）：
   在 375×812 视口扫描用户侧六个核心页，断言三类指标不越阈值——
   - 交互元素（宽或高）< 44px 的数量（分级口径：主操作须 ≥44；文字链/紧凑芯片 36-40，
     各页阈值即按当前分级保留量设定，新增 <44 元素必须走口径评审）
   - 计算字号 < 12px 的文本数（下限 token 见 styles/main.css --mk-fs-*）
   - 横向溢出（scrollWidth - innerWidth > 2 视为破版）

   运行前提：前端 dev server（默认 http://localhost:5173）与后端在跑。
   用法：npm run mobile:spec            （BASE=env BASE_URL，账号=env SPEC_USER/SPEC_PASS）
   越阈值退出码 1，供 CI/本地护栏使用；--json 输出原始计数。 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const USER = process.env.SPEC_USER || 'logocheck2';
const PASS = process.env.SPEC_PASS || 'Abc123456';
const W = 375, H = 812;

/* 阈值 = 2026-09-26 四批整改后的分级保留量；只许收紧，不许放松 */
const PAGES = [
  { key: 'dashboard', path: '/dashboard', gate: '.dash__main .card', budget: { lt44: 3, fonts: 0, hOver: 0 } },
  { key: 'paths', path: '/learning-paths', gate: '.pcard, .empty', budget: { lt44: 8, fonts: 0, hOver: 0 } },
  { key: 'path-detail', path: '/learning-path/lp_1790165713901_bigjo2r', gate: '.hero', budget: { lt44: 4, fonts: 1, hOver: 0 } },
  { key: 'state', path: '/learning-state', gate: '.metrics, main .card', budget: { lt44: 6, fonts: 0, hOver: 0 } },
  { key: 'kmap', path: '/knowledge-map', gate: 'main', budget: { lt44: 7, fonts: 0, hOver: 0 } },
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
    let lt44 = 0, lt32 = 0, fonts = 0;
    const hOver = Math.round(document.documentElement.scrollWidth - window.innerWidth);
    for (const el of document.querySelectorAll(SEL)) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      if (Math.round(r.height) < 44 || Math.round(r.width) < 44) { lt44++; if (r.height < 32 || r.width < 32) lt32++; }
    }
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg') || el.closest('[aria-hidden="true"]')) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      if (parseFloat(getComputedStyle(el).fontSize) < 12) fonts++;
    }
    return { lt44, lt32, fonts, hOver };
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
  if (m.lt44 > budget.lt44) over.push(`lt44 ${m.lt44}>${budget.lt44}`);
  if (m.fonts > budget.fonts) over.push(`fonts ${m.fonts}>${budget.fonts}`);
  if (m.hOver > budget.hOver) over.push(`hOver ${m.hOver}>${budget.hOver}`);
  if (over.length) failed = true;
  results[key] = { ...m, budget, over };
  console.log(`${over.length ? '✖' : '✓'} ${key}: lt44=${m.lt44}/${budget.lt44} fonts=${m.fonts}/${budget.fonts} hOver=${m.hOver}${over.length ? ' → ' + over.join(', ') : ''}`);
};

for (const pg of PAGES) await run(pg.key, pg.path, pg.gate, pg.budget);
if (EVAL_PATH) await run('evaluation', EVAL_PATH, '.evaluation-shell .completion-card', { lt44: 1, fonts: 0, hOver: 0 });

await b.close();
if (process.argv.includes('--json')) console.log(JSON.stringify(results));
if (failed) {
  console.error('\nmobile-spec：存在越阈值页面（见上 ✖）。新增 <44px 交互元素或 <12px 文本需走分级口径评审。');
  process.exit(1);
}
console.log('\nmobile-spec：全部页面在阈值内。');
