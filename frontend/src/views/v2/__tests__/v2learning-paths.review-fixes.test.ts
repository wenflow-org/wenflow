/**
 * 我的学习路径（V2LearningPaths）回归锁 —— 2026-10-08 用户侧走查 #13 / #14 / #15 / #59 / #71
 *
 * #13 「生成中」徽章浅色档 3.11:1：原先用通用墨色 --cyan-ink（cyan 75% 混 ink），
 *     实测 fg rgb(57,143,179) 对徽章底 rgb(222,240,247)；同排「进行中」蓝徽章 5.52:1。
 *     12px/800 属小字（ADMIN_VISUAL_LAYER_SPEC §7.5「小字按 AA 正文 4.5:1」），必须压深。
 * #14 同屏 12px 元信息：实测卡片副行 .pcard__sub 是 5.07:1（浅）/5.29:1（深）——本来就达标，
 *     故未动；本条真正不达标的是同屏页脚「内容由 AI 生成…」那行：又叠了 opacity .75，
 *     --faint 有效色 rgb(133,145,168) 对页底 #f7f8fa 只有 2.98:1。这里锁住它不再叠透明度。
 * #15 生成中卡片的进度文案原先在 normalize / pollOnce 各写一份，轮询把
 *     「主结构生成中，一般 1-2 分钟内完成…」换成「主结构生成中…」，时长承诺整段消失。
 *     现在只有 CORE_PHASE_TEXT 一处来源。
 * #59/#71 ⋯ 更多操作按钮桌面档 32×32 < 36px 触控硬线（check-mobile-spec「lt36 一律 0」），
 *     而它是本屏唯一破坏性入口（一按弹「删除路径」）。两档统一 36×36。
 *
 * 沿用仓库既有「源码锁」写法：读 SFC 源码、花括号配平取规则、断言某条声明或选择器。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningPaths.vue'), 'utf8');
// 去掉注释再断言：上面这些「原先的值」都写在说明注释里，不能误命中
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

/** 取选择器后的声明块（花括号配平），不依赖换行符（工作区是 CRLF） */
function ruleAfter(text: string, selector: string): string {
  const start = text.indexOf(selector);
  expect(start, `源码里没有 ${selector}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`${selector} 声明块不配平`);
}

const decl = (rule: string, prop: string): string | null =>
  new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule)?.[1]?.trim() ?? null;

const px = (v: string | null): number => Number((v ?? '').replace('px', ''));

describe('「生成中」徽章对比度（走查 2026-10-08 #13）', () => {
  const badge = () => ruleAfter(css, '.pcard__badge--cyan');

  it('不再用通用浅墨 --cyan-ink（浅色档只有 3.11:1）', () => {
    expect(decl(badge(), 'color'), '又用回 --cyan-ink，浅色档会掉回 3.11:1').not.toContain('--cyan-ink');
  });

  it('墨色由 --cyan 派生但 ink 占比 ≥55%（浅色档实测 5.6:1，与蓝徽章 5.52 同档）', () => {
    const color = decl(badge(), 'color') ?? '';
    const m = /color-mix\(in srgb,\s*var\(--cyan\)\s*(\d+)%\s*,\s*var\(--ink\)\s*\)/.exec(color);
    expect(m, `徽章墨色不是从 --cyan 与 --ink 派生的深色：${color}`).not.toBeNull();
    expect(Number(m![1]), 'cyan 占比过高（ink 不足），浅色档又落到 AA 以下').toBeLessThanOrEqual(45);
  });

  it('底色仍是 14% cyan tint（只压深文字，不动徽章的浅底）', () => {
    expect(decl(badge(), 'background')).toBe('color-mix(in srgb, var(--cyan) 14%, transparent)');
  });
});

describe('生成中进度文案只有一处来源（走查 2026-10-08 #15）', () => {
  it('完整句「主结构生成中，一般 1-2 分钟内完成…」只出现一次，且没有残留被截断的短句', () => {
    expect(css.match(/主结构生成中，一般 1-2 分钟内完成/g) ?? []).toHaveLength(1);
    expect(css, '又被截成「主结构生成中…」——手机档那句时长承诺会整段消失').not.toContain('主结构生成中…');
  });

  it('首屏 normalize 与轮询 pollOnce 都走同一个 phaseTextOf', () => {
    expect(css.match(/phaseTextOf\(/g) ?? []).toHaveLength(3); // 定义 1 + 调用 2
    const poll = css.slice(css.indexOf('async function pollOnce'), css.indexOf('async function refreshStatus'));
    expect(poll, '轮询没接上共享文案').toContain('phaseTextOf(lc)');
    expect(poll, '轮询里又自己拼了一份进度文案').not.toContain('生成中');
  });
});

describe('⋯ 更多操作按钮触控尺寸（走查 2026-10-08 #59 / #71）', () => {
  it('基座规则就是 36×36（桌面档不再只有 32×32）', () => {
    const rule = ruleAfter(css, '.pcard__more {');
    expect(px(decl(rule, 'width')), '⋯ 按钮又矮回 36px 以下').toBeGreaterThanOrEqual(36);
    expect(px(decl(rule, 'height'))).toBeGreaterThanOrEqual(36);
  });

  it('基座带 position:relative，窄屏 ::before 外扩热区才有定位祖先', () => {
    expect(decl(ruleAfter(css, '.pcard__more {'), 'position')).toBe('relative');
  });

  it('全文件不再有 32px 的 ⋯ 尺寸', () => {
    expect(/\.pcard__more[^}]*width:\s*32px/s.test(css), '还有一处 ⋯ 是 32px').toBe(false);
  });

  it('窄屏仍保留 ::before 外扩热区（36 的盒之外再加一层）', () => {
    const rule = ruleAfter(css, '.pcard__more::before');
    expect(rule).toContain('inset: -8px -7px');
  });
});

describe('页脚 AI 说明不再叠透明度（走查 2026-10-08 #14，同屏 12px 元信息）', () => {
  const aiNote = () => ruleAfter(css, '.paths__ai-note :deep(.ai-note)');

  it('不再叠 opacity（否则 --faint 有效色对页底只有 2.98:1，低于 AA 4.5:1）', () => {
    expect(decl(aiNote(), 'opacity'), 'AI 提示又叠了透明度').toBeNull();
    expect(decl(aiNote(), 'filter'), '不要用 filter 换个方式压淡同一行字').toBeNull();
  });

  it('字号维持 12px 下限（不靠缩小字号换对比度）', () => {
    expect(px(decl(aiNote(), 'font-size'))).toBeGreaterThanOrEqual(12);
  });
});
