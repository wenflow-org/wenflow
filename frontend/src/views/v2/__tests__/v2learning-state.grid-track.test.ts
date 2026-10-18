/**
 * #118 / #122 回归：390 宽下 `/learning-state` 整页横向溢出。
 * 根因是单列 grid 只写 `display: grid`——隐式 auto 轨按子项 min-content 解算
 * （#118：`.state__col` 实测 387.9px；#122：`.card.advisory` 链路上的路径名药丸
 * 撑到 376.9px），把 354px 的容器撑破。修法是显式 `minmax(0, 1fr)` + 药丸可省略，
 * 这里钉住它们别再被删掉。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../V2LearningState.vue'), 'utf8');

/** 取某个选择器的 CSS 规则（按行扫描；本文件的规则都是单层、无嵌套）。
 *  精确匹配：选择器后必须紧跟 `{` 或 `,`——否则 `.ctl` 会先撞上 `.ctl-card {`。 */
function ruleBody(selector: string): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const t = line.trimStart();
    if (!t.startsWith(selector)) return false;
    const rest = t.slice(selector.length).trimStart();
    return rest.startsWith('{') || rest.startsWith(',') || rest.startsWith(':');
  });
  expect(start, `${selector} 的 CSS 规则不存在`).toBeGreaterThan(-1);
  let text = '';
  for (let i = start; i < lines.length; i += 1) {
    text += lines[i] + '\n';
    if (lines[i].includes('}')) break;
  }
  return text;
}

describe('#118 学习状态页窄屏栅格', () => {
  it('.state__col 用显式 minmax(0,1fr) 轨道，子项可收缩', () => {
    expect(ruleBody('.state__col')).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('.state__main 同样显式单列（防止同类隐式轨道溢出）', () => {
    expect(ruleBody('.state__main')).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('不再存在「只有 display: grid; gap」的单列容器（.state__col / .state__main）', () => {
    for (const sel of ['.state__col', '.state__main']) {
      expect(ruleBody(sel), `${sel} 又退回隐式轨道`).not.toMatch(/display:\s*grid;\s*gap:/);
    }
  });
});

describe('#122 建议/调控卡链路窄屏栅格', () => {
  // 390 实测：从叶子药丸到外层卡的整条 min-content 链
  // .dec__tag(249) → .ctl-card__head(345) → .ctl-card/.ctl/.advisory__sub/.advisory(377) → 页宽 411
  const chain = ['.advisory', '.advisory__body', '.advisory__sub', '.guide', '.ctl', '.ctl-card', '.suggest__list'];

  it('链路各层单列容器都带显式 minmax(0,1fr) 轨道', () => {
    for (const sel of chain) {
      expect(ruleBody(sel), `${sel} 缺显式轨道`).toContain('grid-template-columns: minmax(0, 1fr)');
    }
  });

  it('链路上不再出现「只有 display: grid; gap」的形态', () => {
    for (const sel of chain) {
      expect(ruleBody(sel), `${sel} 又退回隐式轨道`).not.toMatch(/display:\s*grid;\s*gap:/);
    }
  });

  it('卡头路径名药丸可收缩省略（nowrap 长标题是 min-content 源头）', () => {
    const rule = ruleBody('.ctl-card__head .dec__tag');
    expect(rule).toContain('min-width: 0');
    expect(rule).toContain('overflow: hidden');
    expect(rule).toContain('text-overflow: ellipsis');
  });
});
