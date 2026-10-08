/**
 * 登录页两处用户侧走查修复的源码锁（2026-10-08 视觉检查）
 *
 * ① 副标题文案 + 来源说明（发现 #5 / #31）：
 *    从 404 点「前往学习台」被守卫弹到 /login?redirect=/dashboard 时，页面上没有任何一句
 *    说明「为什么到了这里」，用户分不清是自己点错还是被登录拦下；副标题又是固定句
 *    「登录后，从上次停下的地方继续。」—— 对一个没账号、没有任何学习记录的路人不成立
 *    （本页无读取历史的逻辑，来源页 404 的按钮是首次进入学习台，不是「继续上次」）。
 *    现在带 redirect 时：提示条说来源，副标题说落点；无 redirect 且本机没存过用户名
 *    （首次到访）时也不再预设「上次」。
 *
 * ② 「记住我」勾选框描边（发现 #28）：.remember-cb 原用 var(--line)（深色 #36373c），
 *    对卡面 #202124 只有 1.36:1；框里没有任何内容，边界就是它全部的可见信息，
 *    于是它在暗色下几乎不可见。改用 --ink 与灰阶的派生（color-mix），亮档 2.61:1 /
 *    暗档 3.91:1。这里钉住两件事：不再退回 --line / --mk-line，且描边值不写死颜色。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sfc = readFileSync(resolve(here, '../V2Login.vue'), 'utf8');

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleAfter(cssRaw: string, selector: string): string {
  const css = stripComments(cssRaw);
  const start = css.indexOf(selector);
  expect(start, `样式里没有 ${selector}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`${selector} 声明块不配平`);
}

describe('登录页：被登录拦下时说清来源与落点', () => {
  it('带 redirect 时渲染来源提示条', () => {
    expect(sfc).toMatch(/v-if="redirectNotice"[^>]*class="notice"/);
    expect(sfc).toContain('你刚才要去的页面需要登录后才能访问。');
  });

  it('提示条只在有 redirect 时出现', () => {
    const m = /const redirectNotice = computed\(\(\) =>([\s\S]*?)\);/.exec(sfc);
    expect(m, '找不到 redirectNotice 的定义').not.toBeNull();
    expect(m![1]).toMatch(/safeRedirect\.value\s*\?/);
  });

  it('副标题给出落点：登录后继续前往 <meta.title>', () => {
    expect(sfc).toContain('登录后继续前往${redirectTitle.value}。');
    // 落点取自路由 meta.title，不写死「学习台」
    expect(sfc).toMatch(/router\.resolve\(safeRedirect\.value\)\.meta\.title/);
  });

  it('取不到目标页名时有兜底文案', () => {
    expect(sfc).toContain('登录后继续前往你刚才要去的页面。');
  });
});

describe('登录页副标题：不向首次到访的路人预设「上次」', () => {
  it('「从上次停下的地方继续」只在回访分支里出现', () => {
    const m = /const subtitle = computed\(\(\) =>([\s\S]*?)\n\}\);/.exec(sfc);
    expect(m, '找不到 subtitle 的定义').not.toBeNull();
    const body = m![1];
    const at = body.indexOf('从上次停下的地方继续');
    expect(at, '回访分支的文案不该消失（有历史的老用户仍需这句话）').toBeGreaterThan(-1);
    expect(body.slice(0, at)).toMatch(/if \(returningUser\)/);
  });

  it('首次到访给中性文案', () => {
    expect(sfc).toContain('登录后，开始你的学习。');
  });

  it('回访判定基于本机存过的用户名，且是挂载时快照', () => {
    expect(sfc).toMatch(/const returningUser = Boolean\(localStorage\.getItem\(LAST_NAME_KEY\)\)/);
  });
});

describe('登录页「记住我」勾选框：描边对卡面可读', () => {
  it('不再退回 var(--line) / var(--mk-line) 的发丝线', () => {
    const cb = ruleAfter(sfc, '.remember-cb');
    expect(cb).not.toMatch(/border[^;]*var\(--(?:mk-)?line\)/);
  });

  it('用不写死颜色的 color-mix 派生描边', () => {
    const cb = ruleAfter(sfc, '.remember-cb');
    const border = /border:\s*([^;]+);/.exec(cb)?.[1] ?? '';
    expect(border).toMatch(/solid\s+color-mix\(in srgb, var\(--ink\) 30%, var\(--wf-border-dark\)\)/);
    expect(border, '描边值里不应出现硬编码色').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('勾选框仍然有 1.5px 描边（不是把边界改成底色）', () => {
    const cb = ruleAfter(sfc, '.remember-cb');
    expect(/border:\s*1\.5px\s+solid\b/.test(cb)).toBe(true);
  });
});
