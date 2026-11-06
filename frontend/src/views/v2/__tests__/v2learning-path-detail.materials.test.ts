/**
 * 「学习路径详情」资料区的护栏（2026-11-06 走查，图1–4 / 图7）
 *
 * 四个实测缺陷：
 *  ① 同一任务下连排三颗「公文种类」——后端引用层按 `sectionId|quote` 去重，
 *     同章不同引文会并存；前端按章节名渲染就重复了。修法：渲染前按章节身份去重。
 *  ② 引用是蓝字下划线（90 年代网页感）——收成胶囊微签 + 文档小图标。
 *  ③ 右栏「学习资料」里「原文 · 公文种类」＋「对应章节：公文种类」两行复读，
 *     下面还塞一个 280px 宽的 <pre> 全文滚动框（从英文爬虫头开始显示 6000 字）。
 *     修法：只留一条引用行 + 左竖线引文块 + 「查看完整章节原文」打开阅读弹窗。
 *  ④ 右栏「接下来」卡片与左栏展开后的任务列表重复，且序号错位——整卡删除。
 *  ⑤ 移动端 order:-1 把「学习资料」顶到阶段列表之前，展开后阶段 1~4 被挤到最底。
 *
 * 本护栏锁：去重入口、胶囊样式、无 <pre> 全文框、无「接下来」、无 order:-1、阅读弹窗在位。
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

function nodesWithTag(root: TplNode, tag: string): TplNode[] {
  const found: TplNode[] = [];
  const walk = (n: TplNode) => {
    if (n.type === 1 && n.tag === tag) found.push(n);
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

const { descriptor, errors } = parse(source);
const root = descriptor.template?.ast as unknown as TplNode | undefined;

describe('资料引用：同一章节只渲染一次', () => {
  it('两处引用循环都走 materialRefsOf（不直接遍历原始 materialRefs）', () => {
    expect(errors).toEqual([]);
    expect(source).toContain('in materialRefsOf(stage)');
    expect(source).toContain('in materialRefsOf(task)');
    expect(source, '直接遍历原始数组会连排同名引用').not.toContain('in stage.materialRefs');
    expect(source).not.toContain('in task.materialRefs');
  });

  it('去重走共享纯函数（按章节身份，不按引文）', () => {
    expect(source).toContain("import { dedupeMaterialRefs, normalizeMaterialMarkdown } from '@/utils/materialText'");
    expect(source).toContain('dedupeMaterialRefs(node?.materialRefs)');
  });

  it('引用是胶囊微签，不再有原生下划线', () => {
    const ref = ruleOf('.material-ref');
    expect(decl(ref, 'text-decoration'), '蓝字下划线又回来了').toBe('none');
    expect(decl(ref, 'border-radius'), '微签要 4px 控件圆角').toBe('4px');
    expect(decl(ref, 'background'), '微签要蓝 10% 底').toContain('color-mix');
    expect(decl(ref, 'font-size')).toBe('12px');
  });
});

describe('学习资料卡：只讲一条引用，全文去弹窗读', () => {
  it('删掉了重复的「对应章节」行，标题改为「当前引用」', () => {
    /* 注释里还留着「原样复述这个缺陷」的说明文字，所以剥注释后再断 */
    const live = source.replace(/<!--[\s\S]*?-->/g, '');
    expect(live, '模板里不许再渲染「对应章节：」这行复读').not.toContain('对应章节：');
    expect(source).toContain('当前引用：');
  });

  it('侧栏里不再有 <pre> 全文滚动框', () => {
    expect(source).not.toContain('<pre class="material-text"');
    expect(stripComments(source), '.material-text 样式应一并删除').not.toContain('.material-text {');
  });

  it('引文用左竖线引用块展示', () => {
    expect(source).toContain('class="material-quote"');
    const quote = ruleOf('.material-quote');
    expect(decl(quote, 'border-left'), '引文块必须有左竖线').toBeTruthy();
  });

  it('给出去大弹窗读全文的入口，且弹窗渲染的是 markdown 而不是原文串', () => {
    expect(source).toContain('查看完整章节原文');
    expect(source).toContain('openMaterialReader');
    expect(source).toContain('normalizeMaterialMarkdown(material?.markdown');
    expect(source, '弹窗正文必须走清洗 + markdown 渲染').toContain('plainMessageHtml(normalized)');
    const readers = nodesWithTag(root as TplNode, 'div').filter((n) => classOf(n) === 'reader');
    expect(readers.length, '缺全文阅读弹窗').toBe(1);
  });
});

describe('右栏冗余卡与移动端顺序', () => {
  it('「接下来」卡片整卡删除，连同 nextTasks 计算属性', () => {
    expect(source).not.toContain('>接下来<');
    expect(source).not.toContain('const nextTasks');
  });

  it('移动端不再把侧栏提前（order:-1 会让阶段列表沉底）', () => {
    const css = stripComments(source);
    expect(css, 'order:-1 会把学习资料顶到阶段列表之前').not.toMatch(/\.side\s*\{[^}]*order\s*:\s*-1/);
    expect(css).toMatch(/\.side\s*\{\s*position:\s*static;\s*\}/);
  });
});
