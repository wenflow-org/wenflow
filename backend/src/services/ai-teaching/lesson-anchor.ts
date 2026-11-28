import type { TeachingScenarioContext } from './teaching-context-types';

export type LearnerBaselineLevel = 'novice' | 'familiar' | 'unknown';

export interface LessonAnchorCriterion {
  id: string;
  text: string;
}

export interface LessonAnchor {
  version: 1;
  /** 本节主问题（来自任务标题/主题，作为开场白、白板与教学的共同聚焦） */
  mainQuestion: string;
  /** 2~3 条自然语言过关判据（由验收标准与学习目标提炼，不做死板考点标签） */
  criteria: LessonAnchorCriterion[];
  /** 学习者前置基础档位 */
  learnerBaseline: LearnerBaselineLevel;
  /** 简短基线说明（供提示词决定是否需要先铺垫语境） */
  baselineNote: string | null;
  /** 后台软关联概念（仅用于图谱、证据归档与评估，不作为前台硬打卡清单） */
  softConcepts: string[];
}

export interface AnchorSegmentLike {
  index: number;
  title: string;
}

const NOVICE_RE = /(?:零基础|没看过|没读过|未读过|未接触|没学过|初次接触|初学者|新手|beginner|小白)/i;
const FAMILIAR_RE = /(?:进阶|有基础|比较熟悉|系统学过|advanced|intermediate)/i;
const NEGATIVE_GUARD_RE = /^(?:解释中不|不要|不能|不可|不得|不出现|别用|只(?:举|写|背|说|用).{0,28}(?:不算过|不算|不给过|不计))/;

function cleanText(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

function splitByConjunction(clause: string): string[] {
  const parts = clause
    .split(/(?:，并(?:且)?|，以及|，同时)/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts : [clause];
}

function splitRawClauses(raw: string): string[] {
  const normalized = cleanText(raw);
  if (!normalized) return [];
  return normalized
    .split(/[；;。\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveBaseline(context: TeachingScenarioContext): {
  learnerBaseline: LearnerBaselineLevel;
  baselineNote: string | null;
} {
  const candidates = [
    cleanText(context.schoolAnchor?.background),
    cleanText(context.schoolAnchor?.baselineEvidence),
    cleanText(context.learnerPersona?.currentLevel),
    cleanText(context.learnerPersona?.background),
    cleanText(context.learnerPersona?.realProblem),
  ].filter(Boolean);

  const joined = candidates.join('；');
  if (!joined) return { learnerBaseline: 'unknown', baselineNote: null };

  let learnerBaseline: LearnerBaselineLevel = 'unknown';
  if (NOVICE_RE.test(joined)) learnerBaseline = 'novice';
  else if (FAMILIAR_RE.test(joined)) learnerBaseline = 'familiar';

  const bestNote = candidates.find((c) => NOVICE_RE.test(c) || FAMILIAR_RE.test(c)) || candidates[0];
  return {
    learnerBaseline,
    baselineNote: bestNote ? (bestNote.length > 80 ? `${bestNote.slice(0, 79)}…` : bestNote) : null,
  };
}

/**
 * 构建本节课的「课堂锚（LessonAnchor）」：
 * 以任务主问题 + 自然语言过关判据 + 学习者基线作为教学与白板的第一锚，
 * 将后台细粒度 KC 退回 `softConcepts` 供图谱/评估沉淀。
 */
export function buildLessonAnchor(context: TeachingScenarioContext): LessonAnchor {
  const mainQuestion = cleanText(context.taskTitle) || cleanText(context.topic) || '本节核心内容';
  const rawCriteria = cleanText(context.currentTaskContext?.acceptanceCriteria);
  const clauses = splitRawClauses(rawCriteria);

  const criteriaTexts: string[] = [];
  let pendingNegative: string[] = [];
  for (const clause of clauses) {
    if (NEGATIVE_GUARD_RE.test(clause)) {
      if (criteriaTexts.length > 0) {
        const lastIdx = criteriaTexts.length - 1;
        if (!criteriaTexts[lastIdx].includes(clause)) {
          criteriaTexts[lastIdx] = `${criteriaTexts[lastIdx]}（${clause}）`;
        }
      } else {
        pendingNegative.push(clause);
      }
      continue;
    }
    if (!criteriaTexts.includes(clause)) criteriaTexts.push(clause);
  }
  // 若正向判据只有 1 条，尝试按「，并 / ，以及 / ，同时」再拆成两段
  if (criteriaTexts.length === 1) {
    const expanded = splitByConjunction(criteriaTexts[0]);
    if (expanded.length >= 2) {
      // 如果前面已附挂过否定约束（它在最后一段末尾），拆开后天然留在最后一段
      criteriaTexts.splice(0, 1, ...expanded);
    }
  }
  if (pendingNegative.length > 0 && criteriaTexts.length > 0) {
    const lastIdx = criteriaTexts.length - 1;
    criteriaTexts[lastIdx] = `${criteriaTexts[lastIdx]}（${pendingNegative.join('；')}）`;
  }

  // 不足 2 条时，从学习目标中补充非重复的实质条款
  if (criteriaTexts.length < 2 && Array.isArray(context.taskProfile?.learningObjectives)) {
    for (const obj of context.taskProfile.learningObjectives) {
      const text = cleanText(obj);
      if (!text || NEGATIVE_GUARD_RE.test(text)) continue;
      if (!criteriaTexts.some((c) => c.includes(text) || text.includes(c))) {
        criteriaTexts.push(text);
      }
      if (criteriaTexts.length >= 3) break;
    }
  }

  // 保底至少 1 条
  if (criteriaTexts.length === 0) {
    const descFirst = cleanText(context.taskDescription).split(/[。；！？\n]/).map((s) => s.trim()).find(Boolean);
    criteriaTexts.push(descFirst || mainQuestion);
  }

  const criteria: LessonAnchorCriterion[] = criteriaTexts.slice(0, 3).map((text, idx) => ({
    id: `anc-${idx + 1}`,
    text,
  }));

  const { learnerBaseline, baselineNote } = resolveBaseline(context);

  const softSet = new Set<string>();
  for (const kc of Array.isArray(context.taskKcs) ? context.taskKcs : []) {
    const name = cleanText(kc?.name);
    if (name) softSet.add(name);
  }
  for (const seed of Array.isArray(context.taskKnowledgeSeeds) ? context.taskKnowledgeSeeds : []) {
    const name = cleanText((seed as { name?: unknown })?.name);
    if (name) softSet.add(name);
  }

  return {
    version: 1,
    mainQuestion,
    criteria,
    learnerBaseline,
    baselineNote,
    softConcepts: [...softSet],
  };
}

/**
 * 由课堂锚派生自然教学段（当板书自身未切段时使用）：
 * 只在有 ≥2 条实质判据时返回分段，避免把单薄课硬拆成碎片。
 */
export function segmentsFromAnchor(
  anchor: LessonAnchor | null | undefined,
  _taskTitle: string,
): AnchorSegmentLike[] {
  if (!anchor || !Array.isArray(anchor.criteria) || anchor.criteria.length < 2) return [];
  return anchor.criteria.slice(0, 4).map((criterion, index) => {
    const stripped = criterion.text.replace(/（[^）]*）$/g, '').trim();
    const title = stripped.length > 36 ? `${stripped.slice(0, 35)}…` : stripped;
    return {
      index: index + 1,
      title: title || `第 ${index + 1} 部分`,
    };
  });
}
