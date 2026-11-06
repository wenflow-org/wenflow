/**
 * 「课程学习 /learn」页面与其他页面 UI 规范对齐的护栏（2026-11-06 走查）
 *
 * 五处实测失调：
 *  ① 顶栏右侧「深灰圆胶囊 + 蓝圆胶囊 + 绿色裸字 + 44px 大方块」四种长相并排；
 *     左侧「‹ 返回路径详情」与两行标题只隔 18px，读成一坨；
 *  ② 底部快捷选项是 3 条 width:100% 的竖排长条，一行 8 个字占近 1000px 宽；
 *  ③ 暗色下用户气泡被 [data-theme='dark'] .msg__bubble 覆写成 surface 灰（与 AI 气泡同色），
 *     且每句底下挂一行「问流导师 · 17:54」，AI 气泡又被 30px 头像右推 40px，
 *     卡点签/小测卡却贴最左 → 左侧三条边界线；
 *  ④ 小测卡紫框配蓝「提交」按钮，选项 44px、跳过另占一行，整块吃掉下方近 40% 高度；
 *  ⑤ 输入区底部提示 flex-end 偏右、字数「0 / 800」常驻、停止键是大方块。
 *
 * 本护栏逐条锁死，防止「别的页面修好了、这页又漂回去」。
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

function all(root: TplNode, pred: (n: TplNode) => boolean): TplNode[] {
  const out: TplNode[] = [];
  const walk = (n: TplNode) => {
    if (n.type === 1 && pred(n)) out.push(n);
    (n.children || []).forEach(walk);
  };
  walk(root);
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

const { descriptor, errors } = parse(source);
const root = descriptor.template?.ast as unknown as TplNode | undefined;

describe('顶栏：四种长相收成一套 32/8 控件', () => {
  it('返回钮只剩图标（文字撤除，aria-label 保留）', () => {
    expect(errors).toEqual([]);
    expect(source).toContain('aria-label="返回路径详情"');
    /* 顶栏那颗按钮里不许再有文本节点（⋯ 菜单项里的「返回路径详情」是另一处，保留） */
    const back = all(root as TplNode, (n) => hasClass(n, 'learn__back'));
    expect(back.length, '模板里找不到 .learn__back').toBe(1);
    const texts = (back[0].children || []).filter((c) => c.type === 2);
    expect(texts.map((c) => (c as unknown as { content?: string }).content).join('').trim()).toBe('');
    const rule = ruleOf('.learn__back');
    expect(has(rule, /width:\s*32px/)).toBe(true);
    expect(has(rule, /border-radius:\s*8px/)).toBe(true);
  });

  it('标题左侧有细竖线（与返回钮分开）', () => {
    const title = ruleOf('.learn__title');
    expect(has(title, /border-left:\s*1px solid/)).toBe(true);
  });

  it('右侧三件套同高同圆角；⋯ 不再是 44 大方块', () => {
    for (const sel of ['.learn__kpbtn', '.learn__finishbtn']) {
      const rule = ruleOf(sel);
      expect(has(rule, /height:\s*32px/), `${sel} 没收到 32 高`).toBe(true);
      expect(has(rule, /border-radius:\s*8px/), `${sel} 还是圆胶囊`).toBe(true);
    }
    const menu = source.slice(source.indexOf('.learn__head-right :deep(.imm-menu__btn) {'));
    expect(has(menu.slice(0, menu.indexOf('}')), /width:\s*32px/)).toBe(true);
  });

  it('「学习中」裸绿字只在异常态出现', () => {
    expect(source).toContain('v-if="initError || isLocked"');
    const span = all(root as TplNode, (n) => hasClass(n, 'learn__live--head'));
    expect(span.length, '顶栏状态字应只剩一处（异常态）').toBe(1);
  });
});

describe('快捷选项：横排短签，不再是满宽长条', () => {
  it('容器是横向可折行', () => {
    const row = ruleOf('.replies__row');
    expect(has(row, /flex-wrap:\s*wrap/)).toBe(true);
    expect(has(row, /flex-direction:\s*row/)).toBe(true);
  });

  it('单条按内容宽、32 高、8px 圆角、无圆点前缀', () => {
    const reply = ruleOf('.reply');
    expect(has(reply, /width:\s*fit-content/)).toBe(true);
    expect(has(reply, /min-height:\s*32px/)).toBe(true);
    expect(has(reply, /border-radius:\s*8px/)).toBe(true);
    expect(stripComments(source), '蓝点前缀已撤').not.toContain('.reply::before');
  });
});

describe('对话流：用户气泡保持品牌蓝、左缘只有一条线', () => {
  it('暗色覆写只作用于 AI 气泡（否则用户气泡被刷成灰）', () => {
    const live = stripComments(source);
    expect(live).toContain("[data-theme='dark'] .msg--ai .msg__bubble {");
    expect(/\[data-theme='dark'\] \.msg__bubble \{/.test(live), '又整类覆写了，用户气泡会再变灰').toBe(false);
  });

  it('AI 头像撤除（模板与样式都不留）', () => {
    expect(stripComments(source)).not.toContain('msg__avatar');
  });

  it('单条时间戳不再渲染（meta 行只为可操作项存在）', () => {
    const live = stripComments(source);
    expect(live).not.toContain('问流导师 · ');
    /* AI 的 meta 行现在只在失败时出现（重试），用户侧只在可编辑时出现 */
    expect(live).toContain('<div v-if="m.failed" class="msg__meta">');
    expect(live).toContain('<div v-if="canEditMessage(m)" class="msg__meta">');
  });

  it('卡点签是 6px 小方签并带图标', () => {
    const chip = ruleOf('.msg__chip--confuse');
    expect(has(chip, /border-radius:\s*6px/)).toBe(true);
    const chipNodes = all(root as TplNode, (n) => hasClass(n, 'msg__chip--confuse'));
    expect(chipNodes.length).toBe(1);
    expect(all(chipNodes[0], (n) => n.tag === 'svg').length, '卡点签缺前置图标').toBe(1);
  });
});

describe('小测卡：蓝色系 + 紧凑', () => {
  it('检查点相关规则里不再出现 --accent（紫）', () => {
    const live = stripComments(source);
    const rules = live.match(/\.checkpoint[^{]*\{[^}]*\}/g) || [];
    const purple = rules.filter((rule) => rule.includes('--accent'));
    expect(purple, `仍有 ${purple.length} 条检查点规则用紫色`).toEqual([]);
  });

  it('选项压到 36 高 / 8px 圆角', () => {
    const option = ruleOf('.checkpoint__option');
    expect(has(option, /min-height:\s*36px/)).toBe(true);
    expect(has(option, /border-radius:\s*8px/)).toBe(true);
  });

  it('「跳过」收进头部（不再与提交并排占一行）', () => {
    expect(source).toContain('class="checkpoint__head-top"');
    const head = source.slice(source.indexOf('class="checkpoint__head-top"'), source.indexOf('checkpoint__actions'));
    expect(head).toContain('checkpoint__skip');
    const actions = source.slice(source.indexOf('class="checkpoint__actions"'));
    const actionBlock = actions.slice(0, actions.indexOf('</div>'));
    expect(actionBlock, '跳过又从头部回到动作行了').not.toContain('skipCheckpoint');
  });
});

describe('输入区细节', () => {
  it('字数只在超过 600 字时出现', () => {
    expect(source).toContain('v-if="input.length > 600"');
  });

  it('底部提示行居中（不再贴右）', () => {
    expect(has(ruleOf('.composer__hint'), /justify-content:\s*center/)).toBe(true);
    expect(has(ruleOf('.composer__hint--single'), /justify-content:\s*center/)).toBe(true);
  });

  it('发送与停止同一颗 32 圆形', () => {
    const send = ruleOf('.composer__send');
    expect(has(send, /width:\s*32px/)).toBe(true);
    expect(has(send, /height:\s*32px/)).toBe(true);
    expect(has(send, /border-radius:\s*50%/)).toBe(true);
    expect(source, '停止态只换底色，不另设尺寸').not.toMatch(/\.composer__send--stop\s*\{[^}]*width:/);
  });
});
