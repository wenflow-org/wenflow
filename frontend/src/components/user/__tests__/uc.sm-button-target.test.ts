/**
 * uc.css 小按钮触控热区护栏（2026-10-08 用户侧走查，发现 #49）
 *
 * 病根：调用日志页（/user/agent-logs）页头动作「导出 JSON / 导出 CSV / 复制排查信息」
 *   与筛选区「查询 / 重置」都是 `class="uc-btn uc-btn--sm"`，桌面档实测——
 *   导出 JSON 88×32、导出 CSV 79×32、复制排查信息 99×32、查询 49×31、重置 50×32
 *   （walkb-newbie-d.json 调用日志-电脑_浅色，深色同值），低于仓库「可点元素不得低于
 *   36px」的硬线（measure-unit2 的 tinyTargets 判据）。
 *   同一批里的「上一页 / 下一页」也复用这个类。
 *
 * 根因：36px 下限原来只写在 @media (max-width:1100px) 的窄屏块里（旧 uc.css:565-571），
 *   桌面档拿不到。修法（评审建议）：把 min-height:36px 提到 .uc-btn--sm 基础样式，
 *   窄屏媒体查询只保留纵向内边距覆盖。
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

describe('uc.css 小按钮触控热区', () => {
  it('基座 .uc-btn--sm 高度有 36px 下限（桌面档也生效，不再只写在窄屏媒体查询里）', () => {
    // 取 CSS 里第一个 `.uc-btn--sm` 声明块——即基座规则（媒体查询里的覆盖在文件更后面）
    const rule = ruleAfter(source, '.uc-btn--sm {');
    expect(px(rule, 'min-height'), '基座 .uc-btn--sm 没有 36px 高度下限').toBeGreaterThanOrEqual(36);
  });
});
