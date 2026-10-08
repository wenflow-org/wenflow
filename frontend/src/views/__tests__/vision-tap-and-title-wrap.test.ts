/**
 * 愿景页走查回归（2026-10-08 用户侧走查 #25 / #26）
 *
 * #25 触控热区：.vn-status__links a（GitHub / Demo）与 .vn-end__back（← 返回首页）
 *   的纵向内边距原来只写在 @media (max-width: 900px) 里。1440 档实测
 *   GitHub 51×21、Demo 42×21、返回首页 69×20，而同页页脚链接是 36 高 —— 同页两套标准。
 *   现在基础档就给足（与 .vn-foot a 同标准），窄屏不再重复声明。
 *
 * #26 孤字行：390 档 h1 被模板里的显式 <br/> 逼成
 *   「答案越来越多时，」/「更值得练的是提问与判」/「断。」三行，末行只剩两个字；
 *   同屏尾屏副文案也折出末行「事。」。修法是窄屏（≤640）放掉这条原型断行 + balance 均分，字号档位不动。
 *
 * 写法沿用仓库既有「源码锁」：读 SFC 源码 → 花括号配平取规则 → 断言声明/选择器，
 * 其中 max-width 覆写必须落在本文件最后一个 <style> 块（写在中间会被后面的桌面规则盖成死代码）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../VisionNext.vue'), 'utf8');
const css = source.replace(/\/\*[\s\S]*?\*\//g, '');

/** 取 selector 那条规则的声明体（用 (?![\\w-]) 防止 .vn-hero h1 命中 .vn-hero h1 br） */
function bodyOf(text: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[\\n{};])\\s*${esc}(?![\\w-])\\s*\\{([^{}]*)\\}`).exec(text);
  expect(m, `样式里没有 ${selector} 声明块`).not.toBeNull();
  return m![1];
}

function decl(body: string, prop: string): string | null {
  const m = new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`).exec(body);
  return m ? m[1].trim() : null;
}

/** padding 简写的纵向值（`padding: 8px 0` → 8） */
function padY(body: string): number {
  const parts = (decl(body, 'padding') ?? '').split(/\s+/);
  if (!parts[0]) return parseFloat(decl(body, 'padding-top') ?? '0');
  return parseFloat(parts[0]);
}

/** 从 at 处（一个 @media 开头）花括号配平取整块 */
function blockAt(text: string, at: number): string {
  let depth = 0;
  for (let i = text.indexOf('{', at); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(at, i + 1);
    }
  }
  throw new Error('声明块不配平');
}

function ruleIndex(text: string, selector: string): number {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[\\n{};])\\s*${esc}(?![\\w-])\\s*\\{`).exec(text);
  expect(m, `样式里没有 ${selector}`).not.toBeNull();
  return m!.index + m![0].indexOf(selector);
}

/** 规则是否写在 @media 里 */
function insideMediaQuery(text: string, index: number): boolean {
  const stack: boolean[] = [];
  let buf = '';
  for (let i = 0; i < index; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      stack.push(buf.trim().startsWith('@media'));
      buf = '';
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else if (!(ch === ';' && stack.length === 0)) {
      buf += ch;
    }
  }
  return stack.some(Boolean);
}

/** 本文件最后一个 <style> 块的内容（窄屏覆写必须写在这里） */
function lastStyleBlock(text: string): string {
  const start = text.lastIndexOf('<style');
  return text.slice(start, text.indexOf('</style>', start));
}

describe('愿景页触控热区（#25）', () => {
  it('状态区链接在基础档就有 ≥36px 高的纵向内边距，不是只在窄屏生效', () => {
    const index = ruleIndex(css, '.vn-status__links a');
    expect(insideMediaQuery(css, index), '.vn-status__links a 的纵向内边距又只在媒体查询里生效').toBe(false);
    // 内容盒 21px（14px 字 / 1.5 行高）+ 上下各 8px = 37 ≥ 36
    expect(padY(bodyOf(css, '.vn-status__links a')), '状态区链接纵向内边距不足以抬到 36px').toBeGreaterThanOrEqual(8);
  });

  it('尾屏「← 返回首页」在基础档就有 ≥36px 高的纵向内边距', () => {
    const index = ruleIndex(css, '.vn-end__back');
    expect(insideMediaQuery(css, index), '.vn-end__back 的纵向内边距又只在媒体查询里生效').toBe(false);
    // 内容盒 20px（13px 字）+ 上下各 9px = 38 ≥ 36
    expect(padY(bodyOf(css, '.vn-end__back')), '返回首页纵向内边距不足以抬到 36px').toBeGreaterThanOrEqual(9);
  });

  it('窄屏块不再重复声明这两处内边距（同页一套标准）', () => {
    const narrow = blockAt(css, css.indexOf('@media (max-width: 900px)'));
    expect(narrow, '窄屏块又覆写了状态区链接内边距').not.toContain('.vn-status__links a');
    expect(narrow, '窄屏块又覆写了返回首页内边距').not.toContain('.vn-end__back');
  });
});

describe('愿景页窄屏孤字行（#26）', () => {
  it('窄屏放掉原型 <br/> 并用 balance 均分，覆写落在本文件最后一个 style 块', () => {
    const block = lastStyleBlock(source);
    const at = block.indexOf('@media (max-width: 640px)');
    expect(at, '最后一个 style 块里没有 ≤640 档覆写').toBeGreaterThan(-1);
    const narrow = blockAt(block, at);
    expect(decl(bodyOf(narrow, '.vn-hero h1'), 'text-wrap'), '缺 text-wrap: balance，窄屏仍会长出孤字行').toBe('balance');
    expect(decl(bodyOf(narrow, '.vn-hero h1 br'), 'display'), '显式换行没在窄屏放掉，末行仍只剩「断。」').toBe('none');
    // 尾屏副文案（末行曾是「事。」）与 h1 同一条规则
    expect(decl(bodyOf(narrow, '.vn-end p'), 'text-wrap'), '尾屏副文案缺 text-wrap: balance，末行仍只剩「事。」').toBe('balance');
  });
});
