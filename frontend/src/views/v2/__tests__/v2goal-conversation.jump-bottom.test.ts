/**
 * 目标规划页：长对话「回到底部」入口（2026-11-11 长会话走查）。
 *
 * 此前 onScrollPin 只维护一个非响应式的 pinToBottom：用户上翻阅读后，新消息到达不会跟随，
 * 页面也没有任何回到最新的入口，只能一路手动滑到底。修法是把贴底状态做成响应式，
 * 离开底部时浮出一颗按钮；点击恢复贴底。这里锁住模板入口与关键样式，
 * 防止后续「屏效比」清理误删。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2GoalConversation.vue'), 'utf8');
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleOf(selector: string): string {
  const start = css.indexOf(`${selector} {`);
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

describe('目标规划：回到底部', () => {
  it('只在离开底部时渲染，带可读文案与 aria-label', () => {
    expect(source).toContain('v-if="!atBottom"');
    expect(source).toContain('class="chat__jump"');
    expect(source).toContain('aria-label="回到底部"');
    expect(source).toContain('@click="jumpToLatest"');
    expect(source).toContain('atBottom.value = pinToBottom');
  });

  it('浮标钉在输入坞上方、不参与滚动区高度', () => {
    const rule = ruleOf('.chat__jump');
    expect(decl(rule, 'position')).toBe('absolute');
    expect(decl(rule, 'bottom'), '浮标没有抬高，会压住输入框').not.toBeNull();
    expect(decl(rule, 'z-index')).not.toBeNull();
  });

  it('移动档抬到触控高度并随更矮的输入坞上移', () => {
    expect(css).toContain('.chat__jump { bottom: 84px; min-height: 44px; }');
  });
});
