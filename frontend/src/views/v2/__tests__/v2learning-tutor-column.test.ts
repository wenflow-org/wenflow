/**
 * 课堂「一列内容」护栏（2026-09-28 用户：「learn 课堂环节，检查点面板超宽，是整个聊天区宽度」）
 *
 * 病根：≥1101 的阅读列（760px 居中）只写在 .tutor__scroll > * 与 .composer__box 上，
 * 而行动台/开场卡/续课条/检查点是 .tutor 的直接孩子、不在滚动区里，拿不到那条上限。
 * 实测（Chromium 实测真机编译 CSS，1920 视口 tutor 1260px）：检查点铺满 1226px，
 * 消息列 760px —— 同一个聊天卡里两套宽度。
 *
 * 护栏锁两件事，缺一不可：
 *  1) 这些卡片确实是 .tutor 的直接孩子（.tutor > .xxx 选择器的前提，被包一层就失效）；
 *  2) 每个直接孩子都在 ≥1101 同列规则里被覆盖，或落在显式豁免名单（豁免要有理由）。
 * 新增任何一张贴着 .tutor 的卡片都会被这条护栏拦下，逼作者决定它进不进这一列。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningPage.vue'), 'utf8');

type TplProp = { type: number; name?: string; value?: { content?: string } };
type TplNode = { type: number; tag?: string; props?: TplProp[]; children?: TplNode[] };

const classOf = (n: TplNode): string =>
  ((n.props || []).find((p) => p.name === 'class')?.value?.content || '').trim();
const primaryClass = (n: TplNode): string => classOf(n).split(/\s+/)[0] || '';

/** <Transition> 不产生 DOM 元素（检查点/完成浮层都包在里面），拆开才是真正挂进 .tutor 的孩子 */
const WRAPPERS = new Set(['Transition', 'TransitionGroup', 'KeepAlive']);
const flatten = (n: TplNode): TplNode[] =>
  n.type === 1 && n.tag && WRAPPERS.has(n.tag) ? (n.children || []).flatMap(flatten) : [n];

function tutorChildren(): TplNode[] {
  const { descriptor, errors } = parse(source);
  expect(errors).toEqual([]);
  const root = descriptor.template?.ast as unknown as TplNode | undefined;
  expect(root, '模板 AST 解析失败').toBeTruthy();

  const sections: TplNode[] = [];
  const walk = (n: TplNode) => {
    if (n.type === 1 && n.tag === 'section' && classOf(n).split(/\s+/).includes('tutor')) sections.push(n);
    (n.children || []).forEach(walk);
  };
  walk(root as TplNode);
  expect(sections, '没找到 <section class="tutor">').toHaveLength(1);
  return (sections[0].children || []).filter((c) => c.type === 1).flatMap(flatten);
}

function mediaBlock(minWidth: number): string {
  const marker = `@media (min-width: ${minWidth}px) {`;
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

/** 刻意不进 760 列的 .tutor 直接孩子——每条都要能说出为什么 */
const EXEMPT: Record<string, string> = {
  tutor__scroll: '消息在它内部，由 .tutor__scroll > * 各自收窄',
  'tutor__jump-bottom': 'absolute 浮标，自身 translateX(-50%) 居中',
  composer: '通栏输入条，内层 .composer__box 已完成 760 居中',
  finish: '整卡完成浮层，刻意铺满',
};

/** 选择器边界匹配：`.tutor > .checkpoint-xxx` 不算覆盖到 `.checkpoint`（子串匹配会放过它） */
const cappedInBlock = (block: string, cls: string): boolean =>
  new RegExp(`\\.tutor > \\.${cls}(?![\\w-])`).test(block);

describe('课堂一列内容：.tutor 直接孩子的宽度契约', () => {
  const children = tutorChildren();
  const block = mediaBlock(1101);

  it('关键 deck 都在 .tutor 直接孩子里（模板改了要先重看这条护栏）', () => {
    const seen = children.map(primaryClass);
    expect(seen).toEqual(expect.arrayContaining(['oscene', 'replies', 'kp-actions', 'checkpoint']));
  });

  it('每个直接孩子都进了 ≥1101 的同列规则，或显式豁免', () => {
    for (const node of children) {
      const cls = primaryClass(node);
      if (!cls || EXEMPT[cls]) continue;
      expect(
        cappedInBlock(block, cls),
        `.tutor > .${cls} 没被 ≥1101 同列规则覆盖（会铺满整个聊天卡宽）`
      ).toBe(true);
    }
  });

  it('豁免名单不腐化：每条豁免仍对应一个真实的直接孩子', () => {
    const seen = children.map(primaryClass);
    for (const cls of Object.keys(EXEMPT)) {
      expect(seen, `${cls} 已不是 .tutor 的孩子，删掉这条豁免`).toContain(cls);
    }
  });

  it('消息 / 输入盒 / 卡片同处一条 760 列', () => {
    expect(block).toContain('.tutor__scroll > * { max-width: 760px');
    expect(block).toContain('.composer__box { max-width: 760px');
    expect(cappedInBlock(block, 'checkpoint')).toBe(true);
  });
});
