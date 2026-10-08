/**
 * 学习状态页回归（2026-10-08 用户侧走查 #8 / #78 / #79）
 *
 * #8  页脚上方「内容由 AI 生成…」那行 12px 灰字原来又叠了 opacity:.75：
 *     --faint(#5f6f8c) 被抬成有效色 rgb(133,145,168)，对页面底 #f7f8fa 只有 2.98:1
 *     （深色档 3.93:1），低于 AA 正文 4.5:1；同页其他 12px 灰字都没叠透明度（5.07:1）。
 * #78 窄屏趋势图里 y 轴刻度「12」被 20/40 两条绿虚线夹住，读图容易把刻度误读成阈值。
 *     修法是拉开阈值线与网格线的层级（阈值加粗/更实，网格更淡），不动等分刻度取值。
 * #79 AI 建议卡右侧的「继续」小按钮实测约 45×30，低于 36px 触控底线。
 *
 * 这里直接读 SFC 源码锁住样式声明，沿用仓库既有的「源码锁」写法。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningState.vue'), 'utf8');
// 去掉注释后再断言：本文件把「原来的 opacity .75」写进了说明注释，不能误命中
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

/** 取选择器后的声明块（花括号配平），不依赖换行符（工作区是 CRLF） */
function ruleAfter(selector: string): string {
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

const decl = (rule: string, prop: string): string | null =>
  new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule)?.[1]?.trim() ?? null;

const px = (v: string | null): number => Number((v ?? '').replace('px', ''));

describe('学习状态页脚注对比度（走查 2026-10-08 #8）', () => {
  const aiNote = () => ruleAfter('.state__ai-note :deep(.ai-note)');

  it('不再叠 opacity（否则 --faint 有效色对比度掉到 2.98:1，低于 AA 4.5:1）', () => {
    expect(decl(aiNote(), 'opacity'), 'AI 提示又叠了透明度，对比度会重新掉到 AA 以下').toBeNull();
    expect(decl(aiNote(), 'filter'), '不要用 filter 换个方式压淡同一行字').toBeNull();
  });

  it('字号维持 12px 门禁下限（不靠缩小字号换对比度）', () => {
    expect(px(decl(aiNote(), 'font-size'))).toBeGreaterThanOrEqual(12);
  });
});

describe('学习状态趋势图阈值线与刻度（走查 2026-10-08 #78）', () => {
  it('阈值虚线比 1px 网格线更粗更实，两者一眼分得开', () => {
    const zone = ruleAfter('.ff-zone');
    expect(px(decl(zone, 'stroke-width')), '阈值线没加粗，又会和网格刻度混在一起').toBeGreaterThan(1);
    // 网格线反过来要更淡：阈值线的层级靠「粗+实」而非单靠色相
    const grid = ruleAfter('.ff-grid line');
    expect(px(decl(grid, 'stroke-width'))).toBeLessThan(px(decl(zone, 'stroke-width')));
    expect(Number(decl(grid, 'opacity'))).toBeLessThan(0.6);
  });
});

describe('学习状态 AI 建议卡「继续」按钮热区（走查 2026-10-08 #79）', () => {
  it('.sug__cta 命中区不低于 36px（实测原来约 45×30）', () => {
    const cta = ruleAfter('.sug__cta {');
    expect(px(decl(cta, 'min-height')), '「继续」按钮又矮回 30px，触控打不中').toBeGreaterThanOrEqual(36);
  });

  it('.sug__cta 用 inline-flex 居中，min-height 才真正撑起可点高度', () => {
    const cta = ruleAfter('.sug__cta {');
    expect(decl(cta, 'display')).toBe('inline-flex');
    expect(decl(cta, 'align-items')).toBe('center');
  });
});
