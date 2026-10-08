/**
 * 教学回合引擎（架构审计 §5 行动 #2：AITeachingCoordinator 按领域拆分）
 *
 * 职责：开场生成（generateOpening：模式决策 + LLM + 确定性兜底 + 超时护栏）与
 * 学生消息处理主回路（processStudentMessage：输入围栏 → 教学回合 LLM → 阶段推进 →
 * 检查点出题/判分挂载 → 知识增量与暖场合并 → 状态与事件落库）。
 * 两函数不触及 orchestrator 实例状态（纯数据进出 + 仓储/服务协作），按普通函数迁出；
 * facade 保留同名委托，行为与拆分前逐一等价。
 */
import { logger } from '../../utils/logger';
import { runBackgroundTask } from '../background-task-tracker.service';
import { executeSkill, executeSkillWithResult, auxSkillDefinitionMap, peerAgentDefinition } from '../../skills';
import { teachingTurnAgentDefinition } from '../../skills/teaching-turn';
import type { SessionWrapupArtifact } from '../../skills/session-wrapup';
import { TeachingOperationLeaseGuard } from './TeachingOperationLeaseGuard';
import { teachingSessionRepository, type TeachingSessionRecord, type TeachingImage, type TeachingDiagram } from './TeachingSessionRepository';import { knowledgeStateService, COMPLETION_TARGET_PROGRESS_FLOOR } from './KnowledgeStateService';
import { peerTriggerService } from './PeerTriggerService';
import { buildTeachingScenarioContext, type TeachingScenarioContext } from './TeachingContextBuilder';
import { fenceLearnerMessagesForModel } from './input-fence';
import { memoryTraceService } from '../memory/memory-trace.service';
import { recordMisconceptions, rerouteMisconceptionConceptKey } from '../learner/misconception-ledger.service';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { CHECKPOINT_MAX_ATTEMPTS, parseSessionArtifacts, resolveCheckpointConceptAttribution } from './checkpoint-shared';
import { shouldDeferCompletionForClosure } from './teaching-closure';
import {
  promoteSupplementSlot,
  fetchSupplementMaterial,
  type SupplementSlot,
} from './teaching-supplement.service';
import {
  TeachingCheckpoint,
  buildCheckpointCodeArbitration,
  checkpointForMessageResult,
  getPendingCheckpoint,
  inheritTeachingState,
  recordAnchorProbeResult,
  recordCheckpointAttemptEvidence,
  recordCheckpointResultEvidence,
  resolveAnchorProbeTarget,
  resolveCheckpointConsumption,
  shouldEmitCheckpoint,
  } from './teaching-checkpoint';
import {
  extractWarmupOutcomes,
  markWarmupAsked,
  mergeWarmupOutcomes,
  pendingWarmupForModel,
  resolveTurnMemoryWarmup,
  stripWarmupPoints,
} from './teaching-warmup';
import {
  LearnStage,
  buildClassroomContext,
  buildClassroomEvent,
  buildLearnerStateContext,
  buildPathBackgroundContext,
  buildTeachingControlContext,
  deriveTeachingRuntimeSignals,
  detectEndIntent,
  determineNextStage,
  extractTeachingStateMetrics,
  withTimeout,
  withTimeoutSignal,
} from './teaching-classroom-flow';
import {
  KnowledgePointStatus,
  cloneKnowledgePoints,
  hasPrematureNextStepLanguage,
  normalizeFrozenKnowledgeState,
  normalizeKnowledgePoints,
  reconcileTeachingKnowledgeState,
} from './teaching-knowledge-state';
import { buildDeterministicOpening, pickPeerStrategy, collectPeerHistory, OPENING_GENERATION_TIMEOUT_MS, COMPLETION_TURNS_BACKSTOP } from './teaching-session-views';
import { generateTeachingVisual, buildVisualOpportunity, detectExerciseLeakInReply } from './teaching-visual.service';
import type { TeachingOpening, ProcessStudentMessageOptions } from './AITeachingCoordinator';
import { normalizeTaskTypeForMetrics } from './AITeachingCoordinator';
import { learningStateService, type LearningStateMetrics } from '../learning/learning-state.service';
import type { TeachingSessionMessage } from './TeachingSessionRepository';
import type { TeachingTurnOutput } from '../../skills/teaching-turn';
import { findArithmeticMismatches, describeMismatchesForRepair } from './teaching-arithmetic-guard';
import { recordDegradation } from '../../skills/degradation-telemetry';
import type { ReplanAdvisory } from './ReplanAdvisoryService';
import {
  AI_TEACHING_AGENT_ID,
  appendTimestamp,
  buildTeachingTurnInput,
  extractPeerDebug,
  extractTeachingOutput,
  extractTeachingPromptDebug,
  requireTeachingRevision,
} from './teaching-turn-shared';

/**
 * 软收口知识地板（2026-09-25 训练局 P1）：老师语义明确收课且无 pending 点时，
 * 平均目标进度达到此值即允许完成。低于硬门禁（80）但高于"刚起步"（30 上下）——
 * 轻量任务（单知识点）常停在 70，硬门禁永远够不着，课就永远收不了。
 */
const SOFT_COMPLETION_PROGRESS_FLOOR = 60;
/**
 * scope-out 最小轮数：开课种子注入的范围外点（后续章节概念）要在这个轮数之后
 * 仍「pending+零进度+从未申报」才允许摘出收束判定。太松会误摘教师计划后置教的点，
 * 太紧则单点轻量任务等不到排除。4 轮 = 教师有充足机会触碰范围内任一点。
 */
export const COMPLETION_SCOPE_OUT_MIN_TURNS = 4;

/**
 * 算式修复重调预算（2026-10-08 内容正确性专项）：主回合 300s 硬帽内，
 * 已耗时 <150s 才允许重调，重调自身 90s 超时——总耗时恒不破 300s 帽。
 */
const ARITHMETIC_REPAIR_BUDGET_MS = 150_000;
const ARITHMETIC_REPAIR_TIMEOUT_MS = 90_000;

/**
 * 收束判定的「本课范围」视图（纯函数，供单测）。
 * 开课种子会把画像 struggleConcepts（往往是后续章节的概念）注入目标集，单任务课堂
 * 可能整节都教不到——这些点把 noPendingPoints/平均进度永久压死，三条收束路径全部失效
 * （实测：西瓜书绪论课被第 2-3 章种子点卡到 40 轮 timebox 硬跳，XIAOCHEN-REVIEW-20261002 P0-1）。
 * 排除判据：本轮教师申报里没有它（本轮在教=在范围内），且已过 COMPLETION_SCOPE_OUT_MIN_TURNS 轮。
 */
export function resolveCompletionScope<T extends { name: string; status?: string; progress?: number }>(
  mergedKnowledge: T[],
  declaredThisTurnNames: Iterable<string>,
  teachingTurns: number
): { inScope: T[]; outOfScopeNames: Set<string> } {
  const declared = new Set(
    Array.from(declaredThisTurnNames).map((name) => String(name || '').trim().toLowerCase()).filter(Boolean)
  );
  const isOutOfScope = (point: { name: string; status?: string; progress?: number }): boolean => {
    if (teachingTurns < COMPLETION_SCOPE_OUT_MIN_TURNS) return false;
    if (declared.has(point.name.trim().toLowerCase())) return false;
    return point.status === 'pending' && (Number(point.progress) || 0) === 0;
  };
  const inScope = mergedKnowledge.filter((point) => !isOutOfScope(point));
  const outOfScopeNames = new Set(
    mergedKnowledge.filter((point) => isOutOfScope(point)).map((point) => point.name.trim().toLowerCase())
  );
  return { inScope, outOfScopeNames };
}
/** 老师"今天就到这儿 / 这一节就齐了"式收课话术（reply 里出现即视为收课信号） */
const CLOSING_REPLY_PATTERNS: RegExp[] = [
  /今天(就)?(到这儿|到这里|收到这儿|就到这)/,
  /这节课?(就)?(到这儿|到这里|结束了)/,
  /这一?节(就)?齐了/,
  /(我们)?(先|就)(到这|到这里)/,
];

export async function generateOpening(context: TeachingScenarioContext): Promise<TeachingOpening> {
  const runtimeSignals = deriveTeachingRuntimeSignals(context);
  const openingMode: TeachingOpening['mode'] = context.taskType === 'project'
    || context.taskType === 'practice'
    || runtimeSignals.confidenceLevel === 'anxious'
    ? 'example-first'
    : runtimeSignals.recentTrend === 'improving'
      && runtimeSignals.recommendedPacing !== 'slow'
      ? 'predict'
      : 'self-assess';
  let parsed: any = null;
  try {
    const result = await withTimeoutSignal(
      (signal) => executeSkillWithResult(auxSkillDefinitionMap['teaching-opening-generator'], {
        subject: context.subject,
        topic: context.topic,
        taskTitle: context.taskTitle,
        taskDescription: context.taskDescription,
        taskType: context.taskType,
        pathSummary: context.pathProgress.pathSummary,
        currentMilestoneTitle: context.pathProgress.currentMilestoneTitle,
        learner: {
          confidenceLevel: runtimeSignals.confidenceLevel,
          recentTrend: runtimeSignals.recentTrend,
          recommendedPacing: runtimeSignals.recommendedPacing,
        },
        openingMode,
        ...(context.learningSignal ? { learningSignal: context.learningSignal } : {}),
        ...(context.lastLessonRecap ? { lastLessonRecap: context.lastLessonRecap } : {}),
        ...(context.priorLearningContext ? { priorLearningContext: context.priorLearningContext } : {}),
        __prompt: {
          userId: context.userId,
          taskId: context.taskId,
          requestPath: '/services/ai-teaching/generate-opening',
          callerAgentId: AI_TEACHING_AGENT_ID,
        },
      }, { abortSignal: signal }),
      OPENING_GENERATION_TIMEOUT_MS,
      'OPENING_GENERATION_TIMEOUT'
    );
    parsed = result.success && result.output ? result.output : null;
  } catch (error) {
    // 开场生成失败：降级为确定性开场兜底，保证开课链路在模型不可用时仍可用。
    logger.warn('[AITeaching] 开场交互块生成失败，降级为确定性开场', {
      error: error instanceof Error ? error.message : String(error),
      userId: context.userId,
      taskId: context.taskId,
      topic: context.topic,
    });
    return buildDeterministicOpening(context);
  }

  if (parsed) {
    return parsed as TeachingOpening;
  }

  logger.warn('[AITeaching] 开场交互块缺少有效结构，降级为确定性开场', {
    userId: context.userId,
    taskId: context.taskId,
    topic: context.topic,
  });
  return buildDeterministicOpening(context);
}

export async function processStudentMessage(
  sessionId: string,
  message: string,
  options: ProcessStudentMessageOptions = {},
): Promise<{
  analysis: TeachingTurnOutput['analysis'];
  aiResponse: string;
  /** 教学配图（owner 口径：图片是一种特殊的文字）——本轮老师临场要给学生看的一张图，内联在回复里 */
  images?: TeachingImage[];
  /** 课堂结构图（2026-09-27 双通道重构）——mermaid 源码，前端确定性渲染，内联在回复里 */
  diagrams?: TeachingDiagram[];
  strategies: string[];
  knowledgePoint: string | null;
  knowledgePoints: KnowledgePointStatus[];
  isCompletion: boolean;
  currentState: LearningStateMetrics;
  peerTriggered: boolean;
  peerMessage?: string;
  promptDebug?: any;
  peerDebug?: any;
  shouldConfirmEnd?: boolean;
  endReason?: 'completion-candidate' | 'learner-requested-end' | null;
  autoEnded?: boolean;
  recovered?: boolean;
  checkpoint?: TeachingCheckpoint | null;
  wrapup?: SessionWrapupArtifact & {
    stateUpdate: LearningStateMetrics | null;
    duration: number;
    summarySource: 'model' | 'fallback';
    evaluationSource: 'model' | 'ai-fallback' | 'failed' | 'unavailable';
  };
  advisory?: ReplanAdvisory;
  revision: number;
  checkpointResolution?: {
    passed: boolean;
    understanding: number;
  };
}> {
  const operationClaim = options.operationClaim || await teachingSessionRepository.claimOperation(
    sessionId,
    options.checkpointId ? `checkpoint:${options.checkpointId}` : 'message',
    ['active', 'timeout'],
    requireTeachingRevision(options.expectedRevision)
  );
  // P2：回合期间心跳续租。操作租约已缩短到 2 分钟，教学回合可能含多次 LLM 调用跑几分钟，
  // 不续租会被并发请求误判为陈旧而抢占（进程崩溃则无人续租，最多 2 分钟自动释放）。
  const operationLeaseGuard = new TeachingOperationLeaseGuard(sessionId, operationClaim.operationId);
  operationLeaseGuard.start();
  let committed = false;

  try {
    const session = operationClaim.session;
    const recovered = session.status === 'timeout';
    if (recovered) {
      logger.info('[AITeaching] 会话超时，本轮提交时自动恢复为活跃状态', { sessionId });
    }

    const submittedCheckpoint = options.checkpointId
      ? getPendingCheckpoint(session.teachingState)
      : null;
    if (options.checkpointId && (!submittedCheckpoint || submittedCheckpoint.id !== options.checkpointId)) {
      throw new Error('理解检查不存在或已处理');
    }

    const context = await buildTeachingScenarioContext(session.userId, session.taskId, session, options.interactionMeta);
    const endIntent = detectEndIntent(message);

  // 恢复续讲回合（resume-continue）：无学生新输入——不落库伪 user 消息，
  // 对话历史/LLM 可见输入保持纯历史，仅靠下方注入的 session-resumed 课堂事件驱动自然接续
  const isResumeContinue = options.kind === 'resume-continue';
  const updatedMessages = isResumeContinue
    ? appendTimestamp([...session.messages])
    : appendTimestamp([
        ...session.messages,
        {
          role: 'user',
          // 落库保持**学生原文**（原始证据，供人工复核/前端展示）。
          // B2/Q14 的输入围栏只作用于"喂给模型的那一份"（见下方 buildTeachingTurnInput 前的映射）。
          content: message,
          timestamp: new Date().toISOString(),
          // 检查点合成消息打标记：进入教学上下文供模型分析答案，但不参与学生行为证据统计
          ...(options.checkpointId ? { checkpoint: true } : {}),
          // 前端交互特征（认知负荷量测 · 前端情报层）：随消息落库，供后续轮次对比
          ...(options.interactionMeta && Object.keys(options.interactionMeta).length > 0
            ? { meta: options.interactionMeta as Record<string, number> }
            : {}),
        }
      ]);

  const previousTeachingState = session.teachingState || {};
  const sessionArtifacts = parseSessionArtifacts(previousTeachingState);
  // 课内温故：计划持久化在 sessionArtifacts（开课时建立、随回合合并结果），
  // 而 context 每回合重建 → 必须回填，否则模型永远拿不到温故计划、结果也摘不到。
  const turnMemoryWarmup = resolveTurnMemoryWarmup(sessionArtifacts);
  if (turnMemoryWarmup) {
    context.memoryWarmup = turnMemoryWarmup;
  }
  // 教师补充槽晋升（活的 path 批次 E）：上一轮 control.supplement 请求 → 后台已入库 →
  // 本轮查库晋升为补充材料（进 scenario 给模型 + 进消息结果给前端卡片）；超轮次置过期。
  const supplementPromotion = promoteSupplementSlot(
    sessionArtifacts.supplement as SupplementSlot | undefined,
    session.userId,
    updatedMessages.length
  );
  const effectiveInitialKnowledgeState = cloneKnowledgePoints(
    Array.isArray(sessionArtifacts.initialKnowledgeState) && sessionArtifacts.initialKnowledgeState.length > 0
      ? sessionArtifacts.initialKnowledgeState
      : context.taskKnowledgeSeeds
  );
  const frozenKnowledgeState = normalizeFrozenKnowledgeState(
    effectiveInitialKnowledgeState,
    session.knowledgeState,
  );

  // 独立锚题探针（Q13/B4）：只在"本轮会出检查点"时才可能投放（复用检查点槽位，纪律 3）。
  // 目标由代码选定后注入本轮提示词（buildTeachingTurnInput → controls.anchorProbe），
  // 并在落库 pendingCheckpoint 时打上 purpose='anchor'（见下方检查点产生分支）。
  const anchorTarget = await resolveAnchorProbeTarget({
    userId: session.userId,
    teachingState: previousTeachingState,
    emitCheckpoint: shouldEmitCheckpoint(session, previousTeachingState),
    learnerProjection: context.learnerProjection,
    // Q8 数据供给：全量已掌握 lastSeenAt（不被 recentConceptLedger 12 条截断）
    masteredLastSeenAt: context.anchorMasteredLastSeenAt,
    messageCount: updatedMessages.length,
    now: simulatedNowOr(),
  });

  const turnInput = await buildTeachingTurnInput({
    ...session,
    // B2/Q14：喂给模型前对学习者消息做输入围栏（正常文本原样；疑似注入被打标为不可信数据）。
    // 落库消息保持原文（见上方 updatedMessages），因此这里传的是围栏后的浅拷贝。
    messages: fenceLearnerMessagesForModel(updatedMessages),
    // 模型可见的看板投影（F1 修复轮 b）：evidenceSource 是服务端权威标注，只落库不进提示词
    //（提示词载荷与修复前逐字节一致，也避免模型回显该字段）。
    knowledgeState: frozenKnowledgeState.map((point) => ({
      name: point.name,
      status: point.status,
      progress: point.progress,
    })),
  }, context, {
    anchorTarget,
    // 检查点作答回合：把代码裁决显式送进本轮输入（报告 #14），让老师反馈口径与系统记录一致
    checkpointVerdict: options.checkpointJudgement?.judgedBy === 'code'
      ? { passed: options.checkpointJudgement.passed, detail: options.checkpointJudgement.detail ?? null }
      : null,
  });
  // 教师补充材料（批次 E）：上一轮请求已入库 → 本轮把就绪载荷送进 scenario（模型可引用出处讲）。
  if (supplementPromotion.payload) {
    (turnInput.scenario as Record<string, unknown>).supplementaryMaterial = supplementPromotion.payload;
  }
  // 教学配图时机（S1，代码裁决 → **显式**送进本轮输入）：老师上一轮用字符画了结构 → 本轮要求出图。
  // 为什么必须显式送：实测埋在 2 万字 system prompt 里的规则会被忽略，写进本轮输入才生效。
  const visualOpportunity = buildVisualOpportunity(updatedMessages);
  if (visualOpportunity) {
    (turnInput as { visualOpportunity?: typeof visualOpportunity }).visualOpportunity = visualOpportunity;
  }
  // 教学回合 wall-clock 超时兜底：LLM 挂起时避免操作租约（30min）被占导致会话内所有操作 409 BUSY；
  // 超时走 releaseOperation + 客户端重试路径（revision 未递增，重试安全）。
  // 阈值对齐 platform_settings.aiReliability.defaultRequestTimeoutMs（300s）：
  // 旧值 90s 会误杀正常回合——教学回合含 2 次 LLM 调用（模拟器 + teaching-turn），上游慢时单次即可超 90s。
  const turnStartedAt = Date.now();
  const turnResult = await withTimeout(
    executeSkill(teachingTurnAgentDefinition, turnInput, {
      contextEnvelope: {
        schemaVersion: 'context-envelope/v1',
        principal: { userId: session.userId },
        session: { sessionId: session.id, taskId: session.taskId },
      },
    }),
    300_000,
    'TEACHING_TURN_TIMEOUT: 教学回合执行超过 300 秒'
  );
  if (!turnResult.success) {
    throw new Error(typeof turnResult.error === 'string' ? turnResult.error : turnResult.error?.message || 'TEACHING_TURN_FAILED');
  }

  const turnRuntimeEnvelope = turnResult?.runtimeEnvelope || null;
  let rawTeachingOutput = extractTeachingOutput(turnResult);
  const promptDebug = extractTeachingPromptDebug(turnResult);
  // 内容正确性第一刀（2026-10-08，宽域 A 轨 3/10 课 P0 的可检出形态）：回复里的算式
  // 确定性复算，命中即带修复指令重调一次（前缀 KV 缓存使重调远便宜于全新回合）；
  // 复检仍错→只打遥测放行，绝不阻塞课堂。repairInstruction 的模型侧承接条款见
  // teaching-turn.yaml「算式正确性」条。
  {
    const mismatches = findArithmeticMismatches(rawTeachingOutput?.reply);
    if (mismatches.length > 0) {
      logger.warn('[AITeaching] 回复算式复算不匹配，触发修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        mismatches: mismatches.map((m) => m.expr),
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          // 照 supplementaryMaterial 的既有注入风格：scenario 上挂修复指令（模板条款「若输入
          // scenario.repairInstruction 存在」承接），重调共享前缀 → KV 缓存命中率高。
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `你上一条回复中的算式被确定性复算判定有误：${describeMismatchesForRepair(mismatches)}。本轮必须输出修正后的完整回复：只修正上述算式及受其影响的数值与结论表述，其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeout(
            executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, taskId: session.taskId },
              },
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'ARITHMETIC_REPAIR_TIMEOUT: 算式修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && findArithmeticMismatches(candidate.reply).length === 0) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 算式修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'MODEL_ARITHMETIC_MISMATCH',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.arithmetic', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-corrective-instruction' : 'flagged-only',
        rootCauseMessage: mismatches.map((m) => m.expr).join('; '),
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 课内温故结果回收：**首选**模型的结构化结果 control.warmupOutcomes（2026-09-17 起），
  // 兼容它仍按「计划里的原名字」写进 knowledge.points 的老行为。
  // 必须在 reconcileTeachingKnowledgeState 的 slice(0,5) 截断**之前**从原始输出里摘——
  // 模型通常把温故点排在本节点之后，先截断会直接丢掉温故结果。
  const rawPoints = Array.isArray(rawTeachingOutput?.knowledge?.points) ? rawTeachingOutput.knowledge.points : [];
  const warmupOutcomes = extractWarmupOutcomes(
    context.memoryWarmup,
    rawPoints,
    rawTeachingOutput?.control?.warmupOutcomes,
  );
  // 待回捞点数（模型看到的那份视图）：用于"该报却没报"的告警口径
  const pendingItems = pendingWarmupForModel(context.memoryWarmup)?.items.length ?? 0;
  const rawBoardOutput = rawPoints.length > 0
    ? {
        ...rawTeachingOutput,
        knowledge: { ...rawTeachingOutput.knowledge, points: stripWarmupPoints(context.memoryWarmup, rawPoints) },
      }
    : rawTeachingOutput;
  const { teachingOutput, existingPoints } = reconcileTeachingKnowledgeState(context, rawBoardOutput, frozenKnowledgeState);
  // 到期旧知与本节看板物理分离（历史事故 2e3ca16：跨 path 到期点串进「本节知识点」被
  // 误显示为「进行中 · x%」，导致课内复习整体下线）：温故点只进 sessionArtifacts.memoryWarmup，
  // 收束时回写记忆引擎（FSRS 重排 dueAt + 落 learner_evidence 供动态预算回校准）。
  // 掌握聚合仲裁（F1 修复轮 b，R1 finding A2）：本会话内有 code 裁决失败的（检查点归属）概念
  // 不得晋升 mastered。负证据 = checkpointHistory 的 code 失败行 + **本回合**检查点裁决
  // （merge 在判分落历史之前执行，当轮失败必须显式并入，否则「末轮答错→同轮判 mastered」漏网）。
  const codeEvidenceArbitration = buildCheckpointCodeArbitration(
    previousTeachingState.checkpointHistory,
    options.checkpointJudgement,
    submittedCheckpoint,
  );
  const mergedKnowledge = normalizeFrozenKnowledgeState(
    effectiveInitialKnowledgeState,
    knowledgeStateService.merge(
      existingPoints,
      teachingOutput.knowledge.points,
      session.mode === 'review', // 复习课允许 mastered 降级：复习失败在掌握度数据上真实可见
      codeEvidenceArbitration
    )
  );
  // 收束判定锚定「冻结目标集」而非每轮合并后的膨胀集合：
  // 目标集在开课（有种子）或首个教学回合冻结，之后模型新增/改名的点不再抬高门槛；
  // 目标点达到 mastered 或进度≥阈值即视为可收束。envelope phase 仍仅作观测 soft 信号。
  const frozenTargetsBefore = parseSessionArtifacts(previousTeachingState).completionTargets;
  const targetsFrozenBefore = Array.isArray(frozenTargetsBefore) && frozenTargetsBefore.length > 0;
  const teachingTurns = session.messages.filter((message) => message.role === 'assistant').length;
  // 范围外点排除（scope-out，实现与判据见 resolveCompletionScope 注释）
  const declaredThisTurn = (teachingOutput.knowledge?.points || [])
    .map((point) => String(point?.name || ''));
  const { inScope: knowledgeInScope, outOfScopeNames } = resolveCompletionScope(
    mergedKnowledge,
    declaredThisTurn,
    teachingTurns
  );
  const completionTargets = knowledgeStateService.resolveCompletionTargets(
    frozenTargetsBefore,
    effectiveInitialKnowledgeState,
    mergedKnowledge,
  ).filter((name) => !outOfScopeNames.has(name.trim().toLowerCase()));
  // 首回合只冻结目标集、不判完成：避免开课注入的到期复习点（retention≥阈值）
  // 在学员尚未参与任何交互时就把课判成「可收束」。
  const targetsConsolidated = targetsFrozenBefore
    && knowledgeStateService.areTargetsConsolidated(completionTargets, knowledgeInScope);
  // 兜底：回合足够多、无 pending、目标集均分达标 → 放行，保证课堂不会「永不收敛」
  const noPendingPoints = knowledgeInScope.every((point) => point.status !== 'pending');
  const avgTargetProgress = knowledgeStateService.averageTargetProgress(completionTargets, knowledgeInScope);
  const backstopReady = targetsFrozenBefore
    && teachingTurns >= COMPLETION_TURNS_BACKSTOP
    && noPendingPoints
    && avgTargetProgress >= COMPLETION_TARGET_PROGRESS_FLOOR;
  // 软收口（2026-09-25 训练局 P1）：老师**语义上明确收课**（"今天就到这儿/这一节就齐了"）且
  // 知识进度已过软地板（≥60、无 pending）时，尊重老师的判断放行——
  // 此前这里用 completionReady 无条件覆盖模型请求，轻量任务（单知识点、进度停在 70%）的课
  // 永远弹不出完成面板，任务悬挂 active 只能手动收尾（真课实测：路径2 两节共 24 轮无一触发）。
  const modelRequestedCompletion = teachingOutput.control?.isCompletionCandidate === true;
  const replySignalsClosing = CLOSING_REPLY_PATTERNS.some((pattern) => pattern.test(teachingOutput.reply || ''));
  const softCompletionReady = targetsFrozenBefore
    && noPendingPoints
    && avgTargetProgress >= SOFT_COMPLETION_PROGRESS_FLOOR
    && (modelRequestedCompletion || replySignalsClosing);
  // 收口闭合门禁（teaching-closure.ts，H3 回测立项）：完成信号与本回合新抛问题/未答检查点
  // 同回合出现时，学员永远轮不到作答课就 completed（26.5% 完结课残留此形态且三窗稳定，
  // 提示词与强制消费均不触及）。此处延迟一轮收束：先让学员答完末问，下一回合再走收口。
  const closureGate = shouldDeferCompletionForClosure({
    reply: teachingOutput.reply || '',
    pendingCheckpoint: previousTeachingState.pendingCheckpoint,
    checkpointEmittedThisTurn: !!teachingOutput.control?.checkpoint,
    priorDeferrals: Number(previousTeachingState.completionDeferrals) || 0,
  });
  const completionReady = (targetsConsolidated || backstopReady || softCompletionReady) && !closureGate.defer;
  if (closureGate.defer) {
    logger.info('[AITeaching] 收口闭合门禁：完成信号延迟一轮（末问未答，先让学员作答）', {
      sessionId: session.id,
      reason: closureGate.reason,
      deferrals: (Number(previousTeachingState.completionDeferrals) || 0) + 1,
    });
  }
  const envelopeCompletionSignal =
    turnRuntimeEnvelope?.businessState?.phase === 'completion-candidate'
    || turnRuntimeEnvelope?.businessState?.isTerminal === true;
  // soft-AND：双方都同意完成时记 alignment=agree；仅 envelope 喊完成时 disagree（不改变硬门禁）
  const completionAlignment: 'agree' | 'envelope-only' | 'knowledge-only' | 'neither' | 'soft-model' =
    completionReady && envelopeCompletionSignal
      ? 'agree'
      : !completionReady && envelopeCompletionSignal
        ? 'envelope-only'
        : completionReady && !envelopeCompletionSignal
          ? 'knowledge-only'
          : 'neither';
  const completionPath: 'targets' | 'backstop' | 'soft-model' | 'none' =
    targetsConsolidated ? 'targets'
      : backstopReady ? 'backstop'
        : softCompletionReady ? 'soft-model'
          : 'none';
  if (completionAlignment === 'envelope-only' || completionAlignment === 'knowledge-only') {
    logger.debug('[AITeaching] completion soft-AND 分歧', {
      sessionId: session.id,
      completionAlignment,
      knowledgeComplete: completionReady,
      envelopePhase: turnRuntimeEnvelope?.businessState?.phase || null,
      envelopeTerminal: turnRuntimeEnvelope?.businessState?.isTerminal === true,
    });
  }
  const effectiveTeachingOutput: TeachingTurnOutput = {
    ...teachingOutput,
    control: {
      ...teachingOutput.control,
      isCompletionCandidate: completionReady,
    },
  };
  const previousClassroomStage = (previousTeachingState.classroomContext?.stage?.current as LearnStage) || 'opening';
  // 恢复续讲首回合不触发伴学（无学生新输入，伴学模拟"同学插话"无意义）
  const peerTriggered = !isResumeContinue && peerTriggerService.shouldTrigger(session, teachingOutput, message);
  // 恢复续讲无学生输入：后续所有 learnerMessage 语义统一为空，避免 teaching-turn 把伪输入当本轮反馈
  const effectiveLearnerMessage = isResumeContinue ? '' : message;
  let peerMessage: string | undefined;
  let peerStrategy: string | null = null;
  let peerFollowUpQuestions: string[] = [];
  let peerDebug: any = null;
  let peerRuntimeEnvelope: any = null;

  if (peerTriggered) {
    // P2-11 修复（审计 §2.2）：伴学历史主路径此前从不转发——引擎 peerInput 无 peerHistory，
    // 伴学每次触发都看不到自己说过什么，规则 11「连续 3 问无进展即收手」的 3 问预算不可达
    // （DB：4879 条中 userPayload 含【此前伴学对话】0 条）。与聊天路径（teaching-session-ops.ts:638-641）
    // 对齐取法：从已落库消息恢复（peer 标记消息 + 内嵌在老师消息里的 peerMessage 插话，见 collectPeerHistory）。
    const peerHistory = collectPeerHistory(session.messages);
    const peerInput = {
      topic: session.topic,
      // 策略由代码按认知层级选定（prompt 规则 38 只负责"怎么说"）：
      // 此前硬编码 'feynman'，使「understand→类比 / apply→反例 / analyze+→辩论」永不触发（§3.19 P0②）。
      // P1-14 修复③：同时读老师本轮回复——老师布置独立作业/等作答时降级为鼓励式，不给解题钥匙。
      strategy: pickPeerStrategy(teachingOutput.analysis.cognitiveLevel, {
        tutorLatestReply: teachingOutput.reply,
      }),
      studentMessage: message,
      // 老师本轮回复原文（2026-09-25 对齐调整）：让伴学看见老师刚说了什么——
      // 老师刚提问等学生答 → 不代答不提前给提示；老师搁置某话题 → 不再追。此前只埋在 6 条窗口里，压不过【学生消息】的锚定。
      tutorLatestReply: teachingOutput.reply,
      tutorContext: updatedMessages.slice(-6).map((item) => ({
        role: item.role,
        content: item.content,
      })),
      cognitiveLevel: teachingOutput.analysis.cognitiveLevel,
      understanding: teachingOutput.analysis.understanding,
      // 规则 41 的"高负荷/受挫"分支需要这两个字段才可达（此前未提供）
      loadIndex: teachingOutput.analysis.loadIndex ?? null,
      emotionalState: teachingOutput.analysis.emotionalState ?? null,
      peerHistory,
    };
    try {
      const peerResult = await executeSkill(peerAgentDefinition, {
        input: peerInput,
        context: {
          userId: session.userId,
          sessionId: session.id,
        },
      }, {
        contextEnvelope: {
          schemaVersion: 'context-envelope/v1',
          principal: { userId: session.userId },
          session: { sessionId: session.id, taskId: session.taskId },
        },
      });
      peerMessage = peerResult.internal?.ext?.peer?.message || peerResult.userVisible || '';
      // 伴学策略与后续追问一并透传（供前端展示「正在用什么学法」与快选追问）
      const peerExt = peerResult.internal?.ext?.peer || null;
      peerStrategy = peerExt?.strategy || null;
      peerFollowUpQuestions = Array.isArray(peerExt?.followUpQuestions)
        ? peerExt.followUpQuestions.filter((q: unknown) => typeof q === 'string' && q.trim())
        : [];
      peerDebug = extractPeerDebug(peerResult);
      peerRuntimeEnvelope = peerResult?.runtimeEnvelope
        || peerResult?.internal?.ext?.peer?.runtimeEnvelope
        || null;
    } catch (e: any) {
      logger.warn('[AITeachingCoordinator] peer-reinforcement 失败', { error: e?.message || String(e) });
    }
  }

  const nextStageDecision = determineNextStage({
    currentStage: previousClassroomStage,
    teachingOutput: effectiveTeachingOutput,
    peerTriggered,
    learnerMessage: effectiveLearnerMessage,
    taskMode: context.taskMode,
    frustratedStreak: previousTeachingState?.learnerStateContext?.frustratedStreak ?? 0,
  });
  const learnerStateContext = buildLearnerStateContext(context, previousTeachingState, {
    ...teachingOutput.analysis,
    struggleDetected: nextStageDecision.stage === 'intervention',
  });
  learnerStateContext.struggleDetected = nextStageDecision.stage === 'intervention';

  const classroomContext = buildClassroomContext({
    previousState: previousTeachingState,
    stage: nextStageDecision.stage,
    stageReason: nextStageDecision.reason,
    teachingOutput: effectiveTeachingOutput,
    learnerMessage: effectiveLearnerMessage,
    context,
    knowledgeState: mergedKnowledge,
    learnerStateContext,
    peerTriggered,
    peerMessage,
  });

  const classroomEvents = Array.isArray(previousTeachingState.classroomEventHistory)
    ? [...previousTeachingState.classroomEventHistory]
    : [];

  classroomEvents.push(buildClassroomEvent('teaching-turn', nextStageDecision.reason, {
    stage: nextStageDecision.stage,
    focusKnowledgePoint: classroomContext.focus.currentKnowledgePoint,
    learnerMessage: effectiveLearnerMessage,
    confusionPoints: learnerStateContext.currentConfusionPoints || [],
    peerTriggered,
    endIntent: endIntent.isEndIntent,
  }));

  if (endIntent.isEndIntent) {
    classroomEvents.push(buildClassroomEvent('end-intent', endIntent.reason, {
      learnerMessage: effectiveLearnerMessage,
    }));
  }

  if (peerTriggered) {
    classroomEvents.push(buildClassroomEvent('peer-support', '本轮触发伴学支持', {
      peerMessage: peerMessage || null,
    }));
  }

  if (completionReady) {
    classroomEvents.push(buildClassroomEvent('completion-candidate', '本轮出现课堂完成候选信号', {
      focusKnowledgePoint: classroomContext.focus.currentKnowledgePoint,
      completionPath,
      avgTargetProgress,
    }));
  }

  // 恢复续讲信号：teaching-turn 看到该事件即知本轮无学生新输入，需自然接续上一轮推进
  if (isResumeContinue) {
    classroomEvents.push(buildClassroomEvent('session-resumed', '学生刚刚恢复本课堂会话，无新输入', {
      instruction: '自然地接续上一轮的教学推进：先一句话承接上次进度，再继续当前焦点知识点。不要询问"你想做什么/从哪继续"，不要重新自我介绍或重复开场。',
    }));
  }

  const stageHistory = Array.isArray(previousTeachingState.stageHistory)
    ? [...previousTeachingState.stageHistory]
    : [];
  const lastStage = stageHistory[stageHistory.length - 1];
  if (!lastStage || lastStage.stage !== nextStageDecision.stage) {
    stageHistory.push({
      stage: nextStageDecision.stage,
      reason: nextStageDecision.reason,
      enteredAt: new Date().toISOString(),
    });
  }

  const teachingControlContext = buildTeachingControlContext(
    nextStageDecision.stage,
    context,
    learnerStateContext,
    {
      ...sessionArtifacts,
      endReason: endIntent.isEndIntent
        ? 'learner-requested-end'
        : completionReady
          ? 'completion-candidate'
          : sessionArtifacts.endReason,
    },
  );

  const learnDebug = {
    input: {
      pathBackgroundContext: buildPathBackgroundContext(context),
      classroomContext,
      learnerStateContext,
      classroomEventContext: {
        recentEvents: classroomEvents.slice(-5),
      },
      visibleDialogueContext: session.messages.map((item) => ({
        role: item.role,
        content: item.content,
      })).concat(isResumeContinue ? [] : [{ role: 'user', content: message }]),
      teachingControlContext,
    },
    output: {
      stageDecision: nextStageDecision,
      classroomContext,
      learnerStateContext,
      knowledgeState: normalizeKnowledgePoints(mergedKnowledge),
      auxiliaryActions: {
        peerTriggered,
        completionCandidate: completionReady,
        autoEndRequested: endIntent.isEndIntent,
      },
      completionCandidateEvidence: teachingOutput.control.completionCandidateEvidence || null,
    },
  };

  if (promptDebug && typeof promptDebug === 'object') {
    promptDebug.learnDebug = learnDebug;
  }

  const assistantMessage: TeachingSessionMessage = {
    role: 'assistant',
    content: teachingOutput.reply,
    timestamp: new Date().toISOString(),
    analysis: teachingOutput.analysis,
    strategies: teachingOutput.pedagogy.strategies,
    knowledgePoint: teachingOutput.knowledge.currentPoint,
    knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
    promptDebug,
    peerTriggered,
    peerMessage: peerMessage || null,
    peerStrategy,
    peerFollowUpQuestions,
    peerDebug,
  };

  // 教学配图（owner 口径 2026-09-23「图片是一种特殊的文字」）：老师临场请求 → 代码闸门 → 画一张，
  // 内联在本轮消息里（`images`）。文本脱离图仍成立；生成失败/超上限一律 fail-open，不阻断课堂。
  // 防答案泄漏硬闸门（2026-09-24 审计）：回复在同轮布置"你自己排/画"练习时不配图——
  // 提示词例外句实测压不过配图时机信号（三次重放一致），故与 maxPerTask 同思路代码化。
  if (teachingOutput.visual && detectExerciseLeakInReply(teachingOutput.reply)) {
    logger.info('[AITeaching] 本轮回复布置了由学生自己排/画的练习，跳过配图（防答案泄漏）', {
      sessionId,
      taskId: session.taskId,
    });
  } else if (teachingOutput.visual) {
    const image = await generateTeachingVisual({
      request: teachingOutput.visual,
      messages: updatedMessages,
    });
    if (image) assistantMessage.images = [image];
  }

  // 课堂结构图（2026-09-27 双通道重构，owner 终审：扩散生图停用、结构类走代码渲染）：
  // 不需要生成——skill 出口已归一化/过滤（normalizeDiagram），这里只过防答案泄漏硬闸
  // （与配图同一条 9/24 审计结论：回复在同轮布置"你自己排/画"练习时不得给结构图）。
  if (teachingOutput.diagram) {
    if (detectExerciseLeakInReply(teachingOutput.reply)) {
      logger.info('[AITeaching] 本轮回复布置了由学生自己排/画的练习，跳过结构图（防答案泄漏）', {
        sessionId,
        taskId: session.taskId,
      });
    } else {
      assistantMessage.diagrams = [teachingOutput.diagram];
    }
  }

  // 位置线图（2026-09-27 双通道重构 Scope B，同一条防答案泄漏硬闸）：
  // 追及/相遇题里"学生自己画位置线"正是练习本体——本轮布置了这类练习就不能给图，给了等于把答案摆出来。
  if (teachingOutput.figure) {
    if (detectExerciseLeakInReply(teachingOutput.reply)) {
      logger.info('[AITeaching] 本轮回复布置了由学生自己画的练习，跳过位置线图（防答案泄漏）', {
        sessionId,
        taskId: session.taskId,
      });
    } else {
      assistantMessage.figures = [teachingOutput.figure];
    }
  }

  if (!completionReady && hasPrematureNextStepLanguage(assistantMessage.content)) {
    logger.warn('[AITeaching] 教学回复越界，尚未满足结束条件却提到下一环节', {
      sessionId,
      taskId: session.taskId,
      reply: assistantMessage.content,
    });
  }

  const persistedMessages = [...updatedMessages, assistantMessage];
  const previousMetrics = extractTeachingStateMetrics(previousTeachingState)
    || learningStateService.coerceMetrics(context.learningState)
    || null;
  
  // 将扩展的 taskType 映射到基础的 4 种类型
  const normalizedTaskType = normalizeTaskTypeForMetrics(context.taskType);
  
  const currentState = learningStateService.calculateRuntimeState(previousMetrics, {
    difficulty: Math.max(1, Math.min(10, teachingOutput.analysis.levelScore + 2)),
    cognitiveLoad: Math.max(1, Math.min(10, (1 - teachingOutput.analysis.understanding + 0.3) * 8)),
    efficiency: teachingOutput.analysis.engagement,
    timeSpent: 1,
    expectedTime: 15,
    completionRate: 1,
    taskType: normalizedTaskType,
  });

    const turnState: Record<string, any> = {
    ...currentState,
    analysis: effectiveTeachingOutput.analysis,
    strategies: effectiveTeachingOutput.pedagogy.strategies,
    completionCandidate: completionReady,
    peerTriggered,
    learnerStateContext,
    classroomContext,
    classroomEventHistory: classroomEvents.slice(-40),
    stageHistory,
    teachingControlContext,
    lastRuntimeEnvelope: turnRuntimeEnvelope,
    lastBusinessPhase: turnRuntimeEnvelope?.businessState?.phase || null,
    envelopeCompletionSignal: !!envelopeCompletionSignal,
    completionAlignment,
    lastPeerRuntimeEnvelope: peerRuntimeEnvelope,
    sessionArtifacts: {
      ...parseSessionArtifacts(session.teachingState),
      initialKnowledgeState: effectiveInitialKnowledgeState,
      // 课内温故：① 标记"模型真的问出来了"（含 review/pending——问过 ≠ 有结果）
      // ② 合并实测结果；计划其余部分原样保留（含负担预算与积压计数）
      ...(() => {
        const persistedPlan =
          parseSessionArtifacts(session.teachingState).memoryWarmup || context.memoryWarmup;
        if (!persistedPlan) return {};
        const asked = markWarmupAsked(persistedPlan, rawPoints, new Date().toISOString());
        const merged = warmupOutcomes.length > 0
          ? mergeWarmupOutcomes(asked, warmupOutcomes, new Date().toISOString())
          : asked;
        // 采样率可观测（2026-09-17）：结构化通道是温故结果的唯一可靠来源，
        // 因此"模型报了几条 / 代码落地几条 / 丢弃几条"必须留痕——否则丢样本只能靠事后猜。
        if (Array.isArray(rawTeachingOutput?.control?.warmupOutcomes) && rawTeachingOutput.control.warmupOutcomes.length > 0) {
          const reported = rawTeachingOutput.control.warmupOutcomes.length;
          const settled = (merged?.items || []).filter((item) => item?.outcome?.status).length;
          logger.info('[AITeaching] 温故结构化结果', {
            sessionId,
            reported,
            extracted: warmupOutcomes.length,
            settled,
            dropped: reported - warmupOutcomes.length,
            recalls: rawTeachingOutput.control.warmupOutcomes.map((entry: any) => entry?.recall ?? null),
          });
        } else if (pendingItems > 0) {
          // 有待回捞点却没报结构化结果 → 可能是"这轮刚问、学生还没答"（正常），也可能是真丢样本。
          // 只在**学生确有机会作答**时告警：该点此前已被问过（askedAt）且其后有学生发言。
          const askedEarlier = (persistedPlan.items || []).filter((item) => item?.askedAt && !item?.outcome?.status);
          const hadAnswerChance = askedEarlier.some((item) => (session.messages || []).some((message) => {
            if (message?.role !== 'user') return false;
            const at = Date.parse(String(message.timestamp || ''));
            return Number.isFinite(at) && at > Date.parse(String(item.askedAt));
          }));
          if (hadAnswerChance) {
            logger.warn('[AITeaching] 学生已作答但模型未报 control.warmupOutcomes（温故结果丢失）', {
              sessionId,
              pendingItems,
            });
          }
        }
        return merged ? { memoryWarmup: merged } : {};
      })(),
      // 冻结的收束目标集：只增一次，后续回合沿用（防止目标集随模型新增/改名膨胀）
      completionTargets,
      // 教师补充槽（批次 E）：① 晋升结果落槽（delivered/expired）；② 本轮新请求（闸门：
      // 已有槽位则忽略——每 session 至多一次）写 requested + fire 后台采集入库。
      // 采集产物进资料库（持久）；槽位流转全部随回合同事务写，无中途并发写。
      ...(() => {
        const existing = sessionArtifacts.supplement as SupplementSlot | undefined;
        if (supplementPromotion.slot && supplementPromotion.slot !== existing) {
          return { supplement: supplementPromotion.slot };
        }
        const request = effectiveTeachingOutput?.control?.supplement
          || rawTeachingOutput?.control?.supplement;
        if (request?.topic && !existing) {
          const slot: SupplementSlot = {
            status: 'requested',
            topic: request.topic,
            query: request.query || request.topic,
            requestedAt: new Date().toISOString(),
            requestedTurn: updatedMessages.length,
          };
          runBackgroundTask('teaching.material-supplement', async () => {
            const outcome = await fetchSupplementMaterial(session.userId, slot.topic, slot.query);
            if (outcome.ok && outcome.materialId) {
              // 槽位回写（全量测试报告 #28）：晋升按采集链自己选中的 id 直取，不再依赖
              // 「查询词 × 网页标题」模糊匹配（实测两例全败：CPA 分值查询 →《22年CPA的调分规则来了》）。
              const written = await teachingSessionRepository
                .patchSessionSupplementMaterial(
                  sessionId,
                  { requestedAt: slot.requestedAt },
                  { materialId: outcome.materialId, sourceUrl: outcome.sourceUrl ?? null }
                )
                .catch((error) => {
                  logger.warn('[AITeaching] 补充材料槽位回写失败（fail-open，晋升退回标题匹配）', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error),
                  });
                  return false;
                });
              logger.info('[AITeaching] 补充材料已入库并回写槽位', {
                sessionId,
                materialId: outcome.materialId,
                written,
              });
              return;
            }
            logger.warn('[AITeaching] 教师补充资料采集失败（fail-open，槽位靠轮次超时过期）', {
              sessionId,
              topic: slot.topic,
              error: outcome.error,
            });
          });
          logger.info('[AITeaching] 教师补充请求已受理', {
            sessionId,
            topic: slot.topic,
            turn: slot.requestedTurn,
          });
          return { supplement: slot };
        }
        return {};
      })(),
      pathBackgroundContext: sessionArtifacts.pathBackgroundContext || buildPathBackgroundContext(context),
      endReason: endIntent.isEndIntent
        ? 'learner-requested-end'
        : completionReady
          ? 'completion-candidate'
          : parseSessionArtifacts(session.teachingState).endReason,
    },
    };
    // 继承上一回合顶层状态后再覆盖本回合字段：否则 pendingCheckpoint / lastCheckpointTurn /
    // checkpointHistory 会在每次重建时丢失（18 号报告 N2）。
    const teachingState: Record<string, any> = inheritTeachingState(previousTeachingState, turnState);

    // 收口闭合门禁计数：延迟发生时 +1（跨回合继承），供 COMPLETION_DEFERRAL_CAP 活力兜底
    if (closureGate.defer) {
      teachingState.completionDeferrals = (Number(previousTeachingState.completionDeferrals) || 0) + 1;
    }

    // 检查点产生：teaching-turn 可选输出 control.checkpoint，按规则落库为 pendingCheckpoint
    const checkpointCandidate = teachingOutput.control.checkpoint;
    if (
      !submittedCheckpoint
      && !completionReady
      && !endIntent.isEndIntent
      && checkpointCandidate
      && !previousTeachingState.pendingCheckpoint
      && (previousTeachingState.lastCheckpointTurn === undefined
        || updatedMessages.length - previousTeachingState.lastCheckpointTurn >= 4)
    ) {
      const checkpointTitle = checkpointCandidate.question.length > 20
        ? `${checkpointCandidate.question.slice(0, 20)}…`
        : checkpointCandidate.question;
      // 概念归属（F1 修复轮 a，R1 H2：全库 0/5955 无归属）：普通检查点带上当前教学点的知识身份——
      // 模型输出无键，用当前点名字的确定性派生键并标注 source='derived'。锚题探针不带：
      // 其归属由 anchorConceptKey 承载，且纪律 2 禁止锚题结果改写掌握，不得经本通道进聚合。
      const checkpointConcept = anchorTarget
        ? null
        : resolveCheckpointConceptAttribution(effectiveTeachingOutput.knowledge.currentPoint);
      teachingState.pendingCheckpoint = {
        id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: checkpointCandidate.type,
        title: checkpointTitle,
        question: checkpointCandidate.question,
        ...(checkpointCandidate.options ? { options: checkpointCandidate.options } : {}),
        allowSkip: true,
        ...(checkpointCandidate.hint ? { contextHint: checkpointCandidate.hint } : {}),
        // 答案键（服务端保存，客户端投影会剥离）：用于代码裁决，保证"对错"不来自模型自评
        ...(checkpointCandidate.correctOptionIds?.length ? { correctOptionIds: checkpointCandidate.correctOptionIds } : {}),
        ...(checkpointCandidate.expectedKeywords?.length ? { expectedKeywords: checkpointCandidate.expectedKeywords } : {}),
        // 概念归属（F1-a）：失败证据据此挂到概念，掌握聚合与误解路由才有可用键
        ...(checkpointConcept
          ? {
              conceptName: checkpointConcept.conceptName,
              conceptKey: checkpointConcept.conceptKey,
              conceptSource: checkpointConcept.conceptSource,
            }
          : {}),
        // 锚题标记（Q13/B4 独立证伪；Q8 延迟保持率复测）：本轮由代码选定锚题目标时打标，
        // 随 inheritTeachingState 跨回合继承；不含答案键，因此 stripCheckpointAnswerKeys 会原样保留
        ...(anchorTarget
          ? {
              purpose: 'anchor' as const,
              anchorConceptKey: anchorTarget.conceptKey,
              anchorExpectedBelief: anchorTarget.expected,
              anchorKind: anchorTarget.kind ?? 'independent',
              ...(anchorTarget.kind === 'delayed' && Number.isFinite(anchorTarget.intervalDays)
                ? { anchorIntervalDays: anchorTarget.intervalDays as number }
                : {}),
            }
          : {}),
      };
      teachingState.lastCheckpointTurn = updatedMessages.length;
    }

    let checkpointResolution: { passed: boolean; understanding: number; judgedBy: 'code' | 'model-reference' } | undefined;
    if (submittedCheckpoint) {
      const understanding = Number(teachingOutput.analysis?.understanding ?? 0);
      const currentPoint = effectiveTeachingOutput.knowledge.currentPoint?.trim().toLowerCase();
      const modelDerivedPassed = completionReady || !!currentPoint && mergedKnowledge.some(
        (point) => point.name.trim().toLowerCase() === currentPoint && point.status === 'mastered'
      );
      // 独立传感器优先（2026-09-17）：有答案键就按**代码裁决**，否则退回模型派生并如实标注来源
      const codeJudgement = options.checkpointJudgement ?? null;
      const judgedBy: 'code' | 'model-reference' = codeJudgement?.judgedBy === 'code' ? 'code' : 'model-reference';
      const passed = judgedBy === 'code' ? codeJudgement!.passed : modelDerivedPassed;
      const checkpointHistory = Array.isArray(teachingState.checkpointHistory)
        ? [...teachingState.checkpointHistory]
        : [];
      checkpointHistory.push({
        checkpointId: submittedCheckpoint.id,
        // title/type 一并留档（2026-09-17）：此前只记 id/passed，读侧无法知道"没通过的是什么题"
        title: submittedCheckpoint.title,
        type: submittedCheckpoint.type,
        submittedAt: new Date().toISOString(),
        passed,
        judgedBy,
        understanding,
        // 概念归属（F1 修复轮 a/b）：掌握聚合仲裁按归属概念消费 code 负证据——
        // 无归属的存量检查点（修复前发出的 pending）不带这两字段，聚合侧不误伤
        ...(submittedCheckpoint.conceptName ? { conceptName: submittedCheckpoint.conceptName } : {}),
        ...(submittedCheckpoint.conceptKey ? { conceptKey: submittedCheckpoint.conceptKey } : {}),
      });

      // 检查点结果留痕（learner_evidence）：独立传感器的原始观测，供 §7 P1-1 的成功率带与控制律消费
      void recordCheckpointResultEvidence(session, submittedCheckpoint, {
        passed,
        judgedBy,
        detail: codeJudgement?.detail ?? null,
        submission: { selectedOptionIds: options.checkpointSubmission?.selectedOptionIds },
      });

      // 独立锚题探针（Q13/B4）：仅对带 purpose='anchor' 的检查点、且**代码裁决**（纪律 1）时
      // 另写一行 anchor:result 作为"待复核"信号；只标记、不改写掌握/难度/BKT（纪律 2）。
      if (submittedCheckpoint.purpose === 'anchor' && judgedBy === 'code') {
        void recordAnchorProbeResult(session, submittedCheckpoint, passed);
      }

      // 仅答对时消费检查点；答错保留 pendingCheckpoint（同一 cpId 可重答，
      // 前端答错反馈后再次提交不会落入「理解检查不存在或已处理」）。
      // 重答上限（2026-10-03 完结课堂裸审计 P1）：同一 cpId 累计答错达到 CHECKPOINT_MAX_ATTEMPTS
      // 即强制消费——否则同一道题被逐轮原样重发（实测最极端 36 次/节），课堂在同一个确认点上
      // 空转直到 LEARN_AUTO_TURN_CAP 才停。到顶后清掉 pendingCheckpoint，老师可换表征出新题/推进。
      const sameCheckpointAttempts = checkpointHistory.filter(
        (row) => row?.checkpointId === submittedCheckpoint.id
      ).length;
      const { consume: consumeCheckpoint, exhausted: attemptsExhausted } =
        resolveCheckpointConsumption(passed, sameCheckpointAttempts);
      if (consumeCheckpoint) {
        delete teachingState.pendingCheckpoint;
        const nextSessionArtifacts = { ...parseSessionArtifacts(teachingState) };
        delete nextSessionArtifacts.pendingCheckpoint;
        teachingState.sessionArtifacts = nextSessionArtifacts;
      }
      if (attemptsExhausted) {
        logger.info('[teaching-turn] 检查点重答到顶，强制消费 pendingCheckpoint（打破同一题循环）', {
          sessionId,
          checkpointId: submittedCheckpoint.id,
          attempts: sameCheckpointAttempts,
        });
        // H1 失败留痕：到顶强消是「未解决收场」的终局标记——每笔答错已有 checkpoint:result，
        // 此前终局只写日志、测量层不可见（实测重答上限可被绕过 27 次）。只留痕、不改写。
        await recordCheckpointAttemptEvidence(session, submittedCheckpoint, {
          outcome: 'attempts_exhausted',
          attempts: sameCheckpointAttempts,
        });
      }
      teachingState.checkpointHistory = checkpointHistory.slice(-20);
      checkpointResolution = { passed, understanding, judgedBy };
    }

    await teachingSessionRepository.commitTurnState(sessionId, operationClaim.operationId, {
      messages: persistedMessages,
      messagesBaseCount: operationClaim.messagesBaseCount,
      knowledgeState: mergedKnowledge,
      teachingState,
      taskId: session.taskId,
      userId: session.userId,
      markTaskInProgress: true,
    });
    committed = true;

    // 误解台账（G-R-R Phase 2）：异步记录本轮结构化误解，best-effort 不阻断回合。
    // 失败路由占位键治理（F1 修复轮 c，R2 复现 concept-1/concept-2 占位入账）：模型给的
    // conceptKey 是路径骨架 concept-N 占位时改挂检查点归属键（发出时带上的当前教学点概念；
    // 无检查点回合退到当前教学点），真键原样，无归属可挂 → 丢弃（宁缺勿错挂）。
    const misconceptions = teachingOutput.analysis?.misconceptions;
    if (Array.isArray(misconceptions) && misconceptions.length > 0) {
      const misconceptionAttribution = (submittedCheckpoint?.conceptKey
        ? {
            conceptName: submittedCheckpoint.conceptName ?? '',
            conceptKey: submittedCheckpoint.conceptKey,
            conceptSource: submittedCheckpoint.conceptSource ?? ('derived' as const),
          }
        : resolveCheckpointConceptAttribution(effectiveTeachingOutput.knowledge.currentPoint));
      void recordMisconceptions(session.userId, sessionId, misconceptions.map((m) => ({
        conceptKey: rerouteMisconceptionConceptKey(m.conceptKey, misconceptionAttribution) || '',
        hypothesis: m.hypothesis,
        canonicalLabel: m.canonicalLabel ?? null,
        confidence: m.confidence,
        evidence: m.evidence,
        status: m.status,
      })).filter((m) => m.conceptKey && m.hypothesis));
    }

    // θ−d EMA：ktEstimate 跨会话滑动平均（α=0.2），best-effort 不阻断回合
    const ktConceptMastery = teachingOutput.analysis?.ktEstimate?.conceptMastery;
    if (Array.isArray(ktConceptMastery) && ktConceptMastery.length > 0) {
      void memoryTraceService.applyKtEstimate(session.userId, ktConceptMastery.map((c) => ({
        conceptKey: c.conceptKey,
        mastery: c.mastery,
      })), session.learningPathId ?? null).catch((error) => {
        logger.warn('[AITeachingCoordinator] ktEstimate EMA 回写失败', { error: error instanceof Error ? error.message : String(error) });
      });
    }

    const baseResult = {
    analysis: teachingOutput.analysis,
    aiResponse: teachingOutput.reply,
    ...(assistantMessage.images?.length ? { images: assistantMessage.images } : {}),
    // 课堂结构图（2026-09-27 双通道重构）：mermaid 源码下行，前端确定性渲染
    ...(assistantMessage.diagrams?.length ? { diagrams: assistantMessage.diagrams } : {}),
    // 位置线图（Scope B）：结构化数值域下行，前端确定性渲染成 SVG
    ...(assistantMessage.figures?.length ? { figures: assistantMessage.figures } : {}),
    // 教师补充材料卡片（批次 E）：本轮晋升成功时随消息下发（前端渲染卡片，点开看章节）
    ...(supplementPromotion.payload ? { supplementaryMaterial: supplementPromotion.payload } : {}),
    strategies: effectiveTeachingOutput.pedagogy.strategies,
    knowledgePoint: effectiveTeachingOutput.knowledge.currentPoint,
    ...(effectiveTeachingOutput.knowledge.confirmCheck
      ? { confirmCheck: effectiveTeachingOutput.knowledge.confirmCheck }
      : {}),
    knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
    isCompletion: completionReady,
    currentState,
    peerTriggered,
    peerMessage,
    peerStrategy,
    peerFollowUpQuestions,
    promptDebug,
    peerDebug,
    // 统一运行契约观测（不改变 isCompletion 硬门禁）
    runtimeEnvelope: turnRuntimeEnvelope,
    completionAlignment,
    envelopeCompletionSignal: !!envelopeCompletionSignal,
    lastBusinessPhase: turnRuntimeEnvelope?.businessState?.phase || null,
    shouldConfirmEnd: completionReady || endIntent.isEndIntent,
    endReason: endIntent.isEndIntent
      ? 'learner-requested-end' as const
      : completionReady
        ? 'completion-candidate' as const
        : null,
    recovered,
      checkpoint: checkpointForMessageResult(teachingState),
      checkpointResolution,
      revision: session.revision + 1,
    };

    return baseResult;
  } finally {
    operationLeaseGuard.stop();
    if (!committed) {
      await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
    }
  }
}
