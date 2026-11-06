/**
 * 知识图谱「点击热区 + 画布光标」实现护栏（2026-11-06 复核回归）。
 *
 * 病根（jsdom 实测：node + SVG renderer 起一张 force 图后读内部结构）：
 *  1) graph 节点 `getLayout()` 返回的是**数组** `[x, y]`（echarts 6.1.0
 *     data/Graph.js:462 的 getLayout → data.getItemLayout；circular/force/simple 三个
 *     布局助手都用 `setLayout([x, y])`）。旧写法按 `l.x` 读值，`typeof l.x` 恒为
 *     undefined → 20px 点击热区整段跳过，点在节点符号外 6~20px 的「热区」里被当成
 *     空白点击、反而清空当前选中（§5 规则静默失效，页面看起来"改过了"）。
 *  2) zrender 把 hover 光标写在它自建的 viewport 子 div 上（Handler.mousemove →
 *     HandlerProxy.setCursor → `painter.getViewportRoot()`，canvas/Painter.js:121 把该
 *     div append 到组件那层 div 里）。写在外层组件 div 的 cursor 会被子 div 的 inline
 *     'default' 盖掉 → 空白画布永远显示箭头，grab / grabbing 看不见。
 *
 * 两个都是「改在源码里但不生效」的坑，组件测试摸不到（jsdom 无 canvas 渲染），
 * 所以与 MkGraph.label-backing.test.ts 同款：按源码锁实现要点。
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

/** 函数体：从签名的结尾 `{` 取到配平的 `}`（签名里含返回类型对象，不能找「第一个 {」） */
function bodyOf(signatureWithBrace: string): string {
  const at = source.indexOf(signatureWithBrace);
  expect(at, `源码里找不到 ${signatureWithBrace}`).toBeGreaterThanOrEqual(0);
  const open = at + signatureWithBrace.length - 1;
  expect(source[open], '签名结尾不是 {').toBe('{');
  return balanced(open);
}

const NODE_NEAR_SIGNATURE = 'function nodeNearPixel(x: number, y: number, radius: number): MkGraphNode | null {';
const LAYOUT_POINT_SIGNATURE = 'function layoutPoint(l: unknown): { x: number; y: number } | null {';

describe('知识图谱：点击热区 r>=20（布局是 [x,y] 数组，不能按 .x 读）', () => {
  it('热区半径常量存在且 >= 20', () => {
    const m = /const NODE_HIT_RADIUS = (\d+)/.exec(source);
    expect(m, '找不到 NODE_HIT_RADIUS').toBeTruthy();
    expect(Number(m![1]), '热区半径小于 20px 达不到 §5 的 r>=20').toBeGreaterThanOrEqual(20);
  });

  it('布局解析走数组安全入口（layoutPoint 认 Array.isArray）', () => {
    const body = bodyOf(LAYOUT_POINT_SIGNATURE);
    expect(body, 'layoutPoint 没有认数组形状：graph 的 getLayout() 就是 [x, y]').toContain('Array.isArray');
  });

  it('热区命中用 layoutPoint 取坐标，且按半径参数判定', () => {
    const body = bodyOf(NODE_NEAR_SIGNATURE);
    expect(body, '热区没有走 layoutPoint：按 l.x 读会恒 undefined，整段跳过').toContain('layoutPoint(');
    expect(body, '热区没有用半径参数判定距离').toContain('radius');
    expect(body, '仍在按 l.x 读布局（数组形状下恒 undefined）').not.toMatch(/\bl\.x\b/);
  });

  it('热区判定传入 NODE_HIT_RADIUS（20px）', () => {
    const body = bodyOf('function bindZrInteractions(instance: echarts.ECharts) {');
    expect(body, '热区调用没有传 NODE_HIT_RADIUS').toContain('nodeNearPixel(x, y, NODE_HIT_RADIUS)');
  });

  it('空白点击接在 zrender 上（ECharts 对无 target 的 click 不派发事件）', () => {
    const body = bodyOf('function bindZrInteractions(instance: echarts.ECharts) {');
    expect(body, '没有 zr click 兜底：空白处的点击到不了 chart.on(click)').toContain("zrender.on('click'");
    expect(body).toContain('nodeNearPixel');
  });
});

describe('知识图谱：画布光标写在 zrender 的 viewport 元素上', () => {
  it('取 painter.getViewportRoot() 作为光标写入目标', () => {
    const body = bodyOf('function bindZrInteractions(instance: echarts.ECharts) {');
    expect(body, '没有取 getViewportRoot()：写外层 div 会被 zrender 子 div 的 inline cursor 盖掉').toContain(
      'getViewportRoot()'
    );
    expect(body, '光标没有写到 viewport 元素上').toContain('cursorTarget.style.cursor');
  });

  it('不再把 cursor 写在组件外层 div 上（无效写法）', () => {
    expect(source, 'el.value.style.cursor 写在外层，会被 zrender viewport 的 inline default 盖掉').not.toContain(
      'el.value.style.cursor'
    );
  });

  it('空白 grab / 拖拽 grabbing / 有 target 不插手（保留节点的 pointer）', () => {
    const body = bodyOf('function bindZrInteractions(instance: echarts.ECharts) {');
    expect(body).toContain("'grab'");
    expect(body).toContain("'grabbing'");
    // 有 target 时必须早退，不能把 data cursor（pointer）覆盖掉
    expect(body).toMatch(/if \(e\.target\) return/);
  });
});
