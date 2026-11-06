/**
 * 课堂页三个浮层 + 回到底部浮标的护栏（2026-11-06 走查）
 *
 * 四组实测问题：
 *  ① 伴学浮窗「小启」：每条消息头顶挂一枚琥珀色学法胶囊 + 「小启 · 19:31」时间戳，
 *     底部常驻一行 AI 免责声明——浮窗本就矮，重复标签吃掉近 1/4 屏；
 *     追问快选与气泡同形（大圆角长条），分不清是消息还是按钮；
 *     发送键是外挂的咖啡色椭圆文字钮，与输入框各长各的；
 *  ② ⋯ 菜单 6 项 + 3 个分组标题 + 每项双行解释，手机上占掉大半个屏幕；
 *  ③ 知识点面板右上「0/2 已掌握」套着胶囊底 + ▾ 三角，标题左侧还挂一个与列表项同形的空心圆环；
 *     且面板浮在聊天气泡上、边缘字压字；
 *  ④ 「↓ 回到底部」胶囊是半透明的，底下的白色气泡文字直接透出来读成重影。
 *
 * 本护栏逐条锁死，防止这些走查结论被后续改动漂回去。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningPage.vue'), 'utf8');

type TplNode = { type: number; tag?: string; props?: { name?: string; value?: { content?: string } }[]; children?: TplNode[] };
const classOf = (n: TplNode): string =>
  ((n.props || []).find((p) => p.name === 'class')?.value?.content || '').trim();
const hasClass = (n: TplNode, cls: string): boolean => classOf(n).split(/\s+/).includes(cls);

function findAll(root: TplNode, pred: (n: TplNode) => boolean): TplNode[] {
  const out: TplNode[] = [];
  const walk = (n: TplNode) => {
    if (n.type === 1 && pred(n)) out.push(n);
    (n.children || []).forEach(walk);
  };
  walk(root);
  return out;
}
function descendants(n: TplNode): TplNode[] {
  const out: TplNode[] = [];
  const walk = (node: TplNode) => {
    (node.children || []).forEach((c) => {
      if (c.type === 1) out.push(c);
      walk(c);
    });
  };
  walk(n);
  return out;
}

/** 注释里会复述被删掉的旧实现，断言前一律剥注释 */
const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

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
const has = (rule: string, re: RegExp): boolean => re.test(rule);

/** 取某个媒体查询块的完整内容（含嵌套规则），用于判「这条规则在哪个宽度档下生效」 */
function mediaOf(query: string): string[] {
  const css = stripComments(source);
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(`@media ${query} {`, from);
    if (start < 0) break;
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          out.push(css.slice(start, i + 1));
          from = i + 1;
          break;
        }
      }
    }
    if (out.length === 0) break;
  }
  return out;
}

const { descriptor, errors } = parse(source);
const root = descriptor.template?.ast as unknown as TplNode | undefined;

describe('伴学浮窗「小启」：去掉重复标签，控件与主界面同形', () => {
  it('免责声明行与每条消息的学法/时间标签一并撤除', () => {
    expect(errors).toEqual([]);
    const live = stripComments(source);
    for (const cls of ['peerdock__meta', 'peerdock__strategy', 'peerdock__ai-note']) {
      expect(live, `${cls} 又回到小启里了`).not.toContain(cls);
    }
    /* 主输入区那条声明仍保留（合规要求）；这里只管小启浮窗内部 */
    const dock = live.slice(live.indexOf('class="peerdock"'));
    expect(
      dock.slice(0, dock.indexOf('</Transition>')),
      'AI 合规声明不该再常驻小启底部'
    ).not.toContain('<AiContentNote');
    /* 模板里也不许再出现「小启 · 时间」这种逐条标签 */
    expect(live).not.toMatch(/小启 · \{\{/);
  });

  it('追问快选是紧凑按钮：横排可折行、8px 圆角、带 ↳ 前缀', () => {
    const follows = ruleOf('.peerdock__follows');
    expect(has(follows, /flex-wrap:\s*wrap/)).toBe(true);
    expect(has(follows, /flex-direction:\s*column/), '又变回竖排长条了').toBe(false);
    const follow = ruleOf('.peerdock__follow');
    expect(has(follow, /border-radius:\s*8px/)).toBe(true);
    expect(has(follow, /padding:\s*4px 10px/)).toBe(true);
    expect(source, '缺 ↳ 前缀，追问又读成消息气泡').toContain(".peerdock__follow::before { content: '↳'");
  });

  it('发送键内嵌输入条右端、32 圆形图标钮', () => {
    const send = ruleOf('.peerdock__send');
    expect(has(send, /width:\s*32px/)).toBe(true);
    expect(has(send, /height:\s*32px/)).toBe(true);
    expect(has(send, /border-radius:\s*50%/)).toBe(true);
    const input = ruleOf('.peerdock__input');
    expect(has(input, /align-items:\s*center/)).toBe(true);
    /* 发送键必须是输入条的直接子节点（外挂椭圆文字钮已退役） */
    const bar = findAll(root as TplNode, (n) => hasClass(n, 'peerdock__input'))[0];
    expect(bar, '模板里找不到 .peerdock__input').toBeTruthy();
    expect(
      (bar.children || []).some((c) => hasClass(c, 'peerdock__send')),
      '发送键跑到输入条外面了'
    ).toBe(true);
    expect(has(ruleOf('.peerdock__input input'), /height:\s*38px/)).toBe(true);
  });

  it('窄屏遮罩从 ≤640 提到 ≤1023（641–1023 这档此前完全裸奔）', () => {
    const blocks = mediaOf('(max-width: 1023px)');
    expect(blocks.length, '没有 ≤1023 的媒体块').toBeGreaterThan(0);
    expect(
      blocks.some((b) => /\.peer-backdrop\s*\{[\s\S]*?display:\s*block/.test(b)),
      '≤1023 这档没有给小启加遮罩 → 浮窗直接压在选项/小测卡上'
    ).toBe(true);
  });
});

describe('⋯ 菜单：单行项，高度减半', () => {
  it('菜单项是 6px 内边距的单行项（双行结构整体退役）', () => {
    const item = ruleOf('.learn__menu-item');
    expect(has(item, /padding:\s*6px 12px/)).toBe(true);
    const live = stripComments(source);
    expect(live, '双行项结构又回来了').not.toContain('learn__menu-item-main');
    expect(live, '菜单分隔线随双行结构一起退役').not.toContain('.learn__menu-sep {');
  });

  it('菜单里只剩真动作：状态块与「返回路径详情」不再重复', () => {
    const live = stripComments(source);
    const group = live.slice(live.indexOf('<ImmersiveMenu mask>'), live.indexOf('</ImmersiveMenu>'));
    expect(group).not.toContain('learn__live');
    /* 空态说明「本节还没有开起来，先返回路径详情…」保留（它只是指路，不是重复入口）；
       不许有的是「返回路径详情」这个**菜单项本身**——左上角返回钮已在做同一件事。 */
    const items = findAll(root as TplNode, (n) => hasClass(n, 'learn__menu-item'));
    const itemText = items.map((b) => descendants(b).map((c) => (c as unknown as { content?: string }).content || '').join(''));
    expect(itemText.some((t) => t.includes('返回路径详情')), '左上角已有返回钮，菜单里不再复读').toBe(false);
    expect(group, '菜单项不该再带开合三角等装饰').not.toContain('▾');
  });
});

describe('知识点面板：读数纯文字 + 遮罩', () => {
  it('标题左侧的装饰圆环撤除（与列表项圆环同形，读成列表项）', () => {
    const live = stripComments(source);
    expect(live, '圆环实现残留').not.toContain('kpRingDash');
    expect(live, '圆环常量残留').not.toContain('KP_RING_C');
    const main = findAll(root as TplNode, (n) => hasClass(n, 'kp__head-main'))[0];
    expect(main, '模板里找不到 .kp__head-main').toBeTruthy();
    expect(descendants(main).some((n) => n.tag === 'svg'), '标题前又插回一个 svg 圆环').toBe(false);
  });

  it('「N / M 已掌握」是纯文字（无胶囊底、无 ▾）', () => {
    const chip = ruleOf('.kp__chip');
    expect(has(chip, /background/), '读数又套回胶囊底了').toBe(false);
    const head = stripComments(source).slice(source.indexOf('class="kp__head-meta"'));
    expect(head.slice(0, head.indexOf('</span>')), '▾ 三角又回来了').not.toContain('▾');
  });

  it('窄屏给面板加遮罩（点遮罩收起）', () => {
    const blocks = mediaOf('(max-width: 1023px)');
    expect(
      blocks.some((b) => /\.kp-mask\s*\{[\s\S]*?display:\s*block/.test(b)),
      '窄屏知识点面板没有遮罩 → 面板边缘与气泡字压字'
    ).toBe(true);
    expect(stripComments(source)).toContain('<div v-if="kpOpen" class="kp-mask"');
  });
});

describe('回到底部浮标：实色不透字', () => {
  const btn = () => ruleOf('.tutor__jump-bottom');

  it('z-index 抬到消息层之上', () => {
    expect(has(btn(), /z-index:\s*9/)).toBe(true);
  });

  it('实色底 + overlay 投影（半透明底会让底下文字透出来）', () => {
    expect(has(btn(), /background:\s*var\(--surface\)/)).toBe(true);
    expect(has(btn(), /box-shadow:\s*var\(--wf-shadow-overlay\)/)).toBe(true);
    expect(btn(), '又用回 raised 档，投影太弱').not.toContain('--wf-shadow-raised');
  });
});
