/**
 * 「目标规划」底部三段布局与冗余元素退役的护栏（2026-11-06 走查·四项定稿）
 *
 * 病根：待确认条/输入区/元数据行原本是 .chat 的并列 flex 子项，三者之间靠
 * `::before { background: linear-gradient(180deg, transparent, var(--canvas)) }`
 * 假装分隔。这个渐变在暗色下读成一条黑带、浅色下读成灰蓝脏带，还盖掉了贴底气泡
 * 下缘的描边——用户三张截图点名「学习方案 · 待确认 上下的黑边」。
 *
 * 修复口径：布局本身保证不重叠，不再用遮罩粉饰。
 *  1) 贴底坞 .chat__dock 是唯一的三段容器：pill / 待确认条 / 输入区 / 元数据行全在里面，
 *     滚动区在坞上方自然结束；坞透明、无边框、无渐变伪元素。
 *  2) 消息反馈栏（👍👎🔄📋）整体退役——澄清期每轮都是问句，复制/重新生成没有对象，
 *     手机上每轮白吃 ~36px。
 *  3) 路径预览弹窗（Modal）里的 ⓘ「内容由 AI 生成」整行删除，全断面唯一出口是
 *     输入框正下方的 .chat__under-hint。
 *  4) PC 也不再给 AI 消息挂头像（含「正在梳理关键信息」的等待态）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2GoalConversation.vue'), 'utf8');
const { descriptor, errors } = parse(source);
const root = descriptor.template?.ast as unknown as TplNode | undefined;

type TplNode = { type: number; tag?: string; props?: { name?: string; value?: { content?: string } }[]; children?: TplNode[] };
const classOf = (n: TplNode): string =>
  ((n.props || []).find((p) => p.name === 'class')?.value?.content || '').trim();
const hasClass = (n: TplNode, cls: string): boolean => classOf(n).split(/\s+/).includes(cls);

function nodes(root: TplNode, pred: (n: TplNode) => boolean): TplNode[] {
  const found: TplNode[] = [];
  const walk = (n: TplNode) => {
    if (n.type === 1 && pred(n)) found.push(n);
    (n.children || []).forEach(walk);
  };
  walk(root);
  return found;
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleOf(selector: string): string {
  const css = stripComments(source);
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

describe('底部三段：贴底坞取代渐变遮罩', () => {
  it('模板里恰好一个 .chat__dock，且四类贴底元素全在里面', () => {
    expect(errors).toEqual([]);
    expect(root, '模板 AST 解析失败').toBeTruthy();
    const docks = nodes(root as TplNode, (n) => hasClass(n, 'chat__dock'));
    expect(docks.length, '.chat__dock 应恰好一处（多了就是两套底流）').toBe(1);

    const inside = new Set<string>();
    for (const child of docks[0].children || []) {
      if (child.type !== 1) continue;
      for (const cls of ['gen-pill', 'proposal-invite', 'composer', 'chat__under-hint', 'composer--entry']) {
        if (hasClass(child, cls)) inside.add(cls);
      }
    }
    for (const cls of ['proposal-invite', 'composer', 'chat__under-hint']) {
      expect(inside.has(cls), `${cls} 没进 .chat__dock：并列 flex 子项会重新引入遮挡`).toBe(true);
    }
    /* 入口态的 composer 在 .entry 里，不许被一起收进会话态的坞 */
    expect(inside.has('composer--entry'), '入口态输入区不该进会话态坞').toBe(false);
  });

  it('滚动区不再为悬浮条补底衬（--pill / --invite 两个 class 判例退役）', () => {
    expect(source).not.toContain('chat__scroll--pill');
    expect(source).not.toContain('chat__scroll--invite');
    expect(source, '滚动区只应剩 blur/哑火一个修饰类').toContain("'chat__scroll--dim': showProposal");
  });

  it('坞与输入区都不再有渐变伪元素或分割线', () => {
    const css = stripComments(source);
    expect(css, '输入区上方的渐变遮罩（深色黑带根源）不许复辟').not.toMatch(/\.composer::before/);
    expect(css, '待确认条上方的渐变遮罩（本次核心 Bug）不许复辟').not.toMatch(/\.proposal-invite::before/);
    const dock = ruleOf('.chat__dock');
    expect(decl(dock, 'display')).toBe('flex');
    expect(decl(dock, 'background')).toBe('transparent');
    expect(decl(dock, 'border'), '坞不能自带分割线（层次靠留白）').toBeNull();
    expect(decl(dock, 'box-shadow')).toBeNull();
    expect(decl(dock, 'flex')).toBe('0 0 auto');
  });

  it('坞里的待确认条只有外框，没有上下分割线', () => {
    const invite = ruleOf('.proposal-invite');
    expect(decl(invite, 'border-top'), '待确认条上方不许再画分割线').toBeNull();
    expect(decl(invite, 'border-bottom'), '待确认条下方不许再画分割线').toBeNull();
  });
});

describe('消息反馈栏退役（目标规划页不挂 👍👎🔄📋）', () => {
  it('模板里没有 MessageActions / 操作条容器', () => {
    expect(source).not.toContain('<MessageActions');
    expect(source).not.toContain('MessageActions.vue');
    expect(source).not.toContain('msg__content--actions');
    expect(source).not.toContain('msg__bubble--relative');
  });

  it('随之无引用的处理器与依赖不残留（否则 vue-tsc 会报未使用）', () => {
    for (const dead of ['hoveredMsgId', 'onBubbleEnter', 'onBubbleLeave', 'copyMessage', 'sendMessageFeedback', 'regenerateMessage']) {
      expect(source, `${dead} 已无派发方`).not.toContain(dead);
    }
    expect(source).not.toContain("from '@/utils/clipboard'");
    expect(source).not.toContain("from '@/api/feedback'");
  });

  it('失败恢复仍留在气泡内联「重试」上', () => {
    expect(source).toContain('class="msg__retry"');
  });
});

describe('AI 声明只有一个出口（输入框正下方）', () => {
  it('路径预览弹窗的 .proposal__note 里没有 ⓘ 声明', () => {
    const notes = nodes(root as TplNode, (n) => hasClass(n, 'proposal__note'));
    expect(notes.length, '弹窗说明块应仍存在（资料提示/生成提示）').toBeGreaterThan(0);
    for (const note of notes) {
      const hasNote = nodes(note, (n) => n.tag === 'AiContentNote').length > 0;
      expect(hasNote, '弹窗里不许再挂 AI 声明（与确认按钮抢焦点）').toBe(false);
    }
  });

  it('全模板只剩两处 AiContentNote：会话态 under-hint + 入口态页脚', () => {
    const all = nodes(root as TplNode, (n) => n.tag === 'AiContentNote');
    expect(all.length, '声明出口应恰好两处（会话态 1 + 入口态 1）').toBe(2);
    expect(source).toContain('class="chat__under-hint"');
    expect(source).toContain('class="goal__ai-note"');
  });
});

describe('PC 不再给 AI 消息挂头像（含等待态）', () => {
  it('模板里没有头像元素或头像样式', () => {
    expect(source).not.toContain('msg__avatar');
    /* 全页唯一的 <img> 是未登录门的品牌标（登录后才能进来的会话流里不逐条自报家门） */
    const imgs = nodes(root as TplNode, (n) => n.tag === 'img');
    expect(imgs.length, '会话流里不该再有头像 <img>').toBe(1);
    expect(classOf(imgs[0]), '唯一保留的 <img> 必须是未登录门品牌标').toBe('login-gate__logo');
  });
});
