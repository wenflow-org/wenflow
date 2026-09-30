/**
 * 校内锚（2026-09-30 广度跑批维度 G 评审驱动；2026-09-30 用户拍板改 LLM 口径）。
 *
 * 实证：教材册次/单元/考试范围此前进过上下文却没落进任何阶段目标——「在校生最需要的与
 * 课堂对表」没有发生。第一版用正则从学习者自述抽锚；用户明确「不要走正则思路，走大模型
 * 自身的推理理解能力」，故抽取改为 goal-conversation 的 understanding.school_anchor
 * （LLM 判断：学习者是否身处某套教材/考试体系、册次单元、考试范围、学校进度），
 * 经 visibleSummary → 定帧层透传。本文件只保留**锚的形状类型**与**引用覆盖观测**
 * （后者仍是确定性判据：目标/标题里有没有出现册次主体或考试关键词）。
 */
export interface PathSchoolAnchor {
  /** 教材版本+册次+单元（如「人教版三年级上册·第五单元」），无则 null */
  textbook: string | null;
  /** 考试范围与题型线索（期末/单元测/模考/高考…），原文片段 */
  examScope: string | null;
  /** 学校进度线索（讲到/下周开/已学…），原文片段 */
  schoolPace: string | null;
  /** 学习者原话证据（背景+基线原文拼合），供提示词引用而不编造 */
  evidence: string;
}






/**
 * 版本在前：「人教版三年级上册第五单元」；版本可省（口语常只说「三年级上册」）。
 * 注意：仅「初三/高中」这类学段词不构成锚——必须带册次或单元（见下方判据），
 * 否则「高中同学」这类随口一提会误触发校内锚。
 */

/** 年级在前：「三年级，人教版上册」（口语里更常见） */




function pick(texts: Array<string | null | undefined>): string[] {
  return texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim());
}

/** 阶段目标/课标题是否真的引用了锚（观测用：只 warn 不阻断） */
export function schoolAnchorCoverage(anchor: PathSchoolAnchor | null, texts: string[]): { referenced: boolean; missing: string[] } {
  if (!anchor) return { referenced: true, missing: [] };
  const joined = texts.join('|');
  const missing: string[] = [];
  if (anchor.textbook) {
    // 教材锚引用判据：册次主体（去掉版本后的「三年级上册」或「高中数学必修一」）出现在文本里
    const core = anchor.textbook.replace(/^(人教|北师大|苏教|外研|沪教|湘教|教科|鲁教|粤教|部编)版?/, '');
    const gradeTerm = core.split(/第/)[0];
    if (!joined.includes(gradeTerm) && !joined.includes(anchor.textbook)) missing.push('教材册次');
  }
  if (anchor.examScope) {
    const keyExam = anchor.examScope.match(/期末|期中|月考|单元测|单元测验|模拟考|模考|学业水平|会考|高考|中考|升学|一轮复习|二轮复习|总复习/);
    if (keyExam && !joined.includes(keyExam[0])) missing.push('考试范围');
  }
  return { referenced: missing.length === 0, missing };
}
