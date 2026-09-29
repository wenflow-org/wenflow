/**
 * 卡头成组护栏（2026-09-29 用户走查健康中心：「位置哪里的都有，统一性呢」）
 *
 * 病根：`.mk-card__head` 靠 `justify-content: space-between` 排版，只对「标题 + 一个尾部元素」
 * 成立。尾部元素 ≥2 个、或折叠头用 `::before` 插入的 ▸ 标记（它同样是一个 flex item）
 * 都会参与均分——实测 1920 视口下健康中心四张卡：「健康检查」标题落在 x=774（卡左内边距仅 273）、
 * 「13 项」悬在 x=1317，「完成度分布」因文案更短又落到 x=1009；同一页四个标题四个位置。
 *
 * 契约：`.mk-card__head` 的首个元素子节点吃掉全部剩余宽度（`flex: 1 1 auto`），
 * 其后元素紧凑成组贴右。锁两件事：
 *  1) 原语层这条成组规则存在（它被删掉，上面那三个位置就会各自散开，且没有任何测试会红）；
 *  2) 首个元素子节点不是裸控件/可点元素——成组规则会把它拉宽到整行，
 *     对一个 select/button 就是实打实的可见缺陷（全仓实测当前 0 处，故可安全依赖）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const here = dirname(fileURLToPath(import.meta.url));
const STYLES = resolve(here, '../../../styles/mk-primitives.css');
const SRC = resolve(here, '../../..');

type TplProp = {
  type: number;
  name?: string;
  arg?: { content?: string; name?: string };
  value?: { content?: string };
};
type TplNode = { tag?: string; props?: TplProp[]; children?: TplNode[] };

const classOf = (node: TplNode): string =>
  ((node.props || []).find((prop) => prop.name === 'class')?.value?.content || '').trim();
const isCardHead = (node: TplNode): boolean => classOf(node).split(/\s+/).includes('mk-card__head');
const CONTROLS = new Set(['select', 'input', 'button', 'textarea']);
const hasClick = (node: TplNode): boolean =>
  (node.props || []).some(
    (prop) => prop.type === 2 && prop.name === 'on' && (prop.arg?.content || prop.arg?.name) === 'click',
  );

type Head = { file: string; kids: number; firstTag: string; first?: TplNode };

/** 遍历 src/views 与 src/components 下所有 .vue，收集 class 含 mk-card__head 的元素 */
function collect(dir: string, out: Head[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(abs, out);
      continue;
    }
    if (!entry.name.endsWith('.vue')) continue;
    const { descriptor, errors } = parse(readFileSync(abs, 'utf8'));
    if (errors.length || !descriptor.template) continue;
    const file = relative(SRC, abs);
    const visit = (node: TplNode) => {
      if (isCardHead(node)) {
        const kids = (node.children || []).filter((child) => child.tag);
        out.push({ file, kids: kids.length, first: kids[0], firstTag: kids[0]?.tag || '（无元素子节点）' });
      }
      (node.children || []).forEach(visit);
    };
    visit(descriptor.template.ast as unknown as TplNode);
  }
}

function cardHeads(): Head[] {
  const out: Head[] = [];
  collect(resolve(SRC, 'views'), out);
  collect(resolve(SRC, 'components'), out);
  return out;
}

/** 取某条规则块的声明体；找不到返回空串 */
function block(css: string, selector: string): string {
  const pattern = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  return css.match(pattern)?.[1] ?? '';
}

describe('卡头成组（.mk-card__head 尾部元素成组贴右）', () => {
  const css = readFileSync(STYLES, 'utf8');
  const base = block(css, '.mk-card__head');
  const group = block(css, '.mk-card__head > :first-child');

  it('原语层声明了 space-between（成组规则的前提），并给首个元素子节点 flex-grow', () => {
    expect(base).toContain('justify-content: space-between');
    expect(group).toMatch(/flex:\s*1\s+1\s+auto/);
  });

  it('首个元素子节点不得是裸控件或可点元素（它会被拉宽到整行）', () => {
    const offenders = cardHeads()
      .filter((head) => head.first && (CONTROLS.has(head.firstTag) || hasClick(head.first)))
      .map((head) => head.file + '  首个孩子 <' + head.firstTag + '>');
    expect(offenders, '卡头首个孩子会被 flex:1 拉伸到整行，请挪到尾部或包进 .mk-card__head-right').toEqual([]);
  });

  it('扫描覆盖到多子节点卡头（护栏不是空转）', () => {
    const heads = cardHeads();
    expect(heads.length).toBeGreaterThan(50);
    expect(heads.filter((head) => head.kids >= 3).length).toBeGreaterThan(0);
  });
});
