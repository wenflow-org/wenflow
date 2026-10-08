/**
 * uc.css 文字按钮触控热区护栏（2026-10-08 用户侧走查，发现 #48）
 *
 * 病根：账户页（/user/account，Profile.vue）资料卡用户名右侧的「编辑」是
 *   `class="uc-btn uc-btn--link"`，桌面档实测 41×27px（walkb-newbie-d.json
 *   个人中心-电脑_浅色/深色两档同值），是全页最小的可点元素，低于仓库
 *   「可点元素不得低于 36px」的硬线（measure-unit2 的 tinyTargets 判据）。
 *   同条文案「详情 / 复制」也复用这个类（AgentLogs.vue）。
 *
 * 修法：给 uc.css 基座 .uc-btn--link 补 min-height:36px（.uc-btn 已是
 *   inline-flex + align-items:center，文字仍居中，横向内边距与配色不变）。
 * 这里锁住「基座规则有 36px 高度下限」这一件事。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../uc.css'), 'utf8');

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleAfter(src: string, selector: string): string {
  const css = stripComments(src);
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

function decl(rule: string, prop: string): string | null {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(rule);
  return m ? m[1].trim() : null;
}

function px(rule: string, prop: string): number {
  return Number((decl(rule, prop) ?? '0px').replace('px', ''));
}

describe('uc.css 文字按钮触控热区', () => {
  it('基座 .uc-btn--link 高度有 36px 下限（账户页「编辑」不再低于触控下沿）', () => {
    const rule = ruleAfter(source, '.uc-btn--link {');
    expect(px(rule, 'min-height'), '基座 .uc-btn--link 没有 36px 高度下限').toBeGreaterThanOrEqual(36);
  });
});
