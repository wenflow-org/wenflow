/**
 * 阶段内 filler 观测（2026-09-29 通宵 R6-1，R5 容量扩容的直接后续）：
 *
 * R5-1 打开课数上限后 AI 评审实证 filler 副作用约 10-15%，四种模式：
 *   ① 同一知识对象第三遍起换说法重排（school-16「三角函数」出现 3+ 次）
 *   ② 收口动作发牌（同一张清单/卡做三遍，exam-12 CATTI）
 *   ③ 同一循环多跑轮次（exam-12 五套模拟）
 *   ④ 回锅课填空（career-01 M4 复现 M1）
 *
 * 定位与 R1 materialRefs 覆盖度观测同构：**只观测不删除**（强删会误伤合法
 * consolidation——同对象第二遍带整合视角是设计内的）。落 log + 指标计数，
 * 供 R6 后续做「修 prompt 还是加重试」的决策依据。
 *
 * 标题相似度：去动作词与标点后按字符二元组 Jaccard。中文无分词，bigram
 * 集合相似对「回补X前置概念 / 合上书重推X例题」这类同对象成对课不误报
 * （句式共享但对象不同 → 相似度低于阈值），对逐字复读与换皮重排敏感。
 */

/** 观测到的单阶段 filler 形态 */
export interface StageFillerReport {
  /** 高相似标题对（≥similarityThreshold）：逐字复读/换皮重排 */
  duplicatePairs: Array<{ a: string; b: string; similarity: number }>;
  /** 同一知识对象出现 ≥minObjectHits 次的标题组（第二遍起多是整合，第三遍起记为 filler） */
  repeatedObjects: Array<{ object: string; hits: number; titles: string[] }>;
}

const STOP_ACTIONS = [
  '回补', '重推', '重做', '验证', '梳理', '整理', '对照', '盘点', '合上书', '基础题',
  '前置概念', '综合', '闭环', '复现', '自查', '形成', '输出', '制定', '明确', '例题',
];

/** 归一化标题：去停用动作词/标点/空白，保留知识对象主体 */
export function normalizeTaskTitle(title: string): string {
  let s = String(title || '');
  for (const w of STOP_ACTIONS) s = s.split(w).join('');
  return s.replace(/[\s，。、；：:；,.;/／·\-—－()（）[\]【】"'“”‘’]/g, '');
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTaskTitle(a);
  const nb = normalizeTaskTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 抽取标题中的「知识对象」粗判：取归一化后 ≥2 字的连续片段里最长的名词性片段 */
function extractObjects(title: string): string[] {
  const n = normalizeTaskTitle(title);
  const out: string[] = [];
  // 常见学科对象词表命中（轻量、无外部依赖；覆盖跑批中实证的重复对象）
  const VOCAB = [
    '三角函数', '数列', '立体几何', '平面向量', '解三角形', '导数', '函数', '不等式',
    '解析几何', '统计概率', '复数', '算法', '集合', '逻辑用语', '力学', '电磁学',
    '电学', '欧姆定律', '语数英', '错位清单', '错题', '长投', '增值税', '申论', '资料分析',
    '数量关系', '听力', '词汇', '口语', '写作', '阅读', '分录', '民法', '刑法', '行政法',
    '挣值', '敏捷', '流程线', 'GDPR', 'SQL', 'Python', 'RAG', 'Zotero', '回归', '问卷',
  ];
  for (const v of VOCAB) if (n.includes(v)) out.push(v);
  return out;
}

export interface DetectStageFillerOptions {
  /** 标题相似度阈值（含）判为重复对，默认 0.7：同章「回补X→重推X」成对课归一化后相似度
   *  约 0.63（设计内循环，不该判复读），近逐字/换皮重排才 ≥0.7 */
  similarityThreshold?: number;
  /** 同一对象出现几次起记入 repeatedObjects，默认 3（第二遍整合合法，第三遍 filler） */
  minObjectHits?: number;
}

export function detectStageFiller(
  tasks: Array<{ title?: string }>,
  options: DetectStageFillerOptions = {},
): StageFillerReport {
  const similarityThreshold = options.similarityThreshold ?? 0.7;
  const minObjectHits = options.minObjectHits ?? 3;
  const titles = tasks.map((t) => String(t?.title || '')).filter(Boolean);
  const duplicatePairs: StageFillerReport['duplicatePairs'] = [];
  for (let i = 0; i < titles.length; i++) {
    for (let j = i + 1; j < titles.length; j++) {
      const sim = titleSimilarity(titles[i], titles[j]);
      if (sim >= similarityThreshold) duplicatePairs.push({ a: titles[i], b: titles[j], similarity: +sim.toFixed(2) });
    }
  }
  const byObject = new Map<string, string[]>();
  for (const t of titles) {
    for (const o of extractObjects(t)) {
      const arr = byObject.get(o) || [];
      if (!arr.includes(t)) arr.push(t);
      byObject.set(o, arr);
    }
  }
  const repeatedObjects: StageFillerReport['repeatedObjects'] = [];
  for (const [object, hits] of byObject) {
    if (hits.length >= minObjectHits) repeatedObjects.push({ object, hits: hits.length, titles: hits });
  }
  return { duplicatePairs, repeatedObjects };
}

export function isStageFiller(report: StageFillerReport): boolean {
  return report.duplicatePairs.length > 0 || report.repeatedObjects.length > 0;
}
