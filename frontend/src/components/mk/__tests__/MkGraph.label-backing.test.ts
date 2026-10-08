/**
 * 知识图谱常显标签「底衬」护栏（2026-10-08 用户侧视觉检查 #24）。
 *
 * 病根：ECharts 的 `labelLayout.hideOverlap` 只比较**标签↔标签**，看不到节点圆/方块。
 * 密集图里某个节点的两行标签会落在相邻节点的符号上，判定为「值得常显」的枢纽标签
 * 因此互相压字（手机浅色档实测：把标签区放大 3 倍能看到「定唯」压在另一个节点方块上；
 * 省略号截断后也没有可点/可悬停的出口，移动端没有 hover）。
 *
 * 修法：给标签铺一层与画布同色的底衬（= 把被压住的节点「镂空」），色值取运行时
 * `--mk-surface`（不新增硬编码），并给底衬留 2–3px 内边距把被压的符号边的溢色盖掉。
 *
 * 本文件锁三件事，任一条挂了就意味着「标签又压在节点上」会复发：
 *  1) label 上有 backgroundColor（底衬存在）；
 *  2) 底衬色来自 token，不是写死的颜色字面量；
 *  3) 底衬有 padding（否则节点符号的 1.5px 描边会从底衬边缘露出来）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../MkGraph.vue'), 'utf8');

/** 花括号配平：从 `open` 的 `{` 取到配平的 `}` */
function balanced(open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error('花括号没有配平');
}

/** 包住某个「唯一声明」的那个 `{...}` 块（往前找到最近的 `{` 再配平） */
function blockContaining(needle: string): string {
  const at = source.indexOf(needle);
  expect(at, `源码里找不到 ${needle}`).toBeGreaterThanOrEqual(0);
  return balanced(source.lastIndexOf('{', at));
}

/** 函数体：从 needle 之后的第一个 `{` 配平 */
function fnBody(needle: string): string {
  const at = source.indexOf(needle);
  expect(at, `源码里找不到 ${needle}`).toBeGreaterThanOrEqual(0);
  return balanced(source.indexOf('{', at));
}

/** 系列级 label 规则：`label:` 在源码里出现三次（graphRoam 回填 show、系列 label、
 *  data.map 里逐节点的 `label: { show }`）。用系列 label 独有的 `position: 'bottom'`
 *  反查它所在的 `{...}`，避开另外两处。 */
function seriesLabelBlock(): string {
  return blockContaining("position: 'bottom'");
}

describe('知识图谱：常显标签底衬（hideOverlap 管不到节点符号）', () => {
  it('label 规则里有 backgroundColor 底衬', () => {
    const label = seriesLabelBlock();
    expect(label, 'label 上没有 backgroundColor：枢纽标签会直接压在节点符号上').toMatch(
      /backgroundColor\s*:/
    );
  });

  it('底衬色取自 --mk-surface token，不是写死的色值', () => {
    const fn = fnBody('function labelSurface');
    expect(fn, '底衬色没有读 --mk-surface，主题切换后会与画布不同色').toMatch(
      /--mk-surface/
    );
    // token 取值行（非兜底行）不得是颜色字面量
    const tokenLine = fn.split('\n').find((l) => l.includes('--mk-surface'))
    expect(tokenLine, '读不到取 token 的那一行').toBeTruthy()
    expect(tokenLine!, '底衬色应当来自 token，不是色值字面量').not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })

  it('底衬有 padding（铺满字的方角会让节点描边从边缘露出）', () => {
    const label = seriesLabelBlock();
    expect(label, '底衬没有 padding：节点符号的 1.5px 描边会贴着字露出').toMatch(
      /padding\s*:/
    );
  });
});
