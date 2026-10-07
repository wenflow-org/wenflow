/**
 * 「目标规划」输入区底部提示条的护栏（2026-10-07，移动端 390/320 实测 + 独立视觉审查）
 *
 * 病根一：移动端把「新目标」按钮塞进输入框下的元数据条（字数计数 + AI 声明）里。
 * 独立视觉审查的结论是三条：① 那一条被用户读作被动状态文本，动作按钮放进去等于藏起来；
 * ② 它的描边药丸样式与页面上方的「快捷补充」建议 chip 同形，但行为相反（一个填入输入框、
 * 一个离开当前会话），会诱导误点；③ 它正上方 30px 就是底部导航的「目标规划」tab，
 * 两者目的地是同一片区域、无从区分。
 * 而「开始另一个目标」本来就有出口：点底部「目标规划」进入无参路由，
 * route.params watcher 走 resetToEntry，并保留「继续上次的规划」恢复入口（390 实测可复现）。
 * 因此该按钮是冗余的，已删除，连同已无派发方的 v2:new-goal 监听链。
 *
 * 病根二：输入盒有 ≈295px 的硬下限，≤355 视口顶出列宽（320 实测右缘 321.3 > 视口 320）。原因是
 * 各级 flex/grid 项的 min-width:auto —— textarea 没写 cols（浏览器按 cols=20 给内在最小宽），
 * 而承载它的 .composer__box 是单列 grid 的 grid item，两者都要显式归零才真的能收缩。
 *
 * 本护栏锁四件事：
 *  1) 提示条里不许再出现按钮/链接（它是元数据行，不是动作行）；
 *  2) .composer__hint 的左右内缩与 .composer 的左右内边距一致（否则提示条比输入框多探出去）；
 *  3) textarea 与 .composer__box 都显式 min-width:0（两级都归零才生效，缺一不可）；
 *  4) 提示条内文本一律 ≥12px（mobile:spec 的 fonts 门禁）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2GoalConversation.vue'), 'utf8');

type TplNode = { type: number; tag?: string; props?: { name?: string; value?: { content?: string } }[]; children?: TplNode[] };
const classOf = (n: TplNode): string =>
  ((n.props || []).find((p) => p.name === 'class')?.value?.content || '').trim();

/** 取模板里 class 含指定类名的**全部**元素（同页有入口态与会话态两个 .composer__hint，
    只取第一个会让断言落在另一个节点上变成空转） */
function templateNodesWithClass(root: TplNode, cls: string): TplNode[] {
  const found: TplNode[] = [];
  const walk = (n: TplNode) => {
    if (n.type === 1 && classOf(n).split(/\s+/).includes(cls)) found.push(n);
    (n.children || []).forEach(walk);
  };
  walk(root);
  return found;
}

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

/** 注释里也会出现「min-width:auto」这类字样，先剥掉再解析声明，否则会把注释文本读成声明值 */
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

const px = (v: string | null): number | null => {
  if (v === null) return null;
  if (v === '0') return 0;
  const m = /^(-?[\d.]+)px$/.exec(v);
  return m ? Number(m[1]) : null;
};

/** 左右 padding（`a` / `a b` / `a b c` / `a b c d`） */
function horizontalPadding(rule: string): { l: number; r: number } | null {
  const v = decl(rule, 'padding');
  if (!v) return null;
  const n = v.split(/\s+/).map(px);
  if (n.some((x) => x === null)) return null;
  const a = n as number[];
  if (a.length === 1) return { l: a[0], r: a[0] };
  if (a.length === 2) return { l: a[1], r: a[1] };
  if (a.length === 3) return { l: a[1], r: a[1] };
  return { l: a[3], r: a[1] };
}

describe('输入区底部提示条：只放元数据，不放动作', () => {
  const { descriptor, errors } = parse(source);
  const root = descriptor.template?.ast as unknown as TplNode | undefined;

  it('两处提示条里都没有按钮或链接（动作不再混进元数据行）', () => {
    expect(errors).toEqual([]);
    expect(root, '模板 AST 解析失败').toBeTruthy();
    const hints = templateNodesWithClass(root as TplNode, 'composer__hint');
    expect(hints.length, '模板里 .composer__hint 应有两处（入口态 + 会话态）').toBe(2);
    const interactive: string[] = [];
    for (const hint of hints) {
      const walk = (n: TplNode) => {
        if (n.type === 1 && (n.tag === 'button' || n.tag === 'a' || n.tag === 'router-link')) {
          interactive.push(n.tag);
        }
        (n.children || []).forEach(walk);
      };
      (hint.children || []).forEach(walk);
    }
    expect(
      interactive,
      `.composer__hint 里出现了 ${interactive.join(', ')}：它是元数据行，动作按钮会被读作被动状态文本`
    ).toEqual([]);
  });

  it('「新目标」按钮与其死事件链已移除（出口由底部「目标规划」tab 承担）', () => {
    expect(templateNodesWithClass(root as TplNode, 'composer__new-goal')).toEqual([]);
    expect(source, 'v2:new-goal 已无派发方，不该再留监听').not.toContain("addEventListener('v2:new-goal'");
    expect(source).not.toContain('function onNewGoalEvent');
  });

  it('移动端提示条左右内缩 = .composer 左右内边距（默认 16），否则比输入框多探出去', () => {
    const block = mobileBlock();
    const hint = ruleOf(block, '.composer__hint');
    const composer = ruleOf(block, '.chat > .composer');
    const hintPad = horizontalPadding(hint);
    const composerPad = horizontalPadding(composer);
    expect(hintPad, '.composer__hint 没读到 padding').toBeTruthy();
    expect(composerPad, '.chat > .composer 没读到 padding').toBeTruthy();
    expect(decl(hint, 'left'), '未显式写 left，绝对定位会落到 composer 的 padding box 边缘（多探出 16px）').toBe(`${composerPad!.l}px`);
    expect(decl(hint, 'right')).toBe(`${composerPad!.r}px`);
  });

  it('两级 min-width:0 都在（缺一级就压不回列宽）', () => {
    expect(decl(ruleOf(source, '.composer__textarea'), 'min-width'), 'textarea 没归零 → 保留 cols=20 的内在最小宽').toBe('0');
    expect(decl(ruleOf(source, '.composer__box'), 'min-width'), '.composer__box 是 grid item，min-width:auto 会把整列撑到 ≈295px').toBe('0');
  });

  it('提示条文本不低于 12px（mobile:spec 的 fonts 口径）', () => {
    for (const sel of ['.composer__hint', '.composer__count']) {
      const size = px(decl(ruleOf(source, sel), 'font-size'));
      expect(size, `${sel} 没读到 font-size`).not.toBeNull();
      expect(size!, `${sel} 字号 ${size} < 12，会破 fonts 门禁`).toBeGreaterThanOrEqual(12);
    }
  });
});
