/**
 * 跨阶段复读观测单测（2026-09-29 实测驱动）。
 *
 * 背景：`detectStageFiller` 只吃**单个阶段**的标题，于是「同一节课被排在相邻两个阶段」
 * 完全不在视野内。实测 `pe-rw-acad-05`（Zotero 路径）：
 *   M1-2「在样式管理器中强制重载 AMA 11th，验证插件样式更新」
 *   M2-1「在样式管理器中强制重载 AMA 11th 样式」
 * 用本仓真实 `titleSimilarity` = **0.739（阈值 0.7 之上）**——阈值没问题，缺的是扫描范围。
 * 后果在知识点上直接可见：两节课产出同一知识点「执行样式强制重载」，80% → 100%。
 *
 * 不变量：
 * ① 跨阶段高相似对要抓到（含真实 0.739 那一对）；
 * ② 同阶段对不重复报（交给 detectStageFiller）；
 * ③ 设计内的「同对象成对课」（回补X→重推X）不误报——与单阶段检测同口径；
 * ④ 只观测不阻断：报告是数据，不抛错、不改输入。
 */
import {
  detectCrossStageFiller, isCrossStageFiller, detectStageFiller, titleSimilarity,
} from '../stage-filler';

/** 真实形态：M1-2 与 M2-1 是同一节课（Zotero 路径） */
const zoteroStages = [
  { stageNumber: 1, tasks: [
    { title: '对照预览与插入结果，定位样式变样的具体差异' },
    { title: '在样式管理器中强制重载 AMA 11th，验证插件样式更新' },
  ] },
  { stageNumber: 2, tasks: [
    { title: '在样式管理器中强制重载 AMA 11th 样式' },
    { title: '核对强制重载后插件样式是否与预览一致' },
  ] },
];

/** 合法形态：跨阶段但对象不同（不该报） */
const legitStages = [
  { stageNumber: 1, tasks: [{ title: '识别长投四情形转换的触发条件' }] },
  { stageNumber: 2, tasks: [{ title: '把长投转换框架迁移到合并报表场景' }] },
];

describe('detectCrossStageFiller · 跨阶段复读', () => {
  it('抓得到真实那一对（相似度 0.739 ≥ 0.7），并带上各自阶段号', () => {
    const r = detectCrossStageFiller(zoteroStages);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].stageA).toBe(1);
    expect(r.pairs[0].stageB).toBe(2);
    expect(r.pairs[0].similarity).toBeGreaterThanOrEqual(0.7);
    // 与真实函数口径一致（防止有人改了归一化却不知道影响了这条判据）
    expect(titleSimilarity(r.pairs[0].a, r.pairs[0].b)).toBeCloseTo(r.pairs[0].similarity, 2);
    expect(isCrossStageFiller(r)).toBe(true);
  });

  it('同阶段的高相似对不在这里报（避免与 detectStageFiller 重复计数）', () => {
    const sameStage = [{ stageNumber: 1, tasks: [{ title: '串联并联电功率计算' }, { title: '串联并联电功率计算' }] }];
    const cross = detectCrossStageFiller(sameStage);
    expect(cross.pairs).toHaveLength(0);
    // 单阶段检测器仍然抓得到
    expect(detectStageFiller(sameStage[0].tasks).duplicatePairs).toHaveLength(1);
  });

  it('跨阶段但对象不同的课不误报（合法迁移/递进）', () => {
    const r = detectCrossStageFiller(legitStages);
    expect(r.pairs).toHaveLength(0);
    expect(isCrossStageFiller(r)).toBe(false);
  });

  it('跨阶段同对象累计 ≥3 次仍记入 repeatedObjects（带阶段号）', () => {
    const r = detectCrossStageFiller([
      { stageNumber: 1, tasks: [{ title: '回补三角函数定义' }] },
      { stageNumber: 2, tasks: [{ title: '合上书重推三角函数例题' }] },
      { stageNumber: 3, tasks: [{ title: '用基础题验证三角函数掌握' }] },
    ]);
    const hit = r.repeatedObjects.find((o) => o.object === '三角函数');
    expect(hit).toBeTruthy();
    expect(hit!.stages).toEqual([1, 2, 3]);
  });

  it('空输入 / 无标题不炸（观测器不许成为新的故障点）', () => {
    expect(detectCrossStageFiller([]).pairs).toHaveLength(0);
    expect(detectCrossStageFiller([{ stageNumber: 1, tasks: [{}, { title: '' }] }]).pairs).toHaveLength(0);
  });

  it('只观测不阻断：不改输入对象', () => {
    const snapshot = JSON.stringify(zoteroStages);
    detectCrossStageFiller(zoteroStages);
    expect(JSON.stringify(zoteroStages)).toBe(snapshot);
  });
});
