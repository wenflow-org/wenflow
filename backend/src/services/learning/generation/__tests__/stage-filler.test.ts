/**
 * stage filler 观测单测（R6-1）：用 2026-09-29 通宵跑批的真实标题模式校准——
 * 同对象成对课（回补→重推）不误报；同对象第三遍起、逐字复读要抓到。
 */
import { detectStageFiller, isStageFiller, titleSimilarity, normalizeTaskTitle } from '../stage-filler';

/** school-16 M2 的真实形态：首轮 7 章 + 次轮同章整合（公式推导链/综合） */
const school16M2 = [
  '盘点必修一必修二各章前置概念断裂点',
  '回补三角函数的定义与基本性质',
  '合上书重推三角函数典型例题',
  '用基础题验证三角函数掌握程度',
  '回补等差等比数列的定义与通项公式推导',
  '合上书重推数列典型例题并做基础题验证',
  '回补立体几何的空间几何体性质与判定',
  '合上书重推立体几何证明题并做基础题验证',
  '对比三角数列立体几何三章的断裂点共性',
  '回补平面向量与解三角形的前置概念',
  '合上书重推向量与解三角形例题并做基础题验证',
  '回补不等式与函数综合的前置概念',
  '合上书重推不等式与函数综合例题并做基础题验证',
  '回补导数与函数性质的前置概念',
  '合上书重推导数典型例题并做基础题验证',
  '回补统计概率与逻辑用语的前置概念',
  '合上书重推统计概率例题并做基础题验证',
  '回补三角函数与数列的公式推导链',
  '合上书重推公式推导链并做基础题验证',
  '回补立体几何与向量的综合前置概念',
  '合上书重推立体几何向量综合例题并做基础题验证',
  '回补函数与导数的综合前置概念',
  '合上书重推函数导数综合例题并做基础题验证',
  '回补数列与不等式的综合前置概念',
  '合上书重推数列不等式综合例题并做基础题验证',
  '回补解析几何的前置概念',
  '合上书重推解析几何例题并做基础题验证',
  '回补算法复数与推理证明的前置概念',
  '合上书重推复数与推理例题并做基础题验证',
  '对照必修一必修二全章梳理闭环打法适用性',
];

/** school-16 M3 干净形态（7 课，跨学科迁移） */
const cleanStage = [
  '盘点数学推导手感里能直接搬进物理的零件',
  '对照课本拆解受力分析的标准动作顺序',
  '合上书重推牛顿第二定律的公式来源',
  '用受力分析五步法拆解一道斜面基础题',
  '对照基础题答案定位自己的推导断点',
  '把数学推导闭环改写成物理力学自查清单',
  '回捞数学闭环，对照两科推导链的异同',
];

/** exam-12 三张同卡三遍（filler 实证） */
const repeatedCard = [
  '整理翻译实务的错位清单',
  '补全错位清单里漏掉的句型',
  '更新错位清单并标注高频错误',
  '做一套真题检验清单覆盖度',
  '复盘错位清单的使用效果',
];

describe('detectStageFiller（R6-1 观测，不删除）', () => {
  it('school-16 M2：同对象第三遍起被 repeatedObjects 抓住（三角函数/立体几何等）', () => {
    const r = detectStageFiller(school16M2.map((title) => ({ title })));
    expect(r.repeatedObjects.length).toBeGreaterThan(0);
    const objects = r.repeatedObjects.map((x) => x.object);
    expect(objects).toContain('三角函数');
    expect(objects).toContain('立体几何');
    // 第二遍整合是设计内的：重复对的相似度不应把整阶段打成复读
    expect(r.duplicatePairs.length).toBe(0);
    expect(isStageFiller(r)).toBe(true);
  });

  it('干净阶段零误报（M3 跨学科迁移 7 课）', () => {
    const r = detectStageFiller(cleanStage.map((title) => ({ title })));
    expect(r.duplicatePairs).toHaveLength(0);
    expect(r.repeatedObjects).toHaveLength(0);
    expect(isStageFiller(r)).toBe(false);
  });

  it('同卡三遍：标题近似命中 duplicatePairs 或对象复现', () => {
    const r = detectStageFiller(repeatedCard.map((title) => ({ title })));
    expect(isStageFiller(r)).toBe(true);
  });

  it('标题相似度：同对象不同句式（回补X/重推X）低于阈值不误报', () => {
    expect(titleSimilarity('回补三角函数的定义与基本性质', '合上书重推三角函数典型例题')).toBeLessThan(0.7);
    expect(titleSimilarity('回补三角函数的定义与基本性质', '回补三角函数与数列的公式推导链')).toBeLessThan(0.7);
    // 同章成对课（回补X前置 / 重推X例题）≈0.63：设计内循环，不得判复读
    expect(titleSimilarity('回补不等式与函数综合的前置概念', '合上书重推不等式与函数综合例题并做基础题验证')).toBeLessThan(0.7);
    // 近逐字复读必须过线
    expect(titleSimilarity('整理错位清单并标注高频错误', '整理错位清单并标注高频错误')).toBe(1);
  });

  it('归一化剥掉停用动作词与标点', () => {
    expect(normalizeTaskTitle('回补三角函数的定义与基本性质')).toBe('三角函数的定义与基本性质');
    expect(normalizeTaskTitle('（整理）错位清单：标注高频错误。')).toBe('错位清单标注高频错误');
  });

  it('空/单课不炸', () => {
    expect(detectStageFiller([]).duplicatePairs).toHaveLength(0);
    expect(detectStageFiller([{ title: '只有一个任务' }]).repeatedObjects).toHaveLength(0);
  });
});
