/**
 * 「最近会话」行内不被撑破的护栏（2026-10-07 实测 390 视口，工作流用户侧走查发现）
 *
 * 病根：.recent__list 是 display:grid，轨道是隐式 auto。auto 轨的**最小尺寸是内容最小宽**，
 * 而 .recent__preview 是 white-space:nowrap —— 一句标题的 min-content 有 525px，轨道就被
 * 撑到 525px，比 358px 的容器宽 167px。行尾的「昨天/10月5日」与「›」被推到 x≈529（视口只有
 * 390，完全在屏外、点不到），标题也在行右缘被切掉半字。
 * 行内那套 `flex:1 + min-width:0 + ellipsis` 因此全程没生效：它只作用于行内，管不住轨宽。
 *
 * 关键反直觉点：**裸 1fr 也不安全**。按 CSS 规范，`1fr` 作为轨道时其 min sizing function
 * 仍是 auto（= 内容最小宽），所以 `grid-template-columns: 1fr` 会复现同一个 bug。
 * 只有 `minmax(0, …)` 这类**把最小宽度钉成 0**的轨道才管得住 nowrap 子元素。
 * 本护栏因此不比对字符串，而是逐轨校验 min sizing function 是否为 0。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2GoalConversation.vue'), 'utf8');

/** 取 SFC 的 <style> 文本（本项目单文件单 style 块，无 scoped 变体分片） */
function styleText(): string {
  const { descriptor, errors } = parse(source);
  expect(errors).toEqual([]);
  const styles = descriptor.styles.map((s) => s.content).join('\n');
  expect(styles.trim(), '没读到 <style> 内容').not.toBe('');
  return styles;
}

/** 从字面 `.cls {` 起花括号配平，取出一条声明块（选中嵌套 @media 内层同名规则时返回最外层那条） */
function ruleOf(css: string, selector: string): string {
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

/** 拆 `grid-template-columns` 的值：顶层空格分隔的轨道（括号内的空格不算，否则 minmax(0, 1fr) 会被劈成两半） */
function tracksOf(value: string): string[] {
  const tracks: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) tracks.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) tracks.push(cur);
  return tracks;
}

/** 轨道的最小尺寸是否为 0（唯一能挡住 nowrap 子元素撑宽轨道的形式） */
function minIsZero(track: string): boolean {
  const mm = /^minmax\(\s*([^,]+?)\s*,/.exec(track);
  const min = mm ? mm[1] : null;
  if (min === null) return false; // 裸 1fr / auto / min-content / max-content / 固定 px 一律不放行
  return /^0(px|lv|sv|dvw|%)?$/.test(min) || min === '0';
}

describe('最近会话：grid 轨道必须钉住最小宽度', () => {
  const css = styleText();

  it('.recent__list 是 grid（改回 flex/block 要先重看这条护栏）', () => {
    expect(ruleOf(css, '.recent__list')).toMatch(/display:\s*grid/);
  });

  it('每条轨道的最小宽度都是 0（裸 1fr 不合格）', () => {
    const rule = ruleOf(css, '.recent__list');
    const m = /grid-template-columns:\s*([^;]+);/.exec(rule);
    expect(m, '.recent__list 没写 grid-template-columns，隐式 auto 轨会被 nowrap 标题撑爆').toBeTruthy();
    const tracks = tracksOf(m![1]);
    expect(tracks.length).toBeGreaterThan(0);
    for (const t of tracks) {
      expect(minIsZero(t), `轨道「${t}」的最小宽度不是 0：nowrap 标题的 min-content 会把它撑出容器`).toBe(true);
    }
  });

  it('护栏不腐化：标题仍是 nowrap+ellipsis（否则这条测试会因去掉 nowrap 而空转）', () => {
    const rule = ruleOf(css, '.recent__preview');
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).toMatch(/min-width:\s*0/);
  });

  it('护栏不腐化：行尾的时间与「›」不被压缩（flex: none），否则又会被挤出视口', () => {
    expect(ruleOf(css, '.recent__time')).toMatch(/flex:\s*none/);
    expect(ruleOf(css, '.recent__go')).toMatch(/flex:\s*none/);
  });
});
