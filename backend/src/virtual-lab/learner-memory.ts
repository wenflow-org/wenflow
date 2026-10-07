/**
 * 虚拟学习者记忆回写与读取（三链统一：assisted / blackbox / quick-learn）
 *
 * 目标：让虚拟学习者「记得自己学过什么、做过什么」。
 * - writeProfileConceptsAfterLesson：课后把知识看板状态回写画像
 *   （mastered → knownConcepts；review/learning → struggleConcepts），
 *   三链共用，修复「黑盒跑完整个故事画像零更新」。
 * - buildLearnerMemorySnapshot：读取画像 + memory_traces（ACT-R 到期复习点），
 *   组装「学习者记忆快照」供 learn-turn-simulator 的 knowledgeSnapshot 消费，
 *   让虚拟学习者带着「上次学的我还记得/有点忘了」的状态上下一节课。
 * - recordCompletedArtifact：任务结算时登记「做完的事」（轻量成果物记录），
 *   故事与开场可引用，让「做完了」在虚拟学习者世界里持续存在。
 *
 * 设计边界：只做虚拟学习者侧的记忆/成果物，不改教学系统。
 * best-effort：任何失败都不阻断主流程。
 */

import prisma from '../config/database';
import { logger } from '../utils/logger';
import { simulatedNowOr } from '../services/virtual-lab/simulation-clock-context';
import { memoryTraceService } from '../services/memory/memory-trace.service';
import { recordDegradation, degradationCause, type DegradationTelemetry } from '../skills/degradation-telemetry';

/** 轻量 JSON 解析（不依赖 session-factory，避免经 blackbox-runner 的循环依赖） */
function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** 与教学端 KnowledgePointStatus 对齐的知识看板条目 */
export interface LessonKnowledgePoint {
  name: string;
  status: 'pending' | 'learning' | 'mastered' | 'review';
  progress: number;
}

/**
 * 与提示词规则 7 对齐的判定阈值（提示词与代码共用同一口径）：
 * - 概念自评 >= 0.65 且非卡住才可能记 mastered；< 0.4 视为 stuck。
 * P1-2：消费端不再写死 0.85，mastery 一律取自 curator 输出的 confidence / 学习者自述。
 */
export const MASTERED_CONFIDENCE_THRESHOLD = 0.65;
export const STUCK_MASTERY_THRESHOLD = 0.4;

/**
 * 记忆提炼 skill（curator）产出的全量概念名单（P1-2）。
 * 写回时遍历全量名单（mastered→known / struggle→struggle），
 * 而不是只吃 selfState 的单 conceptName（curator 最多 10+10 项，
 * 单概念路径结构性只沉淀 1 项）。
 */
export interface CuratedConceptLists {
  mastered?: string[] | null;
  struggling?: string[] | null;
}

/**
 * 模拟器自述的学习者状态（learn-turn-simulator 输出，收束轮持久化在私有状态轨迹里）。
 * 这是虚拟学习者「自己觉得」的状态——内部提炼的记忆来源。
 */
export interface SelfReportedLearnerState {
  /** 本节课概念（知识看板当前点，学习者自评的对照物） */
  conceptName?: string | null;
  /** 概念掌握自评 0-1（learnerState.conceptualMastery） */
  conceptualMastery?: number | null;
  /** 任务理解自评 0-1（learnerState.taskUnderstanding） */
  taskUnderstanding?: number | null;
  /** 程序性掌握自评 0-1（learnerState.proceduralMastery） */
  proceduralMastery?: number | null;
  /** 是否自认任务已完成（learnerFeedback.selfReportedTaskDone） */
  selfReportedTaskDone?: boolean | null;
  /** 自评信心 0-1（learnerFeedback.confidence） */
  confidence?: number | null;
  /** 还想要更多帮助（learnerFeedback.wantsMoreHelp） */
  wantsMoreHelp?: boolean | null;
  /** 剩余的卡点（learnerFeedback.remainingBlockers） */
  remainingBlockers?: string[] | null;
  /** 是否想要提示（learnerState.wantsHint） */
  wantsHint?: boolean | null;
}

/**
 * 内部提炼：从虚拟学习者自述状态判断「自己觉得学会了什么 / 卡在哪」。
 * 不是抄老师侧 knowledgeState，而是模拟器自己的主观认知：
 * - 概念自评高（≥0.65）且自认完成 → 归入 mastered（自己觉得学会了）
 * - 概念自评中低 / 想要提示 / 有剩余卡点 → 归入 struggle（自己觉得没学会）
 * 纯确定性规则，零 LLM。
 */
export function selfExtractLearnerMemory(
  selfState: SelfReportedLearnerState | null | undefined,
): { mastered: string[]; struggling: string[] } {
  const mastered: string[] = [];
  const struggling: string[] = [];
  if (!selfState) return { mastered, struggling };

  const concept = typeof selfState.conceptName === 'string' && selfState.conceptName.trim()
    ? selfState.conceptName.trim()
    : null;
  if (!concept) return { mastered, struggling };

  const mastery = Number(selfState.conceptualMastery);
  const taskDone = selfState.selfReportedTaskDone === true;
  const confidence = Number(selfState.confidence);
  const wantsHelp = selfState.wantsMoreHelp === true;
  const wantsHint = selfState.wantsHint === true;
  const blockers = Array.isArray(selfState.remainingBlockers) && selfState.remainingBlockers.length > 0;

  const confidentEnough = Number.isFinite(mastery)
    ? mastery >= MASTERED_CONFIDENCE_THRESHOLD
    : Number.isFinite(confidence)
      ? confidence >= 0.6
      : false;
  const stuck = wantsHelp || wantsHint || blockers || (Number.isFinite(mastery) && mastery < STUCK_MASTERY_THRESHOLD);

  if (confidentEnough && taskDone && !stuck) {
    mastered.push(concept);
  } else if (stuck || !confidentEnough) {
    struggling.push(concept);
  }
  return { mastered, struggling };
}

/**
 * 从模拟器私有状态轨迹（learnerPrivateStateTrace）中提炼收束轮的自我状态。
 * 轨迹元素结构：{ stage, taskId, state: { ...learnerState, learnerFeedback } }。
 * 取该 task 最近一个 teaching 轨迹条目；找不到时回退到整条轨迹最后一个 teaching 条目。
 */
export function extractSelfStateFromTrace(
  trace: Array<Record<string, any>> | null | undefined,
  taskId?: string | null,
): SelfReportedLearnerState | null {
  if (!Array.isArray(trace) || trace.length === 0) return null;
  const teaching = trace.filter((entry) => entry?.stage === 'teaching');
  if (teaching.length === 0) return null;

  const target = taskId
    ? [...teaching].reverse().find((entry) => String(entry?.taskId || '') === String(taskId))
    : undefined;
  const latest = target || teaching[teaching.length - 1];
  const state = (latest?.state && typeof latest.state === 'object' ? latest.state : {}) as Record<string, any>;
  const feedback = (state.learnerFeedback && typeof state.learnerFeedback === 'object'
    ? state.learnerFeedback : {}) as Record<string, any>;

  return {
    conceptName: typeof state.conceptName === 'string' ? state.conceptName
      : (typeof state.currentConcept === 'string' ? state.currentConcept : null),
    conceptualMastery: typeof state.conceptualMastery === 'number' ? state.conceptualMastery : null,
    taskUnderstanding: typeof state.taskUnderstanding === 'number' ? state.taskUnderstanding : null,
    proceduralMastery: typeof state.proceduralMastery === 'number' ? state.proceduralMastery : null,
    selfReportedTaskDone: typeof feedback.selfReportedTaskDone === 'boolean' ? feedback.selfReportedTaskDone : null,
    confidence: typeof feedback.confidence === 'number' ? feedback.confidence : null,
    wantsMoreHelp: typeof feedback.wantsMoreHelp === 'boolean' ? feedback.wantsMoreHelp : null,
    remainingBlockers: Array.isArray(feedback.remainingBlockers) ? feedback.remainingBlockers : null,
    wantsHint: typeof state.wantsHint === 'boolean' ? state.wantsHint : null,
  };
}

/** 学习者记忆快照：喂给 learn-turn-simulator 的 knowledgeSnapshot 部分 */
export interface LearnerMemorySnapshot {
  /** 已掌握概念（画像 knownConcepts ∪ memory_traces stable/mastered） */
  mastered: Array<{ name: string; status: 'mastered' }>;
  /** 到期复习点（memory_traces 保留率低于阈值，learn 侧注入 review） */
  dueReview: Array<{ name: string; status: 'review'; progress: number }>;
  /** 仍在学习 / 易混淆（画像 struggleConcepts） */
  struggling: Array<{ name: string; status: 'learning' }>;
  /** 最近完成的事项（成果物），供故事/开场引用 */
  recentCompleted: Array<{
    taskId: string | null;
    title: string;
    artifactType: string | null;
    deliverable: string | null;
    completedAt: string;
    /** 记忆提炼 skill 的一句话记忆增量 */
    memoryDelta?: string | null;
    /** 记忆提炼 skill 的自评校准说明 */
    selfCalibration?: string | null;
    /** 本课沉淀的卡点概念（与 known 名单跨表去重） */
    struggleConcepts?: string[];
    /** P2-32：curator 每项 mastered 的 evidence/confidence（记忆池「自己怎么想的」） */
    masteredEvidence?: Array<{ name: string; evidence: string; confidence: number | null }>;
    /** P2-32：curator 每项 struggle 的 blocker/severity */
    struggleEvidence?: Array<{ name: string; blocker: string; severity: string }>;
  }>;
  /** 最近完成任务的标题列表（轻量版，供模拟器自然引用） */
  recentTaskTitles: string[];
  /** 非空表示本次快照是**降级产物**（读取失败→保底值），不可当作"确实没有记忆" */
  degraded?: DegradationTelemetry[];
}

const MASTERED_STATUSES = new Set(['mastered']);
const STRUGGLE_STATUSES = new Set(['review', 'learning', 'pending']);

/**
 * P1-2：用 curator 输出构造写回用的收束轮自述状态——**不再写死 0.85 / selfReportedTaskDone=true**。
 * - conceptualMastery 取 curator masteredConcepts[0].confidence（低于阈值即 false 分支走 struggle）
 * - selfReportedTaskDone 尊重学习者原话：缺失时才按 curator confidence 判（低于阈值即 false）
 * 三链共用，避免三处各写一份 0.85 的漂移。
 */
export function deriveCuratedSelfState(
  selfState: SelfReportedLearnerState | null | undefined,
  curated: {
    mastered: Array<{ name: string; confidence: number }>;
    struggle: Array<{ name: string; blocker: string }>;
    fallbackConcept?: string | null;
  },
): SelfReportedLearnerState {
  const topMastered = curated.mastered[0] ?? null;
  const topConfidence = topMastered && Number.isFinite(Number(topMastered.confidence))
    ? Number(topMastered.confidence)
    : null;
  return {
    ...(selfState || {}),
    conceptName: topMastered?.name
      || curated.struggle[0]?.name
      || selfState?.conceptName
      || curated.fallbackConcept
      || null,
    conceptualMastery: topConfidence ?? selfState?.conceptualMastery ?? null,
    selfReportedTaskDone: selfState?.selfReportedTaskDone
      ?? (topConfidence !== null ? topConfidence >= MASTERED_CONFIDENCE_THRESHOLD : null),
    remainingBlockers: curated.struggle.length > 0
      ? curated.struggle.map((s) => s.blocker).filter(Boolean)
      : selfState?.remainingBlockers || null,
  };
}

/**
 * 课后回写画像概念：掌握 → knownConcepts，仍在学/需复习 → struggleConcepts。
 * 记忆来源优先级：
 * ① curator 输出全量名单（curatedConcepts，LLM 提炼）
 * ② 虚拟学习者「自己提炼」的自述状态（selfState）
 * ③ 老师侧 knowledgeState（仅 fallback 与成果物证据）
 * 三链共用（assisted / blackbox / quick-learn）。同名概念跨表去重，mastered 优先。
 */
export async function writeProfileConceptsAfterLesson(
  userId: string,
  knowledgePoints: LessonKnowledgePoint[],
  options: {
    source?: string;
    /** 虚拟学习者自述状态（内部提炼的优先来源） */
    selfState?: SelfReportedLearnerState | null;
    /** curator 输出的全量概念名单（P1-2：全量遍历，不再只吃单 conceptName） */
    curatedConcepts?: CuratedConceptLists | null;
  } = {},
): Promise<void> {
  if (!userId) return;
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { userId } });
    if (!profile) return;

    const mastered = new Set<string>();
    const struggling = new Set<string>();

    // ① 优先：curator 提炼的全量名单（mastered→known、struggle→struggle）
    const curatedMastered = Array.isArray(options.curatedConcepts?.mastered)
      ? options.curatedConcepts!.mastered!
      : [];
    const curatedStruggle = Array.isArray(options.curatedConcepts?.struggling)
      ? options.curatedConcepts!.struggling!
      : [];
    for (const name of curatedMastered) {
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (trimmed) mastered.add(trimmed);
    }
    for (const name of curatedStruggle) {
      const trimmed = typeof name === 'string' ? name.trim() : '';
      // 跨表去重：同名概念不得同时进 mastered 与 struggle（参考 pcl_f9826524 同名双表实录）
      if (trimmed && !mastered.has(trimmed)) struggling.add(trimmed);
    }

    // ② 次选：虚拟学习者自己提炼（selfState）
    if (options.selfState) {
      const self = selfExtractLearnerMemory(options.selfState);
      for (const name of self.mastered) {
        mastered.add(name);
        struggling.delete(name);
      }
      for (const name of self.struggling) {
        if (!mastered.has(name)) struggling.add(name);
      }
    }

    // ③ fallback：老师侧 knowledgeState（仅当上面没提炼出任何概念时）
    if (mastered.size === 0 && struggling.size === 0 && Array.isArray(knowledgePoints)) {
      for (const kp of knowledgePoints) {
        const name = String(kp?.name || '').trim();
        if (!name) continue;
        if (MASTERED_STATUSES.has(kp.status)) mastered.add(name);
        else if (STRUGGLE_STATUSES.has(kp.status) && !mastered.has(name)) struggling.add(name);
      }
    }

    // 跨表去重（最终防线）：任何路径下同名概念都不得双表共存
    for (const name of mastered) struggling.delete(name);

    if (mastered.size === 0 && struggling.size === 0) return;

    const profileData = safeJsonParse<Record<string, any>>(profile.profile, {});
    const existingKnown = Array.isArray(profileData.knownConcepts) ? profileData.knownConcepts : [];
    const existingStruggle = Array.isArray(profileData.struggleConcepts) ? profileData.struggleConcepts : [];
    const knownConcepts = Array.from(new Set([...existingKnown, ...mastered]));
    // 跨表去重（最终防线）：同名概念不得同时进 known 与 struggle（pcl_f9826524 同名双表实录）
    const knownSet = new Set<string>(knownConcepts.map((name) => String(name).trim()));
    const struggleConcepts = Array.from(
      new Set([...existingStruggle, ...struggling].filter((c) => !knownSet.has(String(c).trim())))
    );

    // 逐项比较（不能只比长度：跨表去重可能等长替换，如 ['a','b'] → ['b','c']）
    const sameList = (a: unknown[], b: unknown[]) =>
      a.length === b.length && a.every((value, index) => value === b[index]);
    if (sameList(knownConcepts, existingKnown) && sameList(struggleConcepts, existingStruggle)) {
      return;
    }

    await prisma.virtual_learner_profiles.update({
      where: { userId },
      data: {
        profile: JSON.stringify({ ...profileData, knownConcepts, struggleConcepts }),
        knownConcepts: JSON.stringify(knownConcepts),
        struggleConcepts: JSON.stringify(struggleConcepts),
        updatedAt: new Date(),
      },
    });
    logger.info(`[vlab-memory] 画像概念已回写（${options.source || 'unknown'}）`, {
      userId,
      known: knownConcepts.length,
      struggle: struggleConcepts.length,
    });
  } catch (error) {
    logger.warn('[vlab-memory] 画像概念回写失败', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 组装学习者记忆快照：
 * - 画像 knownConcepts / struggleConcepts（人设 + 历次课后回写的沉淀）
 * - memory_traces 到期复习点（ACT-R 保留率，源由教学 endSession 写入）
 * - 画像内 recentCompleted（成果物，本模块登记）
 */
export async function buildLearnerMemorySnapshot(
  userId: string,
  options: { limit?: number } = {},
): Promise<LearnerMemorySnapshot> {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(30, Math.round(Number(options.limit) || 8))) : 8;
  const empty: LearnerMemorySnapshot = {
    mastered: [],
    dueReview: [],
    struggling: [],
    recentCompleted: [],
    recentTaskTitles: [],
  };
  if (!userId) return empty;

  const degraded: DegradationTelemetry[] = [];
  const [profile, dueTraces] = await Promise.all([
    prisma.virtual_learner_profiles.findUnique({ where: { userId } }).catch((error: unknown) => {
      degraded.push(recordDegradation({
        source: 'virtual-lab/learner-memory',
        faultCategory: 'DB_READ_FAILED',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['profile'],
        mitigationApplied: 'return-empty-snapshot',
        rootCauseMessage: degradationCause(error),
      }));
      return null;
    }),
    memoryTraceService.getDueTraces(userId, { limit }).catch((error: unknown) => {
      degraded.push(recordDegradation({
        source: 'virtual-lab/learner-memory',
        faultCategory: 'DB_READ_FAILED',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['dueReview'],
        mitigationApplied: 'return-empty-due',
        rootCauseMessage: degradationCause(error),
      }));
      return [] as Awaited<ReturnType<typeof memoryTraceService.getDueTraces>>;
    }),
  ]);
  if (!profile) return degraded.length ? { ...empty, degraded } : empty;

  const profileData = safeJsonParse<Record<string, any>>(profile.profile, {});
  const knownConcepts = Array.isArray(profileData.knownConcepts) ? profileData.knownConcepts : [];
  const struggleConcepts = Array.isArray(profileData.struggleConcepts) ? profileData.struggleConcepts : [];
  const recentCompletedRaw = Array.isArray(profileData.recentCompleted) ? profileData.recentCompleted : [];

  // memory_traces 到期点优先（比画像 struggleConcepts 更「现在时」）
  const dueNames = new Set(dueTraces.map((t) => t.conceptKey));
  const mastered = knownConcepts
    .filter((name: unknown): name is string => typeof name === 'string' && !!name.trim() && !dueNames.has(name.trim()))
    .slice(0, limit)
    .map((name: string) => ({ name, status: 'mastered' as const }));
  const dueReview = dueTraces.map((t) => ({
    name: t.conceptKey,
    status: 'review' as const,
    progress: Math.round((t.retention ?? 0.5) * 100),
  }));
  const struggling = struggleConcepts
    .filter((name: unknown): name is string => typeof name === 'string' && !!name.trim() && !dueNames.has(name.trim()))
    .slice(0, limit)
    .map((name: string) => ({ name, status: 'learning' as const }));

  const recentCompleted = recentCompletedRaw
    .filter((item: any): item is Record<string, any> => !!item && typeof item === 'object')
    .slice(0, 6)
    .map((item: Record<string, any>) => ({
      taskId: typeof item.taskId === 'string' ? item.taskId : null,
      title: typeof item.title === 'string' ? item.title : '未命名事项',
      artifactType: typeof item.artifactType === 'string' ? item.artifactType : null,
      deliverable: typeof item.deliverable === 'string' ? item.deliverable : null,
      completedAt: typeof item.completedAt === 'string' ? item.completedAt : '',
      memoryDelta: typeof item.memoryDelta === 'string' ? item.memoryDelta : null,
      selfCalibration: typeof item.selfCalibration === 'string' ? item.selfCalibration : null,
      struggleConcepts: Array.isArray(item.struggleConcepts)
        ? item.struggleConcepts.filter((c: unknown): c is string => typeof c === 'string' && !!c.trim())
        : [],
      masteredEvidence: Array.isArray(item.masteredEvidence)
        ? item.masteredEvidence
            .filter((e: any) => e && typeof e.name === 'string' && e.name.trim())
            .map((e: any) => ({
              name: e.name,
              evidence: typeof e.evidence === 'string' ? e.evidence : '',
              confidence: Number.isFinite(Number(e.confidence)) ? Number(e.confidence) : null,
            }))
        : [],
      struggleEvidence: Array.isArray(item.struggleEvidence)
        ? item.struggleEvidence
            .filter((e: any) => e && typeof e.name === 'string' && e.name.trim())
            .map((e: any) => ({
              name: e.name,
              blocker: typeof e.blocker === 'string' ? e.blocker : '',
              severity: typeof e.severity === 'string' ? e.severity : '',
            }))
        : [],
    }));

  return {
    mastered,
    dueReview,
    struggling,
    recentCompleted,
    recentTaskTitles: recentCompleted.map((item) => item.title),
    ...(degraded.length ? { degraded } : {}),
  };
}

/** 记忆池展示用：curator 每项 mastered 的证据（P2-32） */
export interface MemoryCuratedMasteredItem {
  name: string;
  evidence: string;
  confidence: number;
}
/** 记忆池展示用：curator 每项 struggle 的卡点与严重度（P2-32） */
export interface MemoryCuratedStruggleItem {
  name: string;
  blocker: string;
  severity: string;
}

/**
 * P2-33：selfCalibration 自由文本 → 自评校准判决的**确定性**解析。
 *
 * 旧实现用 `includes('高估')` / `includes('低估')` 子串回声，否定与混合句一律误翻
 * （「本课未见高估」→ overconfident、「此前低估本次较准」→ underconfident）。
 *
 * 新判据（在 556 条真实 curator 输出上迭代校准）：
 * ① 方向词表：高估/偏高/偏乐观/偏自信/过度自信/高看/虚高/嘴硬 ↔ 低估/偏低/偏保守/偏谨慎/偏谦/不自信；
 * ② 否定辖域：否定词与方向词之间只允许连接/程度词（如「没有明显高估或低估」= 无偏差），
 *    「A 或 B」共享同一否定（前一个方向词被否定且仅隔连接词时，后一个一并否定）；
 * ③ 语境守卫：「可靠度/可信度/程度/水平/质量/中等」后接偏高/偏低 说的是**可靠度高低**，不是偏差方向；
 * ④ 动作词兜底：打折/下调/压低（高估）与 上修/上调（低估），用于「阶段性嘴硬，自评需略打折」这类无方向名词的句子；
 * ⑤ 两个方向同时成立 → 无法定论；无任何判据 → 未给出判决。
 * 返回 null = 不写回（同时打破「回写值即输入回声」闭环）。
 */
export function parseSelfCalibrationVerdict(
  raw: string | null | undefined,
): 'overconfident' | 'underconfident' | 'calibrated' | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;

  // 时相对照：「此前低估，本次较准」——偏差词在过去、校准词指本轮 → 判为已校准
  // （否则会被子串判据误翻成 underconfident）
  const PAST_MARKERS = /此前|之前|以前|过去|上次|以往|原来|从前/;
  const CURRENT_MARKERS = /本次|这次|本轮|本课|现在|这回|这一课|当前/;
  const CALIBRATION_ASSERTION = /较准|比较准|挺准|基本准|准确|相符|一致|吻合|对得上|客观/;
  if (PAST_MARKERS.test(text) && CURRENT_MARKERS.test(text)) {
    const currentIndex = text.search(CURRENT_MARKERS);
    const pastPart = text.slice(0, currentIndex);
    const currentPart = text.slice(currentIndex);
    const pastHasBias = /高估|偏高|低估|偏低|偏保守|偏乐观|偏自信|不自信|嘴硬/.test(pastPart);
    if (pastHasBias && CALIBRATION_ASSERTION.test(currentPart)) return 'calibrated';
  }

  // 否定词按长度降序，避免「没有」被「没」抢先
  const NEGATIONS = ['未见明显', '没有明显', '无明显', '未见', '没有', '不存在', '谈不上', '算不上', '不算', '不是', '并不', '并未', '无', '没', '不', '非'];
  const OVER_WORDS = ['高估', '偏高', '偏乐观', '偏自信', '过度自信', '高看', '虚高', '嘴硬', '过于乐观', '过度乐观'];
  const UNDER_WORDS = ['低估', '偏低', '偏保守', '偏谨慎', '偏谦', '不自信', '过于保守', '过度保守'];
  // 可靠度/程度语境下的「偏高/偏低」不是偏差方向
  const RELIABILITY_CONTEXT = /(可靠度|可信度|可靠|可信|程度|水平|质量|中等|校准度)[略稍偏很比较适中]*$/;
  // 否定词与方向词之间只允许连接/程度词
  const NEGATION_GAP = /^[\s，,、和与或也且而且乃至及很太严重过于完全任何大]{0,14}$/;
  const CONJUNCTION_GAP = /^[\s，,、和与或也及]{1,4}$/;

  const collect = (words: string[]): Array<{ word: string; start: number; end: number; negated?: boolean }> => {
    const hits: Array<{ word: string; start: number; end: number; negated?: boolean }> = [];
    for (const word of words) {
      let from = 0;
      for (;;) {
        const index = text.indexOf(word, from);
        if (index < 0) break;
        from = index + word.length;
        if ((word === '偏高' || word === '偏低') && RELIABILITY_CONTEXT.test(text.slice(Math.max(0, index - 8), index))) {
          continue;
        }
        hits.push({ word, start: index, end: index + word.length });
      }
    }
    return hits.sort((a, b) => a.start - b.start);
  };

  const overHits = collect(OVER_WORDS);
  const underHits = collect(UNDER_WORDS);
  const allHits = [...overHits, ...underHits].sort((a, b) => a.start - b.start);

  const isNegated = (hit: { start: number; end: number }): boolean => {
    for (const neg of NEGATIONS) {
      let from = 0;
      for (;;) {
        const negIndex = text.indexOf(neg, from);
        if (negIndex < 0) break;
        from = negIndex + neg.length;
        if (negIndex + neg.length > hit.start) continue;
        if (NEGATION_GAP.test(text.slice(negIndex + neg.length, hit.start))) return true;
      }
    }
    // 「没有明显高估或低估」：后一个方向词共享前一个的否定
    const position = allHits.indexOf(hit as any);
    if (position > 0) {
      const previous = allHits[position - 1];
      const between = text.slice(previous.end, hit.start);
      if (CONJUNCTION_GAP.test(between) && previous.negated) return true;
    }
    return false;
  };
  for (const hit of allHits) hit.negated = isNegated(hit);

  const hasOver = overHits.some((hit) => !hit.negated);
  const hasUnder = underHits.some((hit) => !hit.negated);
  const overAction = /打折|下调|压低|扣分|降低.{0,6}(置信|评价|把握)|不可全信|不能全信/.test(text);
  const underAction = /上修|上调|调高|加分|提高.{0,6}(置信|评价)|高于其(自述|自评|口头)/.test(text);

  if (hasOver && hasUnder) return null;
  if (hasOver) return 'overconfident';
  if (hasUnder) return 'underconfident';
  if (overAction && !underAction) return 'overconfident';
  if (underAction && !overAction) return 'underconfident';
  // 明确的自评准确表述（不含 meta 词「校准」——它出现在「记忆按此校准」这类模板句里，不构成判决）
  if (/较准|比较准|挺准|基本准|准确|相符|一致|吻合|对得上|客观/.test(text)) return 'calibrated';
  return null;
}

/**
 * 任务结算后登记「做完的事」（轻量成果物）。
 * 写入画像 profile.recentCompleted（去重 + 上限 12），供故事/开场引用。
 * 数据来源：subtasks 的验收标准 + 虚拟学习者自述掌握的提炼（best-effort）。
 */
export async function recordCompletedArtifact(input: {
  userId: string;
  taskId: string;
  taskTitle: string;
  artifactType?: string | null;
  deliverable?: string | null;
  knowledgePoints?: LessonKnowledgePoint[];
  /** 虚拟学习者自述状态（内部提炼：自己觉得掌握了什么） */
  selfState?: SelfReportedLearnerState | null;
  milestoneTitle?: string | null;
  /** 记忆提炼 skill 的 memoryDelta（一句话记忆增量） */
  memoryDelta?: string | null;
  /**
   * 记忆提炼 skill 的完整结果（供记忆池展示"自己怎么想的"）。
   * P2-32：evidence/confidence/severity 随名单一起透传落库——
   * 旧实现只留 .name/.blocker，提示词要求的证据字段被结构性丢弃。
   */
  memoryCurated?: {
    mastered: MemoryCuratedMasteredItem[];
    struggling: MemoryCuratedStruggleItem[];
    selfCalibration: string;
  } | null;
}): Promise<void> {
  if (!input.userId || !input.taskId) return;
  try {
    const profile = await prisma.virtual_learner_profiles.findUnique({ where: { userId: input.userId } });
    if (!profile) return;
    const profileData = safeJsonParse<Record<string, any>>(profile.profile, {});
    const existing = Array.isArray(profileData.recentCompleted) ? profileData.recentCompleted : [];

    const curatedMastered = Array.isArray(input.memoryCurated?.mastered)
      ? input.memoryCurated!.mastered!.filter((m) => m && typeof m.name === 'string' && m.name.trim())
      : [];
    const curatedStruggle = Array.isArray(input.memoryCurated?.struggling)
      ? input.memoryCurated!.struggling!.filter((s) => s && typeof s.name === 'string' && s.name.trim())
      : [];

    // 优先用自述提炼（内部记忆），缺失时回退老师侧 mastered 概念
    const selfExtracted = input.selfState ? selfExtractLearnerMemory(input.selfState) : null;
    const masteredNames = curatedMastered.length > 0
      ? curatedMastered.map((m) => m.name)
      : selfExtracted && selfExtracted.mastered.length > 0
        ? selfExtracted.mastered
        : (input.knowledgePoints || [])
            .filter((kp) => kp?.status === 'mastered' && typeof kp.name === 'string' && kp.name.trim())
            .map((kp) => kp.name.trim());
    // 跨表去重：同名概念不得同时进 mastered 与 struggle（参考 pcl_f9826524 同名双表实录）
    const masteredSet = new Set(masteredNames.map((n) => n.trim()));
    const struggleNames = curatedStruggle
      .map((s) => s.name)
      .filter((n) => !masteredSet.has(n.trim()));
    const entry = {
      taskId: input.taskId,
      title: input.taskTitle || '未命名事项',
      artifactType: input.artifactType || null,
      deliverable: input.deliverable || null,
      milestoneTitle: input.milestoneTitle || null,
      masteredConcepts: masteredNames.slice(0, 8),
      struggleConcepts: struggleNames.slice(0, 8),
      // P2-32：证据/卡点/严重度随名单落库（记忆池「自己怎么想的」的数据来源）
      masteredEvidence: curatedMastered.slice(0, 8).map((m) => ({
        name: m.name,
        evidence: typeof m.evidence === 'string' ? m.evidence : '',
        confidence: Number.isFinite(Number(m.confidence)) ? Number(m.confidence) : null,
      })),
      struggleEvidence: curatedStruggle
        .filter((s) => !masteredSet.has(s.name.trim()))
        .slice(0, 8)
        .map((s) => ({
          name: s.name,
          blocker: typeof s.blocker === 'string' ? s.blocker : '',
          severity: typeof s.severity === 'string' ? s.severity : '',
        })),
      memoryDelta: input.memoryDelta || null,
      selfCalibration: input.memoryCurated?.selfCalibration || null,
      completedAt: simulatedNowOr().toISOString(),
    };
    const next = [
      entry,
      ...existing.filter((item: any) => !item || item?.taskId !== input.taskId),
    ].slice(0, 12);
    profileData.recentCompleted = next;

    // TIR 反馈闭环：curator 的 selfCalibration 分析 → 回写 profile 的 selfAssessmentAccuracy。
    // P2-33：① 确定性判据（方向词 + 否定辖域 + 语境守卫 + 动作词，见 parseSelfCalibrationVerdict）；
    // ② 只写**单向判决**（overconfident / underconfident）——自由文本里的「较准/准确」不足以覆盖
    //    画像默认值 'accurate'，否则「无偏差句」会被批量写成 accurate（回声环的另一种形态）；
    // ③ 仅在判决与现值不同时写回，打破「curator 读该字段 → 产出该句 → 该句写回该字段」的回声闭环。
    const verdict = parseSelfCalibrationVerdict(input.memoryCurated?.selfCalibration);
    const directionalVerdict = verdict === 'overconfident' || verdict === 'underconfident' ? verdict : null;
    if (directionalVerdict && directionalVerdict !== profileData.selfAssessmentAccuracy) {
      profileData.selfAssessmentAccuracy = directionalVerdict;
      logger.info('[vlab-memory] 自评校准判决已回写', {
        userId: input.userId,
        verdict: directionalVerdict,
      });
    }

    await prisma.virtual_learner_profiles.update({
      where: { userId: input.userId },
      data: {
        profile: JSON.stringify(profileData),
        updatedAt: new Date(),
      },
    });
    logger.info('[vlab-memory] 已完成事项已登记', {
      userId: input.userId,
      taskId: input.taskId,
      title: input.taskTitle,
      artifactType: input.artifactType || null,
    });
  } catch (error) {
    logger.warn('[vlab-memory] 已完成事项登记失败', {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
