/**
 * 教学知识点状态机纯函数域（架构审计 §5 行动 #2：AITeachingCoordinator 按领域拆分）
 *
 * 职责：知识点状态归一（normalizeKnowledgePoints/cloneKnowledgePoints）、冻结态解冻
 * （normalizeFrozenKnowledgeState）、模型输出的知识增量计算（computeKnowledgeDelta：
 * 新点并入/进展推进/可疑点判别）、过早下一步话术检测与知识状态对账（reconcile*）。
 * MAX_KNOWLEDGE_POINTS 为合并上限护栏。自 AITeachingCoordinator 头部迁出，行为不变。
 */
import type { TeachingKnowledgePointState } from './TeachingSessionRepository';
import type { TeachingScenarioContext } from './TeachingContextBuilder';
import type { TeachingTurnOutput } from '../../skills/teaching-turn';

export interface KnowledgePointStatus {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

export function normalizeKnowledgePoints(points: TeachingKnowledgePointState[]): KnowledgePointStatus[] {
  return points.map((point) => ({
    name: point.name,
    status: point.status,
    progress: point.progress,
  }));
}

export function cloneKnowledgePoints(points: TeachingKnowledgePointState[] | null | undefined): TeachingKnowledgePointState[] {
  if (!Array.isArray(points)) return [];
  return points
    .filter((point) => point && typeof point.name === 'string' && point.name.trim())
    .map((point) => ({
      name: point.name.trim(),
      status: point.status,
      progress: Number.isFinite(point.progress) ? Number(point.progress) : 0,
    }));
}

/** 合并后知识点的总数上限（防止模型每轮新增点导致无限膨胀） */
export const MAX_KNOWLEDGE_POINTS = 12;

export function normalizeFrozenKnowledgeState(
  frozenPoints: TeachingKnowledgePointState[] | null | undefined,
  currentPoints: TeachingKnowledgePointState[] | null | undefined,
): TeachingKnowledgePointState[] {
  const frozen = cloneKnowledgePoints(frozenPoints);
  const current = cloneKnowledgePoints(currentPoints);
  if (frozen.length === 0) {
    return current.slice(0, MAX_KNOWLEDGE_POINTS);
  }

  const frozenMap = new Map(
    frozen.map((point) => [point.name.trim().toLowerCase(), point])
  );
  const currentMap = new Map(
    current.map((point) => [point.name.trim().toLowerCase(), point])
  );

  const merged = frozen.map((point, index) => {
    const currentPoint = currentMap.get(point.name.trim().toLowerCase());
    return {
      name: point.name,
      status: currentPoint?.status || point.status || (index === 0 ? 'learning' : 'pending'),
      progress: currentPoint ? Math.max(point.progress || 0, currentPoint.progress || 0) : (point.progress || 0),
    };
  });

  // 保留模型/合并中新出现的点（不在种子集合里）：追加到末尾，避免新发现被静默丢弃
  for (const currentPoint of current) {
    if (!frozenMap.has(currentPoint.name.trim().toLowerCase())) {
      merged.push({ ...currentPoint });
    }
    if (merged.length >= MAX_KNOWLEDGE_POINTS) break;
  }
  return merged;
}

export function hasPrematureNextStepLanguage(reply: string): boolean {
  if (!reply || typeof reply !== 'string') return false;
  const text = reply.trim();
  if (!text) return false;

  const patterns = [
    /进入下一环节/,
    /进入下一个环节/,
    /进入下一步任务/,
    /进入下一个任务/,
    /接下来.*下一环节/,
    /接下来.*下一个任务/,
    /后续.*下一个任务/,
  ];

  return patterns.some((pattern) => pattern.test(text));
}

export function computeKnowledgeDelta(
  initialPoints: TeachingKnowledgePointState[],
  finalPoints: TeachingKnowledgePointState[]
) {
  const initialMap = new Map(initialPoints.map((point) => [point.name, point]));
  const finalMap = new Map(finalPoints.map((point) => [point.name, point]));
  const names = Array.from(new Set([...initialMap.keys(), ...finalMap.keys()]));

  const newlyMastered: string[] = [];
  const movedToReview: string[] = [];
  const stillLearning: string[] = [];
  const unchangedMastered: string[] = [];

  for (const name of names) {
    const before = initialMap.get(name);
    const after = finalMap.get(name);
    if (!after) continue;

    if (after.status === 'mastered') {
      if (!before || before.status !== 'mastered') {
        newlyMastered.push(name);
      } else {
        unchangedMastered.push(name);
      }
      continue;
    }

    if (after.status === 'review' && before?.status !== 'review') {
      movedToReview.push(name);
      continue;
    }

    if (after.status === 'learning' || after.status === 'pending') {
      stillLearning.push(name);
    }
  }

  return {
    newlyMastered,
    movedToReview,
    stillLearning,
    unchangedMastered,
  };
}

function normalizeConcept(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function pruneOverlyBroadCoreConceptPoints(
  points: TeachingKnowledgePointState[],
  coreConcept: string | null,
): TeachingKnowledgePointState[] {
  const normalizedCoreConcept = normalizeConcept(coreConcept);
  const normalizedPoints = points.filter((point) => normalizeConcept(point.name));

  if (!normalizedCoreConcept) {
    return normalizedPoints;
  }

  const hasFinerPoint = normalizedPoints.some((point) => normalizeConcept(point.name) !== normalizedCoreConcept);
  if (!hasFinerPoint) {
    return normalizedPoints;
  }

  const filtered = normalizedPoints.filter((point) => normalizeConcept(point.name) !== normalizedCoreConcept);
  return filtered.length > 0 ? filtered : normalizedPoints;
}

export function reconcileTeachingKnowledgeState(
  context: TeachingScenarioContext,
  output: TeachingTurnOutput,
  existingPoints: TeachingKnowledgePointState[]
) {
  const coreConcept = context.taskProfile.coreConcept || context.taskProfile.linkedConceptName || null;
  const filteredOutputPoints = pruneOverlyBroadCoreConceptPoints(output.knowledge.points, coreConcept).slice(0, 5);
  const filteredExistingPoints = pruneOverlyBroadCoreConceptPoints(existingPoints, coreConcept);
  const normalizedCurrentPoint = normalizeConcept(output.knowledge.currentPoint || null);
  const currentPointExists = !!normalizedCurrentPoint && [
    ...filteredOutputPoints,
    ...filteredExistingPoints,
  ].some((point) => normalizeConcept(point.name) === normalizedCurrentPoint);

  const currentPoint = currentPointExists
    ? output.knowledge.currentPoint
    : filteredOutputPoints[0]?.name || filteredExistingPoints[0]?.name || null;

  return {
    teachingOutput: {
      ...output,
      knowledge: {
        ...output.knowledge,
        currentPoint,
        points: filteredOutputPoints,
      }
    } as TeachingTurnOutput,
    existingPoints: filteredExistingPoints,
  };
}
