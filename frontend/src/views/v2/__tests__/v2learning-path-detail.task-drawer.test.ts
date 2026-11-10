/**
 * 任务卡「微调」抽屉的护栏（2026-11-06 二次走查）
 *
 * 四个实测问题：
 *  ① 抽屉在任务卡**外面**（`.task-edit` 是 `.task` 的兄弟节点），夹在任务 1 与任务 2 之间，
 *     还画着 dashed 虚线框 → 既不像属于任务 1，又像未完成占位；
 *  ② 6 个控件挤一排，红色「删除」与「插入」只隔 6px，打完字手一抖就删错任务；
 *  ③ 「缩短 10 分钟 / 延长 10 分钟」两个 5 字按钮吃掉半行宽；
 *  ④ 「资料：[📄 公文种类]」独占一行，任务头再复读一次「本阶段依据资料」。
 *
 * 本护栏锁：抽屉在卡内（同一张卡、底部细分割线、无虚线）、上下两行结构（删除与插入分开）、
 * 步进器替代长文案、引用签并进属性和阶段级引用行已删。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningPathDetail.vue'), 'utf8');

type TplNode = { type: number; tag?: string; props?: { name?: string; value?: { content?: string } }[]; children?: TplNode[] };
const classOf = (n: TplNode): string =>
  ((n.props || []).find((p) => p.name === 'class')?.value?.content || '').trim();
const hasClass = (n: TplNode, cls: string): boolean => classOf(n).split(/\s+/).includes(cls);

function find(root: TplNode, pred: (n: TplNode) => boolean): TplNode | undefined {
  let hit: TplNode | undefined;
  const walk = (n: TplNode) => {
    if (!hit && n.type === 1 && pred(n)) hit = n;
    (n.children || []).forEach(walk);
  };
  walk(root);
  return hit;
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

/** 注释里会复述被删掉的旧实现（旧类名/旧文案），断言前一律剥注释 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
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

const { descriptor, errors } = parse(source);
const root = descriptor.template?.ast as unknown as TplNode | undefined;

describe('微调抽屉归属当前任务卡', () => {
  it('抽屉是任务卡的子节点（不再是卡外的兄弟虚线框）', () => {
    expect(errors).toEqual([]);
    const task = find(root as TplNode, (n) => hasClass(n, 'task'));
    expect(task, '模板里找不到 .task').toBeTruthy();
    const inside = descendants(task as TplNode);
    expect(
      inside.some((n) => hasClass(n, 'task-edit')),
      '抽屉跑到任务卡外面了 → 又是一个游离的虚线框'
    ).toBe(true);
  });

  it('卡内展开靠一条细分割线，不再是虚线框', () => {
    const drawer = ruleOf('.task-edit');
    expect(/border-top\s*:\s*1px solid/.test(drawer), '缺 border-top 分割线').toBe(true);
    expect(drawer, '虚线框（未完成占位观感）不许复辟').not.toContain('dashed');
    expect(/grid-column\s*:\s*1\s*\/\s*-1/.test(drawer), '抽屉要吃满卡宽').toBe(true);
  });
});

describe('抽屉内部：两行结构，删除与插入分开', () => {
  const drawer = () => find(root as TplNode, (n) => hasClass(n, 'task-edit'));

  it('第一行两端对齐放步进器与删除，第二行整宽放插入', () => {
    const rows = descendants(drawer() as TplNode).filter((n) => hasClass(n, 'task-edit__row'));
    expect(rows.length, '第一行（步进器 + 删除）应有一行').toBe(1);
    expect(hasClass(rows[0], 'task-edit__row--split'), '第一行要两端对齐').toBe(true);
    const insert = descendants(drawer() as TplNode).find((n) => hasClass(n, 'task-edit__insert'));
    expect(insert, '第二行缺插入组合框').toBeTruthy();
  });

  it('删除按钮不在插入那一行（此前相隔 6px，手抖即删错）', () => {
    const insert = descendants(drawer() as TplNode).find((n) => hasClass(n, 'task-edit__insert')) as TplNode;
    expect(
      descendants(insert).some((n) => hasClass(n, 'task-edit__danger')),
      '删除键又和插入键挤在同一行了'
    ).toBe(false);
  });

  it('时长用步进器（两颗），不再用「缩短/延长 10 分钟」长按钮', () => {
    const steps = descendants(drawer() as TplNode).filter((n) => hasClass(n, 'task-edit__step'));
    expect(steps.length).toBe(2);
    /* 可见文案收成 −10 分 / +10 分（aria-label 仍是完整的「缩短/延长 10 分钟」） */
    expect(source).toContain('−10 分');
    expect(source).toContain('+10 分');
    expect(stripComments(source)).not.toContain('task-edit__btn');
  });

  it('插入框吃满整行：输入框 flex，插入键内嵌在组合框里', () => {
    const input = ruleOf('.task-edit__input');
    expect(/flex\s*:\s*1 1 auto/.test(input), '输入框没吃满剩余宽度').toBe(true);
    expect(ruleOf('.task-edit__submit'), '插入键应内嵌（无外描边，靠左分隔线）').toContain('border-left');
    expect(stripComments(source), '组合框要能整体聚焦').toContain('.task-edit__insert:focus-within');
  });
});

describe('任务卡三行压两行', () => {
  it('引用签并进属性行（不再有独占一行的「资料：」）', () => {
    const live = stripComments(source);
    expect(live).not.toContain('task__material');
    expect(live).not.toContain('stage__material');
    expect(live).not.toContain('本阶段依据资料');
    const meta = ruleOf('.task__meta');
    expect(meta, '属性行要允许折行（窄屏引用签换行）').toContain('flex-wrap: wrap');
    expect(source).toContain('material-ref--inline');
  });

  it('微调入口在展开态改文案为「收起 ▴」', () => {
    expect(source).toContain("{{ editingTaskId === task.id ? '收起 ▴' : '微调' }}");
  });
});
