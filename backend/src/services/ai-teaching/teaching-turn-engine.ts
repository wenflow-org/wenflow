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
import { executeSkill, auxSkillDefinitionMap, peerAgentDefinition } from '../../skills';
import { teachingTurnAgentDefinition } from '../../skills/teaching-turn';
import type { SessionWrapupArtifact } from '../../skills/teaching-wrapup';
import { TeachingOperationLeaseGuard } from './TeachingOperationLeaseGuard';
import { teachingSessionRepository, type TeachingSessionRecord, type TeachingImage, type TeachingDiagram, type TeachingFigure } from './TeachingSessionRepository';import { knowledgeStateService, COMPLETION_TARGET_PROGRESS_FLOOR } from './KnowledgeStateService';
import { peerTriggerService } from './PeerTriggerService';
import { buildTeachingScenarioContext, type TeachingScenarioContext } from './TeachingContextBuilder';
import {
  buildBranchDirective,
  buildLessonContract,
  buildLessonReport,
  collectLessonEvidence,
  evaluateLessonContract,
  MAX_EXIT_TICKET_ATTEMPTS,
  normalizeBranchState,
  normalizeStudentNeed,
  parseExitTicketSubmission,
  resolveBranchDecision,
  type ExitTicket,
  type LessonContract,
  type LessonEvidence,
  type LessonReport,
} from './lesson-contract';
import { fenceLearnerMessagesForModel } from './input-fence';
import { memoryTraceService } from '../memory/memory-trace.service';
import { recordMisconceptions, rerouteMisconceptionConceptKey } from '../learner/misconception-ledger.service';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { parseSessionArtifacts, resolveCheckpointConceptAttribution, resolveUnderstandingReading } from './checkpoint-shared';
import { applyVoidPendingCheckpoint } from './checkpoint-void';
import { shouldDeferCompletionForClosure } from './teaching-closure';
import {
  promoteSupplementSlot,
  fetchSupplementMaterial,
  fetchSupplementMaterialSync,
  supplementStatusForScenario,
  supplementSyncPlan,
  planStudentLinkRead,
  readStudentLink,
  buildSupplementPayload,
  type SupplementSlot,
  type SupplementSyncOutcome,
} from './teaching-supplement.service';
import { getRequestContext } from '../../gateway/api-gateway/context';
import { CHECKPOINT_MAX_ATTEMPTS, normalizeForKeywordMatch } from './checkpoint-shared';
import {
  TeachingCheckpoint,
  buildCheckpointCodeArbitration,
  checkpointForMessageResult,
  getPendingCheckpoint,
  inheritTeachingState,
  isCheckpointAnswerAlreadyGiven,
  isDuplicateCheckpointQuestion, normalizeCheckpointWithTelemetry,
  isCheckpointRetryCoolingDown,
  hasOnlyAlreadyFailedGaps,
  findUnfurnishedChoiceQuestion,
  judgeCheckpointAnswer,
  recordAnchorProbeResult,
  recordCheckpointAttemptEvidence,
  recordCheckpointResultEvidence,
  resolveAnchorProbeTarget,
  resolveCheckpointConsumption,
  shouldEmitCheckpoint,
  } from './teaching-checkpoint';
import { resolveCheckpointPrediction } from './checkpoint-prediction';
import { findRepeatedQuestionAfterAnswer } from './question-loop-guard';
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
  detectEndIntent,
  determineNextStage,
  extractTeachingStateMetrics,
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
import { pickPeerStrategy, collectPeerHistory, COMPLETION_TURNS_BACKSTOP, ensureConfusionMaterialOnScreen } from './teaching-session-views';
import { generateTeachingVisual, buildVisualOpportunity, detectExerciseLeakInReply, detectArgumentClassificationAsk, hasDanglingFigureReference, stripDanglingFigureReferences, paletteOfSubject, shouldEmitFigureAmong, figureRestatesReply, stripInLessonAnnotations, maskFigureForQuestion, resolveFigureMaxPerSession, collectFigureNumbers, collectReplyNumbers, figureNumbersFightReply } from './teaching-visual.service';
import { isArgumentClassificationTask } from './teaching-argument-task';
import type { TeachingOpening, ProcessStudentMessageOptions } from './AITeachingCoordinator';
import { normalizeTaskTypeForMetrics } from './AITeachingCoordinator';
import { emitEarlyReplyDelta } from './teaching-stream-emit';
import { learningStateService, type LearningStateMetrics } from '../learning/learning-state.service';
import type { TeachingSessionMessage } from './TeachingSessionRepository';
import type { TeachingTurnOutput } from '../../skills/teaching-turn';
import { findArithmeticMismatches, describeMismatchesForRepair } from './teaching-arithmetic-guard';
import {
  describeCorrectAnswer,
  ensureVerdictOpening,
  repairContradictedPassedVerdict,
  shouldGuardReplyForFailedConcept,
  stripAffirmationsOnFailedVerdict,
} from './checkpoint-feedback-guard';
import { assessAdjacentRepetition, findPreviousAssistantReply } from './teaching-repetition-guard';
import { decideBoardIntent, numbersOnBoard, shouldSkipExampleRefresh, mergeCorrectionNotes, buildCorrectionDirective, collectTurnBoardFaceText, collectSpecTextFragments, findUnmatchedBoardReferences, referencesBoardWithoutBoardAvailable, type BoardCorrectionNote } from './board-intent';
import { applyBoardOp } from './board-controller';
import { BOARD_DESIGN_BASE_INSTRUCTION, boardPromptInputForTeacher, decideBoardAttachment, isDegenerateFirstBoard, openBoard, type BoardState } from './board-state';
import { designBoard } from './teaching-board-design.service';
import {
  detectLearnerSkipRequest,
  isLearnerConfusionSignal,
  lessonPhaseSummary,
  normalizeLessonPhaseState,
  resolveLessonPhaseTurn,
  segmentsFromBoard,
  segmentsFromKcs,
  settleLessonPhase,
  type LessonPhaseTurnView,
  type LessonPhaseState,
  type LessonSegment,
} from './lesson-phase';
import {
  BOARD_DESIGN_MAX_ATTEMPTS,
  BOARD_LESSON_PLAN_INSTRUCTION,
  boardSegmentCount,
  fixBoardAxisDeixis,
  isAxisCompatible,
  resolveBoardMaterial,
  revealBoardTo,
} from './board-lesson';
import { planVisualFigure, intentFromOpportunity, shouldDeferWholeStructureFigure } from './visual-planner';
import { extractTeacherNumberBindings, findDanglingBoardPositionReferences, maskMismatchedBoardNumberLabels } from './board-intent';
import { detectOpenRequest } from './teaching-closure';
import { recordDegradation } from '../../skills/degradation-telemetry';
import type { ReplanAdvisory } from './ReplanAdvisoryService';
import {
  buildTeachingTurnInput,
  extractPeerDebug,
  extractTeachingOutput,
  extractTeachingPromptDebug,
  requireTeachingRevision,
} from './teaching-turn-shared';
import {
  ensureCheckpointQuestionVisible,
  resolveCompletionScope,
  computeLearnerShortAckStreak,
  appendExitTicketToReply,
  COMPLETION_SCOPE_OUT_MIN_TURNS, SOFT_COMPLETION_PROGRESS_FLOOR,
  ARITHMETIC_REPAIR_BUDGET_MS, ARITHMETIC_REPAIR_TIMEOUT_MS,
  CLOSING_REPLY_PATTERNS,
  assertLearnerTurnInput,
  buildUpdatedMessages,
  gradePendingExitTicket,
  buildContractGapDirective,
  stripTrailingQuestionParagraph,
  stripLearnerNarrationOpening,
  generateExitTicketForLesson,
  figureGateSnapshot,
} from './teaching-turn-preparation';

/**
 * 补充材料同轮复调的进度事件（2026-11-23）：经请求级流式通道下发（路由翻译为 SSE
 * `progress` 事件），前端在「正在查阅外部资料：…」状态行提示。非流式/测试上下文无
 * streamRequest 时静默——进度提示永不影响主流程。
 */
function emitSupplementProgress(stage: 'searching' | 'fusing' | 'reading-link', topic: string): void {
  try {
    getRequestContext()?.streamRequest?.onStream?.({ type: 'progress', stage, topic });
  } catch {
    // 进度事件失败不追责
  }
}
export { generateOpening, appendExitTicketToReply, ensureCheckpointQuestionVisible, stripLearnerNarrationOpening, resolveCompletionScope, computeLearnerShortAckStreak, hasUnverifiablePriorClaim, COMPLETION_SCOPE_OUT_MIN_TURNS } from './teaching-turn-preparation';
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
  /** 位置线/白板等确定性 SVG 图——2026-11-11：模拟链路需要把它交给虚拟学习者，否则学员"看不见图" */
  figures?: TeachingFigure[];
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
  /** 课堂契约（最低必须完成集）+ 本回合支线判定 + 实时报告：前端契约卡/支线标签直接消费。 */
  lessonContract?: LessonContract | null;
  lessonReport?: LessonReport | null;
  /** 课末独立终检题（待作答/通过/失败），前端「结课终检」卡直接消费 */
  exitTicket?: ExitTicket | null;
  branch?: {
    kind: string;
    need: string;
    active: string | null;
    remaining: number;
    parkingLot: Array<{ at: string; topic: string }>;
  } | null;
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
  const hasLearnerImages = assertLearnerTurnInput(options, message);

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
  /**
   * #173-1①：回合证据写入延后到 `commitTurnState` 成功之后执行。
   *
   * 此前三处证据写（checkpoint:result / anchor:result / checkpoint:attempt）都在提交**之前**，
   * 而它们各自 best-effort 吞错 ⇒ 提交失败回滚后「证据在、状态不在」：证据表里记了一次作答，
   * 教学状态却退回作答前（重试会再记一次，成功率分母与校准样本双双失真）。
   * 口径对齐同文件 `recordMisconceptions`（提交成功后写、失败只 warn）：接受「提交后崩溃丢证据」，
   * 比留下无法对账的孤儿证据更可控。
   */
  const deferredEvidence: Array<{ kind: string; write: () => Promise<unknown> }> = [];

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

    const context = await buildTeachingScenarioContext(
      session.userId,
      session.taskId,
      session,
      options.interactionMeta,
      // 学习表现预测并行化（2026-11-26）：它是语气的软提示，不该挡在回合关键路径上——首轮与板书设计
      // 并行，其余轮在调老师之前等一下即可（复用命中时零成本）。
      { deferPrediction: true },
    );
    const predictionReady: Promise<void> = (context as typeof context & { pendingLearnerPrediction?: Promise<void> })
      .pendingLearnerPrediction ?? Promise.resolve();
    const endIntent = detectEndIntent(message);
    // 课堂阶段协议（2026-11-26，lesson-phase.ts）：任务课启用——课的结构由代码定（点名→分段建构→整合→
    // 迁移→审错→收束），出题只在整合/迁移/审错各 1 道，板书讲一段露一行。复习/延伸课与有效失败模式
    // 各有自己的流程，不套这条线；LESSON_PHASE_PROTOCOL=0 是应急回退开关（整条线退回旧节奏）。
    const lessonPhaseEnabled = process.env.LESSON_PHASE_PROTOCOL !== '0'
      && session.mode !== 'review'
      && session.mode !== 'extension'
      && context.taskMode !== 'productiveFailure';

  // 恢复续讲回合（resume-continue）：无学生新输入——不落库伪 user 消息，
  // 对话历史/LLM 可见输入保持纯历史，仅靠下方注入的 session-resumed 课堂事件驱动自然接续
  const isResumeContinue = options.kind === 'resume-continue';
  const updatedMessages = buildUpdatedMessages(session.messages, message, options, hasLearnerImages);

  const previousTeachingState = session.teachingState || {};
  const sessionArtifacts = parseSessionArtifacts(previousTeachingState);
  // 课堂契约（2026-11-19）：旧会话没有契约时按当前上下文补建；契约只在建课时冻结，本回合只读。
  const lessonContract: LessonContract = (sessionArtifacts.lessonContract as LessonContract | undefined)
    || buildLessonContract(context);
  const previousBranchState = normalizeBranchState(sessionArtifacts.branchState);
  context.lessonContract = lessonContract;
  context.branchState = previousBranchState;
  const previousLessonReport = sessionArtifacts.lessonReport as LessonReport | undefined;
  // 课末独立终检（2026-11-19）：与课内检查点分离的结课终检题。
  // 上一轮发题、本轮学生作答 → 先确定性判分；结果计入证据账本（kind=exit-ticket）与结课报告。
  const exitTicketTurn = gradePendingExitTicket({
    exitTicketState: (sessionArtifacts.exitTicket as ExitTicket | undefined) || null,
    exitTicketHistory: sessionArtifacts.exitTicketHistory,
    kind: options.kind,
    message,
  });
  let exitTicketState = exitTicketTurn.state;
  const exitTicketHistory = exitTicketTurn.history;
  const exitTicketAttempts = exitTicketTurn.attempts;
  const exitTicketVerdict = exitTicketTurn.verdict;
  const exitTicketGradedThisTurn = exitTicketTurn.graded;
  const exitTicketFormatMiss = exitTicketTurn.formatMiss;
  const contractGap = buildContractGapDirective(previousLessonReport, lessonContract);
  const contractGapDirective = contractGap.directive;
  const independentGapKcs = contractGap.independentGapKcs;
  context.branchDirective = [buildBranchDirective(previousBranchState, lessonContract), contractGapDirective]
    .filter(Boolean)
    .join('\n') || null;
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


  // 共享白板（2026-10-28 接线）：任务级持久板书，不是一次性配图。
  // 首轮先建板、再把「板上真实有什么」送进老师输入；后续轮老师先说、同轮刷新板（方案 A）。
  // 开课消息（analysis.openingMode）是系统欢迎语，不是教学回合：首课首轮时它已经在历史里，
  // 按「assistant 消息数 === 0」判首轮会永远不成立，白板整节课都建不起来。
  const previousTeachingAssistantCount = session.messages.filter(
    (m) => m.role === 'assistant' && !(m.analysis as { openingMode?: unknown } | undefined)?.openingMode,
  ).length;
  const storedBoard = (sessionArtifacts as { board?: BoardState | null }).board ?? null;
  const taskChanged = !!storedBoard && storedBoard.taskId !== String(session.taskId);
  let board: BoardState | null = storedBoard && !taskChanged ? storedBoard : null;
  const isFirstTurnOfTask = previousTeachingAssistantCount === 0 || taskChanged;
  const visualOpportunity = buildVisualOpportunity(updatedMessages, session.topic, context.taskMaterialPayload ?? null);
  const persistedPhaseState = normalizeLessonPhaseState(previousTeachingState.lessonPhase);
  // 论证/分类课不建板书（2026-11-27 真课：白板把「A③→结论」直接连线，贴在考题底下）。
  // 这类课的学生产出就是「句子归属」，板一摆就是答案；整节课以纸面材料 + 对话进行。
  const answerBoardTask = isArgumentClassificationTask({
    title: context.taskTitle,
    description: context.taskDescription,
    material: context.taskMaterialPayload,
    acceptanceCriteria: context.currentTaskContext?.acceptanceCriteria,
  });
  if (answerBoardTask && board) {
    logger.info('[AITeaching] 论证/分类课不挂已建板书（板面即答案），本轮起隐藏', {
      sessionId,
      taskId: session.taskId,
      kind: board.figure?.kind,
    });
    board = null;
  }
  // 阶段协议下板书是整节课的参照物，首轮没画出来不能整节课都没有：点名/建构阶段每回合允许再试一次，
  // 全课最多 BOARD_DESIGN_MAX_ATTEMPTS 次。绘图员明确「这课不该画板」或材料被概括成短语时不重试（是判断不是故障）。
  const boardDesignAttempts = Number((sessionArtifacts as { boardDesignAttempts?: unknown }).boardDesignAttempts || 0);
  const boardRetryDue = lessonPhaseEnabled
    && !answerBoardTask
    && !board
    && !isFirstTurnOfTask
    && boardDesignAttempts > 0
    && boardDesignAttempts < BOARD_DESIGN_MAX_ATTEMPTS
    && (persistedPhaseState?.phase === 'orient' || persistedPhaseState?.phase === 'build');
  let boardDesignFailures = board ? 0 : boardDesignAttempts;
  // 文字优先开关（2026-11-26）：显式关闭整课板书，用于纯文字课或对照实验；
  // 关闭后课堂仍可经视觉节点按需插单图（visualIntent 路径不受影响）。
  if (!board && !answerBoardTask && process.env.BOARD_DESIGN_DISABLED !== '1' && (isFirstTurnOfTask || boardRetryDue)) {
    const intent = decideBoardIntent({
      taskType: context.taskType,
      kind: visualOpportunity?.kindHint ?? null,
      studentText: message,
      lastTeacherText: null,
      boardNumbers: [],
    });
    // 绘图员的材料入口走回退链（材料本体 → 章节原文 → 资料投影）：此前只有第一条，而 path-task-design
    // 不写 materialPayload 时它就是 null——实录里绘图员拿到的 task.material=null，只能画出一屏勾叉。
    const designedPromise = designBoard({
      task: {
        title: context.taskTitle,
        description: context.taskDescription,
        taskType: context.taskType,
        material: resolveBoardMaterial({
          taskMaterialPayload: context.taskMaterialPayload,
          excerpts: context.activeTaskMaterialExcerpts,
          materials: context.materials,
        }),
      },
      scenario: { subject: session.subject, topic: session.topic, learnerLevel: 'beginner' },
      studentSays: message,
      kindHint: visualOpportunity?.kindHint ?? null,
      questionIntent: intent,
      lastTeacherReply: null,
      instruction:
        BOARD_DESIGN_BASE_INSTRUCTION
        + intent.instruction
        // 阶段协议下：一块板管一节课——开课画完整并标好教学段，之后讲一段露一行、行列不再改
        + (lessonPhaseEnabled ? BOARD_LESSON_PLAN_INSTRUCTION : ''),
    }, { userId: session.userId, sessionId: session.id, taskId: session.taskId }, { lessonPlan: lessonPhaseEnabled });
    // 首轮本就要花约 10s 画板：预测藏在这段时间里，不再额外占学生等待
    const designed = await Promise.all([designedPromise, predictionReady]).then(([result]) => result);
    if (boardRetryDue) {
      logger.info('[AITeaching] 首轮板书未生成，阶段协议下重试设计', {
        sessionId,
        taskId: session.taskId,
        attempt: boardDesignAttempts + 1,
      });
    }
    if (designed.figure) {
      board = openBoard(String(session.taskId), designed.figure, { conceal: 'takeaway', intent });
    } else {
      boardDesignFailures = /^(?:teaching-board-design declined|material-paraphrase-board)/.test(String(designed.reason || ''))
        ? BOARD_DESIGN_MAX_ATTEMPTS
        : boardDesignAttempts + 1;
      logger.warn('[AITeaching] 首轮白板未生成（fail-open，纯文字继续）', {
        sessionId,
        taskId: session.taskId,
        reason: designed.reason,
        attempts: boardDesignFailures,
      });
    }
  }
  await predictionReady;

  // 课堂阶段协议（2026-11-26）：本轮所处阶段、能否出题、板书露到哪一段。必须在调老师之前算好——
  // 老师要看着「本轮屏幕上真实露出的板」说话，出题时机也要先在载荷里定下来。
  // 教学段：优先沿用已持久化的（轴冻结）；新开课取板书分段；板没有分段就按核心知识点一段一个。
  const taughtSoFar = session.messages
    .filter((m) => m.role === 'assistant' && !(m.analysis as { openingMode?: unknown } | undefined)?.openingMode)
    .map((m) => String(m.content || ''))
    .join('\n');
  const boardSegments = board ? segmentsFromBoard(board.figure?.maskedSpec) : [];
  // 单一坐标系（2026-11-26 工程外审）：有分段板书时，教学段一律取板书分段。
  // 此前「持久化段优先」——板晚到或板段数与持久段数不等时，boardReveal 按教学段算、
  // 实际露板按板段算，两套坐标互相矛盾（教学 2 段 / 板 4 段时，整合阶段指令说「还有空行」、
  // 板上却已全露）。板是「一块板管一节课」的真理源，段数跟板走。
  const lessonSegments: LessonSegment[] = boardSegments.length > 0
    ? boardSegments
    : persistedPhaseState?.segments?.length
      ? persistedPhaseState.segments
      : segmentsFromKcs(lessonContract.coreKcs.map((kc) => kc.name), context.taskTitle);
  // 段数变了就把持久状态里的段列表与当前段号一起夹回来（不改阶段、不清进度）
  const phaseStateForTurn = persistedPhaseState && persistedPhaseState.segments.length !== lessonSegments.length
    ? { ...persistedPhaseState, segments: lessonSegments, segment: Math.min(persistedPhaseState.segment, lessonSegments.length) }
    : persistedPhaseState;
  /**
   * 本轮学生屏幕上的板：按阶段露出。空壳矩阵不出。
   * 能分段的板：点名阶段只露行列名骨架，建构阶段讲一段露一行，建构之后全图。
   * 不能分段的板（位置线/循环/层级…）没有骨架态可拆，开课即全图——它就是点名阶段的「地图总览」，
   * 比第二轮突然冒出来一块板更稳。段数按板自己的分段算（教学段可能来自知识点，数量未必对得上）。
   */
  const boardViewForTurn = (source: BoardState | null): BoardState | null => {
    if (!source) return null;
    if (!phaseView) return source;
    if (isDegenerateFirstBoard(source)) return null;
    const ownSegments = boardSegmentCount(source.figure?.maskedSpec);
    if (ownSegments <= 0) return source;
    const level = phaseView.state.phase === 'orient'
      ? 0
      : phaseView.state.phase === 'build'
        ? Math.min(Math.max(1, phaseView.state.segment), ownSegments)
        : ownSegments;
    return revealBoardTo(source, level);
  };
  let boardForTurn: BoardState | null = null;
  const previousCheckpointRows = Array.isArray(previousTeachingState.checkpointHistory)
    ? previousTeachingState.checkpointHistory
    : [];
  const phaseView: LessonPhaseTurnView | null = !lessonPhaseEnabled ? null : resolveLessonPhaseTurn(phaseStateForTurn, {
    teachingTurns: previousTeachingAssistantCount,
    isResume: isResumeContinue,
    isSubmission: !!submittedCheckpoint,
    verdictPassed: submittedCheckpoint ? options.checkpointJudgement?.passed === true : null,
    pendingCheckpoint: !submittedCheckpoint && !!previousTeachingState.pendingCheckpoint,
    endIntent: endIntent.isEndIntent,
    learnerSkipRequested: detectLearnerSkipRequest(message),
    studentMessage: message,
    contract: lessonContract,
    evidence: collectLessonEvidence({
      contract: lessonContract,
      checkpointHistory: previousCheckpointRows,
      exitTickets: exitTicketState ? [exitTicketState] : [],
      knowledgeState: session.knowledgeState,
      teachingTurns: previousTeachingAssistantCount,
    }),
    segments: lessonSegments,
    exploratory: context.entryState === 'exploratory',
    taughtText: taughtSoFar,
    acceptanceCriteria: context.currentTaskContext.acceptanceCriteria ?? null,
    board: board && !isDegenerateFirstBoard(board)
      ? { segmentCount: boardSegmentCount(board.figure?.maskedSpec) }
      : null,
  });
  boardForTurn = boardViewForTurn(board);
  // 阶段协议下不再逐轮注入「本轮必须出一次独立检查点」——出题时机由阶段机定，这句指令会和
  // 「本轮 emitCheckpoint=false」正面打架；要补哪个 KC 改在检查阶段的指令里点名。
  if (phaseView) {
    context.branchDirective = [buildBranchDirective(previousBranchState, lessonContract)]
      .filter(Boolean)
      .join('\n') || null;
  }

  // 独立锚题探针（Q13/B4）：只在"本轮会出检查点"时才可能投放（复用检查点槽位，纪律 3）。
  // 目标由代码选定后注入本轮提示词（buildTeachingTurnInput → controls.anchorProbe），
  // 并在落库 pendingCheckpoint 时打上 purpose='anchor'（见下方检查点产生分支）。
  const anchorTarget = await resolveAnchorProbeTarget({
    userId: session.userId,
    teachingState: previousTeachingState,
    emitCheckpoint: phaseView ? phaseView.emitCheckpoint : shouldEmitCheckpoint(session, previousTeachingState),
    learnerProjection: context.learnerProjection,
    // Q8 数据供给：全量已掌握 lastSeenAt（不被 recentConceptLedger 12 条截断）
    masteredLastSeenAt: context.anchorMasteredLastSeenAt,
    messageCount: updatedMessages.length,
    now: simulatedNowOr(),
  });
  // 断线续讲（resume-continue）本轮无学生新输入，session-resumed 是驱动"自然接续"的唯一信号。
  // 该事件必须在 buildTeachingTurnInput **之前**并入本轮可见事件——否则模型只从上一轮持久化的
  // classroomEventHistory 派生 recentEvents，本轮提示词里根本不存在（issue #165）；回合结束后再
  // 以同一对象 push 落库，保证本轮所见与下一轮历史逐字节一致。
  const resumedEvent = isResumeContinue
    ? buildClassroomEvent('session-resumed', '学生刚刚恢复本课堂会话，无新输入', {
        instruction: '自然地接续上一轮的教学推进：先一句话承接上次进度，再继续当前焦点知识点。不要询问"你想做什么/从哪继续"，不要重新自我介绍或重复开场。',
      })
    : null;

  // 给老师的正确答案文本（2026-11-26）：只在不会泄题的时点给——答对时，或这道题的重答次数已用完时。
  // 还能重答时不给：否则「先给一条线索、请他在卡片上再答一次」会变成照抄答案。
  const submittedCheckpointAttempts = submittedCheckpoint
    ? previousCheckpointRows.filter((row: any) => row?.checkpointId === submittedCheckpoint.id).length + 1
    : 0;
  const checkpointCorrectAnswer = describeCorrectAnswer(submittedCheckpoint);
  const exitTicketCorrectAnswer = exitTicketTurn.graded
    ? describeCorrectAnswer(exitTicketHistory[exitTicketHistory.length - 1])
    : null;
  const turnInput = await buildTeachingTurnInput({
    ...session,
    // 断线续讲：把 session-resumed 追加进本轮可见事件（非续讲回合不带该键，行为不变）。
    ...(resumedEvent
      ? {
          teachingState: {
            ...previousTeachingState,
            classroomEventHistory: [
              ...(Array.isArray(previousTeachingState.classroomEventHistory)
                ? previousTeachingState.classroomEventHistory
                : []),
              resumedEvent,
            ],
          },
        }
      : {}),
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
      ? {
          passed: options.checkpointJudgement.passed,
          detail: options.checkpointJudgement.detail ?? null,
          ...((options.checkpointJudgement.passed || submittedCheckpointAttempts >= CHECKPOINT_MAX_ATTEMPTS) && checkpointCorrectAnswer
            ? { correctAnswer: checkpointCorrectAnswer }
            : {}),
        }
      : null,
    exitTicketVerdict: exitTicketVerdict
      ? { ...exitTicketVerdict, ...(exitTicketCorrectAnswer ? { correctAnswer: exitTicketCorrectAnswer } : {}) }
      : null,
    ...(phaseView
      ? { emitCheckpoint: phaseView.emitCheckpoint, lessonPhase: phaseView }
      : {}),
    // 契约缺证据时必须给一次落证据的机会：常规节奏闸门按「当前焦点已考过/已收口」关闭，
    // 真课里就出现「核心 KC 缺独立证据、老师只能在正文里口头提问、证据永不落账」的死结。
    // 阶段协议下出题时机只有阶段机一个权威：forceCheckpoint 旁路不参与（它正是「小测跑步机」的发动机）。
    forceCheckpoint: !phaseView
      && previousLessonReport?.met === false
      && !previousTeachingState.pendingCheckpoint
      && ((Array.isArray(previousLessonReport.missingKcs) && previousLessonReport.missingKcs.length > 0)
        || independentGapKcs.length > 0)
      && previousTeachingAssistantCount >= 2
      // 2026-11-24 真跑复盘：刚判错就换题重测同一 KC（intervention 里也一样）会让课堂变成审讯。
      // 契约补证仍要落，但至少先让教师把「为什么错」讲两轮——冷却期由 checkpointHistory 的判错时刻计算。
      && !isCheckpointRetryCoolingDown(session, previousTeachingState)
      // 更强一层：唯一缺口就是刚判错的那个 KC 时，再测也拿不到「独立证据」（学生已被讲解/纠错），
      // 只会无限追打。此时停手，让本节 met=false 诚实收口，独立验证留给下一节。
      && !hasOnlyAlreadyFailedGaps([
        ...(Array.isArray(previousLessonReport.missingKcs) ? previousLessonReport.missingKcs : []),
        ...independentGapKcs,
      ], previousTeachingState),
  });
  // 教师补充材料（批次 E）：上一轮请求已入库 → 本轮把就绪载荷送进 scenario（模型可引用出处讲）。
  // 未就绪/刚过期 → 诚实回执 supplementStatus（supplementStatusForScenario）：此前零注入，
  // 学生秒回时老师只能「装失忆」，过期则静默吞掉承诺、永不交代（2026-11-22 切口 C）。
  if (supplementPromotion.payload) {
    (turnInput.scenario as Record<string, unknown>).supplementaryMaterial = supplementPromotion.payload;
  }
  const supplementStatus = supplementStatusForScenario(
    supplementPromotion,
    sessionArtifacts.supplement as SupplementSlot | undefined
  );
  if (supplementStatus) {
    (turnInput.scenario as Record<string, unknown>).supplementStatus = supplementStatus;
  }
  // 教学配图时机（代码裁决 → **显式**送进本轮输入）：上一轮画了字符结构 / 学生在描述位置 /
  // 当前任务本身就是结构化关系 → 本轮给模型一次出图机会。
  // 为什么必须显式送：实测埋在 2 万字 system prompt 里的规则会被忽略，写进本轮输入才生效。
  // 阶段协议下板书已在屏幕上时不再给「出图时机」：老师的一次性配图本来就会让位给常驻板（见下方 figure 分支），
  // 再塞一个出图信号只会让它白写一张 figure、或在正文里依赖一张不会出现的图。
  // 但「整课结构图」在点名/建构阶段不给机会：这一阶段正在一段一段建，预先画全图等于剧透后几段
  // 的关系（分段/时间邻近都破了）。等整合/迁移/审错再给，才是一张总结图。
  const deferWholeStructureFigure = shouldDeferWholeStructureFigure({
    phase: phaseView?.state.phase ?? null,
    hasBoard: Boolean(boardForTurn),
    reason: visualOpportunity?.reason ?? null,
  });
  const opportunityForTurn = deferWholeStructureFigure ? null : visualOpportunity;
  if (deferWholeStructureFigure) {
    logger.info('[AITeaching] 点名/建构阶段不给整课结构图机会（防剧透，留到整合后）', {
      sessionId: session.id,
      taskId: session.taskId,
      phase: phaseView?.state.phase ?? null,
    });
  }
  if (opportunityForTurn && !(phaseView && boardForTurn)) {
    (turnInput as { visualOpportunity?: typeof visualOpportunity }).visualOpportunity = opportunityForTurn;
  }
  // 白板上下文：**每轮都注入**——有板时是「板上写了什么」，没板时是一句正向的
  // 「本任务暂无板书，不要提及或假设任何图」（2026-11-03 心理学走查 S3-3）。
  // 为什么没板也要说话：提示词里「无 boardContext 则禁止看图指代」埋在 system prompt 里，
  // 真人走查实测会被忽略——模型靠"字段缺席"自己推断不出限制，于是假设有一块板并描述它的
  // 排布（一手「两栏」、一手「两个圈」）。正向告知写进本轮输入才生效。
  // 语义不翻转：figure/diagram 丢弃闸看的是 `board` 真值；提示词侧已按内容判（2026-11-03，rule15）；
  // #244 起文案与校验器信号同源（boardReachesStudent：degenerate 首版板永不下发，不得声称有板）。
  Object.assign(turnInput, boardPromptInputForTeacher(boardForTurn));
  // —— 学生贴链接·回合前预抓（2026-11-23，DeepSeek 调研 ③ 修正落法）——
  // URL 在调用模型前就能用正则确定性抽出：预抓（SSE reading-link 状态行）→ 注入本轮输入 →
  // **只调一次** teaching-turn（与 control.supplement 的二次调用不同路——那条路必须先答一轮
  // 才知道要不要搜；这条不需要）。独立配额（学生自带学习材料 ≠ 老师补料的每课 1 次）；
  // 闭卷/SSRF/配额不抓 → linkStatus 注入降级提示，老师明确说明而不是装没看见。
  let studentLinkPayload: { url: string; title: string; excerpt: string } | null = null;
  let studentLinkStatus: { status: string; url: string } | null = null;
  let studentLinkReadAttempted = false;
  {
    const previousLinkReadCount = Number(sessionArtifacts.linkReadCount || 0);
    const plan = planStudentLinkRead(message, sessionArtifacts, previousLinkReadCount);
    if (plan.action === 'read') {
      emitSupplementProgress('reading-link', plan.url);
      studentLinkReadAttempted = true;
      const outcome = await readStudentLink(session.userId, plan.url);
      if (outcome.ok && outcome.excerpt) {
        studentLinkPayload = { url: outcome.url, title: outcome.title || '学生发来的链接', excerpt: outcome.excerpt };
        logger.info('[AITeaching] 学生链接已读取并注入本轮', {
          sessionId,
          url: outcome.url,
          durationMs: outcome.durationMs,
          chars: outcome.excerpt.length,
        });
      } else {
        studentLinkStatus = { status: outcome.code || 'unreadable', url: plan.url };
        logger.info('[AITeaching] 学生链接读取失败，注入降级提示', {
          sessionId,
          url: plan.url,
          code: outcome.code,
          durationMs: outcome.durationMs,
        });
      }
    } else if (plan.action === 'skip' && (plan.reason === 'closed-book' || plan.reason === 'unsafe-url') && plan.url) {
      // 不抓但必须「看见」：注入 linkStatus 让老师明确说明（闭卷 → 请学生贴正文；可疑地址 → 同样引导贴正文，不提内部词）
      studentLinkStatus = { status: plan.reason === 'closed-book' ? 'closed-mode' : 'unsafe', url: plan.url };
    }
  }
  if (studentLinkPayload) {
    (turnInput.scenario as Record<string, unknown>).studentLinkMaterial = studentLinkPayload;
  }
  if (studentLinkStatus) {
    (turnInput.scenario as Record<string, unknown>).linkStatus = studentLinkStatus;
  }
  // 教学回合 wall-clock 超时兜底：LLM 挂起时避免操作租约（30min）被占导致会话内所有操作 409 BUSY；
  // 超时走 releaseOperation + 客户端重试路径（revision 未递增，重试安全）。
  // 阈值对齐 platform_settings.aiReliability.defaultRequestTimeoutMs（300s）：
  // 旧值 90s 会误杀正常回合——教学回合含 2 次 LLM 调用（模拟器 + teaching-turn），上游慢时单次即可超 90s。
  // 175-3：必须用 withTimeoutSignal 把超时信号透传进 executeSkill（→ callPrompt → gateway）——
  // 旧写法 withTimeout 自建的 controller 无人消费，超时 reject 后底层模型调用仍在跑，而 finally 已经
  // releaseOperation，于是「租约已释放但仍在烧 token」，并发新请求会与幽灵回合双花同一份预算。
  const turnStartedAt = Date.now();
  // let（非 const）：补充材料同轮复调（下方 sync 块）成功时会把整个回合结果换成本轮二次调用产出
  let turnResult = await withTimeoutSignal(
    (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
      contextEnvelope: {
        schemaVersion: 'context-envelope/v1',
        principal: { userId: session.userId },
        // conversationId 双写教学会话 id（与 goal 链路「会话标识双写」同模式）：
        // 供 resolveCacheSessionKey 做前缀缓存会话亲和，缺省会退化为 agentId（全体用户共享暖前缀）。
        session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
      },
      abortSignal: signal,
    }),
    300_000,
    'TEACHING_TURN_TIMEOUT: 教学回合执行超过 300 秒'
  );
  if (!turnResult.success) {
    throw new Error(typeof turnResult.error === 'string' ? turnResult.error : turnResult.error?.message || 'TEACHING_TURN_FAILED');
  }

  let turnRuntimeEnvelope = turnResult?.runtimeEnvelope || null;
  let rawTeachingOutput = extractTeachingOutput(turnResult);
  let promptDebug = extractTeachingPromptDebug(turnResult);
  // —— 教师补充材料·同轮同步复调（2026-11-23 设计定稿，外审「隔轮异步违约」正解）——
  // 主路径：截获 control.supplement → 带硬预算同步采集（search→选源→fetch→入库，与备课采集
  // 同源裁决 + 防注入纪律）→ 成功则同轮二次调用融合（与下方算式修复块同形态：scenario 注入 +
  // 共享前缀 KV 缓存；restart 事件让前端清掉草稿改流式展示），第二段产出作为本轮正式回复，
  // 槽位直写 delivered。失败/超时/闭卷 → 什么都不换：草稿过渡句照常落轮，既有异步链
  //（后台采集 + 下轮晋升 + supplementStatus 诚实回执）原样兜底——昨天的诚实回执从主路径
  // 降级为兜底层，一层不废。
  let supplementSyncOutcome: SupplementSyncOutcome | null = null;
  let supplementSyncSlot: SupplementSlot | null = null;
  let supplementSyncPayload: ReturnType<typeof buildSupplementPayload> = null;
  {
    const firstRequest = rawTeachingOutput?.control?.supplement;
    if (supplementSyncPlan(firstRequest, sessionArtifacts.supplement as SupplementSlot | undefined, sessionArtifacts)) {
      const syncStartedAt = Date.now();
      const topic = String(firstRequest.topic);
      emitSupplementProgress('searching', topic);
      const outcome = await fetchSupplementMaterialSync(session.userId, topic, String(firstRequest.query || topic));
      if (outcome.ok && outcome.materialId) {
        const payload = buildSupplementPayload(session.userId, outcome.materialId, topic);
        if (payload) {
          emitSupplementProgress('fusing', topic);
          (turnInput.scenario as Record<string, unknown>).supplementaryMaterial = payload;
          // recall 前重置 delta 消费位 + 发 restart：前端清掉草稿文本，改流式展示融合后的正式回复
          const streamRequest = getRequestContext()?.streamRequest;
          if (streamRequest) {
            streamRequest.consumed = false;
            streamRequest.onStream?.({ type: 'restart', attempt: 2 });
          }
          try {
            const recallResult = await withTimeoutSignal(
              (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
                contextEnvelope: {
                  schemaVersion: 'context-envelope/v1',
                  principal: { userId: session.userId },
                  session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
                },
                abortSignal: signal,
              }),
              300_000,
              'SUPPLEMENT_RECALL_TIMEOUT: 补充材料融合重调超时'
            );
            if (recallResult.success) {
              const fused = extractTeachingOutput(recallResult);
              if (fused?.reply) {
                turnResult = recallResult;
                turnRuntimeEnvelope = recallResult?.runtimeEnvelope || null;
                rawTeachingOutput = fused;
                promptDebug = extractTeachingPromptDebug(recallResult);
                supplementSyncOutcome = { ...outcome, ok: true, durationMs: Date.now() - syncStartedAt };
                supplementSyncPayload = payload;
                supplementSyncSlot = {
                  status: 'delivered',
                  topic,
                  query: String(firstRequest.query || topic),
                  requestedAt: new Date().toISOString(),
                  requestedTurn: updatedMessages.length,
                  deliveredTurn: updatedMessages.length,
                  materialId: payload.materialId,
                  materialTitle: payload.title,
                  sourceUrl: payload.sourceUrl,
                };
              }
            }
          } catch (error) {
            logger.warn('[AITeaching] 补充材料融合重调失败，按草稿过渡句放行（异步链兜底）', {
              sessionId,
              topic,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      if (!supplementSyncOutcome) {
        supplementSyncOutcome = { ...outcome, ok: false, durationMs: Date.now() - syncStartedAt };
      }
      logger.info('[AITeaching] 补充材料同轮复调收口', {
        sessionId,
        topic,
        mode: supplementSyncOutcome.ok ? 'sync' : 'fallback',
        outcomeError: outcome.error ?? null,
        durationMs: supplementSyncOutcome.durationMs,
        materialId: outcome.materialId ?? null,
      });
    }
  }
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
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              // 175-3：修复重调同样要能取消——超时后放行原回复，但底层重调必须停，不能继续占租约外的 token。
              abortSignal: signal,
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
  // 出题附料确定性检测（修复批 11-②，交流体验评审 §20.4#2「盲答判对」）：正文抛选择题形态
  // 而本轮既无 control.checkpoint（结构化选项由前端渲染）、正文也无内联选项列表——学员只能
  // 盲答，教师还会采认盲答（u19 实证），评估作废。命中即带修复指令重调一次（与第一刀同形态：
  // scenario.repairInstruction + 前缀 KV 缓存）；复检仍缺→打遥测放行，绝不阻塞课堂。
  {
    const bareChoice = findUnfurnishedChoiceQuestion(
      rawTeachingOutput?.reply,
      !!(rawTeachingOutput?.control?.checkpoint?.options?.length),
    );
    if (bareChoice) {
      logger.warn('[AITeaching] 正文裸选择题（无选项/无材料），触发附料修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        snippet: bareChoice.snippet,
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `你上一条回复在正文里出了一道选择题（「${bareChoice.snippet}」），但选项没有随文给出——学生只能盲答，这会让作答与评估都失效。本轮必须输出修正后的完整回复：要么把选项完整列出（逐项编号或 A/B/C 随文给出，选项材料必须在你给出的内容里），要么改成不需要选项的问法（让学生用自己的话作答、或直接对上文材料作答）；其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'CHOICE_MATERIAL_REPAIR_TIMEOUT: 附料修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && !findUnfurnishedChoiceQuestion(
              candidate.reply,
              !!(candidate.control?.checkpoint?.options?.length),
            )) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 附料修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.choiceQuestion', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-supply-options-instruction' : 'flagged-only',
        rootCauseMessage: `bare choice question without options/material: ${bareChoice.snippet}`,
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 简答题答案键缺件（2026-11-26 A6 实录 + 工程外审 P1）：short_answer 不带 expectedKeywords
  // 等于一张没有评分标准的裸题——判分只能退回模型参考判定，还会多耗一个回合。
  // 处理顺序与上一条裸选择题同形：先带修复指令重调一次；复检仍缺→本题不上屏（从输出里摘掉题卡，
  // 并剪掉正文末尾的悬空追问），打遥测。阶段机这一轮 checksInPhase 不加，下一轮仍会要求出题，
  // 指令会再次点名「答案键必须给」。
  {
    const checkpointDraft = rawTeachingOutput?.control?.checkpoint;
    const hasExpectedKeywords = Array.isArray(checkpointDraft?.expectedKeywords)
      && checkpointDraft!.expectedKeywords.some((keyword) => String(keyword ?? '').trim());
    if (checkpointDraft?.type === 'short_answer' && !hasExpectedKeywords) {
      logger.warn('[AITeaching] 简答题缺 expectedKeywords，触发补键重调', {
        userId: context.userId,
        taskId: context.taskId,
        question: String(checkpointDraft.question ?? '').slice(0, 80),
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = '你上一条回复里的简答题没有给 expectedKeywords（评分要点），这张题无法判定对错。本轮必须输出修正后的完整回复：为这道简答题补 1–3 组 expectedKeywords（每组只放「任何正确作答都会出现的核心词」，同义写法用半角竖线 | 并列；不得用题干里已经出现的词），其余内容（讲解、知识看板、control 字段、语气、篇幅）原样保留；绝不可向学生提及任何校验或系统检查。';
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'SHORT_ANSWER_KEY_REPAIR_TIMEOUT: 补答案键重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            const repairedCheckpoint = candidate?.control?.checkpoint;
            if (candidate?.reply
              && repairedCheckpoint?.type === 'short_answer'
              && Array.isArray(repairedCheckpoint.expectedKeywords)
              && repairedCheckpoint.expectedKeywords.some((keyword) => String(keyword ?? '').trim())) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 补答案键重调失败', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['checkpoint.expectedKeywords', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-supply-answer-key' : 'drop-checkpoint',
        rootCauseMessage: `short_answer checkpoint without expectedKeywords: ${String(checkpointDraft.question ?? '').slice(0, 120)}`,
      });
      if (repairedOutput) {
        rawTeachingOutput = repairedOutput;
      } else if (rawTeachingOutput) {
        // 补不回来：不上屏。剪掉正文末尾那道题的追问，避免学生看到一道没有作答卡的悬空题。
        if (rawTeachingOutput.control) {
          delete (rawTeachingOutput.control as { checkpoint?: unknown }).checkpoint;
        }
        rawTeachingOutput = { ...rawTeachingOutput, reply: stripTrailingQuestionParagraph(rawTeachingOutput.reply || '') };
      }
    }
  }
  // 指认-板面交叉核对（修复批 13-①，BOARD_MISMATCH 指认落空形态可复算杠杆，§22.3 定性）：
  // reply 里带板面指认语境的引号片段（看板上「X」/标着「X」的那条线）在当前持久板面上找不到，
  // 学习者按指认看板会对不上（批 L/M 实证：指认的连线 rev 里不存在、右栏行数不符）。命中即带
  // 修复指令重调一次（同前两刀机制）；复检仍缺→打遥测放行，绝不阻塞课堂。
  if (board) {
    const boardFaceText = collectSpecTextFragments(
      board.figure?.maskedSpec ?? board.figure?.fullSpec ?? null,
    ).join(' ');
    const priorTeacherText = updatedMessages
      .filter((m) => m?.role === 'assistant')
      .map((m) => String((m as { content?: unknown }).content ?? ''))
      .join('\n');
    const boardRefMisses = findUnmatchedBoardReferences({
      reply: rawTeachingOutput?.reply,
      boardText: boardFaceText,
      priorTeacherText,
      // 滞后引用判定（批 38-③）：历史板面出现过、当前已无的指认对象不再被引对话豁免
      priorBoardText: (parseSessionArtifacts(session.teachingState).boardHistory as
        | Array<{ spec: Record<string, unknown> }>
        | undefined)
        ?.map((h) => collectSpecTextFragments(h?.spec ?? null).join(' '))
        .join(' '),
    });
    if (boardRefMisses.misses.length > 0) {
      logger.warn('[AITeaching] 板面指认与当前板面不符（指认落空），触发修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        misses: boardRefMisses.misses,
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `你上一条回复指认了板面上的具体内容（${boardRefMisses.misses.map((m) => `「${m}」`).join('、')}），但当前板面上找不到它们——学习者按指认看板会对不上。本轮必须输出修正后的完整回复：要么把指认改为当前板面上真实存在的元素（引号内逐字使用板面现有文本），要么删去对不存在元素的指认、只用口头讲解承接；其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'BOARD_REFERENCE_REPAIR_TIMEOUT: 板面指认修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && findUnmatchedBoardReferences({
              reply: candidate.reply,
              boardText: boardFaceText,
              priorTeacherText,
              priorBoardText: (parseSessionArtifacts(session.teachingState).boardHistory as
                | Array<{ spec: Record<string, unknown> }>
                | undefined)
                ?.map((h) => collectSpecTextFragments(h?.spec ?? null).join(' '))
                .join(' '),
            }).misses.length === 0) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 板面指认修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.boardReference', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-board-reference-instruction' : 'flagged-only',
        rootCauseMessage: `board references not found on current board: ${boardRefMisses.misses.join(' | ').slice(0, 160)}`,
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 位置/槽位指认存在性守卫（修复批 38-①，u01L2 reeval31 实证：位置/计数形态没有引号片段，
  // 批 13-① 内容守卫抓不住——「右栏第 3 行我留了空槽」而右栏只有 2 行）。F1 越界行/帧指认
  // + F2 空槽承诺无空位 → 修复指令重调一次；复检仍犯→打遥测放行，绝不阻塞课堂。
  if (board) {
    const positionSpec = board.figure?.maskedSpec ?? board.figure?.fullSpec ?? null;
    const positionMisses = findDanglingBoardPositionReferences({
      reply: rawTeachingOutput?.reply,
      spec: positionSpec,
    });
    if (positionMisses.misses.length > 0) {
      logger.warn('[AITeaching] 板面位置指认越界/空槽承诺无空位，触发修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        misses: positionMisses.misses,
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `你上一条回复指认了板面上的位置（${positionMisses.misses.map((m) => `「${m}」`).join('、')}），但当前板面上不存在这些位置——学习者按指认去找会落空。本轮必须输出修正后的完整回复：先数一遍当前板面的行数/帧数，把指认改到真实存在的行/格/帧上（或逐字引用板面现有文本），也可以删去该位置指认、只用口头讲解承接；其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'BOARD_POSITION_REPAIR_TIMEOUT: 板面位置指认修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && findDanglingBoardPositionReferences({
              reply: candidate.reply,
              spec: positionSpec,
            }).misses.length === 0) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 板面位置指认修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.boardPositionRef', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-board-position-ref-instruction' : 'flagged-only',
        rootCauseMessage: `dangling board position references: ${positionMisses.misses.join(' | ').slice(0, 160)}`,
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 无板面时的板面指认检测（修复批 15-②，BOARD_DANGLING_TRACE 批 14 critical：本课无板面
  // 而教师用「看板上/那份图」说话——学习者面对不存在的参照物）。命中即带修复指令重调一次：
  // 删去板面指认、用口头描述承接；复检仍犯→打遥测放行。
  if (!board) {
    const absentBoardRef = referencesBoardWithoutBoardAvailable(rawTeachingOutput?.reply);
    if (absentBoardRef) {
      logger.warn('[AITeaching] 本课无板面而回复指认板面（证据链断裂），触发修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        snippet: absentBoardRef.snippet,
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `你上一条回复指认了板面/图示（「${absentBoardRef.snippet}」），但本课当前没有任何板面——学习者在屏幕上找不到你说的那份材料。本轮必须输出修正后的完整回复：删去对板面/图示的指认，把需要指认的内容改用口头完整描述（原句引用任务材料原文即可）；其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'BOARD_ABSENT_REPAIR_TIMEOUT: 无板面指认修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && !referencesBoardWithoutBoardAvailable(candidate.reply)) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 无板面指认修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.boardReference', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-board-absent-instruction' : 'flagged-only',
        rootCauseMessage: `board referenced but no board exists: ${absentBoardRef.snippet}`,
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 已答不推进守卫（修复批 19-①，F_LOOP u17 批 R critical 可复算杠杆）：学员实质性作答后
  // 教师原样重复同一问句——学员开始自我怀疑（「是不是我没理解对」）。命中即带修复指令重调
  // 一次（先反馈作答再推进）；复检仍犯→打遥测放行。
  {
    const prevAssistant = findPreviousAssistantReply(updatedMessages);
    const repeatedQuestion = findRepeatedQuestionAfterAnswer({
      priorTeacherReply: prevAssistant,
      learnerReply: message,
      currentReply: rawTeachingOutput?.reply,
    });
    if (repeatedQuestion) {
      logger.warn('[AITeaching] 学员已作答而教师原样重复同一问句（已答不推进），触发修复重调', {
        userId: context.userId,
        taskId: context.taskId,
        repeated: repeatedQuestion.repeated,
      });
      let repairedOutput: TeachingTurnOutput | null = null;
      if (Date.now() - turnStartedAt < ARITHMETIC_REPAIR_BUDGET_MS) {
        try {
          (turnInput.scenario as Record<string, unknown>).repairInstruction = `学员刚刚已经回答了你的提问（「${repeatedQuestion.repeated}」），你却在原样重复同一个问题——这会让学员怀疑自己理解错了。本轮必须输出修正后的完整回复：第一句先对学员的作答给出明确反馈（对/不对+一句话为什么），然后推进到下一步（新情形追问/下一知识点/更小一步），不得原样重复上一轮的任何问句；其余内容（知识看板、检查点、control 字段、语气、篇幅）原样保留；不得缩短回复或趁机改写无关内容；绝不可向学生提及任何校验或系统检查。`;
          const repairResult = await withTimeoutSignal(
            (signal) => executeSkill(teachingTurnAgentDefinition, turnInput, {
              contextEnvelope: {
                schemaVersion: 'context-envelope/v1',
                principal: { userId: session.userId },
                session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
              },
              abortSignal: signal,
            }),
            ARITHMETIC_REPAIR_TIMEOUT_MS,
            'QUESTION_LOOP_REPAIR_TIMEOUT: 已答不推进修复重调超时'
          );
          if (repairResult.success) {
            const candidate = extractTeachingOutput(repairResult);
            if (candidate?.reply && !findRepeatedQuestionAfterAnswer({
              priorTeacherReply: prevAssistant,
              learnerReply: message,
              currentReply: candidate.reply,
            })) {
              repairedOutput = candidate;
            }
          }
        } catch (error) {
          logger.warn('[AITeaching] 已答不推进修复重调失败，按原回复放行', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.questionLoop', `task:${context.taskId}`],
        mitigationApplied: repairedOutput ? 'retry-answered-advance-instruction' : 'flagged-only',
        rootCauseMessage: `question repeated after substantive learner answer: ${repeatedQuestion.repeated}`,
      });
      if (repairedOutput) rawTeachingOutput = repairedOutput;
    }
  }
  // 指称修正（2026-11-26）：老师把「列」说成「行」（或反之）时按板上标签原文改回，不重调模型。
  // 实录里老师两次说「「[H] 由谁产生」那一行」而它是列——学生按「行」去找找不到，指令不可执行。
  if (rawTeachingOutput?.reply && boardForTurn) {
    const deixis = fixBoardAxisDeixis(rawTeachingOutput.reply, boardForTurn);
    if (deixis.fixed.length > 0) {
      logger.info('[AITeaching] 板书指称修正：行列称谓与板上标签对不上，已按标签改回', {
        sessionId: session.id,
        fixes: deixis.fixed.slice(0, 4),
      });
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.boardDeixis'],
        mitigationApplied: 'fix-board-axis-deixis-by-label',
        rootCauseMessage: deixis.fixed.slice(0, 4).join(' ｜ '),
      });
      rawTeachingOutput = { ...rawTeachingOutput, reply: deixis.reply };
    }
  }
    // 检查点反馈硬门（拍板 #5 切口1，2026-10-08）：代码判错的作答回合，老师回复不得出现
  // 肯定语——此前只有提示词软约束（b52576b4 裁决注入），话术与判分脱钩从未被度量与拦截。
  // 命中即句子级剥离 + 遥测（MODEL_AFFIRMATION_MISMATCH）；切口2 的落库计数=本遥测为分子、
  // learner_evidence 的 code 失败 checkpoint:result 行为分母。整句全中/剥后过短时
  // flagged-only 放行原文（回复不能被剥空）。纯函数与样本库见 checkpoint-feedback-guard.ts。
  if (rawTeachingOutput?.reply && submittedCheckpoint
    && options.checkpointJudgement?.judgedBy === 'code'
    && options.checkpointJudgement.passed === false) {
    const screened = stripAffirmationsOnFailedVerdict(rawTeachingOutput.reply);
    if (screened.stripped.length > 0) {
      logger.warn('[AITeaching] 检查点判错但回复含肯定语（反馈硬门）', {
        sessionId: session.id,
        checkpointId: submittedCheckpoint.id,
        strippedCount: screened.stripped.length,
        applied: screened.applied,
        samples: screened.stripped.slice(0, 3),
      });
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'MODEL_AFFIRMATION_MISMATCH',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.affirmation', `task:${context.taskId}`],
        mitigationApplied: screened.applied ? 'strip-affirmation-sentences' : 'flagged-only',
        rootCauseMessage: screened.stripped.slice(0, 3).join(' ｜ '),
      });
      if (screened.applied) {
        rawTeachingOutput = { ...rawTeachingOutput, reply: screened.reply };
      }
    }
  }
  // 检查点反馈硬门（对称方向，2026-10-28 f3 实拍）：代码判对、模型却否定作答。
  // 实测答案键 A / 学生选 A / checkpointHistory.passed=true，模型仍说「这道不对」并逼学生重写三行。
  // 命中即换成确定性确认（保留原回复最后一个问句），并单列遥测；不阻断课堂。
  if (rawTeachingOutput?.reply && submittedCheckpoint
    && options.checkpointJudgement?.judgedBy === 'code'
    && options.checkpointJudgement.passed === true) {
    const repaired = repairContradictedPassedVerdict(rawTeachingOutput.reply);
    if (repaired !== rawTeachingOutput.reply) {
      logger.warn('[AITeaching] 检查点判对但回复否定作答（反馈硬门·对称）', {
        sessionId: session.id,
        checkpointId: submittedCheckpoint.id,
        before: String(rawTeachingOutput.reply).slice(0, 120),
        after: repaired.slice(0, 120),
      });
      recordDegradation({
        source: 'ai-teaching/teaching-turn-engine',
        faultCategory: 'MODEL_NEGATION_ON_PASSED_CHECKPOINT',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['teachingReply.verdict', `task:${context.taskId}`],
        mitigationApplied: 'replace-with-deterministic-confirmation',
        rootCauseMessage: String(rawTeachingOutput.reply).slice(0, 200),
      });
      rawTeachingOutput = { ...rawTeachingOutput, reply: repaired };
    }
  }
  // 裁决句兜底（2026-11-26）：上面两道硬门都是「命中才修」——模型只要不写裁决句就都放行。实录里学生
  // 看到作答处标红，老师却说「你选的是 A，我们来看看…」，通篇没说对错。代码裁决回合，反馈首句必须
  // 明确给结论；没有就补一句确定性裁决（不替换模型的话术）。课末终检的裁决回合同理。
  {
    const checkpointVerdictTurn = !!submittedCheckpoint && options.checkpointJudgement?.judgedBy === 'code';
    const exitVerdictTurn = exitTicketTurn.graded && !!exitTicketVerdict;
    if (rawTeachingOutput?.reply && (checkpointVerdictTurn || exitVerdictTurn)) {
      const verdictPassed = checkpointVerdictTurn
        ? options.checkpointJudgement!.passed === true
        : exitTicketVerdict!.passed === true;
      const aligned = ensureVerdictOpening(rawTeachingOutput.reply, verdictPassed);
      if (aligned !== rawTeachingOutput.reply) {
        logger.info('[AITeaching] 反馈首句未给裁决，已补确定性裁决句', {
          sessionId: session.id,
          verdictPassed,
          before: String(rawTeachingOutput.reply).slice(0, 80),
        });
        recordDegradation({
          source: 'ai-teaching/teaching-turn-engine',
          faultCategory: 'SCHEMA_VIOLATION',
          severity: 'P2_DEGRADED',
          impactedDimensions: ['teachingReply.verdict', `task:${context.taskId}`],
          mitigationApplied: 'prepend-deterministic-verdict-opening',
          rootCauseMessage: `reply opened without a verdict on a code-judged turn (passed=${verdictPassed})`,
        });
        rawTeachingOutput = { ...rawTeachingOutput, reply: aligned };
      }
    }
  }
  // 失败检查点概念的**后续回合**肯定语护栏（#84，2026-10-19 实证）：提交轮硬门只管当轮——
  // zhongkao-streaming 批实测两次 code failed（缺要点）后，老师在随后自由回合仍称
  // 「你答对了/这一关你走通了」。口径收紧（精度优先）：仅当本回合知识点命中会话内
  // code 失败概念时剥离；遥测单列一类，不污染切口2 一致性口径（#85 双臂 A 臂可显式关闭）。
  const judgingFailedThisTurn = !!(submittedCheckpoint
    && options.checkpointJudgement?.judgedBy === 'code'
    && options.checkpointJudgement.passed === false);
  if (options.failedConceptFollowupGuard !== false && rawTeachingOutput?.reply && !judgingFailedThisTurn) {
    const failedConceptNames = buildCheckpointCodeArbitration(previousTeachingState.checkpointHistory).codeFailedConceptNames;
    if (shouldGuardReplyForFailedConcept({
      currentPoint: rawTeachingOutput.knowledge?.currentPoint,
      failedConceptNames,
      judgingThisTurn: judgingFailedThisTurn,
    })) {
      const screened = stripAffirmationsOnFailedVerdict(rawTeachingOutput.reply);
      if (screened.stripped.length > 0) {
        logger.warn('[AITeaching] 失败检查点概念的后续回合仍含肯定语（#84 护栏）', {
          sessionId: session.id,
          currentPoint: rawTeachingOutput.knowledge?.currentPoint,
          failedConceptNames: failedConceptNames.slice(0, 3),
          strippedCount: screened.stripped.length,
          applied: screened.applied,
        });
        recordDegradation({
          source: 'ai-teaching/teaching-turn-engine',
          faultCategory: 'MODEL_AFFIRMATION_AFTER_FAILED_CHECKPOINT',
          severity: 'P2_DEGRADED',
          impactedDimensions: ['teachingReply.affirmation', `task:${context.taskId}`],
          mitigationApplied: screened.applied ? 'strip-affirmation-sentences' : 'flagged-only',
          rootCauseMessage: screened.stripped.slice(0, 3).join(' ｜ '),
        });
        if (screened.applied) {
          rawTeachingOutput = { ...rawTeachingOutput, reply: screened.reply };
        }
      }
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
  // 自由需求分型 → 支线判定（2026-11-19）：模型只报「学生这轮想要什么」，代码决定进哪条支线、
  // 还有多少预算、下一轮是否强制回主线。支线正确不冒充核心 KC 的独立证据。
  const studentNeed = normalizeStudentNeed((rawTeachingOutput as any)?.analysis?.studentNeed);
  const branchDecision = resolveBranchDecision({
    need: studentNeed,
    contract: lessonContract,
    state: previousBranchState,
    message,
    focusKc: teachingOutput.knowledge?.currentPoint || null,
  });
  if (branchDecision.branch !== 'spine') {
    logger.info('[AITeaching] 课堂支线判定', {
      sessionId,
      need: studentNeed,
      branch: branchDecision.branch,
      active: branchDecision.state.active,
      turnsUsed: branchDecision.state.turnsUsed,
      budget: branchDecision.state.budget,
      parkingCount: branchDecision.state.parkingLot.length,
    });
  }
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
  // #48 P-22：掌握下降事件计数——负证据降级分支是否真的可达，必须有可观测读数
  // （只升不降若仍是常态，难度控制与完课判定的输入不可信）。累加进 teachingState，
  // 由 `npm run mastery:degrade-audit` 汇总「每百课下降事件数」。
  const masteryDegrade = knowledgeStateService.diffMastery(existingPoints, mergedKnowledge);
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
  // 延伸学（#124）：延伸课不产生「完成」终态——它不是任务结算课，教师可一直陪学到学员主动结束
  // （finalize 仅允许 end_only）。任务完成判据仍照常计算并留痕，只是不把完成信号发出去。
  const extensionMode = session.mode === 'extension';
  // 终检刚通过：收束轮不该再带新的追问（模型常会「顺手再验一处」，把课又拖下去）；
  // 去掉末尾追问段，并允许本轮直接收束（终检本身就是最后一道关）。
  const exitTicketJustPassed = exitTicketGradedThisTurn && exitTicketState?.status === 'passed';
  if (exitTicketJustPassed) {
    teachingOutput.reply = stripTrailingQuestionParagraph(teachingOutput.reply || '');
  }
  // 课堂阶段协议（2026-11-26）：完成信号由阶段机给——课走完「点名→建构→整合→迁移→审错→收束」且学生
  // 已给出总结才允许收束。此前靠模型自报 + 看板进度，实录里 4 轮就把一节哲学课判完了。
  const rawCompletionSignal = !extensionMode && (phaseView
    ? phaseView.state.phase === 'close' && phaseView.completionDue
    : targetsConsolidated || backstopReady || softCompletionReady);
  const completionSignal = rawCompletionSignal || exitTicketJustPassed;
  // 课堂契约证据账本（2026-11-19）：只认已通过的检查点 + 课末终检 + 看板掌握；
  // 独立证据要求代码裁决且首答正确。本回合刚提交的检查点尚未写入 checkpointHistory，这里显式并入。
  // 同一份作答元数据用于当轮契约和随后持久化的历史，避免重答在当轮被误算为首答。
  const submittedConceptFallback = submittedCheckpoint && !submittedCheckpoint.conceptName
    ? resolveCheckpointConceptAttribution(mergedKnowledge[mergedKnowledge.length - 1]?.name || '')
    : null;
  const checkpointAttempt = submittedCheckpoint ? {
    checkpointId: submittedCheckpoint.id,
    submittedAt: new Date().toISOString(),
    attempts: (Array.isArray(previousTeachingState.checkpointHistory)
      ? previousTeachingState.checkpointHistory.filter((row) => row?.checkpointId === submittedCheckpoint.id).length
      : 0) + 1,
    ...(submittedCheckpoint.conceptName || submittedConceptFallback?.conceptName
      ? { conceptName: submittedCheckpoint.conceptName || submittedConceptFallback?.conceptName } : {}),
    ...(submittedCheckpoint.conceptKey || submittedConceptFallback?.conceptKey
      ? { conceptKey: submittedCheckpoint.conceptKey || submittedConceptFallback?.conceptKey } : {}),
    ...(submittedCheckpoint.answerAlreadyGiven === true ? { answerAlreadyGiven: true as const } : {}),
  } : null;
  const currentCheckpointRows = (options.checkpointId && checkpointAttempt && options.checkpointJudgement)
    ? [{
        ...checkpointAttempt,
        passed: options.checkpointJudgement.passed === true,
        judgedBy: options.checkpointJudgement.judgedBy,
      }]
    : [];
  const lessonEvidence = collectLessonEvidence({
    contract: lessonContract,
    checkpointHistory: [
      ...(Array.isArray(previousTeachingState.checkpointHistory) ? previousTeachingState.checkpointHistory : []),
      ...currentCheckpointRows,
    ],
    exitTickets: exitTicketState ? [exitTicketState] : [],
    knowledgeState: mergedKnowledge,
    teachingTurns,
    // 阶段协议下，收束之前看板证据要过「点名门」：这个 KC 全课一次没被提到，不算已覆盖。
    // 收束阶段放行旧口径——点名门是启发式（提到 ≠ 讲透），不能让它把课卡在结课前。
    ...(phaseView && phaseView.state.phase !== 'close'
      ? { taughtText: `${taughtSoFar}\n${String(teachingOutput.reply || '')}\n${JSON.stringify(boardForTurn?.figure?.maskedSpec ?? '')}` }
      : {}),
  });
  const contractEvaluation = evaluateLessonContract({
    contract: lessonContract,
    evidence: lessonEvidence,
    teachingTurns,
  });
  // 只有「建课时已落库」的契约才作为完成硬门（旧会话/单测夹具没有契约 → 保持旧完成口径）；
  // 引擎补建的契约仅用于提示词与观测，不改变完成率。
  const persistedContract = sessionArtifacts.lessonContract as LessonContract | undefined;
  const contractEnforced = !!persistedContract
    && persistedContract.coreKcs?.length > 0
    && process.env.LESSON_CONTRACT_ENFORCE !== '0';
  const contractBlocked = contractEnforced && !contractEvaluation.met;

  // 课末独立终检（2026-11-19）：收束信号出现时，先过一道与课内检查点分离的终检题；
  // - 未发过/上一题失败 → 生成新题（每题都是新情境），本轮不完成；
  // - 待作答 → 不完成；
  // - 通过 → 计入契约独立证据，允许完成；
  // - 失败次数用尽 → 不再发题，契约/终检未通过按未达成处理（交给停课/结算门）。
  const exitTicketPassed = exitTicketState?.status === 'passed';
  const exitTicketPending = exitTicketState?.status === 'pending';
  let exitTicketBlocked = false;
  // 选择题只认选项字母。学生若整句作答，解析不出选项时不要把答案判负：
  // 保持 pending，本轮重贴题面与选项，下一轮按字母作答即可（不消耗次数）。
  if (exitTicketFormatMiss && exitTicketState?.status === 'pending' && !extensionMode) {
    appendExitTicketToReply(teachingOutput, exitTicketState);
    if (teachingOutput.control) delete teachingOutput.control.checkpoint;
    exitTicketBlocked = true;
  }
  if (contractEnforced && rawCompletionSignal) {
    if (exitTicketPending) {
      exitTicketBlocked = true;
    } else if (!exitTicketPassed && exitTicketAttempts < MAX_EXIT_TICKET_ATTEMPTS) {
      // 失败后的同一回合先由老师补救，不在学生刚答错的这一轮立刻再发一道新终检。
      if (exitTicketGradedThisTurn) {
        exitTicketBlocked = true;
      } else {
        const generated = await generateExitTicketForLesson({
          subject: context.subject,
          topic: context.topic,
          taskTitle: context.taskTitle,
          taskMaterial: context.taskMaterialPayload ?? null,
          contract: lessonContract,
          evidence: lessonEvidence,
          messages: session.messages,
          attempts: exitTicketAttempts,
        });
        if (generated) {
          exitTicketState = generated;
          exitTicketHistory.push(generated);
          exitTicketBlocked = true;
          appendExitTicketToReply(teachingOutput, generated);
          // 终检与课内检查点不同槽：同轮不再叠加一道检查点。
          if (teachingOutput.control) delete teachingOutput.control.checkpoint;
          logger.info('[AITeaching] 课末终检已发出', {
            sessionId,
            conceptName: generated.conceptName,
            type: generated.type,
            attempt: exitTicketAttempts + 1,
          });
        }
      }
    } else if (!exitTicketPassed) {
      exitTicketBlocked = true;
    }
  }
  if (contractBlocked && rawCompletionSignal) {
    logger.info('[AITeaching] 课堂契约未达成：完成信号暂缓', {
      sessionId,
      covered: contractEvaluation.coveredKcs,
      missing: contractEvaluation.missingKcs,
      independent: `${contractEvaluation.independentCount}/${contractEvaluation.requiredIndependent}`,
      reasons: contractEvaluation.reasons,
    });
  }
  // 只有「本轮本来会发完成信号」时，收口门禁才有意义。此前无论是否会完成，
  // 只要回复带问号就 +1，长课里前 6 个普通提问就把绝对上限/唯一宽限消耗光，
  // 课末真正的新末问反而被直接收掉（外部独立评审 P0）。
  const wouldComplete = completionSignal
    && !contractBlocked
    && !exitTicketBlocked;
  const closureGate = wouldComplete
    ? shouldDeferCompletionForClosure({
        reply: teachingOutput.reply || '',
        pendingCheckpoint: previousTeachingState.pendingCheckpoint,
        checkpointEmittedThisTurn: !!teachingOutput.control?.checkpoint,
        emittedCheckpointQuestion: typeof teachingOutput.control?.checkpoint?.question === 'string'
          ? teachingOutput.control.checkpoint.question
          : null,
        priorDeferrals: Number(previousTeachingState.completionDeferrals) || 0,
        previousDeferredQuestion: typeof previousTeachingState.completionDeferralQuestion === 'string'
          ? previousTeachingState.completionDeferralQuestion
          : null,
        priorDeferralsForSameQuestion: Number(previousTeachingState.completionDeferralQuestionCount) || 0,
        capGraceUsed: previousTeachingState.completionCapGraceUsed === true,
      })
    : { defer: false, reason: null as null, questionKey: null as string | null };
  // 收尾循环打断（2026-11-13 u07 实证）：内容讲完后老师连续多轮重发近同构收尾话术、
  // 学员只会「好/收到/回去练」，完成信号却因软进度地板/模型信号未齐而永不落地——
  // 10 分钟被同义重复占满，黑盒侧 confirm_complete 一直可点但实验被循环拖到 abandon。
  // 循环信号 = 老师连续收尾（收尾话术或模型自报完成候选）且学员无新问题；连续 ≥3 轮
  // 且知识面已冻结、无 pending 检查点时，绕过软条件强制放行完成信号，让完成确认面板
  // 出现。finalize 门禁按 closureLoopBreakReleased 同步放行（#164 两门禁同源纪律）。
  const priorClosureRepeatStreak = Number(previousTeachingState.closureRepeatStreak) || 0;
  const learnerHasNewQuestion = /[?？]/.test(String(message || ''))
    || detectOpenRequest(String(message || ''));
  // 循环信号两种形态都要认（锚点样本 2026-11-13 实证：复述循环未必带「到这儿收」类收尾词）：
  // ① 显式收尾话术 / 模型自报完成候选；② 与上一轮回复低增量重复（teaching-repetition-guard 同源判据）。
  const adjacentRepetition = assessAdjacentRepetition(
    findPreviousAssistantReply(updatedMessages),
    teachingOutput.reply || '',
  );
  const closureRepeatStreak = (replySignalsClosing || modelRequestedCompletion || adjacentRepetition.lowIncrement) && !learnerHasNewQuestion
    ? priorClosureRepeatStreak + 1
    : 0;
  // 学员短确认收口（修复批 13-②，repetitive_closure_loop 取证定性）：任务宣布结束后教师反复
  // 重发同一作业指令（「去练/贴回来」）、学员只会「马上去/好」——旧强制收口需要 targetsFrozen，
  // 多任务会话的后续任务不满足，循环持续十轮。短确认 ×2 + 教师低增量 ×streak≥2 本身即为收口
  // 条件（不依赖 targetsFrozen）：教师若真在推进新内容，lowIncrement 为 false 不触发。
  const learnerShortAckStreak = computeLearnerShortAckStreak(updatedMessages);
  const shortAckInstructionLoopBreak = closureRepeatStreak >= 2
    && learnerShortAckStreak >= 2
    && adjacentRepetition.lowIncrement;
  let completionReady = wouldComplete && !closureGate.defer;
  let forcedCompletionLoopBreak = false;
  if (!completionReady && !extensionMode && !contractBlocked
    && ((targetsFrozenBefore && noPendingPoints && closureRepeatStreak >= 3) || shortAckInstructionLoopBreak)) {
    completionReady = true;
    forcedCompletionLoopBreak = true;
    logger.warn('[AITeaching] 收尾循环打断：连续收尾话术且学员无新问题，强制放行完成信号', {
      sessionId: session.id,
      taskId: session.taskId,
      streak: closureRepeatStreak,
      learnerShortAckStreak,
      loopBreakKind: shortAckInstructionLoopBreak ? 'short-ack-instruction-loop' : 'frozen-targets',
      avgTargetProgress: Number(avgTargetProgress?.toFixed?.(3) ?? avgTargetProgress),
    });
  }
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
    extensionMode ? 'none'
      : targetsConsolidated ? 'targets'
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
  // 正文已定稿（护栏与收束判定都过了）：先把这句话发给用户，别让他等后面的伴学与板书。
  emitEarlyReplyDelta(effectiveTeachingOutput.reply);
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
    // （DB：4879 条中 userPayload 含【此前伴学对话】0 条）。与聊天路径（teaching-session-ops 的
    // processPeerMessage：从 peer 标记消息恢复 peerHistory）对齐取法：从已落库消息恢复
    // （peer 标记消息 + 内嵌在老师消息里的 peerMessage 插话，见 collectPeerHistory）。
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
          session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
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
      logger.warn('[AITeachingCoordinator] teaching-peer-reinforcement 失败', { error: e?.message || String(e) });
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

  // 恢复续讲信号：与 buildTeachingTurnInput 前注入的是同一对象（本轮已可见），此处并入落库历史
  if (resumedEvent) {
    classroomEvents.push(resumedEvent);
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

  // learnDebug 调试包已随 tsm debug 停写一并移除（B1）：其唯一消费者是
  // `promptDebug.learnDebug`（随消息落库的调试信封），观测走 llm_execution_attempts。

  // 数据还债 B1（2026-10-08）：promptDebug/peerDebug 不再随消息落 tsm——
  // 实测它们占 tsm payload 99.75%（3.45GB/日增 465MB），且与 prompt_call_logs
  // 的 userPayload/attemptTrace 冗余。调试观测走 llm_execution_attempts（traceId 可关联）。
  // 第三人称转述学生（2026-11-26 真课实录）：模型偶发把内部分析写进可见正文——
  // 「学生只说了「继续」，那就顺着往下讲。」。只剪开头这一句，剪空则保留原文。
  const narratedReply = stripLearnerNarrationOpening(teachingOutput.reply);
  if (narratedReply !== teachingOutput.reply) {
    teachingOutput.reply = narratedReply;
    effectiveTeachingOutput.reply = narratedReply;
  }
  // 点名困惑兜底（2026-11-27 苏格拉底论证课）：学生说「不知道是什么事情/啥意思」而正文
  // 仍没摆出可判断的材料时，代码把第一组材料插到最后一个问句之前——先有句子，再有判断。
  // 指令层已让模型自己摆；这里只兜住「材料在上下文里、模型却没贴」的那一种。
  if (phaseView?.state.phase === 'orient'
    && isLearnerConfusionSignal(message)
    && context.taskMaterialPayload) {
    const grounded = ensureConfusionMaterialOnScreen(teachingOutput.reply, context.taskMaterialPayload);
    if (grounded !== teachingOutput.reply) {
      teachingOutput.reply = grounded;
      effectiveTeachingOutput.reply = grounded;
      logger.info('[AITeaching] 点名困惑：材料未上屏，代码补摆第一组', {
        sessionId,
        taskId: session.taskId,
      });
    }
  }
  const assistantMessage: TeachingSessionMessage = {
    role: 'assistant',
    content: teachingOutput.reply,
    timestamp: new Date().toISOString(),
    analysis: teachingOutput.analysis,
    strategies: teachingOutput.pedagogy.strategies,
    knowledgePoint: teachingOutput.knowledge.currentPoint,
    knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
    peerTriggered,
    peerMessage: peerMessage || null,
    peerStrategy,
    peerFollowUpQuestions,
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

  // 无 boardContext ⇒ 本轮没有任何可指代的图（2026-10-29 契约）：
  // prompt 已要求不输出 figure/diagram，但真 LLM 实测仍会输出（学生一句"画个图"就能触发）。
  // 图闸在 reply 之后才拦，若这里不丢，reply 会留下「看这张图」而界面无图；直接删字段，
  // 后续 D10 悬空引用剥离再兜住正文指代。
  if (!board && (teachingOutput.figure || teachingOutput.diagram)) {
    logger.info('[AITeaching] 本轮无 boardContext，丢弃模型输出的 figure/diagram', {
      sessionId,
      taskId: session.taskId,
      figureKind: teachingOutput.figure?.kind ?? null,
      hasDiagram: Boolean(teachingOutput.diagram),
    });
    delete teachingOutput.figure;
    delete teachingOutput.diagram;
  }

  // 有板时视觉由板书承载：模型若仍交了视觉意图，平台不会出图（下方节点只在无板时跑），
  // 留着这条意图等于给前端/日志一个不会兑现的承诺——直接丢。
  if (board && teachingOutput.visualIntent) {
    delete teachingOutput.visualIntent;
  }

  // 视觉节点（2026-11-26 契约层拆分）：模型只交 `visualIntent`（关系 + 焦点），
  // 图由独立节点按 teaching-board-design 单图模式生成；失败 fail-open。
  // 有板时不画一次性配图（板书是任务级现场）；旧提示词仍给 figure 时以模型为准。
  // 模型漏交 intent 时，用编排层的机会判据还原（时机是代码定的，模型只补关系/焦点）——
  // 实测 flash 会把这个可选字段整个省掉；漏字段不能等于「本轮不出图」。
  const visualIntent = teachingOutput.visualIntent?.need
    ? teachingOutput.visualIntent
    : intentFromOpportunity(opportunityForTurn);
  const synthesizedIntent = !teachingOutput.visualIntent?.need && Boolean(visualIntent);
  if (!board && visualIntent && !teachingOutput.figure) {
    if (detectArgumentClassificationAsk(teachingOutput.reply)) {
      logger.info('[AITeaching] 本轮让学生判断句子归属（前提/结论），跳过视觉节点（图即答案）', {
        sessionId,
        taskId: session.taskId,
      });
    } else if (detectExerciseLeakInReply(teachingOutput.reply)) {
      logger.info('[AITeaching] 本轮布置了学生自己画/排的练习，跳过视觉节点（防答案泄漏）', {
        sessionId,
        taskId: session.taskId,
      });
    } else {
      logger.info('[AITeaching] 视觉节点开始出图', {
        sessionId,
        taskId: session.taskId,
        relation: visualIntent.relation,
        kindHint: visualIntent.kindHint ?? null,
        focus: visualIntent.focus,
        synthesizedIntent,
      });
      const planned = await planVisualFigure({
        intent: visualIntent,
        task: {
          title: context.taskTitle,
          description: context.taskDescription,
          taskType: context.taskType,
          material: resolveBoardMaterial({
            taskMaterialPayload: context.taskMaterialPayload,
            excerpts: context.activeTaskMaterialExcerpts,
            materials: context.materials,
          }),
        },
        scenario: { subject: session.subject, topic: session.topic, learnerLevel: 'beginner' },
        studentSays: message,
        lastTeacherReply: null,
        opportunityInstruction: opportunityForTurn?.instruction ?? null,
        context: { userId: session.userId, sessionId: session.id, taskId: session.taskId },
      });
      if (planned.figure) {
        teachingOutput.figure = planned.figure;
        teachingOutput.visualIntent = visualIntent;
        logger.info('[AITeaching] 视觉节点产出图', {
          sessionId,
          taskId: session.taskId,
          relation: visualIntent.relation,
          kind: planned.figure.kind,
          synthesizedIntent,
        });
      }
    }
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
  if (teachingOutput.figure && board) {
    // 板书层接管视觉后，老师本轮再出一张一次性配图会盖掉常驻白板（下方 board 分支只在
    // assistantMessage.figures 为空时挂板）。白板是任务级现场，优先级高于临时配图。
    logger.info('[AITeaching] 已有共享白板，跳过老师本轮一次性配图', {
      sessionId,
      taskId: session.taskId,
      kind: teachingOutput.figure.kind,
    });
  } else if (teachingOutput.figure) {
    // 课中图不挂结论注（用户 2026-10-23 硬指令）：caption / note 在实测里几乎只在替学生答题。
    const deReviewed = stripInLessonAnnotations(teachingOutput.figure);
    // 读图/复述题不扣图，改为脱敏：把被问的答案从图上挖掉，结构照常给学生看（外部讨论定案）
    const maskedFigure = maskFigureForQuestion(deReviewed, teachingOutput.reply);
    let wanted: typeof deReviewed = {
      ...deReviewed,
      // 学科调色板在这里盖章（模型不参与）：同一份 spec 换个学科就是另一套色相/材质，
      // 只影响观感，不改变任何几何与语义。模型自己给了合法 palette 则以它为准。
      palette: deReviewed.palette || paletteOfSubject(session.subject),
    };
    // 库侧快照只在这条出图分支里取：会话上限、同图型配额、同骨架去重共用一次查询
    const figureGate = await figureGateSnapshot(sessionId, wanted.kind);
    if (detectArgumentClassificationAsk(teachingOutput.reply)) {
      logger.info('[AITeaching] 本轮让学生判断句子归属（前提/结论），跳过本轮图（图即答案）', {
        sessionId,
        taskId: session.taskId,
        kind: wanted.kind,
      });
    } else if (detectExerciseLeakInReply(teachingOutput.reply)) {
      logger.info('[AITeaching] 本轮回复布置了由学生自己画的练习，跳过位置线图（防答案泄漏）', {
        sessionId,
        taskId: session.taskId,
      });
    } else if (figureNumbersFightReply(wanted, teachingOutput.reply)) {
      // 图文数字打架（2026-10-21 走查 #15）：同一回合里正文说一套数、图上画另一套，学生只会更懵。
      // 判据是确定性对账：图内标签里的数字一个都没在正文出现（且两边都有多个数字）→ 判为编数，不出图。
      logger.warn('[AITeaching] 图内数字与正文完全对不上，跳过本轮图', {
        sessionId,
        taskId: session.taskId,
        kind: wanted.kind,
        figureNumbers: collectFigureNumbers(wanted).slice(0, 8),
        replyNumbers: [...collectReplyNumbers(teachingOutput.reply)].slice(0, 8),
      });
    } else if (teachingOutput.control?.checkpoint) {
      // 出题回合不出图（2026-10-23 第五批外审：14 张里 5 张的判词是「老师这一轮让学生自己产出，
      // 图里已经把答案给出」）。文案层拦不住——模型会在追问句之外顺手把结论画好；
      // 而「本轮发了检查点」是确定性信号：这一刻学生该动手，不该看见成品图。
      logger.info('[AITeaching] 本轮发了检查点（学生要自己产出），跳过本轮图', {
        sessionId,
        taskId: session.taskId,
        kind: wanted.kind,
      });
    } else if (figureRestatesReply(wanted, teachingOutput.reply)) {
      // 「图只是把这段回复抄进框里」不再出图（2026-10-23 外部视觉评审：86% 被判多余）。
      logger.info('[AITeaching] 图只是复述本轮正文，跳过本轮图', {
        sessionId,
        taskId: session.taskId,
        kind: wanted.kind,
      });
    } else if (figureGate.total >= resolveFigureMaxPerSession()) {
      // 会话配额是**硬闸**（2026-10-19）：提示词里的"上限"只是建议，模型仍会每轮出图——
      // 实跑地理课一节课出了 12 张同类图，读起来就是"老师每轮都在摆同一张表"。
      logger.info('[AITeaching] 本会话图数已达上限，跳过本轮图', {
        sessionId,
        taskId: session.taskId,
        kind: wanted.kind,
        count: figureGate.total,
      });
    } else if (figureGate.kindCount >= figureGate.kindCap) {
      // 总量闸门之外再按图型封顶（2026-10-21 真课）：同一节课 10 张位置线，
      // 其中几张只是换了标签——学生看到的是「老师反复摆同一张图」。
      // 2026-10-22：配额按证据等级分配（A 4 / B 4 / C 3 / D 2），见 doc/DIAGRAM_PEDAGOGY_RESEARCH.md
      logger.info('[AITeaching] 本会话该图型已达上限，跳过本轮图', {
        sessionId,
        taskId: session.taskId,
        kind: wanted.kind,
        count: figureGate.kindCount,
        cap: figureGate.kindCap,
      });
    } else if (!shouldEmitFigureAmong(figureGate.figures, wanted)) {
      // 与上一轮同一张图（学生只改了措辞）→ 不再重摆；下方悬空引用清理会把"见下图"一并剥掉
      logger.info('[AITeaching] 本会话已有同骨架的图（只改了措辞/条目），跳过重复渲染', {
        sessionId,
        taskId: session.taskId,
        kind: wanted.kind,
      });
    } else {
      // 走完全部闸门才下发。读图/复述题在这里脱敏：把被问的答案挖掉（点/辅助线标签→？，
      // 关系名→？），结构照常呈现——外部讨论定案：扣图会让学生面对一句悬空的「看图」。
      if (maskedFigure !== null && maskedFigure !== deReviewed) {
        wanted = maskedFigure;
        logger.info('[AITeaching] 本轮是读图/复述题，图已脱敏后下发', {
          sessionId,
          taskId: session.taskId,
          kind: wanted.kind,
        });
      }
      assistantMessage.figures = [wanted];
      // 出图来源留痕（2026-10-21）：评审要能回答「这张图为什么出现」。
      // 模型自己给的理由在 figure.why；这里记的是编排层有没有给机会、因为什么给、建议了什么图型。
      assistantMessage.figureSource = {
        trigger: opportunityForTurn ? 'opportunity' : 'model',
        reason: opportunityForTurn?.reason ?? null,
        kindHint: opportunityForTurn?.kindHint ?? null,
        ruleWhy: opportunityForTurn?.ruleWhy ?? null,
        matched: opportunityForTurn?.matched ?? [],
      };
    }
  }

  // 纠正语境（修复批 7，BOARD_MISMATCH critical×2：板书固化学员已纠错误）：误解轮的假设
  // 持久化进 teachingState.lastCorrectionNotes（cap 5、按假设去重），本课后续所有刷新轮
  // 都带着「不得保留学员被纠正前错误版本」的清除禁令——设计器盲重建（不收当前板面）时
  // 否则会把学员错版原样抄回（实证 badf3f77：turn4 纠正试用期档位后 rev4 仍挂错版到课终）。
  // 注意：teachingState 本体在下方才构建，这里先算好语境，持久化在声明后统一落。
  const turnMisconceptions = Array.isArray(teachingOutput.analysis?.misconceptions)
    ? (teachingOutput.analysis.misconceptions as Array<{ conceptKey?: unknown; hypothesis?: unknown }>)
      .filter((m) => m && typeof m === 'object')
    : [];
  const mergedCorrectionNotes = mergeCorrectionNotes(
    (previousTeachingState as { lastCorrectionNotes?: BoardCorrectionNote[] }).lastCorrectionNotes,
    turnMisconceptions,
    updatedMessages.length,
  );
  const correctionDirective = buildCorrectionDirective(mergedCorrectionNotes);
  const correctionNotesChanged = mergedCorrectionNotes
    !== (previousTeachingState as { lastCorrectionNotes?: BoardCorrectionNote[] }).lastCorrectionNotes;

  // 共享白板（方案 A，2026-10-28 接线）：老师先说完 → 识别「换了例子/条件」→ 同轮刷新板 →
  // 随本轮消息下发。首轮的板已在调用老师前建好；这里只处理后续轮。
  /** 换板/纠错后把新 spec 落到板上。阶段协议下轴冻结：行列变了就不换；分段标记丢了按原板补回。 */
  const applyBoardRefresh = (source: BoardState, nextSpec: unknown, reason: 'new-example' | 'correction'): BoardState => {
    if (phaseView && !isAxisCompatible(source.figure?.maskedSpec, nextSpec)) {
      logger.info('[AITeaching] 重画的板改了行列，轴冻结：保持原板', { sessionId, reason, kind: source.figure?.kind ?? null });
      return source;
    }
    const previousSpec = (source.figure?.maskedSpec ?? {}) as Record<string, unknown>;
    const merged = { ...(nextSpec as Record<string, unknown>) };
    for (const key of ['rowSegments', 'frameSegments']) {
      if (!(key in merged) && key in previousSpec) merged[key] = previousSpec[key];
    }
    return applyBoardOp(source, { type: 'update', reason }, merged) ?? source;
  };
  // 阶段协议下板书只设计一次（一块板管一节课）：逐轮重画——换例也好、纠正也好——都会把学生正在对照的
  // 参照物换掉；而且矩阵板换例必然换行列名，画完也会被轴冻结退回，白等一次绘图。新例子、新数值写进正文。
  if (board && !isFirstTurnOfTask && !phaseView) {
    const intent = decideBoardIntent({
      taskType: context.taskType,
      kind: board.figure?.kind ?? null,
      studentText: message,
      lastTeacherText: teachingOutput.reply,
      boardNumbers: numbersOnBoard(board.figure?.maskedSpec),
    });
    // 阶段协议下轴冻结：只有老师明确换了对象/条件（scene，强信号）才允许重画；「老师提到了板上还没有的
    // 数字」这类弱信号不重画——实录里 8 个版本换了 6 次轴，学生每轮都要重新找参照物。
    if (intent.exampleChange !== 'none' && (!phaseView || intent.exampleChange === 'scene')) {
      // 换例重绘守门（2026-11-13 修复批 4b，BOARD_MISMATCH 聚类 major×3）：换例信号最弱一档
      // （老师只是提到板上还没有的数字，没说换成/改成/假设）常是**同例深挖**——此时重绘会把
      // 同一例子的板改成编造的变体，与教师开场口述/旧板自相矛盾（实证：财务课 rev2「付出货款
      // 0 元」被重绘成「付现 60 万」，老师照新板讲，整课口径翻车）。老师本句仍在引用旧板
      // 内容 → 判同例深挖，本轮保持旧板（可复算口径见 shouldSkipExampleRefresh）。
      const refreshGuard = shouldSkipExampleRefresh({
        intent,
        boardSpec: board.figure?.maskedSpec ?? null,
        teacherReply: teachingOutput.reply,
      });
      if (refreshGuard.skip) {
        logger.info('[AITeaching] 换例重绘抑制：换数信号但老师本句仍在引用旧板内容（同例深挖误触发），保持旧板', {
          sessionId,
          taskId: session.taskId,
          hits: refreshGuard.hits.slice(0, 6),
        });
        recordDegradation({
          source: 'ai-teaching/board-refresh',
          faultCategory: 'SCHEMA_VIOLATION',
          severity: 'P2_DEGRADED',
          impactedDimensions: ['board.revision'],
          mitigationApplied: 'skip-example-refresh-stale-overlap',
          rootCauseMessage: `variant refresh triggered by fresh numbers only while teacher reply still references old board content: ${refreshGuard.hits.slice(0, 4).join(' / ')}`,
        });
      } else {
        const designed = await designBoard({
          task: { title: context.taskTitle, description: context.taskDescription, taskType: context.taskType, material: context.taskMaterialPayload || null },
          scenario: { subject: session.subject, topic: session.topic, learnerLevel: 'beginner' },
          studentSays: message,
          kindHint: board.figure?.kind ?? null,
          questionIntent: intent,
          lastTeacherReply: teachingOutput.reply,
          instruction:
            (intent.exampleChange === 'scene'
              ? '老师这一轮换了对象/条件。把同一结构的板换成**当前这个情境**（对象、液体、条件标签全换）。'
              : '老师这一轮换了例子/条件。把同一结构的板换成**老师这一轮给的例子**（该换的词、数值、单位全换，旧例子不要留）。')
            + '结构、图型、副标注写法不变。' + intent.instruction
            + correctionDirective,
        }, { userId: session.userId, sessionId: session.id, taskId: session.taskId });
        if (designed.figure) {
          // 数字-指标绑定一致性守卫（修复批 36-②，BOARD-001 u04 reeval29 critical）：教师
          // 近轮「(指标)是/为(数字)亿」绑定与板面同数字异指标的行冲突时，把板面数字挖成
          // ?（答案不上板纪律：让学习者按教师口径填，不错着抄）。绑定取最近 6 条教师发言。
          const numberBindings = extractTeacherNumberBindings([
            teachingOutput.reply,
            ...session.messages.filter((m) => m.role === 'assistant').slice(-6).map((m) => String(m.content || '')),
          ]);
          const numberGuard = maskMismatchedBoardNumberLabels(designed.figure as any, numberBindings);
          if (numberGuard.masked.length > 0) {
            logger.warn('[AITeaching] 板面数字与教师绑定冲突，已挖空待学习者按教师口径填写', {
              sessionId,
              taskId: session.taskId,
              masked: numberGuard.masked.slice(0, 4),
            });
          }
          board = applyBoardRefresh(board, numberGuard.spec, 'new-example');
        } else {
          logger.warn('[AITeaching] 换板绘图被拒（保持旧板）', {
            sessionId,
            taskId: session.taskId,
            kind: board.figure?.kind ?? null,
            intent: `${intent.askAbout}/${intent.exampleChange}`,
            reason: designed.reason,
          });
        }
      }
    } else if (turnMisconceptions.length > 0) {
        // 纠正轮确定性刷新槽位（修复批 7）：误解轮常规意图不刷 → 板面错过纠正机会
        //（实证 badf3f77 turn4：教师纠正试用期档位，rev 停在 2，错版后被后续盲重建沿袭到课终）。
        // 带清除指令强制重绘一次；4b 换例守门不适用——纠正不是换数，信号更强更明确。
        const designed = await designBoard({
          task: { title: context.taskTitle, description: context.taskDescription, taskType: context.taskType, material: context.taskMaterialPayload || null },
          scenario: { subject: session.subject, topic: session.topic, learnerLevel: 'beginner' },
          studentSays: message,
          kindHint: board.figure?.kind ?? null,
          questionIntent: intent,
          lastTeacherReply: teachingOutput.reply,
          instruction: '老师本轮纠正了学生的一个错误理解。把板面改成**老师本轮纠正后的正确口径**；'
            + '不得保留学生被纠正前的错误版本。结构、图型、副标注写法不变。'
            + intent.instruction + correctionDirective,
        }, { userId: session.userId, sessionId: session.id, taskId: session.taskId });
        if (designed.figure) {
          // 数字-指标绑定一致性守卫（修复批 36-②，BOARD-001 u04 reeval29 critical）：教师
          // 近轮「(指标)是/为(数字)亿」绑定与板面同数字异指标的行冲突时，把板面数字挖成
          // ?（答案不上板纪律：让学习者按教师口径填，不错着抄）。绑定取最近 6 条教师发言。
          const numberBindings = extractTeacherNumberBindings([
            teachingOutput.reply,
            ...session.messages.filter((m) => m.role === 'assistant').slice(-6).map((m) => String(m.content || '')),
          ]);
          const numberGuard = maskMismatchedBoardNumberLabels(designed.figure as any, numberBindings);
          if (numberGuard.masked.length > 0) {
            logger.warn('[AITeaching] 板面数字与教师绑定冲突，已挖空待学习者按教师口径填写', {
              sessionId,
              taskId: session.taskId,
              masked: numberGuard.masked.slice(0, 4),
            });
          }
          board = applyBoardRefresh(board, numberGuard.spec, 'correction');
          logger.info('[AITeaching] 纠正轮板书刷新：误解轮强制重绘，清除被纠正的错误表述', {
            sessionId,
            taskId: session.taskId,
            notes: mergedCorrectionNotes.map((note) => note.conceptKey).slice(0, 4),
          });
        } else {
          logger.warn('[AITeaching] 纠正轮板书刷新被拒（保持旧板）', {
            sessionId,
            taskId: session.taskId,
            reason: designed.reason,
          });
        }
      }
  }
  // 本轮最终下发的板：阶段协议下按露出程度取视图。练习泄漏闸只拦一次性配图，不再拦持久板——
  // 实录里老师一句「用一句话说」就让整块板本轮不上屏，下一轮才原样下发，学生对着空屏听老师「指板」。
  boardForTurn = boardViewForTurn(board);
  if (boardForTurn && !assistantMessage.figures?.length
    && (phaseView || !detectExerciseLeakInReply(teachingOutput.reply))) {
    const boardDecision = decideBoardAttachment(boardForTurn, updatedMessages, paletteOfSubject(session.subject));
    if (boardDecision.kind === 'degenerate') {
      logger.warn('[AITeaching] 首版板书是空壳矩阵（全格已标出、无留白），本轮不摆板', {
        sessionId,
        taskId: session.taskId,
        kind: board.figure?.kind ?? null,
      });
    } else if (boardDecision.kind === 'attached') {
      assistantMessage.figures = boardDecision.figures;
      assistantMessage.figureSource = boardDecision.figureSource;
    }
  }

  // D10（A/B 报告 2026-10-13）：回复里出现"（见图）/我画了一个结构示意"这类指向附图的指引，
  // 但本轮实际没有任何 images/diagrams/figures（老师声称画了、图上却没有）→ 悬空引用，学生
  // 看到的是一句指向虚空的话。此时剥离该引用（回退到"文本脱离图仍成立"的原则，不阻断课堂）。
  {
    const hasAnyVisual = !!assistantMessage.images?.length
      || !!assistantMessage.diagrams?.length
      || !!assistantMessage.figures?.length;
    // 阶段协议下板书是**常驻对象**（前面回合已下发、学员屏幕上一直在），本轮不重发 figure
    // 不等于图上没有内容。2026-11-26 A4 实录：整合回合回复以「板上的图已经全露出来了」开头，
    // 本轮 figures 为空 → 被当成悬空引用剥离，剥掉「板上」后剩下「的图…」，句子直接断裂。
    if (!hasAnyVisual && !board && hasDanglingFigureReference(assistantMessage.content)) {
      const stripped = stripDanglingFigureReferences(assistantMessage.content);
      if (stripped && stripped !== assistantMessage.content) {
        logger.info('[AITeaching] 回复引用配图但本轮无图，剥离悬空图引用（D10）', {
          sessionId,
          taskId: session.taskId,
        });
        assistantMessage.content = stripped;
      }
    }
  }

  // 相邻轮低增量重复护栏（issue #103 / E-02 语义卡环，最小版·**仅告警**）：
  // 判据与事后机械尺 r6post-eval.mjs mechTeacherLoop 同源（归一化字三元组 Jaccard ≥ 0.5），
  // 纯函数在 teaching-repetition-guard.ts。此处的定位是**观测**：不改写回复、不重调、不阻断
  // 课堂（主防线是提示词「相邻轮不得复述已教内容」）。命中即打一条 warn，供告警回看与
  // 后续「改动前后同读数对照」取证；若读数证实该护栏无用，删本块即完全回退。
  {
    const previousReply = findPreviousAssistantReply(updatedMessages);
    const repetition = assessAdjacentRepetition(previousReply, assistantMessage.content);
    if (repetition.lowIncrement) {
      logger.warn('[AITeaching] 相邻教学轮低增量重复（换措辞未增信息）', {
        sessionId: session.id,
        taskId: session.taskId,
        stage: nextStageDecision.stage,
        jaccard: Number(repetition.jaccard.toFixed(3)),
        sharedTrigrams: repetition.sharedTrigrams,
        novelRatio: Number(repetition.novelRatio.toFixed(3)),
        previousExcerpt: String(previousReply ?? '').slice(0, 120),
        currentExcerpt: String(assistantMessage.content ?? '').slice(0, 120),
      });
    }
  }

  if (!completionReady && hasPrematureNextStepLanguage(assistantMessage.content)) {
    logger.warn('[AITeaching] 教学回复越界，尚未满足结束条件却提到下一环节', {
      sessionId,
      taskId: session.taskId,
      reply: assistantMessage.content,
    });
  }

  // 白板指针随 assistant 消息落库（2026-11-13）：放在全部板面变更（换例重绘/figures 附加）
  // 之后，保证指向的就是本轮学习者最终可见的那一版。
  if (boardForTurn ?? board) {
    assistantMessage.boardState = {
      revision: (boardForTurn ?? board)!.revision,
      kind: board.figure?.kind ?? null,
      focusId: board.figure?.focusId ?? null,
      conceal: board.figure?.conceal ?? null,
    };
  }

  // 课堂报告（每回合都写）：前端契约卡实时显示「已覆盖/独立证据/停车区」，
  // 结课时 wrapup/结算响应直接复用同一份，不另算一遍。
  const lessonReport = buildLessonReport({
    contract: lessonContract,
    evaluation: contractEvaluation,
    evidence: lessonEvidence,
    branchState: branchDecision.state,
    teachingTurns,
    exitTicket: exitTicketState,
  });

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
      // 学生链接独立配额计数（2026-11-23）：按**抓取尝试**记账（失败也占额，防重试风暴），
      // 上限 STUDENT_LINK_MAX_PER_LESSON；不与 control.supplement 的每课 1 次混用
      ...(studentLinkReadAttempted
        ? { linkReadCount: Number(sessionArtifacts.linkReadCount || 0) + 1 }
        : {}),
      // 共享白板：任务级持久板书（跨轮保留；换任务时由上方 load 逻辑丢弃）
      board: board ?? null,
      // 阶段协议：板书没画出来时的已失败次数（画出来后恒为 0），用于点名/建构阶段的有限重试
      ...(lessonPhaseEnabled ? { boardDesignAttempts: boardDesignFailures } : {}),
      // 白板 revision 历史（2026-11-13 课堂评审 7/7 实证）：教师逐轮「板上左栏第 N 行」类指认
      // 需要能回放学习者当时看到的板面。此前只存最终 revision，评审/裁判在证据面无法定位被指
      // 对象（referee 误报 TEACHING_BOARD_UNVERIFIABLE、课堂评审误报 BOARD_DANGLING）。
      // 按 revision 变更追加快照（学习者可见面 maskedSpec），上限 40 版，只增证据不改行为。
      boardHistory: (() => {
        const prev = parseSessionArtifacts(session.teachingState).boardHistory as
          | Array<{ revision: number; at: string; kind: string; spec: Record<string, unknown> }>
          | undefined;
        const history = Array.isArray(prev) ? [...prev] : [];
        if (!board?.figure) return history;
        const last = history[history.length - 1];
        if (last && last.revision === board.revision) return history;
        history.push({
          revision: board.revision,
          at: new Date().toISOString(),
          kind: board.figure.kind,
          spec: board.figure.maskedSpec,
        });
        return history.slice(-40);
      })(),
      initialKnowledgeState: effectiveInitialKnowledgeState,
      // 课堂契约/支线/报告（2026-11-19）：契约稳定；支线预算与停车区逐回合更新；报告供前端实时展示。
      lessonContract,
      branchState: branchDecision.state,
      lessonReport,
      // 课末终检（2026-11-19）：当前题 + 历史（用于结课报告/复判追踪）
      exitTicket: exitTicketState,
      exitTicketHistory,
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
      // 教师补充槽（批次 E）：① 同轮同步复调成功 → 直写 delivered 槽（2026-11-23），不再走
      // 后台采集；② 晋升结果落槽（delivered/expired）；③ 本轮新请求且同步未成（失败/超时/闭卷
      // 之外的回落）→ 既有异步链：写 requested + fire 后台采集入库。
      // 采集产物进资料库（持久）；槽位流转全部随回合同事务写，无中途并发写。
      ...(() => {
        const existing = sessionArtifacts.supplement as SupplementSlot | undefined;
        if (supplementSyncSlot) {
          // 同步复调已在本轮交付：二段输出若再带 supplement 请求也在此被拦（每 session ≤1 次）
          return { supplement: supplementSyncSlot };
        }
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
    // 纠正语境持久化（修复批 7）：teachingState 本体在此才构建，误解假设名单在此落
    if (correctionNotesChanged) {
      teachingState.lastCorrectionNotes = mergedCorrectionNotes;
    }

    // 收口闭合门禁计数：延迟发生时 +1（跨回合继承）。
    // 计数分两口：全会话累计（绝对上限）+ 同一题累计（同题重复上限）。换新题时重置同题计数，
    // 避免早期旧题耗尽预算后，后面新抛出的末问被直接收掉（外部审计 P0-2）。
    if (closureGate.defer) {
      const sameQuestion = !!closureGate.questionKey
        && closureGate.questionKey === String(previousTeachingState.completionDeferralQuestion || '');
      teachingState.completionDeferrals = (Number(previousTeachingState.completionDeferrals) || 0) + 1;
      teachingState.completionDeferralQuestion = closureGate.questionKey;
      teachingState.completionDeferralQuestionCount = sameQuestion
        ? (Number(previousTeachingState.completionDeferralQuestionCount) || 0) + 1
        : 1;
      if (closureGate.capGrace) teachingState.completionCapGraceUsed = true;
    }

    // 收尾循环打断：streak 跨回合继承；强制放行过的课，收束入口（evaluateSessionClosable）
    // 依 closureLoopBreakReleased 同步放行，避免「引擎放完成、confirm_task 409」的僵局。
    teachingState.closureRepeatStreak = closureRepeatStreak;
    if (forcedCompletionLoopBreak) teachingState.closureLoopBreakReleased = true;

    // #48 P-22：掌握下降计数跨回合累加（本轮 0 次也保留上一轮计数，不清零）
    if (masteryDegrade.count > 0) {
      teachingState.masteryDegradeCount =
        (Number(previousTeachingState.masteryDegradeCount) || 0) + masteryDegrade.count;
      teachingState.lastMasteryDegrades = masteryDegrade.concepts.slice(0, 5);
    }

    // 检查点产生：teaching-turn 可选输出 control.checkpoint，按规则落库为 pendingCheckpoint
    const checkpointCandidate = teachingOutput.control.checkpoint;
    // 题面可见性（外部审计 P0-4）：检查点题面只存在 pendingCheckpoint，不写进教师回复时，
    // 学习者历史/逐字稿里会出现「学生回答了一道从未出现过的题」。所有会更新 pendingCheckpoint
    // 的路径（新出题 / 答错重出题）都必须把题面补进本轮可见回复，已包含则不重复。
    const applyCheckpointQuestionVisibility = (question: string | null | undefined) => {
      if (!question) return;
      const visibleWithQuestion = ensureCheckpointQuestionVisible(assistantMessage.content, question);
      if (visibleWithQuestion === assistantMessage.content) return;
      assistantMessage.content = visibleWithQuestion;
      teachingOutput.reply = visibleWithQuestion;
      effectiveTeachingOutput.reply = visibleWithQuestion;
    };
    // 出题时机与频次只有一个权威：shouldEmitCheckpoint（单焦点通关守门员，2026-11-11 第二刀）。
    // 引擎侧不再维护「节奏票」——旧 checkpointRhythmMinTurns 会把理解度 <0.6 加速到 2 条消息，
    // 与「学生懵时给支架不弹卡」直接冲突。下面只保留与编排层同向的结构兜底。
    const pendingBeforeTurn = previousTeachingState.pendingCheckpoint;
    // 复述问判定输入（2026-11-13 修复批 4，课堂 ASSESSMENT_REPEAT_RECALL 聚类重评 5/5）：
    // 本题答案键是否已在教师已说过的内容（历史回复 + 本轮回复）里逐字出现——是则材料已被
    // 教师贴过标签，本题是对已给口径的复述确认而非迁移检验（可复算口径见
    // isCheckpointAnswerAlreadyGiven）。放在换题面路径之前算好：新发射、就地换题面、
    // 连击抑制三处共用同一个读数。锚题豁免：延迟保持率复测本就是重测已教概念，
    // 按设计是复述——不参与判定、也不留标记（无标记的历史行天然当不了「上一问复述」）。
    const candidateRecallOnLabeled = checkpointCandidate && !anchorTarget
      ? isCheckpointAnswerAlreadyGiven(checkpointCandidate, [
        ...updatedMessages
          .filter((m) => m?.role === 'assistant')
          .map((m) => String((m as { content?: unknown }).content ?? '')),
        teachingOutput.reply,
        // 布题轮板书面（修复批 10-D1，交流体验评审 §19.2#1 答案提前暴露）：本轮随消息下发的
        // 板面/配图也算「教师已贴标签的面」——u04 实证板书挂「净占用现金 830」而教师四轮追问
        // 「报净额」，答案一直在学生视野内，题只能走过场。板面文本并入扫描源后，此类检查点
        // 与答案已说破的检查点走同一条复述问链（标记 + 连击抑制 + wrapup 证据门）。
        collectTurnBoardFaceText(assistantMessage?.figures),
      ])
      : { recall: false as const };
    // 板面源单独命中时打遥测留痕（不做板面重绘——误伤教师合法中间数的风险大于单例收益，
    // 修复批 10 只做「标记进复述链」；若后续批次水位不降再升级为布题轮板书遮蔽杠杆）。
    const recallOnBoardFace = checkpointCandidate && !anchorTarget
      ? isCheckpointAnswerAlreadyGiven(
        checkpointCandidate,
        collectTurnBoardFaceText(assistantMessage?.figures),
      )
      : { recall: false as const };
    if (recallOnBoardFace.recall) {
      logger.info('[AITeaching] 布题轮板面携带本题答案键（答案提前暴露），检查点按复述问标记', {
        sessionId,
        taskId: session.taskId,
        matched: String(recallOnBoardFace.matched ?? '').slice(0, 80),
      });
      recordDegradation({
        source: 'ai-teaching/teaching-turn-checkpoint',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['checkpoint.answerKey'],
        mitigationApplied: 'flag-answer-on-board-face',
        rootCauseMessage: `checkpoint answer key visible on board face this turn: ${String(recallOnBoardFace.matched ?? '').slice(0, 160)}`,
      });
    }
    // 作废通道：语义边界与两条护栏见 ./checkpoint-void.ts；作废不授权本轮出题，出题时机只认 controls.emitCheckpoint。
    const voidedPendingCheckpoint = teachingOutput.control?.voidCheckpoint === true && !submittedCheckpoint && !!pendingBeforeTurn;
    if (voidedPendingCheckpoint && pendingBeforeTurn) {
      applyVoidPendingCheckpoint(teachingState, pendingBeforeTurn, session.id);
    }
    // #50：答错重答时若模型给出了新题面，替换 pendingCheckpoint 的内容（保留 cpId，
    // 因此重答上限仍按同一检查点累计），而不是把旧题原样再发一遍。
    // 作废回合不做这种「就地换题面」：那道题已被撤销，绝不能让旧 cpId 带着新题面复活
    //（否则 voided 留痕与一道复活的旧题同时存在）。模型若同时给了新题面，本轮也不落库——
    // 出题闸的待答票（pending 仍在）会拦下它；新题留到后续满足出题时机的回合。
    // 阶段协议下一题一 id：答错不再「就地换题面、保留 cpId」——那会让同一 id 先后挂着不同题面与不同答案键，
    // 账本把新题的首答记成重答，独立证据永久丢失（实录 caseA）。补测由阶段机在下一个检查阶段安排。
    if (!phaseView && !voidedPendingCheckpoint && pendingBeforeTurn && checkpointCandidate?.question) {
      const changedQuestion = normalizeForKeywordMatch(pendingBeforeTurn.question) !== normalizeForKeywordMatch(checkpointCandidate.question);
      if (changedQuestion && !isDuplicateCheckpointQuestion(previousTeachingState.checkpointHistory, checkpointCandidate)) {
        const replacementCheckpoint = normalizeCheckpointWithTelemetry({
          ...pendingBeforeTurn,
          question: checkpointCandidate.question,
          ...(checkpointCandidate.options ? { options: checkpointCandidate.options } : {}),
          ...(checkpointCandidate.correctOptionIds ? { correctOptionIds: checkpointCandidate.correctOptionIds } : {}),
          ...(checkpointCandidate.expectedKeywords ? { expectedKeywords: checkpointCandidate.expectedKeywords } : {}),
          ...(checkpointCandidate.hint ? { hint: checkpointCandidate.hint } : {}),
          // 复述问标记随换题面重算（修复批 4）：就地换题面后旧标记可能失真——按新题面/新答案键
          // 重算；新题已非复述时剥掉旧标记，保证历史行里「上一问复述」读数可复算。
          ...(candidateRecallOnLabeled.recall ? { answerAlreadyGiven: true as const } : {}),
        }, pendingBeforeTurn.type);
        if (!candidateRecallOnLabeled.recall) {
          delete (replacementCheckpoint as { answerAlreadyGiven?: unknown }).answerAlreadyGiven;
        }
        teachingState.pendingCheckpoint = replacementCheckpoint;
        // 重出题同样要保证新题面在可见回复里（否则学员下一轮答的是一道历史里没有的题）
        applyCheckpointQuestionVisibility(checkpointCandidate.question);
      }
    }
    // 同题复问抑制（TONIGHT-BROAD-2026-10-07 宽域 C 轨缺陷②）：候选题面与本会话**已出过**的题面
    // 归一后同文（学生已答过/跳过这道题）→ 本回合抑制该检查点，只打遥测；课堂照常继续、绝不阻塞。
    // 与「答错保留、答对消费」既有语义兼容：只少问第二遍同题，pendingCheckpoint 消费/重答链路不动。
    const checkpointEmissionEligible = !submittedCheckpoint
      && !completionReady
      && !endIntent.isEndIntent
      && !!checkpointCandidate
      // 出题时机**只有一个权威**：编排层的 controls.emitCheckpoint（由 shouldEmitCheckpoint 按
      // 单焦点收口条件算出，teaching-turn-shared.ts 注入本轮模型输入）。为 false 时本轮**任何**
      // checkpoint 都不落库——引擎不再自带节奏旁路，作废回合也不例外。
      && turnInput.controls?.emitCheckpoint === true
      // 待答票：本轮若已有待答检查点（作废被撤销前它就在），不得再落新题。
      && !previousTeachingState.pendingCheckpoint;
    const duplicateCheckpointQuestion = checkpointEmissionEligible
      && isDuplicateCheckpointQuestion(previousTeachingState.checkpointHistory, checkpointCandidate);
    if (duplicateCheckpointQuestion) {
      const duplicatedQuestion = String(checkpointCandidate?.question ?? '');
      logger.info('[AITeaching] 检查点题面与本会话已出过的题面重复（归一后同文），本回合抑制该检查点', {
        sessionId: session.id,
        question: duplicatedQuestion.slice(0, 80),
      });
      recordDegradation({
        source: 'ai-teaching/teaching-turn-checkpoint',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['checkpoint.question'],
        mitigationApplied: 'suppress-duplicate-checkpoint',
        rootCauseMessage: `duplicate checkpoint question (normalized) vs session checkpointHistory: ${duplicatedQuestion.slice(0, 200)}`,
      });
    }
    // 复述问门槛（修复批 4）：「上一问是对已贴标签材料的复述确认」且「本问又复述已给答案」
    // → 连续复述，本回合抑制出题。单次复述仍放行（提示词 rule 243 已定迁移为默认形态，
    // 代码只断连击）。抑制只跳过落库，不写 lastCheckpointConcept、不改回复：焦点下回合
    // 可重试换迁移新情形，自愈不阻塞。
    const previousCheckpointWasRecall = (() => {
      const historyRows = Array.isArray(previousTeachingState.checkpointHistory)
        ? previousTeachingState.checkpointHistory
        : [];
      const lastAnsweredRow = [...historyRows].reverse().find((row: any) => row?.voided !== true);
      return lastAnsweredRow?.answerAlreadyGiven === true;
    })();
    const recallRepeatSuppressed = checkpointEmissionEligible
      && !duplicateCheckpointQuestion
      && previousCheckpointWasRecall
      && candidateRecallOnLabeled.recall;
    if (recallRepeatSuppressed) {
      logger.info('[AITeaching] 连续复述问拦截：上一问已是对已贴标签材料的复述确认，本问答案键又在教师内容里逐字出现，本回合抑制出题', {
        sessionId: session.id,
        matched: (candidateRecallOnLabeled.matched ?? '').slice(0, 80),
      });
      recordDegradation({
        source: 'ai-teaching/teaching-turn-checkpoint',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P2_DEGRADED',
        impactedDimensions: ['checkpoint.question'],
        mitigationApplied: 'suppress-consecutive-recall-checkpoint',
        rootCauseMessage: `consecutive recall checkpoint: answer key already stated verbatim by teacher (matched: ${(candidateRecallOnLabeled.matched ?? '').slice(0, 120)})`,
      });
    }
    let checkpointEmittedThisTurn = false;
    if (checkpointEmissionEligible && !duplicateCheckpointQuestion && !recallRepeatSuppressed) {
      // 课堂阶段协议：题目考核的知识点由阶段机点名（契约缺口按顺序轮转）。模型声明的考点不在缺口
      // 集合里（或没声明）时以阶段机为准——此前不校验，模型一直围绕当前焦点出题，缺口 KC 永远悬空。
      if (phaseView?.targetKc) {
        const declaredConcept = String(checkpointCandidate.conceptName ?? '').trim();
        const declaredIsGap = phaseView.gapKcs
          .some((name) => normalizeForKeywordMatch(name) === normalizeForKeywordMatch(declaredConcept));
        if (!declaredIsGap) checkpointCandidate.conceptName = phaseView.targetKc;
      }
      checkpointEmittedThisTurn = true;
      const checkpointTitle = checkpointCandidate.question.length > 20
        ? `${checkpointCandidate.question.slice(0, 20)}…`
        : checkpointCandidate.question;
      // 概念归属（F1 修复轮 a，R1 H2：全库 0/5955 无归属）：普通检查点带上当前教学点的知识身份——
      // 模型输出无键，用当前点名字的确定性派生键并标注 source='derived'。锚题探针不带：
      // 其归属由 anchorConceptKey 承载，且纪律 2 禁止锚题结果改写掌握，不得经本通道进聚合。
      // 兜底（EPOCH2 发现 #2 收尾）：模型漏报 currentPoint 时用看板首个点名近似——
      // 此前直接 null，产生无归属检查点（证据无键、无法参与概念聚合）。
      // 2026-11-11 第二刀补第三层兜底：本轮 output.knowledge 为空但会话最近一条教学消息带
      // knowledgePoint/knowledgePoints 时，沿用该点名。课堂实证（合同案例）出现 pending 无归属
      // → checkpointHistory 无 conceptName → 单焦点守门员匹配不到，同一焦点可反复出题。
      const latestSessionPointName = (() => {
        for (let i = updatedMessages.length - 1; i >= 0; i -= 1) {
          const message = updatedMessages[i] as { knowledgePoint?: unknown; knowledgePoints?: unknown };
          const direct = typeof message?.knowledgePoint === 'string' ? message.knowledgePoint.trim() : '';
          if (direct) return direct;
          const points = Array.isArray(message?.knowledgePoints) ? message.knowledgePoints as Array<{ name?: unknown }> : [];
          const lastName = points.map((point) => (typeof point?.name === 'string' ? point.name.trim() : '')).filter(Boolean).pop();
          if (lastName) return lastName;
        }
        return '';
      })();
      const checkpointConcept = anchorTarget
        ? null
        // 模型显式声明的考点优先（2026-11-19）：契约缺口轮会点名核心 KC，声明值让证据落对账，
        // 不再一律按「当前教学点」近似（真课实证：契约外的点拿走检查点归属，核心 KC 永远缺证据）。
        : resolveCheckpointConceptAttribution(effectiveTeachingOutput.control?.checkpoint?.conceptName)
          ?? resolveCheckpointConceptAttribution(effectiveTeachingOutput.knowledge.currentPoint)
          ?? resolveCheckpointConceptAttribution(effectiveTeachingOutput.knowledge.points[0]?.name)
          // 2026-11-11 第二刀补第二层：本轮 output.knowledge 为空但合并后的看板有当前焦点时，
          // 用看板最后一个点（追加顺序=当前焦点）。真机两例（盘库/心理）首题无归属即是此因。
          ?? resolveCheckpointConceptAttribution(
            Array.isArray(mergedKnowledge) && mergedKnowledge.length
              ? mergedKnowledge[mergedKnowledge.length - 1]?.name
              : ''
          )
          ?? resolveCheckpointConceptAttribution(latestSessionPointName);
      teachingState.pendingCheckpoint = normalizeCheckpointWithTelemetry({
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
        // 复述问标记（修复批 4）：本问答案键已在教师内容里逐字出现 → 留档 true，
        // 提交后随 history 行成为下一题出题门槛的「上一问是否复述型」输入。锚题轮恒不打。
        ...(candidateRecallOnLabeled.recall ? { answerAlreadyGiven: true as const } : {}),
      }, checkpointCandidate.type);
      teachingState.lastCheckpointTurn = updatedMessages.length;
      // 单焦点守门员的发射层记忆：历史行可能无归属（旧 pending 或模型漏报 currentPoint），
      // 记住本次发射的焦点名，下一轮即使 history 匹配不到也能拦住同焦点第二题。
      if (checkpointConcept?.conceptName) teachingState.lastCheckpointConcept = checkpointConcept.conceptName;
      // 题面可见性（外部审计 P0-4）：检查点题面只存在 pendingCheckpoint，不写进教师回复，
      // 于是学习者历史/课程逐字稿里出现「学生回答了一道从未出现过的题」。这里把题面
      // 补进本轮可见回复（已包含则不重复），保证学员、模拟器、导出逐字稿看到同一道题。
      applyCheckpointQuestionVisibility(checkpointCandidate.question);
    }

    let checkpointResolution: { passed: boolean; understanding: number | null; judgedBy: 'code' | 'model-rubric' | 'model-reference' } | undefined;
    if (submittedCheckpoint) {
      const rawUnderstanding = teachingOutput.analysis?.understanding;
      // 无读数记 null，不记 0（2026-11-01）：`Number(null ?? 0)` 会把「不可观测」写成「理解度 0」，
      // 与 checkpoint-shared 的出题节奏/伴学触发是同一处语义混淆。
      const understanding = resolveUnderstandingReading(rawUnderstanding);
      const currentPoint = effectiveTeachingOutput.knowledge.currentPoint?.trim().toLowerCase();
      const modelDerivedPassed = completionReady || !!currentPoint && mergedKnowledge.some(
        (point) => point.name.trim().toLowerCase() === currentPoint && point.status === 'mastered'
      );
      // 独立传感器优先（2026-09-17；2026-11-08 分级判分）：有答案键就按裁决通道——code（答案键
      // 确定性/词面全命中）或 model-rubric（简答词面未全命中后的模型语义复核）——否则退回模型
      // 派生并如实标注来源
      const codeJudgement = options.checkpointJudgement ?? null;
      const judgedBy: 'code' | 'model-rubric' | 'model-reference' = codeJudgement
        ? codeJudgement.judgedBy
        : 'model-reference';
      const passed = codeJudgement ? codeJudgement.passed : modelDerivedPassed;
      const checkpointHistory = Array.isArray(teachingState.checkpointHistory)
        ? [...teachingState.checkpointHistory]
        : [];
      // 与当轮契约复用作答次数、归属和复述标记；次数同时驱动重答上限。
      const sameCheckpointAttempts = checkpointAttempt!.attempts;
      checkpointHistory.push({
        ...checkpointAttempt!,
        // title/type 一并留档（2026-09-17）：此前只记 id/passed，读侧无法知道"没通过的是什么题"
        title: submittedCheckpoint.title,
        type: submittedCheckpoint.type,
        // 同题复问抑制所需（TONIGHT-BROAD-2026-10-07）：落完整题面供归一比对；
        // 历史旧行可能只有 ≤20 字 title，判重时 isDuplicateCheckpointQuestion 回退读 title。
        question: submittedCheckpoint.question,
        // 选项/答案键/学员选择一并留档（2026-10-29 导出补齐）：
        // 此前历史行只留题干，课后报告无法还原 A/B/C/D 与学员选了哪一项。
        // 答案键仍属服务端数据，读侧由 stripCheckpointAnswerKeys 统一剥离，不下发客户端。
        ...(submittedCheckpoint.options?.length
          ? { options: submittedCheckpoint.options.map((option) => ({ id: option.id, text: option.text })) }
          : {}),
        ...(submittedCheckpoint.correctOptionIds?.length
          ? { correctOptionIds: submittedCheckpoint.correctOptionIds.map(String) }
          : {}),
        ...(options.checkpointSubmission?.selectedOptionIds?.length
          ? { selectedOptionIds: options.checkpointSubmission.selectedOptionIds.map(String) }
          : {}),
        passed,
        judgedBy,
        understanding,
      });

      // #96 阈值拟合前置：在判分前解析系统对「该概念已掌握」的预测（ktEstimate 优先，
      // 回落到本回合知识看板），随证据落库；无预测时 null，不猜。
      const prediction = resolveCheckpointPrediction({
        conceptName: submittedCheckpoint.conceptName,
        conceptKey: submittedCheckpoint.conceptKey,
        knowledgePoints: mergedKnowledge,
        ktConceptMastery: teachingOutput.analysis?.ktEstimate?.conceptMastery,
        understanding: Number.isFinite(Number(rawUnderstanding)) ? Number(rawUnderstanding) : null,
      });

      // 检查点结果留痕（learner_evidence）：独立传感器的原始观测，供 §7 P1-1 的成功率带与控制律消费。
      // #173-1①：入队，提交成功后写（此前在提交前 void 写，回滚会留孤儿证据）。
      deferredEvidence.push({
        kind: `checkpoint:result:${submittedCheckpoint.id}`,
        write: () => recordCheckpointResultEvidence(session, submittedCheckpoint, {
          passed,
          judgedBy,
          detail: codeJudgement?.detail ?? null,
          submission: { selectedOptionIds: options.checkpointSubmission?.selectedOptionIds },
          prediction,
        }),
      });

      // 独立锚题探针（Q13/B4）：仅对带 purpose='anchor' 的检查点、且**代码裁决**（纪律 1）时
      // 另写一行 anchor:result 作为"待复核"信号；只标记、不改写掌握/难度/BKT（纪律 2）。
      if (submittedCheckpoint.purpose === 'anchor' && judgedBy === 'code') {
        deferredEvidence.push({
          kind: `anchor:result:${submittedCheckpoint.id}`,
          write: () => recordAnchorProbeResult(session, submittedCheckpoint, passed),
        });
      }

      // 仅答对时消费检查点；答错保留 pendingCheckpoint（同一 cpId 可重答，
      // 前端答错反馈后再次提交不会落入「理解检查不存在或已处理」）。
      // 重答上限（2026-10-03 完结课堂裸审计 P1）：同一 cpId 累计答错达到 CHECKPOINT_MAX_ATTEMPTS
      // 即强制消费——否则同一道题被逐轮原样重发（实测最极端 36 次/节），课堂在同一个确认点上
      // 空转直到 LEARN_AUTO_TURN_CAP 才停。到顶后清掉 pendingCheckpoint，老师可换表征出新题/推进。
      const { consume: consumeCheckpoint, exhausted: attemptsExhausted } =
        resolveCheckpointConsumption(passed, sameCheckpointAttempts);
      if (consumeCheckpoint) {
        delete teachingState.pendingCheckpoint;
        const nextSessionArtifacts = { ...parseSessionArtifacts(teachingState) };
        delete nextSessionArtifacts.pendingCheckpoint;
        teachingState.sessionArtifacts = nextSessionArtifacts;
      }
      if (!consumeCheckpoint) {
        // 表征切换指令（2026-10-10 逐字稿评审）：答错保留待重答时，向下一轮模型可见的最近课堂
        // 事件（teaching-turn-shared recentEvents 取尾 5 条）注入换表征指令——原样重发同一道
        // 选择题是评审实测的复读形态（同一题干连出 8 轮才换问法）。
        const retryEventHistory = Array.isArray(teachingState.classroomEventHistory)
          ? [...teachingState.classroomEventHistory]
          : [];
        retryEventHistory.push(buildClassroomEvent('checkpoint-retry', '理解检查作答未通过，保留待重答', {
          checkpointId: submittedCheckpoint.id,
          attempts: sameCheckpointAttempts,
          instruction: '学员这次理解检查答错了：下一轮先用一两句话点拨关键区分，再换一种提问形式重问（填空、口述推理、排序、情境应用均可），不要原样重复同一道选择题。',
        }));
        teachingState.classroomEventHistory = retryEventHistory.slice(-40);
      }
      if (attemptsExhausted) {
        logger.info('[teaching-turn] 检查点重答到顶，强制消费 pendingCheckpoint（打破同一题循环）', {
          sessionId,
          checkpointId: submittedCheckpoint.id,
          attempts: sameCheckpointAttempts,
        });
        // H1 失败留痕：到顶强消是「未解决收场」的终局标记——每笔答错已有 checkpoint:result，
        // 此前终局只写日志、测量层不可见（实测重答上限可被绕过 27 次）。只留痕、不改写。
        // #173-1①：同样延后到提交成功后写。
        deferredEvidence.push({
          kind: `checkpoint:attempt:${submittedCheckpoint.id}`,
          write: () => recordCheckpointAttemptEvidence(session, submittedCheckpoint, {
            outcome: 'attempts_exhausted',
            attempts: sameCheckpointAttempts,
          }),
        });
      }
      teachingState.checkpointHistory = checkpointHistory.slice(-20);
      checkpointResolution = { passed, understanding, judgedBy };
    }

    // 课堂阶段协议：记下本轮结果（本段讲完了吗 / 出题了吗 / 这次作答过了吗 / 题被质疑作废了吗），
    // 下一回合开始时据此推进阶段。存量课堂（协议未激活）不写这个键，行为不变。
    if (phaseView) {
      // 轮转记账按**实际出的题**算（2026-11-26 工程外审）：此前记的是阶段机计划点名的 targetKc，
      // 模型若围绕另一个缺口出题（A3 第 6 回合：计划「识别柠檬酸循环场所」，实际考「识别氧化磷酸化场所」），
      // 计划点名的缺口会被误记为已考，整节课再也不考它。改成记落库题目的 conceptName。
      const emittedConcept = checkpointEmittedThisTurn
        ? String(teachingState.pendingCheckpoint?.conceptName ?? '').trim()
        : '';
      teachingState.lessonPhase = settleLessonPhase(phaseView.state, {
        segmentDone: teachingOutput.control?.segmentDone === true && phaseView.state.phase === 'build',
        checkpointEmitted: checkpointEmittedThisTurn && !!teachingState.pendingCheckpoint,
        isSubmission: !!submittedCheckpoint,
        verdictPassed: submittedCheckpoint ? options.checkpointJudgement?.passed === true : null,
        checkpointVoided: voidedPendingCheckpoint === true,
        targetKc: emittedConcept || phaseView.targetKc,
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
    // 教师补充材料卡片（批次 E）：本轮晋升成功时随消息下发（前端渲染卡片，点开看章节）；
    // 同轮同步复调成功时挂融合用的同一份 payload（2026-11-23——此前 sync 模式不发卡）
    ...(supplementPromotion.payload
      ? { supplementaryMaterial: supplementPromotion.payload }
      : (supplementSyncPayload
        ? { supplementaryMaterial: supplementSyncPayload }
        : {})),
    // 补充材料同步复调 telemetry（2026-11-23）：mode=sync 同轮交付 / fallback 回落异步链；
    // 只在触发轮存在，实用性测试与线上观测靠它统计触发率与耗时分布
    ...(supplementSyncOutcome
      ? {
          supplementSync: {
            mode: supplementSyncOutcome.ok ? 'sync' as const : 'fallback' as const,
            ok: supplementSyncOutcome.ok,
            durationMs: supplementSyncOutcome.durationMs,
            error: supplementSyncOutcome.error ?? null,
            materialId: supplementSyncOutcome.materialId ?? null,
            sourceUrl: supplementSyncOutcome.sourceUrl ?? null,
          },
        }
      : {}),
    strategies: effectiveTeachingOutput.pedagogy.strategies,
    knowledgePoint: effectiveTeachingOutput.knowledge.currentPoint,
    ...(effectiveTeachingOutput.knowledge.confirmCheck
      ? { confirmCheck: effectiveTeachingOutput.knowledge.confirmCheck }
      : {}),
    knowledgePoints: normalizeKnowledgePoints(mergedKnowledge),
    lessonContract,
    lessonReport,
    lessonPhase: phaseView
      // 用 settle 之后的状态生成摘要（2026-11-26 工程外审）：此前发的是回合前快照，
      // 作答通过的那一回合 passedPhases 还少一个，前端阶段条要等下一回合才跳。
      ? lessonPhaseSummary({ ...phaseView, state: (teachingState.lessonPhase as LessonPhaseState | undefined) ?? phaseView.state })
      : null,
    exitTicket: exitTicketState,
    branch: {
      kind: branchDecision.branch,
      need: studentNeed,
      active: branchDecision.state.active,
      remaining: Math.max(0, branchDecision.state.budget - branchDecision.state.turnsUsed),
      parkingLot: branchDecision.state.parkingLot,
    },
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

    await teachingSessionRepository.commitTurnState(sessionId, operationClaim.operationId, {
      messages: persistedMessages,
      messagesBaseCount: operationClaim.messagesBaseCount,
      knowledgeState: mergedKnowledge,
      teachingState,
      taskId: session.taskId,
      userId: session.userId,
      markTaskInProgress: true,
      // 幂等结算与业务写入同事务（2026-10-21）：此前账本在路由里二次独立提交，
      // 崩溃窗口内消息已落库而账本仍 processing，同 key 只能拿到 409。
      ...(options.idempotencyKey
        ? {
            settlement: {
              idempotencyKey: options.idempotencyKey,
              result: options.settlementResult
                ? options.settlementResult(baseResult as unknown as Record<string, any>)
                : baseResult as unknown as Record<string, any>,
              revision: baseResult.revision,
            },
          }
        : {}),
    });
    committed = true;

    // #173-1①：状态已提交成功，现在才写回合证据（checkpoint:result / anchor:result / checkpoint:attempt）。
    // 提交前写会留下「证据在、状态不在」的孤儿行；此处写与 `recordMisconceptions` 同口径：
    // 提交后进程崩溃会丢证据，但绝不产生无法对账的孤立证据。证据写入 best-effort（各自内部已吞错），
    // 这里再包一层 catch 确保任一证据写失败都不影响已提交的课堂状态与响应。
    for (const evidence of deferredEvidence) {
      try {
        await evidence.write();
      } catch (error) {
        logger.warn('[AITeaching] 回合证据写入失败（已提交的课堂状态不受影响）', {
          sessionId,
          kind: evidence.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 误解台账（G-R-R Phase 2）：异步记录本轮结构化误解，best-effort 不阻断回合。
    // 失败路由占位键治理（F1 修复轮 c，R2 复现 concept-1/concept-2 占位入账）：模型给的
    // conceptKey 是路径骨架 concept-N 占位时改挂检查点归属键（发出时带上的当前教学点概念；
    // 无检查点回合退到当前教学点），真键原样，无归属可挂 → 丢弃（宁缺勿错挂）。
    // 本回合的概念归属（检查点归属优先，无检查点回落到当前教学点）：误解与 ktEstimate
    // 两条写入通道共用——占位键的改挂目标必须同源，否则同一回合两处落到不同概念。
    const checkpointConceptAttribution = (submittedCheckpoint?.conceptKey
      ? {
          conceptName: submittedCheckpoint.conceptName ?? '',
          conceptKey: submittedCheckpoint.conceptKey,
          conceptSource: submittedCheckpoint.conceptSource ?? ('derived' as const),
        }
      : resolveCheckpointConceptAttribution(effectiveTeachingOutput.knowledge.currentPoint));
    const misconceptions = teachingOutput.analysis?.misconceptions;
    if (Array.isArray(misconceptions) && misconceptions.length > 0) {
      void recordMisconceptions(session.userId, sessionId, misconceptions.map((m) => ({
        conceptKey: rerouteMisconceptionConceptKey(m.conceptKey, checkpointConceptAttribution) || '',
        hypothesis: m.hypothesis,
        canonicalLabel: m.canonicalLabel ?? null,
        confidence: m.confidence,
        evidence: m.evidence,
        status: m.status,
      })).filter((m) => m.conceptKey && m.hypothesis));
    }

    // θ−d EMA：ktEstimate 跨会话滑动平均（α=0.2），best-effort 不阻断回合
    // #94：kcId（模型从 scenario.taskKcs 回填的稳定键）随行透传——写入侧优先按它锚定概念身份，
    // 未命中/缺失回落自由文本名（见 memory-trace.service resolveConceptIdSafe）。
    const ktConceptMastery = teachingOutput.analysis?.ktEstimate?.conceptMastery;
    if (Array.isArray(ktConceptMastery) && ktConceptMastery.length > 0) {
      // #109：模型把路径骨架 concept-N 回填进 conceptKey 时，与误解台账同口径改挂本回合
      // 概念归属；无归属可挂 → 丢弃（宁缺勿错挂）。此前原样透传 → 写入侧按文本名
      // 新建 concepts/memory_traces（历史 36 条 kt-estimate 痕迹的生成侧根因）。
      const ktItems = ktConceptMastery.flatMap((c) => {
        const conceptKey = rerouteMisconceptionConceptKey(c.conceptKey, checkpointConceptAttribution);
        if (!conceptKey) return [];
        return [{
          conceptKey,
          ...(typeof c.kcId === 'string' && c.kcId.trim() ? { kcId: c.kcId.trim() } : {}),
          mastery: c.mastery,
          // #133（2026-10-22）：模型自报证据窗（skill 侧已截 200 字）随行透传落
          // memory_traces.ktEvidence——此前在此被丢弃，事后检查器只能拿二手转述核对。
          ...(typeof c.evidence === 'string' && c.evidence.trim() ? { evidence: c.evidence.trim() } : {}),
        }];
      });
      if (ktItems.length > 0) {
        void memoryTraceService.applyKtEstimate(session.userId, ktItems, session.learningPathId ?? null).catch((error) => {
          logger.warn('[AITeachingCoordinator] ktEstimate EMA 回写失败', { error: error instanceof Error ? error.message : String(error) });
        });
      }
    }

    return baseResult;
  } finally {
    operationLeaseGuard.stop();
    if (!committed) {
      await teachingSessionRepository.releaseOperation(sessionId, operationClaim.operationId);
    }
  }
}
