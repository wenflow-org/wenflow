/* eslint-disable @typescript-eslint/no-explicit-any -- 教学回合上下文/模型产出的动态形状，字段由上游契约与运行时校验兜底 */
/**
 * 教学回合的知识/支线/完成判定（2026-11-27 从 teaching-turn-engine.ts 拆出）。
 *
 * 输入是本轮模型产出与课堂上下文，输出本轮合并后的知识、支线判定、契约证据、
 * 完成信号与终检处理结果。所有判定仍是确定性代码，不含 LLM 调用。
 */
import { logger } from '../../utils/logger';
import type { TeachingTurnOutput } from '../../skills/teaching-turn';
import type { ProcessStudentMessageOptions } from './AITeachingCoordinator';
import type { TeachingSessionRecord, TeachingSessionMessage } from './TeachingSessionRepository';
import type { TeachingScenarioContext } from './TeachingContextBuilder';
import type { TeachingCheckpoint } from './teaching-checkpoint';
import type { BoardState } from './board-state';
import type { ExitTicket, LessonContract, LessonEvidence } from './lesson-contract';
import {
  CLOSING_REPLY_PATTERNS,
  SOFT_COMPLETION_PROGRESS_FLOOR,
  appendExitTicketToReply,
  computeLearnerShortAckStreak,
  generateExitTicketForLesson,
  resolveCompletionScope,
  stripTrailingQuestionParagraph,
} from './teaching-turn-preparation';
import {
  collectLessonEvidence,
  evaluateLessonContract,
  MAX_EXIT_TICKET_ATTEMPTS,
  normalizeBranchState,
  normalizeStudentNeed,
  resolveBranchDecision,
} from './lesson-contract';
import { shouldDeferCompletionForClosure, detectOpenRequest } from './teaching-closure';
import { COMPLETION_TURNS_BACKSTOP } from './teaching-session-views';
import { buildCheckpointCodeArbitration } from './teaching-checkpoint';
import { parseSessionArtifacts, resolveCheckpointConceptAttribution } from './checkpoint-shared';
import {
  extractWarmupOutcomes,
  pendingWarmupForModel,
  stripWarmupPoints,
} from './teaching-warmup';
import { reconcileTeachingKnowledgeState, normalizeFrozenKnowledgeState } from './teaching-knowledge-state';
import { knowledgeStateService, COMPLETION_TARGET_PROGRESS_FLOOR } from './KnowledgeStateService';
import { assessAdjacentRepetition, findPreviousAssistantReply } from './teaching-repetition-guard';

export interface TeachingTurnEvaluation {
  teachingOutput: TeachingTurnOutput;
  effectiveTeachingOutput: TeachingTurnOutput;
  warmupOutcomes: ReturnType<typeof extractWarmupOutcomes>;
  pendingItems: number;
  branchDecision: ReturnType<typeof resolveBranchDecision>;
  studentNeed: ReturnType<typeof normalizeStudentNeed>;
  masteryDegrade: ReturnType<typeof knowledgeStateService.diffMastery>;
  mergedKnowledge: ReturnType<typeof normalizeFrozenKnowledgeState>;
  checkpointAttempt: {
    checkpointId: string;
    submittedAt: string;
    attempts: number;
    conceptName?: string;
    conceptKey?: string;
    answerAlreadyGiven?: true;
  } | null;
  completionReady: boolean;
  forcedCompletionLoopBreak: boolean;
  closureRepeatStreak: number;
  closureGate: ReturnType<typeof shouldDeferCompletionForClosure>;
  exitTicketState: ExitTicket | null;
  exitTicketHistory: ExitTicket[];
  contractEvaluation: ReturnType<typeof evaluateLessonContract>;
  lessonEvidence: LessonEvidence[];
  completionPath: 'targets' | 'backstop' | 'soft-model' | 'none';
  completionAlignment: 'agree' | 'envelope-only' | 'knowledge-only' | 'neither' | 'soft-model';
  avgTargetProgress: number;
  teachingTurns: number;
  completionTargets: string[];
  rawPoints: any[];
  envelopeCompletionSignal: boolean;
}

export interface TeachingTurnEvaluationParams {
  rawTeachingOutput: TeachingTurnOutput | null;
  context: TeachingScenarioContext;
  frozenKnowledgeState: ReturnType<typeof normalizeFrozenKnowledgeState>;
  effectiveInitialKnowledgeState: ReturnType<typeof normalizeFrozenKnowledgeState>;
  previousTeachingState: Record<string, any>;
  session: TeachingSessionRecord;
  sessionArtifacts: ReturnType<typeof parseSessionArtifacts>;
  lessonContract: LessonContract;
  previousBranchState: ReturnType<typeof normalizeBranchState>;
  message: string;
  updatedMessages: TeachingSessionMessage[];
  submittedCheckpoint: TeachingCheckpoint | null;
  checkpointId: ProcessStudentMessageOptions['checkpointId'];
  checkpointJudgement: ProcessStudentMessageOptions['checkpointJudgement'];
  exitTicketGradedThisTurn: boolean;
  exitTicketAttempts: number;
  exitTicketFormatMiss: boolean;
  exitTicketState: ExitTicket | null;
  exitTicketHistory: ExitTicket[];
  phaseView: { state: { phase: string }; completionDue: boolean } | null;
  boardForTurn: BoardState | null;
  taughtSoFar: string;
  turnRuntimeEnvelope: { businessState?: { phase?: string | null; isTerminal?: boolean } } | null;
}

export async function evaluateTeachingTurn(params: TeachingTurnEvaluationParams): Promise<TeachingTurnEvaluation> {
  const {
    rawTeachingOutput, context, frozenKnowledgeState, effectiveInitialKnowledgeState,
    previousTeachingState, session, sessionArtifacts, lessonContract, previousBranchState,
    message, updatedMessages, submittedCheckpoint, checkpointId, checkpointJudgement,
    exitTicketGradedThisTurn, exitTicketAttempts, exitTicketFormatMiss,
    phaseView, boardForTurn, taughtSoFar, turnRuntimeEnvelope,
  } = params;
  let exitTicketState = params.exitTicketState;
  const exitTicketHistory = [...params.exitTicketHistory];
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
      sessionId: session.id,
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
    checkpointJudgement,
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
  const currentCheckpointRows = (checkpointId && checkpointAttempt && checkpointJudgement)
    ? [{
        ...checkpointAttempt,
        passed: checkpointJudgement.passed === true,
        judgedBy: checkpointJudgement.judgedBy,
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
            sessionId: session.id,
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
      sessionId: session.id,
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
  return {
    teachingOutput, effectiveTeachingOutput, warmupOutcomes, pendingItems, branchDecision,
    studentNeed, masteryDegrade, mergedKnowledge, checkpointAttempt, completionReady,
    forcedCompletionLoopBreak, closureRepeatStreak, closureGate, exitTicketState,
    exitTicketHistory, contractEvaluation, lessonEvidence, completionPath,
    completionAlignment, avgTargetProgress, teachingTurns, completionTargets,
    rawPoints, envelopeCompletionSignal,
  };
}
