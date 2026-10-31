/**
 * 知识图谱节点标签护栏（2026-10-08 用户侧视觉检查）
 *
 * 病根：标签字号是 narrow ? 10 : 11，低于仓库 12px 的文本下限，节点名难以辨认；
 * 画布内文字由 ECharts 绘制、不是 DOM 文本，mobile:spec 的 fonts 门禁永远看不到它，
 * 所以这条一直没人管。字号提到 12 后，每行字数与行高必须同步调整，
 * 否则单字变宽会把画布挤得更糊（每行少一个字，两行后的整体标签宽度基本不变）。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../../../components/mk/MkGraph.vue'), 'utf8');

function numberAfter(prop: string): number[] {
  const found: number[] = [];
  const re = new RegExp(`${prop}\\s*:\\s*([^,\\n]+)`, 'g');
  let m = re.exec(source);
  while (m) {
    for (const n of m[1].matchAll(/\d+/g)) found.push(Number(n[0]));
    m = re.exec(source);
  }
  return found;
}

describe('知识图谱：节点标签可辨认性', () => {
  it('标签字号不低于 12px（原先 10/11 低于文本下限）', () => {
    const sizes = numberAfter('fontSize');
    expect(sizes.length, '源码里读不到 fontSize').toBeGreaterThan(0);
    for (const s of sizes) {
      expect(s, `字号 ${s} < 12：节点名辨认困难`).toBeGreaterThanOrEqual(12);
    }
  });

  it('行高不小于字号（12px 字挤在 12px 行高里会互相压）', () => {
    const lineHeights = numberAfter('lineHeight');
    expect(lineHeights.length).toBeGreaterThan(0);
    const minFont = Math.min(...numberAfter('fontSize'));
    for (const lh of lineHeights) {
      expect(lh, `行高 ${lh} < 字号 ${minFont}`).toBeGreaterThanOrEqual(minFont);
    }
  });

  it('每行字数与字号配套（字号抬高后每行收窄）', () => {
    const perLine = /const perLine = narrow \? (\d+) : (\d+)/.exec(source);
    expect(perLine, '读不到 perLine 的三元表达式').toBeTruthy();
    expect(Number(perLine![1]), '窄屏每行字数没收窄，12px 字会互相压').toBeLessThanOrEqual(6);
    expect(Number(perLine![2])).toBeLessThanOrEqual(8);
  });

  it('窄屏密集图不常显标签（画布放不下 7 个标签，点按看详情）', () => {
    // 2026-10-29 像素级走查：320–370px 宽 + 20 多个节点时，无论 4 个还是 6 个常显
    // 标签都会叠字、最右一列被 canvas 裁掉。改为窄屏密集图一个都不常显；
    // 桌面密集图仍保留枢纽 + 薄弱节点。
    expect(source, '窄屏分支应跳过 labelWorthy 填充').toMatch(
      /if \(!denseGraph\)[\s\S]*?\} else if \(!narrow\) \{/
    );
    expect(source).toContain('窄屏密集图刻意一个常显标签都不放');
  });
});
