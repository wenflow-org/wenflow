/**
 * 图谱标签密度阈值护栏（2026-10-05）。
 *
 * 病根：阈值只看节点数（`nodes.length > 18`），不看画布面积。同一个 18 概念的单路径图，
 * 桌面 823×620 画布上标签互不打扰，390 视口挤进 345×392（面积 0.27 倍）就字压字——
 * 而 18 恰好不满足 `> 18`，全量 18 个标签照画（实测截图可见多组标签重叠）。
 *
 * 本文件锁两个边界，任一条挂了都意味着「窄屏又糊成一片」会复发：
 *  1) 宽画布阈值不变（18）——桌面行为不能被这次改动带跑；
 *  2) 窄画布阈值收到 8——18 概念必须落进「只标枢纽」档。
 */
import { describe, expect, it } from 'vitest';
import { isDenseLabelGraph } from '../MkGraph.vue';

describe('MkGraph 标签密度：窄画布更早进「只标枢纽」档', () => {
  it('宽画布阈值保持 18（桌面行为不变）', () => {
    expect(isDenseLabelGraph(18, false)).toBe(false);
    expect(isDenseLabelGraph(19, false)).toBe(true);
  });

  it('窄画布阈值收到 8：18 概念必须进密集档', () => {
    expect(isDenseLabelGraph(8, true)).toBe(false);
    expect(isDenseLabelGraph(9, true)).toBe(true);
    expect(isDenseLabelGraph(18, true)).toBe(true);
  });

  it('同一张图窄屏至少和宽屏一样密（窄屏不会更宽松）', () => {
    for (const n of [0, 1, 8, 9, 18, 19, 40, 76]) {
      if (isDenseLabelGraph(n, false)) expect(isDenseLabelGraph(n, true)).toBe(true);
    }
  });
});
