/**
 * 「目标规划」会话态输入盒的护栏（2026-10-08，390×844 实测 + 独立视觉审查）
 *
 * 病根一：回形针带着一个 margin-top 偏移，注释写着「按钮 32 高」——那是旧尺寸的算法，
 * 按钮早已 44。而 .composer__box 是 align-items:flex-end 的 flex 容器，盒高由最高子项决定，
 * 于是这 4.5px 既把输入盒从 57 撑到 61.3（单行文字 16px，61 的盒子大半是死白），
 * 又把回形针中心压到 705.3、比首行文字中线 703.3 低 2px（发送键同因贴底而偏 2px）。
 * 按钮与内容区等高时 flex-start 的中心本就落在首行中线上，偏移纯属多余。
 *
 * 病根二：会话态底条与入口态 hero 输入共用同一档控件尺寸（44px），单行盒子被撑到 61px。
 * 会话态是常驻底条，控件收到 36 后盒高 ≈49，盒子贴着文字；红色停止键也不再是整条最重的一块。
 * 入口态保持 44 不动：它既是首屏 hero 输入，也是 mobile:spec 的量测态（375 视口跑
 * /goal-conversation 入口态，lt44 预算只有 2），动它会改门禁口径。
 *
 * 本护栏锁四件事：
 *  1) 基础规则与移动块里都不再有 .composer__attach 的 margin-top 偏移；
 *  2) 会话态盒 min-height 收到 48、回形针与发送键同档 36；
 *  3) 入口态的 .composer__send 仍是 44（不许把门禁量测态一起收小）；
 *  4) 会话态 textarea 上下内边距与 36 控件档配套（6px → 内容 36，三者中线重合）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2GoalConversation.vue'), 'utf8');

function mobileBlock(): string {
  const marker = '@media (max-width: 1100px) {';
  const start = source.indexOf(marker);
  expect(start, `文件里没有 ${marker}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${marker} 不闭合`);
}

/** 注释里也会出现「margin-top:」这类字样，先剥掉再解析，否则会把注释文本读成声明 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleOf(cssRaw: string, selector: string): string {
  const css = stripComments(cssRaw);
  const start = css.indexOf(`${selector} {`);
  expect(start, `样式里没有 ${selector} 规则`).toBeGreaterThan(-1);
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

describe('会话态移动输入盒：控件贴中线、盒子贴文字', () => {
  const mobile = mobileBlock();

  it('回形针不再用过期的 margin-top 偏移（按钮 44 与内容区等高，flex-start 即中线对齐）', () => {
    expect(decl(ruleOf(source, '.composer__attach'), 'margin-top')).toBeNull();
    expect(
      stripComments(mobile),
      '移动块里仍给 .composer__attach 写了 margin-top：它会把回形针压低 2px 并撑高输入盒'
    ).not.toMatch(/\.composer__attach\s*\{[^}]*margin-top\s*:/);
  });

  it('会话态收紧到 36 档，入口态仍保留 44 触控尺寸（后者是 mobile:spec 的量测态）', () => {
    expect(decl(ruleOf(mobile, '.chat > .composer .composer__box'), 'min-height')).toBe('48px');
    for (const selector of ['.chat > .composer .composer__attach', '.chat > .composer .composer__send']) {
      const rule = ruleOf(mobile, selector);
      expect(decl(rule, 'width'), `${selector} 宽度没收紧`).toBe('36px');
      expect(decl(rule, 'height'), `${selector} 高度没收紧`).toBe('36px');
    }
    const entrySend = ruleOf(mobile, '.composer__send');
    expect(decl(entrySend, 'width'), '入口态发送键被一起收小了，会改 mobile:spec 的 lt44 口径').toBe('44px');
    expect(decl(entrySend, 'height')).toBe('44px');
  });

  it('会话态 textarea 上下内边距与 36 控件档配套（内容 36 → 三者中线重合）', () => {
    expect(decl(ruleOf(mobile, '.chat > .composer .composer__textarea'), 'padding')).toBe('6px 0');
  });
});
