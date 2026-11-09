/**
 * 知识图谱 · 4K 走查两处回归（2026-11-09）：
 *
 * ① **点击位置偏**：`body.admin-route .ac` 在 2000px+ 带 `zoom: 1.15`、3600px+ 带 `zoom: 1.3`。
 *    CSS zoom 放大的是视觉尺寸，`getBoundingClientRect()` / MouseEvent 的 offsetX 报的都是放大后的
 *    CSS px，而 ECharts 的 canvas 坐标系是放大前的逻辑 px。2560 实测：逻辑 844 的点，zrender 收到
 *    971 = 844 × 1.15 → 命中区整体外扩，点这个点选中旁边那颗。修法是把 DOM 坐标除回逻辑 px，
 *    并在捕获阶段写进 zrender 的 zrX/zrY（它见到现成坐标就不再自己算）。
 *
 * ② **左下角空一大片**：力导向收敛成近似圆团，`layout:'force'` 档按短边取景，宽高比 2:1 的画布
 *    长边两侧必然各留一大条空画布（3840 实测左右各空 773 / 768px，图只占宽度 32%）。修法是
 *    力导向只跑一次，把收敛坐标缓存下来，之后 `layout:'none'` + 节点 x/y 直接喂——
 *    这一档下 ECharts 的 View 会把数据包围盒铺满取景盒，空画布因此被填掉，且位置不再随
 *    选中/换主题重排。
 *
 * 组件在 jsdom 里起不了画布，所以按源码锁实现要点（与 MkGraph.hit-area.test.ts 同款）。
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

function bodyOf(signatureWithBrace: string): string {
  const at = source.indexOf(signatureWithBrace);
  expect(at, `源码里找不到 ${signatureWithBrace}`).toBeGreaterThanOrEqual(0);
  const open = at + signatureWithBrace.length - 1;
  expect(source[open], '签名结尾不是 {').toBe('{');
  return balanced(open);
}

const BIND = 'function bindZrInteractions(instance: echarts.ECharts) {';

describe('点击命中：DOM 坐标折回逻辑 px（CSS zoom 补偿）', () => {
  it('捕获阶段把折好的坐标写进 zrX/zrY（zrender 见到现成坐标就直接用）', () => {
    expect(source).toContain('target.zrX = (clientX - rect.left) / scale');
    expect(source).toContain('target.zrY = (clientY - rect.top) / scale');
    // 缩放系数取自「viewport 实宽 / 逻辑宽」，不硬编码 zoom 配置
    expect(source).toContain('root.getBoundingClientRect().width / logicalW');
  });

  it('zrender 的 click 优先用 zrX/zrY，回落到 offsetX（没 zoom 时两者相等）', () => {
    expect(source).toContain('Number(zr.zrX ?? e.offsetX)');
    expect(source).toContain('Number(zr.zrY ?? e.offsetY)');
  });

  it('捕获阶段的本体判定也除回逻辑 px（否则「点这个点选中旁边那颗」）', () => {
    const body = bodyOf(BIND);
    expect(body).toContain('symbolAtPixel((ev.clientX - rect.left) / scale, (ev.clientY - rect.top) / scale)');
    expect(body).toContain('zrZoomScale(instance, hitRoot)');
  });

  it('预置 zrX 会跳过 normalizeEvent 的剩余步骤：必须自己补 zrDelta / which', () => {
    /* 实测教训（2026-11-09）：只写 zrX/zrY，zrender 的 normalizeEvent 提前 return，
       e.zrDelta 永远是 undefined → Handler.makeEventPacket 的 wheelDelta 跟着是 undefined
       → ECharts RoamController 只走 1/factor 分支，滚轮往哪边滚都变成「缩小」。 */
    expect(source).toContain('target.zrDelta == null');
    expect(source).toContain('target.zrDelta = delta ? delta / 120');
    expect(source).toContain('target.which == null');
  });

  it('补偿覆盖 zrender 监听的全部指针事件（hover / 拖拽 / 滚轮一起治）', () => {
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'click', 'wheel', 'touchstart', 'touchmove', 'touchend']) {
      expect(source).toContain(`'${type}'`);
    }
    expect(source).toContain('addEventListener(type, stampZrPoint, true)');
  });
});

describe('布局方式：力导向等比取景，不许铺满（铺满会横向拉长）', () => {
  it('series 固定在 layout:force（layout:none 会把包围盒非等比铺满取景盒）', () => {
    expect(source).toContain("layout: 'force',");
    expect(source, '不许再用 layout:none：2:1 画布上横向会被拉长 ≈2.4 倍').not.toContain("layout: pin ? 'none'");
    expect(source).not.toContain('pinnedBase');
  });

  it('取景按包围盒等比缩放（宽高取小，四周留 padding）', () => {
    const fit = bodyOf('function fitGraphView(padding = 48) {');
    expect(fit).toContain('Math.min((viewW - padding * 2) / boxW, (viewH - padding * 2) / boxH)');
  });

  it('画布尺寸变化且用户没动过视角 → 重新等比取景', () => {
    expect(source).toContain('userRoamed');
    expect(source).toMatch(/else if \(!userRoamed\) \{[\s\S]*?fitGraphView\(\)/);
  });
});
