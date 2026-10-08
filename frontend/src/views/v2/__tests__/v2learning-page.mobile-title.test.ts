/**
 * 课堂页窄屏页头标题护栏（2026-10-08 用户侧走查）
 *
 * 病根：窄屏把任务名压成单行 + 省略号，390 实测 24 字任务名需要 390px、只分到 178px，
 * 页头只能读到「解剖自己做过的那个功…」，而页头没有别的完整标题入口。
 * 用户口径是「宁可多占一行，也不要把文案压到读不全」，故窄屏放宽到两行（桌面不受影响）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningPage.vue'), 'utf8');
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

function blockAt(start: number): string {
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error('声明块不配平');
}

/** 取「声明块里含该属性」的那一条规则（同名选择器可能有多条） */
function ruleHaving(selector: string, prop: string): string {
  const re = new RegExp(`(?:^|[;{\\s])${prop}\\s*:`);
  for (let from = 0; from >= 0; ) {
    const start = css.indexOf(selector, from);
    if (start < 0) break;
    const block = blockAt(start);
    if (re.test(block)) return block;
    from = start + 1;
  }
  throw new Error(`没有找到带 ${prop} 的 ${selector}`);
}

const decl = (rule: string, prop: string): string | null =>
  new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule)?.[1]?.trim() ?? null;

describe('课堂页窄屏页头标题', () => {
  it('窄屏允许两行：标题不再被单行省略号压成半句话', () => {
    const strong = ruleHaving('.learn__title strong', '-webkit-line-clamp');
    expect(decl(strong, '-webkit-line-clamp')).toBe('2');
    expect(decl(strong, 'white-space'), '没解除单行，两行 clamp 不生效').toBe('normal');
    expect(decl(strong, 'overflow')).toBe('hidden');
  });

  it('两行 clamp 只落在 ≤900 媒体块里，桌面仍单行省略', () => {
    // 全文件有多个 ≤900 块，取含标题规则的那一个（末尾那个是 composer 的）
    const blocks = [...css.matchAll(/@media \(max-width: 900px\) \{/g)].map((m) => blockAt(m.index!));
    const hit = blocks.filter((b) => b.includes('.learn__title strong'));
    expect(hit, '两行 clamp 不在任何 ≤900 媒体块里（会误伤桌面）').toHaveLength(1);
    expect(hit[0].replace(/\s+/g, ' ')).toContain('-webkit-line-clamp: 2');
    // 基础档（桌面）保持单行 + 省略号
    const base = css.slice(0, css.indexOf('@media (max-width: 900px)'));
    const start = base.indexOf('.learn__title strong');
    expect(start, '基础档找不到标题规则').toBeGreaterThan(-1);
    const baseRule = blockAt(start);
    expect(decl(baseRule, 'white-space')).toBe('nowrap');
    expect(decl(baseRule, 'text-overflow')).toBe('ellipsis');
  });
});
