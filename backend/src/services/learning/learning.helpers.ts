// 学习服务 - 模块级纯工具函数（自 learning.service.ts 抽离，行为保持不变；无 this / prisma）
import type {
  GeneratePathData,
  GoalToPathHandoffSnapshot,
  NewPathTaskType,
  ParsedPathGenerationStatus,
  PathAdjustmentEvidence,
  PathAdjustmentPolicy,
  PathCognitiveConcept,
  PathCognitiveDesign,
  PathCoreStep,
  PathNormalizedInputSnapshot,
  PathSceneFraming,
  PathSceneFramingNormalizedInput,
} from './learning.types';
import { DISPLAY_LABEL_MAP, NEW_PATH_TASK_TYPES } from './learning.constants';
import type { PathGenerationPhase } from './path-generation-status';

/**
 * 以任务分钟汇总归一「预计投入」展示时长（唯一用户可逐条核对的真实来源）：
 * - path.estimatedHours / milestone.estimatedHours 在骨架期由 path-planning LLM 粗估，
 *   与 stage-designer 逐任务产出的 estimatedMinutes 系统性脱节（无生成后校准），
 *   长期出现「路径 40h 但任务合计 12h」之类的偏差。
 * - 展示改由任务分钟汇总推导：
 *   阶段小时 = 该阶段任务分钟/60 向上取整（阶段级粗粒度，允许整点）；
 *   路径小时 = **全部任务分钟合计/60**（1 位小数）＋无任务阶段的 LLM 原值
 *   —— 不再 Σ 阶段取整值：零头各自进位会把总量抬高（走查 P8：
 *   375min=6.25h 被算成 2+2+3=7h）。
 * - 无任务或生成中（骨架期）时保留 LLM 原值（此时任务分钟尚不存在，原估是唯一参考）。
 * 原始 LLM 估算保留在 estimatedHoursRaw 供内部评估/诊断使用。
 */
export function normalizePathHoursFromTasks(
  path: { estimatedHours?: number | null; milestones?: Array<Record<string, any>> }
): { estimatedHours: number | null; estimatedHoursRaw: number | null; milestones: Array<Record<string, any>> } {
  const milestones = Array.isArray(path.milestones) ? path.milestones : [];
  const hasAnyTask = milestones.some((m: any) => Array.isArray(m?.subtasks) && m.subtasks.length > 0);

  // 阶段级归一：任务分钟 → 整小时（ceil）。无任务的阶段保留 LLM 原值。
  const normalizedMilestones = milestones.map((m: any) => {
    const tasks = Array.isArray(m?.subtasks) ? m.subtasks : [];
    const rawHours = typeof m?.estimatedHours === 'number' && m.estimatedHours > 0 ? m.estimatedHours : null;
    if (tasks.length === 0) {
      return { ...m, estimatedHours: rawHours, estimatedHoursRaw: rawHours };
    }
    const totalMinutes = tasks.reduce((sum: number, t: any) => sum + (Number(t?.estimatedMinutes) || 0), 0);
    const normalized = Math.max(1, Math.ceil(totalMinutes / 60));
    return { ...m, estimatedHours: normalized, estimatedHoursRaw: rawHours };
  });

  // 路径级归一：按**真实任务分钟**一次性换算（1 位小数），与任务明细可核对；
  // 无任务的阶段（骨架期/未展开）仍按其 LLM 原值计入，避免丢估算。
  // 旧实现是 Σ「各阶段向上取整后的小时」——每阶段的零头各自进位再累加，
  // 系统性偏高（走查 P8：45+60+45+75+60+90 = 375min = 6.25h，旧算法 2+2+3 = 7h）。
  const allTasks = normalizedMilestones.flatMap((m: any) => m?.subtasks || []);
  const rawPathHours = typeof path.estimatedHours === 'number' && path.estimatedHours > 0 ? path.estimatedHours : null;
  if (allTasks.length === 0) {
    return { estimatedHours: rawPathHours, estimatedHoursRaw: rawPathHours, milestones: normalizedMilestones };
  }
  const totalTaskMinutes = allTasks.reduce((sum: number, t: any) => sum + (Number(t?.estimatedMinutes) || 0), 0);
  const tasklessStageHours = normalizedMilestones.reduce((sum: number, m: any) => {
    const tasks = Array.isArray(m?.subtasks) ? m.subtasks : [];
    return sum + (tasks.length === 0 && typeof m?.estimatedHours === 'number' ? m.estimatedHours : 0);
  }, 0);
  const normalizedPathHours = Math.round(((totalTaskMinutes / 60) + tasklessStageHours) * 10) / 10;
  return {
    estimatedHours: Math.max(1, normalizedPathHours),
    estimatedHoursRaw: rawPathHours,
    milestones: normalizedMilestones,
  };
}

export function parsePathSummary(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const summary = parsed?.summary;
    return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
  } catch {
    return null;
  }
}

export function cleanPathTitle(title: string): string {
  const t = title.trim();
  const cleaned = t.replace(/(?:[，,、\s]*)(?:学习路径|学习计划|路径计划)$/, '').trim();
  return cleaned || t;
}

/** subject 长度上限：超过即视为把目标原文误当学科，改用路径名兜底 */
export const MAX_PATH_SUBJECT_LENGTH = 24;

/**
 * 解析学习路径 subject。
 * 背景：path-planning 的 analyzeInput 用 `input.goal` 当 subject，导致 learning_paths.subject
 * 常被写成几百字目标原文，进而污染教学 prompt、管理端内容列表与 Dashboard 路径卡副标题。
 * 规则：subject 简洁（<= MAX_PATH_SUBJECT_LENGTH）则沿用；否则用清洗后的路径名兜底。
 */
export function resolvePathSubject(subject: unknown, fallbackTitle: string): string {
  const raw = typeof subject === 'string' ? subject.trim() : '';
  if (raw && raw.length <= MAX_PATH_SUBJECT_LENGTH) return raw;
  return fallbackTitle;
}

/** JSON 列（Prisma 里是字符串）→ 对象/数组；已是对象则原样返回 */
function parseJsonColumn(value: unknown): any {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** 消息时间戳（升序，毫秒） */
function readMessageTimestamps(messages: unknown): number[] {
  const list = parseJsonColumn(messages);
  if (!Array.isArray(list)) return [];
  return list
    .map((m: any) => (m?.timestamp ? new Date(m.timestamp).getTime() : NaN))
    .filter((t: number) => Number.isFinite(t))
    .sort((a: number, b: number) => a - b);
}

/**
 * 未结束会话的活跃时长估算（口径同 AITeachingCoordinator.computeEffectiveDurationMinutes）：
 * - 结束时刻取「暂停中 → pausedAt；否则 → updatedAt（最后一次动作）」，
 *   而不是 now —— 否则把「离开之后放置的时间」越算越多；
 * - 减去累计暂停时长；
 * - 再用消息时间戳间隔（>30 分钟视为离开）给出的活跃时长封顶，
 *   防止合盖/杀进程等无 pagehide 场景把 idle 算进学习时长。
 */
function estimateActiveMinutes(
  session: { messages?: unknown; teachingState?: unknown; updatedAt?: Date | string | null } | null | undefined,
  startMs: number
): number {
  const state = parseJsonColumn(session?.teachingState);
  const artifacts = (state?.sessionArtifacts && typeof state.sessionArtifacts === 'object')
    ? state.sessionArtifacts
    : (state && typeof state === 'object' ? state : {});
  let pausedDurationMs = Number(artifacts?.pausedDurationMs ?? 0);
  if (!Number.isFinite(pausedDurationMs) || pausedDurationMs < 0) pausedDurationMs = 0;

  const times = readMessageTimestamps(session?.messages);
  const pausedAtMs = typeof artifacts?.pausedAt === 'string' ? new Date(artifacts.pausedAt).getTime() : NaN;
  const updatedAtMs = session?.updatedAt ? new Date(session.updatedAt).getTime() : NaN;
  // 终点信号优先级：暂停中 → pausedAt（那一刻离开）；否则 → updatedAt（最后一次动作）。
  // 两者都没有时，仅当有消息可封顶才允许用 now；否则不猜（返回 0，保持旧行为）。
  const endMs = Number.isFinite(pausedAtMs)
    ? pausedAtMs
    : (Number.isFinite(updatedAtMs) ? updatedAtMs : (times.length > 0 ? Date.now() : NaN));
  if (!Number.isFinite(endMs)) return 0;

  const wallMinutes = Math.max(1, Math.round((endMs - startMs - pausedDurationMs) / 60000));
  if (times.length === 0) return wallMinutes;

  let activeMinutes = 0;
  for (let i = 1; i < times.length; i++) {
    // 间隔 > 30 分钟视为离开（与 timeout-fallback 规则一致）
    activeMinutes += Math.min((times[i] - times[i - 1]) / 60000, 30);
  }
  // 首尾窗按**实测**补：首条消息前的引导段 + 最后活动后的收尾段，各封顶 10 分钟。
  // （旧实现是固定 +60 分钟，对"消息少、挂得久"的会话明显偏松——走查 N6：
  //   学习台出现「今日已学 67 / 60 分钟」这类只能靠墙钟解释的数字。）
  const leadInMinutes = Math.min(Math.max((times[0] - startMs) / 60000, 0), 10);
  const tailMinutes = Math.min(Math.max((endMs - times[times.length - 1]) / 60000, 0), 10);
  const messageCap = Math.round(activeMinutes + leadInMinutes + tailMinutes);
  return Math.max(1, Math.min(wallMinutes, messageCap));
}

/**
 * 会话有效时长（分钟）统一口径。
 *
 * 优先级：
 * 1. `duration` 列（收束时已扣除暂停/idle 并封顶）；
 * 2. `endTime − startTime`（超时等未写 duration 的历史会话），封顶 30 分钟；
 * 3. **未结束的会话**（active/paused）：按 startTime → 最后活动（扣暂停）估算，
 *    并用消息时间戳间隔封顶 —— 缺这一档时，「学了一节课后暂停/离开」在
 *    学习历史、学习台、学习状态里会显示 0 分钟
 *    （走查 P9 实测：学了约 10 分钟 → 学习历史「累计时长 0 分钟」）。
 *
 * 学习历史的「累计时长」、/learning/stats、学习状态聚合都走这里，避免各页各算。
 * 注意：调用方查询会话时需带上 status/messages/teachingState/updatedAt，
 * 否则只能退化为第 1、2 档（见 /learning/stats 与 assemble-learning-state 的 select）。
 */
export function normalizeSessionDurationMinutes(session: {
  duration?: number | null;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
  status?: string | null;
  messages?: unknown;
  teachingState?: unknown;
  updatedAt?: Date | string | null;
}): number {
  const rawDuration = session.duration ?? 0;
  if (rawDuration > 0) {
    // 历史兼容：部分会话把秒写入 duration
    return rawDuration > 24 * 60 ? Math.round(rawDuration / 60) : rawDuration;
  }
  const start = session.startTime ? new Date(session.startTime).getTime() : NaN;
  const end = session.endTime ? new Date(session.endTime).getTime() : NaN;
  if (Number.isFinite(start) && Number.isFinite(end)) {
    return Math.max(1, Math.min(30, Math.round((end - start) / 60000)));
  }
  if (!Number.isFinite(start)) return 0;
  return estimateActiveMinutes(session, start);
}

export function normalizeStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

export function normalizeConversationHistory(value: any): Array<{ role: string; content: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((message: any) => ({
      role: typeof message?.role === 'string' ? message.role : 'user',
      content: typeof message?.content === 'string' ? message.content : ''
    }))
    .filter((message: { role: string; content: string }) => message.content);
}

export function normalizeConceptText(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function buildConceptMap(cognitiveDesign: PathCognitiveDesign | null | undefined): Map<string, PathCognitiveConcept> {
  const map = new Map<string, PathCognitiveConcept>();
  const concepts = Array.isArray(cognitiveDesign?.coreConcepts) ? cognitiveDesign!.coreConcepts! : [];
  for (const concept of concepts) {
    if (!concept?.id || !concept?.name) continue;
    map.set(concept.id, concept);
  }
  return map;
}

export function resolveTaskConcept(
  linkedConceptId: string | null | undefined,
  cognitiveDesign: PathCognitiveDesign | null | undefined,
  fallbackText?: string | null | undefined
): {
  linkedConceptId: string | null;
  linkedConceptName: string | null;
  linkedConceptDescription: string | null;
  conceptSource: 'linked-concept' | 'fallback-text' | 'missing';
} {
  const conceptId = normalizeConceptText(linkedConceptId);
  const conceptMap = buildConceptMap(cognitiveDesign);
  const concept = conceptId ? conceptMap.get(conceptId) : null;

  if (concept) {
    return {
      linkedConceptId: concept.id,
      linkedConceptName: concept.name,
      linkedConceptDescription: concept.description || null,
      conceptSource: 'linked-concept'
    };
  }

  const fallback = normalizeConceptText(fallbackText);
  if (fallback) {
    return {
      linkedConceptId: conceptId,
      linkedConceptName: fallback,
      linkedConceptDescription: null,
      conceptSource: 'fallback-text'
    };
  }

  return {
    linkedConceptId: conceptId,
    linkedConceptName: null,
    linkedConceptDescription: null,
    conceptSource: 'missing'
  };
}

export function resolveMilestoneConcept(
  conceptId: string | null | undefined,
  cognitiveDesign: PathCognitiveDesign | null | undefined,
  fallbackText?: string | null | undefined
): {
  coreConceptId: string | null;
  coreConceptName: string | null;
  coreConceptDescription: string | null;
  conceptSource: 'linked-concept' | 'fallback-text' | 'missing';
} {
  const resolved = resolveTaskConcept(conceptId, cognitiveDesign, fallbackText);
  return {
    coreConceptId: resolved.linkedConceptId,
    coreConceptName: resolved.linkedConceptName,
    coreConceptDescription: resolved.linkedConceptDescription,
    conceptSource: resolved.conceptSource,
  };
}

export function inferMilestoneConceptFromTasks(tasks: any[]): string | null {
  const counts = new Map<string, number>();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const conceptId = typeof task?.linkedConcept === 'string' && task.linkedConcept.trim()
      ? task.linkedConcept.trim()
      : null;
    if (!conceptId) continue;
    counts.set(conceptId, (counts.get(conceptId) || 0) + 1);
  }

  let winner: string | null = null;
  let maxCount = 0;
  counts.forEach((count, conceptId) => {
    if (count > maxCount) {
      winner = conceptId;
      maxCount = count;
    }
  });
  return winner;
}

export function getSceneFramingNormalizedInput(sceneFraming: PathSceneFraming | null | undefined): PathSceneFramingNormalizedInput | null {
  if (!sceneFraming || !sceneFraming.normalizedInput || typeof sceneFraming.normalizedInput !== 'object') {
    return null;
  }
  return sceneFraming.normalizedInput;
}

export function isStructuredNormalizedInput(value: any): value is PathSceneFramingNormalizedInput {
  if (!value || typeof value !== 'object') return false;
  return !!(
    value.learnerProfile
    || value.problemSpace
    || value.resources
    || value.successCriteria
    || value.planningHints
  );
}

export function resolvePersistedNormalizedInput(parsedTemplate: Record<string, any> | null | undefined): PathSceneFramingNormalizedInput | null {
  const candidate = parsedTemplate?.normalizedInput;
  if (candidate && typeof candidate === 'object') {
    if (candidate.normalizedInput && isStructuredNormalizedInput(candidate.normalizedInput)) {
      return candidate.normalizedInput;
    }
    if (isStructuredNormalizedInput(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveNormalizedInputSnapshot(parsedTemplate: Record<string, any> | null | undefined): PathNormalizedInputSnapshot | null {
  const snapshot = parsedTemplate?.normalizedInputSnapshot;
  if (snapshot && typeof snapshot === 'object') {
    return snapshot as PathNormalizedInputSnapshot;
  }

  const candidate = parsedTemplate?.normalizedInput;
  if (
    candidate
    && typeof candidate === 'object'
    && (
      typeof candidate.description === 'string'
      || typeof candidate.sourceConversationId === 'string'
      || typeof candidate.timePerDay === 'string'
    )
  ) {
    return candidate as PathNormalizedInputSnapshot;
  }

  return null;
}

export function getSceneFramingFirstDeliverable(sceneFraming: PathSceneFraming | null | undefined): string | null {
  const normalizedInput = getSceneFramingNormalizedInput(sceneFraming);
  const confirmedProposalDeliverable = typeof normalizedInput?.confirmedProposal?.firstDeliverable === 'string'
    ? normalizedInput.confirmedProposal.firstDeliverable.trim()
    : '';
  if (confirmedProposalDeliverable) return confirmedProposalDeliverable;

  return typeof sceneFraming?.firstDeliverable === 'string' && sceneFraming.firstDeliverable.trim()
    ? sceneFraming.firstDeliverable.trim()
    : null;
}

export function getSceneFramingFocusSource(sceneFraming: PathSceneFraming | null | undefined): string[] {
  const normalizedInput = getSceneFramingNormalizedInput(sceneFraming);
  const keyStages = normalizeStringArray(normalizedInput?.confirmedProposal?.keyStages);
  if (keyStages.length > 0) return keyStages;

  return normalizeStringArray(sceneFraming?.planningFocus);
}

export function getSceneFramingFallbackDomain(sceneFraming: PathSceneFraming | null | undefined): string | null {
  const normalizedInput = getSceneFramingNormalizedInput(sceneFraming);
  const surfaceGoal = typeof normalizedInput?.learnerProfile?.surfaceGoal === 'string'
    ? normalizedInput.learnerProfile.surfaceGoal.trim()
    : '';
  if (surfaceGoal) return surfaceGoal;

  const realProblem = typeof normalizedInput?.problemSpace?.realProblem === 'string'
    ? normalizedInput.problemSpace.realProblem.trim()
    : '';
  if (realProblem) return realProblem;

  if (typeof sceneFraming?.cognitiveDomain === 'string' && sceneFraming.cognitiveDomain.trim()) {
    return sceneFraming.cognitiveDomain.trim();
  }

  if (typeof sceneFraming?.intent === 'string' && sceneFraming.intent.trim()) {
    return sceneFraming.intent.trim();
  }

  return null;
}

export function parsePathCognitiveDesign(raw: string | null): PathCognitiveDesign | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.cognitiveCore || parsed?.cognitiveDesign;

    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const cognitiveDomain = typeof candidate.cognitiveDomain === 'string' && candidate.cognitiveDomain.trim()
      ? candidate.cognitiveDomain.trim()
      : null;
    const coreConcepts = Array.isArray(candidate.coreConcepts)
      ? candidate.coreConcepts
          .map((concept: any, index: number) => {
            const name = typeof concept?.name === 'string' ? concept.name.trim() : '';
            if (!name) return null;
            const role = concept?.role === 'hub' ? 'hub' : 'supporting';
            const description = typeof concept?.description === 'string' && concept.description.trim()
              ? concept.description.trim()
              : undefined;
            return {
              id: typeof concept?.id === 'string' && concept.id.trim() ? concept.id.trim() : `concept-${index + 1}`,
              name,
              role,
              description,
            } as PathCognitiveConcept;
          })
          .filter(Boolean) as PathCognitiveConcept[]
      : [];

    if (!cognitiveDomain && coreConcepts.length === 0) {
      return null;
    }

    return {
      cognitiveDomain,
      coreConcepts,
    };
  } catch {
    return null;
  }
}

export function parsePathMilestoneConceptBindings(raw: string | null): Array<{ stageNumber: number; coreConcept: string | null; title?: string | null }> {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const milestones = Array.isArray(parsed?.taskChain?.milestones)
      ? parsed.taskChain.milestones
      : Array.isArray(parsed?.milestones)
        ? parsed.milestones
        : [];

    return milestones.map((milestone: any, index: number) => ({
      stageNumber: Number.isFinite(Number(milestone?.stageNumber)) ? Number(milestone.stageNumber) : index + 1,
      coreConcept: typeof milestone?.coreConcept === 'string' && milestone.coreConcept.trim() ? milestone.coreConcept.trim() : null,
      title: typeof milestone?.title === 'string' && milestone.title.trim() ? milestone.title.trim() : null,
    }));
  } catch {
    return [];
  }
}

export function parsePathAdjustmentPolicy(raw: string | null): PathAdjustmentPolicy | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.adjustmentPolicy;

    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const allowedModes = Array.isArray(candidate.allowedModes)
      ? candidate.allowedModes.filter((mode: any) => mode === 'expand' || mode === 'compress' || mode === 'replan')
      : [];
    const recommendedMode = candidate.recommendedMode === 'expand'
      || candidate.recommendedMode === 'compress'
      || candidate.recommendedMode === 'replan'
      ? candidate.recommendedMode
      : null;
    const triggerSource = candidate.triggerSource === 'learn'
      || candidate.triggerSource === 'ai-teaching'
      || candidate.triggerSource === 'learner-model-agent'
      || candidate.triggerSource === 'skill:learner-model'
      || candidate.triggerSource === 'system'
      ? candidate.triggerSource
      : null;

    if (allowedModes.length === 0 && !recommendedMode && !triggerSource) {
      return null;
    }

    return {
      allowedModes,
      recommendedMode,
      triggerSource,
    };
  } catch {
    return null;
  }
}

export function parsePathAdjustmentEvidence(raw: string | null): PathAdjustmentEvidence | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.adjustmentEvidence;

    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const pacingSignal = candidate.pacingSignal === 'fast'
      || candidate.pacingSignal === 'slow'
      || candidate.pacingSignal === 'balanced'
      ? candidate.pacingSignal
      : null;

    const evidence: PathAdjustmentEvidence = {
      stableConcepts: normalizeStringArray(candidate.stableConcepts),
      fragileConcepts: normalizeStringArray(candidate.fragileConcepts),
      strugglingConcepts: normalizeStringArray(candidate.strugglingConcepts),
      prerequisiteGaps: normalizeStringArray(candidate.prerequisiteGaps),
      pacingSignal,
    };

    if (
      evidence.stableConcepts?.length === 0
      && evidence.fragileConcepts?.length === 0
      && evidence.strugglingConcepts?.length === 0
      && evidence.prerequisiteGaps?.length === 0
      && !evidence.pacingSignal
    ) {
      return null;
    }

    return evidence;
  } catch {
    return null;
  }
}

export function buildSceneSummaryFromFraming(
  sceneFraming: PathSceneFraming | null | undefined,
  milestoneCount?: number,
  taskCount?: number,
) {
  if (!sceneFraming) return null;

  const normalizedInput = getSceneFramingNormalizedInput(sceneFraming);
  const firstDeliverable = getSceneFramingFirstDeliverable(sceneFraming);
  const focusSource = getSceneFramingFocusSource(sceneFraming);
  const outOfScope = normalizeStringArray(normalizedInput?.confirmedProposal?.outOfScope);
  const legacyExcludedScope = normalizeStringArray(sceneFraming.excludedScope);
  const surfaceGoal = typeof normalizedInput?.learnerProfile?.surfaceGoal === 'string'
    ? normalizedInput.learnerProfile.surfaceGoal.trim()
    : '';
  const realProblem = typeof normalizedInput?.problemSpace?.realProblem === 'string'
    ? normalizedInput.problemSpace.realProblem.trim()
    : '';

  return {
    // 标题用短的用户目标（surfaceGoal）；问题原文另放 problemBackground 供卡内按需展开，
    // 避免把几百字 realProblem 当卡片标题整段铺出（见 V2LearningPathDetail 设计意图卡）。
    title: surfaceGoal || realProblem || sceneFraming.intent || null,
    problemBackground: realProblem || null,
    firstDeliverable,
    targetState: normalizedInput?.successCriteria?.observableResult || sceneFraming.targetState || null,
    planningFocus: focusSource,
    excludedScope: outOfScope.length > 0 ? outOfScope : legacyExcludedScope,
    riskFlags: normalizeStringArray(sceneFraming.riskFlags),
    timeBudget: normalizedInput?.resources?.timeBudget || normalizedInput?.resources?.timePerWeek || sceneFraming.resourceProfile?.timeBudget || null,
    timeHorizon: normalizedInput?.resources?.timeHorizon || sceneFraming.resourceProfile?.timeHorizon || null,
    milestoneCount: typeof milestoneCount === 'number' ? milestoneCount : undefined,
    taskCount: typeof taskCount === 'number' ? taskCount : undefined,
  };
}

export function slugifyConceptId(value: string, fallbackIndex: number): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();

  return normalized ? `concept-${normalized}` : `concept-${fallbackIndex + 1}`;
}

export function parsePathGenerationStatus(raw: string | null): ParsedPathGenerationStatus | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    const generation = parsed?._generation;

    if (!generation || typeof generation !== 'object') {
      return null;
    }

    const normalizeStageStatus = (value: any) => {
      return value === 'pending' || value === 'processing' || value === 'succeeded' || value === 'failed'
        ? value
        : undefined;
    };

    const normalizeCoreStep = (value: any): PathCoreStep | undefined => {
      return value === 'framing' || value === 'planning' || value === 'persist' || value === 'completed'
        ? value
        : undefined;
    };

    return {
      core: normalizeStageStatus(generation.core),
      coreStep: normalizeCoreStep(generation.coreStep),
      stageDesign: normalizeStageStatus(generation.stageDesign),
      lastError: typeof generation.lastError === 'string' && generation.lastError.trim()
        ? generation.lastError.trim()
        : null,
      sourceConversationId: typeof generation.sourceConversationId === 'string'
        ? generation.sourceConversationId
        : null,
      triggerSource: typeof generation.triggerSource === 'string'
        ? generation.triggerSource
        : null,
      updatedAt: typeof generation.updatedAt === 'string' ? generation.updatedAt : null,
      stageDesignRetryCount: typeof generation.stageDesignRetryCount === 'number'
        ? generation.stageDesignRetryCount
        : 0,
      stageDesignAppendCount: typeof generation.stageDesignAppendCount === 'number'
        ? generation.stageDesignAppendCount
        : 0,
      lastStageDesignRetryAt: typeof generation.lastStageDesignRetryAt === 'string'
        ? generation.lastStageDesignRetryAt
        : null,
      scene: generation.scene && typeof generation.scene === 'object'
        ? generation.scene
        : null
    };
  } catch {
    return null;
  }
}

export function parseJsonSafe(raw: any): any {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isSuspiciousCognitiveDomain(value: string | null | undefined): boolean {
  const text = normalizeConceptText(value);
  if (!text) return false;
  return /(不会|不知道如何|缺少|问题|困难|痛点|恶化|缓解|解决|改善|针对.+功能|围绕.+模块)/.test(text);
}

export function isSuspiciousCoreConceptName(value: string | null | undefined): boolean {
  const text = normalizeConceptText(value);
  if (!text) return false;
  return /^(梳理|提炼|整合|记录|分析|学习|设计|绘制|撰写|汇总|复盘|验证)/.test(text);
}

export function parseTaskLearningObjectives(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean);
    }
    if (typeof parsed === 'string' && parsed.trim()) {
      return [parsed.trim()];
    }
  } catch {
    if (raw.trim()) return [raw.trim()];
  }
  return [];
}

export function normalizePathTaskType(value: any): NewPathTaskType | 'reading' | 'practice' | 'project' | 'quiz' {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if ((NEW_PATH_TASK_TYPES as readonly string[]).includes(normalized)) {
    return normalized as NewPathTaskType;
  }
  if (normalized === 'reading' || normalized === 'practice' || normalized === 'project' || normalized === 'quiz') {
    return normalized;
  }
  return 'execute';
}

export function buildNormalizedPathInputSnapshot(data: GeneratePathData): PathNormalizedInputSnapshot {
  const conversationHistory = Array.isArray(data.userProfile?.conversationHistory)
    ? data.userProfile.conversationHistory
        .map((message: any) => ({
          role: typeof message?.role === 'string' ? message.role : 'user',
          content: typeof message?.content === 'string' ? message.content : '',
        }))
        .filter((message: { role: string; content: string }) => message.content)
    : [];
  const sceneFramingNormalizedInput = getSceneFramingNormalizedInput(data.userProfile?.pathSceneFraming);
  const orchestratorNormalizedInput = data.userProfile?.normalizedInput && typeof data.userProfile.normalizedInput === 'object'
    ? data.userProfile.normalizedInput as PathSceneFramingNormalizedInput
    : null;

  return {
    source: data.source || (data.sourceConversationId ? 'goal' : 'api'),
    mode: data.mode || 'generate',
    description: data.description,
    subject: data.subject || null,
    deadlineText: data.deadlineText || null,
    sourceConversationId: data.sourceConversationId || null,
    existingPathId: data.existingPathId || null,
    skillLevel: data.userProfile?.skillLevel || data.userProfile?.currentSkillLevel || null,
    timePerDay: data.userProfile?.timePerDay || null,
    confirmedProposal: data.userProfile?.confirmedProposal || null,
    conversationHistory,
    normalizedInput: sceneFramingNormalizedInput || orchestratorNormalizedInput || null,
  };
}

export function buildGoalToPathHandoffSnapshot(data: GeneratePathData): GoalToPathHandoffSnapshot | null {
  if (data.source !== 'goal' && !data.sourceConversationId) {
    return null;
  }

  const handoff = data.userProfile?.goalFinalPayload;
  if (handoff && typeof handoff === 'object') {
    return {
      source: 'goal',
      mode: 'generate',
      sourceConversationId: handoff.sourceConversationId || data.sourceConversationId || null,
      existingPathId: handoff.existingPathId || data.existingPathId || null,
      rawGoal: typeof handoff.rawGoal === 'string' ? handoff.rawGoal : data.description,
      finalUserVisible: typeof handoff.finalUserVisible === 'string' ? handoff.finalUserVisible : null,
      visibleSummary: handoff.visibleSummary || null,
      conversationHistory: Array.isArray(handoff.conversationHistory)
        ? handoff.conversationHistory
        : Array.isArray(data.userProfile?.conversationHistory)
          ? data.userProfile.conversationHistory
          : [],
      prerequisiteCheckResults: Array.isArray(handoff.prerequisiteCheckResults)
        ? handoff.prerequisiteCheckResults
        : (Array.isArray(data.userProfile?.normalizedInput?.prerequisiteCheckResults)
          ? data.userProfile.normalizedInput.prerequisiteCheckResults
          : null),
      goalHandoffFields: handoff.goalHandoffFields && typeof handoff.goalHandoffFields === 'object'
        ? handoff.goalHandoffFields
        : null,
    };
  }

  return {
    source: 'goal',
    mode: 'generate',
    sourceConversationId: data.sourceConversationId || null,
    existingPathId: data.existingPathId || null,
    rawGoal: data.description,
    finalUserVisible: null,
    visibleSummary: null,
    conversationHistory: Array.isArray(data.userProfile?.conversationHistory) ? data.userProfile.conversationHistory : [],
    prerequisiteCheckResults: Array.isArray(data.userProfile?.normalizedInput?.prerequisiteCheckResults)
      ? data.userProfile.normalizedInput.prerequisiteCheckResults
      : null,
    goalHandoffFields: null,
  };
}

export function normalizeStageTraceStatus(value: any): 'started' | 'succeeded' | 'failed' | null {
  return value === 'started' || value === 'succeeded' || value === 'failed' ? value : null;
}

export function normalizeStageTracePhase(value: any): PathGenerationPhase | null {
  if (value === 'core' || value === 'stageDesign') return value;
  if (value === 'enrichment') return 'stageDesign';
  return null;
}

/** 解析 path.aiPromptTemplate 中持久化的 JSON 模板（坏数据/空值返回空对象，绝不抛错） */
export function parsePathPromptTemplate(raw: string | null): Record<string, any> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 由 knowledgeType × cognitiveLevel 查展示标签（DISPLAY_LABEL_MAP），无映射返回 null */
export function generateDisplayLabel(knowledgeType?: string | null, cognitiveLevel?: string | null): string | null {
  if (!knowledgeType || !cognitiveLevel) return null;
  const typeMap = DISPLAY_LABEL_MAP[knowledgeType];
  if (typeMap && typeMap[cognitiveLevel]) {
    return typeMap[cognitiveLevel];
  }
  return null;
}
