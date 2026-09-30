/**
 * 校内锚抽取（2026-09-30 广度跑批维度 G 评审驱动）。
 *
 * 实证（4 条校内路径评审）：人设里的教材册次/单元/考试范围/学校进度**传进了上下文、
 * 对话层引用了，但生成的阶段目标与课标题里一次都没出现**——「在校生最需要的与课堂对表」
 * 没有发生。根因：这条链上没有结构化的 schoolAnchor，stage-designer 只拿到散文式
 * learnerProfile，提示词也无从引用。
 *
 * 做法：从 normalizedInput 的学习者自述里**确定性抽取**教材版本/册次/单元、考试范围、
 * 学校进度三类可引用要素，交给 stage-designer（提示词规则 33 引用）；抽取不到就**不注入**
 * （该键不出现，非校内路径行为与原先完全一致）。原文证据随附，防模型编造教材细节。
 *
 * 只抽取不生成：学习者没说的册次/单元绝不补全（锚的价值是"他真在这套体系里"）。
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

const VERSION = '(?:(?:人教|北师大|苏教|外研|沪教|湘教|教科|鲁教|粤教|部编)版?)?';
const GRADE = '([一二三四五六]年级|初[一二三]|高[一二三]|高中|初中|高职)';
const SUBJECT = '([语数英物化生史地政音体美心理计算机科学]{1,3})?';
const TERM = '(上册|下册|必修[一二三]|选择性必修[一二三])';
const UNIT = '(?:第?([一二三四五六七八九十]+)单元)?';
/**
 * 版本在前：「人教版三年级上册第五单元」；版本可省（口语常只说「三年级上册」）。
 * 注意：仅「初三/高中」这类学段词不构成锚——必须带册次或单元（见下方判据），
 * 否则「高中同学」这类随口一提会误触发校内锚。
 */
const TEXTBOOK_RE_A = new RegExp(`(${VERSION})${GRADE}${SUBJECT}${TERM}?${UNIT}`);
/** 年级在前：「三年级，人教版上册」（口语里更常见） */
const TEXTBOOK_RE_B = new RegExp(`${GRADE}${SUBJECT}[，,、\\s]*(${VERSION})${TERM}?${UNIT}`);
const EXAM_RE = /[^。；;\n]{0,24}(?:期末|期中|月考|单元测|单元测验|模拟考|模考|学业水平|会考|高考|中考|升学|一轮复习|二轮复习|总复习)[^。；;\n]{0,24}/g;
const PACE_RE = /[^。；;\n]{0,24}(?:讲到|学到|进行到|下周开|下周要开|已学完|刚学完|正在学|刚学|还没学|落后于|超前)[^。；;\n]{0,24}/g;

function pick(texts: Array<string | null | undefined>): string[] {
  return texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim());
}

/**
 * 从路径生成的 normalizedInput 里抽校内锚。
 * 输入形状兼容两种持久化形态（顶层 normalizedInput / 快照内嵌）。
 */
export function resolveSchoolAnchorForPathDesign(normalizedInput: unknown): PathSchoolAnchor | null {
  if (!normalizedInput || typeof normalizedInput !== 'object') return null;
  const ni = normalizedInput as Record<string, unknown>;
  const lp = (ni.learnerProfile && typeof ni.learnerProfile === 'object' ? ni.learnerProfile : {}) as Record<string, unknown>;
  const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const evidenceParts = pick([
    asText(lp.backgroundExperience),
    asText((lp.currentBaseline as Record<string, unknown> | undefined)?.evidence),
    asText(lp.surfaceGoal),
    Array.isArray(lp.painPoints) ? (lp.painPoints as unknown[]).filter((x) => typeof x === 'string').join('；') : asText(lp.painPoints),
    asText(lp.constraintsAndBoundaries),
  ]);
  const sceneRaw = ni.scene;
  const sceneParts = pick([
    typeof sceneRaw === 'string' ? sceneRaw : asText((sceneRaw as Record<string, unknown> | undefined)?.description),
  ]);
  const combined = [...evidenceParts, ...sceneParts].join('。');
  if (!combined.trim()) return null;

  // 教材版本+册次+单元：两种语序都认（版本在前 / 年级在前），取第一处命中。
  // 必须带册次或单元才算锚（「初三」「高中」这类学段词单独出现不算——见正则注释）。
  let textbook: string | null = null;
  for (const part of [...evidenceParts, ...sceneParts]) {
    // 两种语序都试；A 命中但不带册次/单元时（如「孩子三年级，人教版上册」里 A 只吃到
    // 「三年级」）继续试 B，B 才能吃到逗号后面的「人教版上册」。
    const a = part.match(TEXTBOOK_RE_A);
    const candidates = [a, a ? part.match(TEXTBOOK_RE_B) : null].filter(Boolean) as RegExpMatchArray[];
    for (const m of candidates) {
      const term = m[4];
      const unit = m[5];
      if (!term && !unit) continue;
      const gradeFirst = m === candidates[1] && candidates.length > 1 && m !== a;
      const version = gradeFirst ? m[3] : m[1];
      const grade = gradeFirst ? m[1] : m[2];
      const subject = gradeFirst ? m[2] : m[3];
      textbook = [version, grade, subject, term, unit ? `第${unit}单元` : ''].filter(Boolean).join('');
      break;
    }
    if (textbook) break;
  }
  const firstOf = (re: RegExp): string | null => {
    const m = combined.match(re);
    if (!m || !m.length) return null;
    const hit = m[0].trim();
    return hit.length >= 4 ? hit : null;
  };
  const examScope = firstOf(EXAM_RE);
  const schoolPace = firstOf(PACE_RE);
  if (!textbook && !examScope && !schoolPace) return null;
  return {
    textbook,
    examScope,
    schoolPace,
    evidence: combined.slice(0, 400),
  };
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
