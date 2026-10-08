/**
 * 课堂页移动端 AI 消息页脚护栏（操作条与「问流导师 · 时间」必须同行且互不挤压）
 *
 * 触屏档 `.msg-actions` 常显。原先四枚按钮里两枚带文字（重新生成 / 复制），合计 224px，
 * 与 nowrap 的「问流导师 · 12:22」一起塞不进 390 档 280px / 375 档 266px 的页脚行：
 * 时间被压到 51px 并与按钮组叠在一起。
 *
 * 收口办法是把四枚按钮统一成纯图标（文字去掉，语义交由 title + aria-label），
 * 触点仍保留 40×40：合计 160px，一行放得下 —— 而不是把页脚拆成两行。
 * 所以这里锁两件事：
 *   1. 页面不得再给页脚加「各占一行」的覆盖（那会退回两行、并让页脚变高）；
 *   2. 桌面「meta 左 / 操作条右」同行布局不变。
 * 按钮「纯图标 + 触控尺寸」的断言在组件侧（components/chat/__tests__/message-actions.test.ts）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningPage.vue'), 'utf8');
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
/** 折叠空白后的整文件文本（文件是 CRLF，跨行声明要折行后才能当整串匹配） */
const flat = css.replace(/\s+/g, ' ');

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

describe('课堂页移动端 AI 消息页脚', () => {
  it('页脚保持一行：页面不再把操作条与元信息拆成各占一行', () => {
    expect(flat, '页脚又被拆成两行了').not.toContain(
      '.msg__content--actions > .msg-actions, .msg__content--actions > .msg__meta { grid-column: 1 / -1; }',
    );
    // 页脚相关的窄屏覆盖（若有）不得改这两列的占位
    const mobileBlocks = [...css.matchAll(/@media \(max-width: 900px\) \{/g)];
    for (const m of mobileBlocks) {
      const block = blockAt(m.index!).replace(/\s+/g, ' ');
      if (!block.includes('.msg__content--actions')) continue;
      expect(block, '窄屏块改了页脚列占位').not.toContain('grid-column: 1 / -1');
    }
  });

  it('桌面保持 meta 左、操作条右的同行布局', () => {
    const content = ruleHaving('.msg__content--actions {', 'grid-template-columns');
    expect(content.replace(/\s+/g, ' ')).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(ruleHaving('.msg__content--actions > .msg-actions', 'grid-column')).toContain('grid-column: 2');
    expect(ruleHaving('.msg__content--actions > .msg__meta', 'grid-column')).toContain('grid-column: 1');
  });
});
