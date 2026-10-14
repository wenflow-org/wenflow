/**
 * 减少动态效果护栏（2026-10-15，评审 F23 / issue #26）
 *
 * 病根：`@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0.01ms
 * !important } }` 是流传最广的无障碍写法，但它在本仓**会毁掉一切同步度量**——`transition-property`
 * 的 CSS 初值就是 `all`，给 `*` 下 0.01ms 等于凭空给每个元素造一条「全属性过渡」；任何「写样式后
 * 立刻量尺寸」的代码量到的是过渡起始值而不是终值。
 *
 * 实测代价：课堂 mermaid 结构图在减少动态效果下把节点间距从 104px 算成 2077px，整张 6 节点图
 * 被渲染成 4476×6313px，课堂页撑到 1.2 万 px，检查点与输入框被推到十几屏之后（学生用不了）。
 * 逐条二分的结论：`animation-duration` / `animation-iteration-count` 无辜，只有这条
 * `transition-duration` 触发；`transition: none` / `transition-property: none` 都正常。
 *
 * 契约（本护栏锁两件事）：
 *  1) 两个全局兜底块（styles/main.css、styles/mk-primitives.css）必须用 `transition-property: none`
 *     关过渡——把时长压到 0.01ms 的写法一旦回来，度量又会开始读到过渡起始值；
 *  2) 全仓**任何** reduced-motion 块里都不得出现 `transition-duration` / `-webkit-transition-duration`，
 *     也不得出现带非 0 时长的 `transition` 简写（`none` 与全 0 时长放行，它们不制造过渡）。
 *
 * 为什么是测试而不是 design:check 规则：规则 3/7/14/15/16 那套是「棘轮 + 基线」的还款计划表，
 * 而这条的存量是 0（2026-10-15 已清零），硬失败最省事；且这条不变式的说明本身就是文档，
 * 与 card-head-grouping.test.ts 同族。扫描面覆盖 src 下**所有** .css 与 .vue 的 style 块。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'vue/compiler-sfc';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../..'); // src/styles/__tests__ → src

/** 剥掉注释再匹配：修复自身的说明里就写着「不能写 transition-duration: 0.01ms」，
 *  不剥会把注释当违规（与 design:check 的材质规则同一手法）。 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 该文件的可扫描 CSS 面：.vue 取 <style> 块，.css 全文 */
function cssSurface(abs: string, text: string): string {
  if (!abs.endsWith('.vue')) return text;
  const { descriptor, errors } = parse(text);
  if (errors.length) return '';
  return descriptor.styles.map((block) => block.content).join('\n');
}

/** 取所有 `@media` 前置含 prefers-reduced-motion 且含 reduce 的块体（按括号配对截取） */
function reducedMotionBodies(css: string): string[] {
  const bodies: string[] = [];
  const re = /@media([^{]*)\{/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const prelude = match[1];
    let depth = 1;
    let k = re.lastIndex;
    while (k < css.length && depth > 0) {
      if (css[k] === '{') depth += 1;
      else if (css[k] === '}') depth -= 1;
      k += 1;
    }
    const body = css.slice(re.lastIndex, k - 1);
    re.lastIndex = k;
    if (/prefers-reduced-motion/i.test(prelude) && /\breduce\b/i.test(prelude)) bodies.push(body);
  }
  return bodies;
}

type CssFile = { file: string; abs: string; css: string };

/** src 下所有 .css 与 .vue（`src/**` 是扫描面：构建产物 dist/ 与 node_modules 不属源码） */
function collectCssFiles(): CssFile[] {
  const out: CssFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.name.endsWith('.css') && !entry.name.endsWith('.vue')) continue;
      const text = readFileSync(abs, 'utf8');
      out.push({ file: relative(SRC, abs), abs, css: stripComments(cssSurface(abs, text)) });
    }
  };
  walk(SRC);
  return out;
}

/** 一条违规：file | 块体里的原始片段 */
type Violation = { file: string; snippet: string };

/** 违规判据：块体里出现 transition-duration 声明，或带非 0 时长的 transition 简写 */
function violationsIn(body: string, file: string): Violation[] {
  const out: Violation[] = [];
  const push = (snippet: string) => out.push({ file, snippet: snippet.replace(/\s+/g, ' ').trim() });

  for (const m of body.matchAll(/(?:-webkit-)?transition-duration\s*:\s*[^;}\n]+/gi)) {
    push(m[0]);
  }
  for (const m of body.matchAll(/(?:^|[;{\s])transition\s*:\s*([^;}\n]+)/gi)) {
    const value = m[1].trim();
    if (/^none\b/i.test(value)) continue; // 显式「没有过渡」
    const times = value.match(/\b\d*\.?\d+(ms|s)\b/gi) || [];
    const allZero = times.length > 0 && times.every((t) => parseFloat(t) === 0);
    if (allZero) continue; // 全 0 时长不制造过渡（与不写等价）
    push(`transition: ${value}`);
  }
  return out;
}

describe('减少动态效果护栏（reduced-motion 块不得制造过渡）', () => {
  const files = collectCssFiles();

  it('扫描面非空（护栏自身不能是空转）', () => {
    expect(files.length).toBeGreaterThan(100);
    const withBlocks = files.filter((f) => reducedMotionBodies(f.css).length > 0);
    expect(withBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it('两个全局兜底块用 transition-property: none 关过渡（不是把时长压成 0.01ms）', () => {
    for (const rel of ['styles/main.css', 'styles/mk-primitives.css']) {
      const target = files.find((f) => f.file.replace(/\\/g, '/').endsWith(rel));
      expect(target, `${rel} 未被打描到`).toBeTruthy();
      const bodies = reducedMotionBodies(target!.css);
      expect(bodies.length, `${rel} 里找不到 prefers-reduced-motion: reduce 块`).toBeGreaterThan(0);
      const hasPropertyNone = bodies.some((b) => /transition-property\s*:\s*none/i.test(b));
      expect(hasPropertyNone, `${rel} 的减少动态效果块里缺少 transition-property: none`).toBe(true);
    }
  });

  it('全仓 reduced-motion 块里不得出现 transition-duration 或带非 0 时长的 transition', () => {
    const violations: Violation[] = [];
    for (const f of files) {
      for (const body of reducedMotionBodies(f.css)) violations.push(...violationsIn(body, f.file));
    }
    expect(
      violations,
      `减少动态效果块里出现了会制造过渡的写法（用 transition-property: none 代替）：\n${violations
        .map((v) => `  ${v.file}  →  ${v.snippet}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
