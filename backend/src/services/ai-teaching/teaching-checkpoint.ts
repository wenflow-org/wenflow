import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import type { TeachingSessionRecord } from './TeachingSessionRepository';
import type { TeachingScenarioContext } from './TeachingContextBuilder';
import type { AnchorProbePlan } from '../learner/anchor-probe';
import { shouldRunAnchorProbe, partitionDelayedAnchorCandidates, selectAnchorCandidates, evaluateAnchorProbeOutcome } from '../learner/anchor-probe';
import { recordDegradation, degradationCause } from '../../skills/degradation-telemetry';
import {
  ANCHOR_RESULT_LOOKBACK,
  summarizeAnchorEvidence,
  buildAnchorSignalSource,
  buildDelayedAnchorCandidatesFromLearnerSignals,
  resolveDelayedAnchorDays,
  deriveTurnsSinceLastProbe,
  buildAnchorCandidatesFromLearnerSignals,
  buildAnchorResultEvidence,
  anchorResultEvidenceKey,
} from './anchor-probe-emit';
import { simulatedNowOr } from '../../services/virtual-lab/simulation-clock-context';
import {
  CHECKPOINT_MIN_TURNS,
  CHECKPOINT_TRIGGER_MIN_UNDERSTANDING,
  parseSessionArtifacts,
} from './checkpoint-shared';

/**
 * 教学检查点纯函数域（架构审计 §5 行动 #2：AITeachingCoordinator 按领域拆分）
 *
 * 职责：检查点类型契约（TeachingCheckpoint 及提交载荷/结果）、出题判定（shouldEmitCheckpoint）、
 * 待答读取（getPendingCheckpoint）、历史汇总（summarizeCheckpointHistory）、
 * 客观判分（judgeCheckpointAnswer：选择题 id 集合匹配 + 简答关键词包含）、
 * 结果挂载（checkpointForMessageResult）、状态继承与答案键剥离（服务端答案绝不下发）。
 * 自 AITeachingCoordinator 头部迁出，行为保持不变；AITeachingCoordinator re-export
 * 维持既有 import 路径。
 */
export interface TeachingCheckpoint {
  id: string;
  type: 'single_choice' | 'multi_choice' | 'short_answer';
  title: string;
  question: string;
  options?: Array<{ id: string; text: string }>;
  allowSkip?: boolean;
  contextHint?: string;
  /** 答案键（服务端保存，**不下发给学生**）：选择题的正确选项 id */
  correctOptionIds?: string[];
  /** 答案键：简答题的必备要点（代码按包含判定） */
  expectedKeywords?: string[];
  /**
   * 独立锚题探针标记（Q13/B4）：仅当本轮由 `anchor-probe` 选定目标时才存在。
   * 探针结果只写 `learner_evidence: anchor:result` 作为**待复核信号**，绝不静默改写掌握/难度/BKT。
   * 非锚题检查点不带该字段（保持与历史产出逐字节一致）。
   */
  purpose?: 'anchor';
  /** 锚题目标概念（注入提示词、写入证据行，便于人工复核） */
  anchorConceptKey?: string;
  /** 锚题期望信念：mastered→答错即 false_mastery；struggling→答对即 false_struggle */
  anchorExpectedBelief?: 'mastered' | 'struggling';
  /**
   * 锚题种类（Q8 测量深化）：`independent`（Q13 独立证伪，缺省） / `delayed`（延迟保持率复测）。
   * 随 `inheritTeachingState` 跨回合继承，供结果留痕区分两类探针。
   */
  anchorKind?: 'independent' | 'delayed';
  /** 延迟锚题的自然日间隔（UTC 日界，仅 `anchorKind='delayed'`）；用于"间隔 vs 保持率" */
  anchorIntervalDays?: number;
}

export interface CheckpointSubmitPayload {
  selectedOptionIds?: string[];
  answerText?: string;
  /** 跳过检查点：清除待处理检查点并记录历史，不触发教学回合 */
  skip?: boolean;
}

export interface CheckpointSubmitResult {
  passed: boolean;
  feedback: string;
  hint?: string;
  nextAction: 'continue' | 'review' | 'retry';
  revision: number;
}

export function shouldEmitCheckpoint(
  session: { messages: Array<{ role: string; analysis?: any }> },
  teachingState: Record<string, any> | null | undefined,
): boolean {
  if (getPendingCheckpoint(teachingState)) return false;
  const lastTurn = Number(teachingState?.lastCheckpointTurn);
  if (Number.isFinite(lastTurn) && session.messages.length - lastTurn < CHECKPOINT_MIN_TURNS) return false;
  const stage = String(teachingState?.classroomContext?.stage?.current ?? '');
  if (stage === 'wrapup') return false;
  const lastAnalysis = [...session.messages].reverse().find((message) => message?.analysis)?.analysis;
  const understanding = Number(lastAnalysis?.understanding);
  return Number.isFinite(understanding) && understanding >= CHECKPOINT_TRIGGER_MIN_UNDERSTANDING;
}

export function getPendingCheckpoint(teachingState: Record<string, any> | null | undefined): TeachingCheckpoint | null {
  return teachingState?.pendingCheckpoint
    || parseSessionArtifacts(teachingState).pendingCheckpoint
    || null;
}

export function summarizeCheckpointHistory(raw: unknown): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  recent: Array<{ title: string; passed: boolean; skipped?: boolean; understanding?: number }>;
} | null {
  const rows = Array.isArray(raw) ? raw : [];
  if (rows.length === 0) return null;
  const passed = rows.filter((row) => row?.passed === true).length;
  const skipped = rows.filter((row) => row?.skipped === true).length;
  return {
    total: rows.length,
    passed,
    failed: rows.length - passed - skipped,
    skipped,
    recent: rows.slice(-5).map((row) => ({
      title: String(row?.title ?? row?.checkpointId ?? ''),
      passed: row?.passed === true,
      ...(row?.skipped === true ? { skipped: true } : {}),
      ...(typeof row?.understanding === 'number' ? { understanding: row.understanding } : {}),
    })),
  };
}

export interface CheckpointCodeJudgement {
  /** code = 代码按答案键裁决（独立传感器）；model-reference = 无答案键，退回模型/完成度派生（同步标记，不冒充独立） */
  judgedBy: 'code' | 'model-reference';
  passed: boolean;
  detail: string;
}

/** 归一化选项 id 集合（大小写/空白容错） */
function normalizeIdSet(ids: unknown): Set<string> {
  if (!Array.isArray(ids)) return new Set();
  return new Set(ids
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean));
}

/** 归一化待比对文本：小写、去空白与常见标点（简答要点的保守包含判定） */
function normalizeForMatch(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s，。、；：！？,.;:!?（）()【】[\]"'“”‘’—-]/g, '');
}

/**
 * **代码裁决**检查点作答（2026-09-17，审计 §7 P1-1「独立传感器」）。
 *
 * 原理：此前 `passed` 由 `completionReady || 当前点已被判 mastered` 反推——**答案是模型自己的判断**，
 * 于是"检查点通过率"与"模型认为学习者懂不懂"是同一条序列（自证回路，§5.3）。
 * 有了答案键（`control.checkpoint.correctOptionIds` / `expectedKeywords`），对错可以由代码判定，
 * 这才是可用于闭环控制的、独立于 LLM 自评的观测量。
 *
 * 边界（诚实标注，不假装独立）：
 * - 没有答案键 → 返回 `null`，调用方退回旧的模型派生判定，并在证据里标 `judgedBy='model-reference'`；
 * - 简答按"要点是否出现"保守判定：宁可**漏判通过**，不误判通过（避免鼓励背关键词）；
 * - 这仍是**弱独立**：题目与答案键都由 LLM 产出，独立的是"评判学习者"这一步。
 */
export function judgeCheckpointAnswer(
  checkpoint: Pick<TeachingCheckpoint, 'type' | 'correctOptionIds' | 'expectedKeywords'>,
  submission: { selectedOptionIds?: string[]; answerText?: string },
): CheckpointCodeJudgement | null {
  if (checkpoint.type === 'single_choice' || checkpoint.type === 'multi_choice') {
    const key = normalizeIdSet(checkpoint.correctOptionIds);
    if (key.size === 0) return null;
    const chosen = normalizeIdSet(submission?.selectedOptionIds);
    const passed = chosen.size === key.size && Array.from(chosen).every((id) => key.has(id));
    // detail 用**原始写法**（便于事后人工复核），比对用归一化集合
    const original = (ids: unknown) => Array.from(new Set((Array.isArray(ids) ? ids : [])
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean)));
    const keyText = original(checkpoint.correctOptionIds).join('/');
    const chosenText = original(submission?.selectedOptionIds).join('/') || '空';
    return {
      judgedBy: 'code',
      passed,
      detail: passed
        ? `选项集合与答案键一致（${keyText}）`
        : `选项集合不一致（正确 ${keyText}，作答 ${chosenText}）`,
    };
  }

  const keywords = (checkpoint.expectedKeywords || []).map(normalizeForMatch).filter(Boolean);
  if (keywords.length === 0) return null;
  const text = normalizeForMatch(submission?.answerText);
  const missing = keywords.filter((keyword) => !text.includes(keyword));
  return {
    judgedBy: 'code',
    passed: missing.length === 0,
    detail: missing.length === 0 ? '作答包含全部要点' : `缺少要点：${missing.join('/')}`,
  };
}

/**
 * 检查点结果留痕（`learner_evidence` type=`checkpoint:result`）。
 *
 * 为什么单独留痕：这是**独立于 LLM 自评**的第一手观测（`judgedBy='code'` 时）——
 * 第 3 步的"目标成功率带"（§7 P1-1）与效度检验（§8 E5）都以它为输入。
 * 无答案键时也照记，但标 `judgedBy='model-reference'`，**不得**混进独立信号。
 * 置信度按来源给：code=0.95（可复算）、model-reference=0.6（模型派生，含自证风险）。
 */
export async function recordCheckpointResultEvidence(
  session: TeachingSessionRecord,
  checkpoint: TeachingCheckpoint,
  result: {
    passed: boolean;
    judgedBy: 'code' | 'model-reference';
    detail: string | null;
    submission: { selectedOptionIds?: string[] };
  },
): Promise<void> {
  try {
    const at = new Date();
    await prisma.learner_evidence.create({
      data: {
        id: `lev_cp_${checkpoint.id}_${at.getTime()}`,
        eventId: `checkpoint:${checkpoint.id}:${at.getTime()}`,
        evidenceKey: `checkpoint:result:${checkpoint.id}`,
        userId: session.userId,
        pathId: session.learningPathId ?? null,
        taskId: session.taskId ?? null,
        sessionId: session.id,
        evidenceType: 'checkpoint:result',
        payload: JSON.stringify({
          checkpointId: checkpoint.id,
          type: checkpoint.type,
          passed: result.passed,
          judgedBy: result.judgedBy,
          detail: result.detail,
          ...(result.submission.selectedOptionIds?.length
            ? { selectedOptionIds: result.submission.selectedOptionIds }
            : {}),
        }),
        confidence: result.judgedBy === 'code' ? 0.95 : 0.6,
        occurredAt: at,
      },
    });
    logger.info('[AITeaching] 检查点结果留痕', {
      sessionId: session.id,
      checkpointId: checkpoint.id,
      passed: result.passed,
      judgedBy: result.judgedBy,
    });
  } catch (error) {
    logger.warn('[AITeaching] 检查点结果留痕失败（不影响判定与课堂）', {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 锚题探针 · 回合内目标解析（本接线里唯一的 I/O 点）。
 *
 * 仅在**本轮满足出检查点条件**（`emitCheckpoint=true`，即 `shouldEmitCheckpoint` 为真）时才接线——
 * 探针复用检查点这一个测量槽位（`anchor-probe` 纪律 3：不与检查点抢采样）。随后按优先级解析：
 * 1. **延迟锚题（Q8）**：已掌握/已完成点距上次接触达到 N 个自然日（UTC 日界，env
 *    `TEACHING_DELAYED_ANCHOR_DAYS`，默认 7）→ 做一次保持率复测，产出"间隔 vs 保持率"样本；
 *    以 `lastProbeAt` 做同间隔冷却，避免同一窗口内重复投放。
 * 2. **独立证伪探针（Q13/B4）**：用 `shouldRunAnchorProbe` 过闸（间隔 72h、轮次、退避、无 pending 检查点），
 *    从 `mastered/struggling` 候选 `limit:1` 选一个目标。
 *
 * 任何一步不满足 / 读取失败 → 返回 null，链路**与不接线时逐字节一致**（不注入、不落标记、不写证据）。
 * 数据来源：`learnerProjection.relevantKnowledge.mastered/struggling`（由 memory_traces + 会话看板派生）；
 * `fragile` 被有意排除，`turnsSinceLastProbe` 用 `消息数 − lastCheckpointTurn` 近似，详见 anchor-probe-emit.ts。
 */
export async function resolveAnchorProbeTarget(params: {
  userId: string;
  teachingState: Record<string, any> | null | undefined;
  emitCheckpoint: boolean;
  learnerProjection: TeachingScenarioContext['learnerProjection'] | null | undefined;
  /** 全量已掌握概念 lastSeenAt（不受 recentConceptLedger 12 条截断；见 TeachingContextBuilder） */
  masteredLastSeenAt?: Record<string, string> | null;
  messageCount: number;
  now: Date;
}): Promise<AnchorProbePlan | null> {
  if (!params.emitCheckpoint) return null;
  try {
    const rows = await prisma.learner_evidence.findMany({
      where: { userId: params.userId, evidenceType: 'anchor:result' },
      orderBy: { occurredAt: 'desc' },
      take: ANCHOR_RESULT_LOOKBACK,
      select: { occurredAt: true, payload: true },
    });
    const { lastProbeAt, probesSinceLastFlag } = summarizeAnchorEvidence(rows);
    const signalSource = buildAnchorSignalSource(params.learnerProjection, params.masteredLastSeenAt);

    // 优先：延迟锚题（Q8 测量深化）——已完成点经过 N 个自然日后复测保持率。
    const delayed = partitionDelayedAnchorCandidates(
      buildDelayedAnchorCandidatesFromLearnerSignals(signalSource),
      {
        now: params.now,
        minIntervalDays: resolveDelayedAnchorDays(process.env.TEACHING_DELAYED_ANCHOR_DAYS),
        lastProbeAt,
        limit: 1,
      },
    );
    // 跨时钟域/非法时间戳：显式跳过并留痕（绝不静默钳制）。正常"未到间隔"不在此列，避免噪声。
    const crossDomain = delayed.skipped.filter((item) => item.reason === 'future-timestamp');
    const invalidTime = delayed.skipped.filter((item) => item.reason === 'invalid-time');
    if (crossDomain.length > 0 || invalidTime.length > 0) {
      logger.warn('[anchor-probe] 延迟锚题候选时间戳异常，已跳过并留痕（跨时钟域/非法时间）', {
        userId: params.userId,
        now: params.now.toISOString(),
        crossDomain: crossDomain.map((item) => ({ conceptKey: item.conceptKey, completedAt: item.completedAt })),
        invalidTime: invalidTime.map((item) => ({ conceptKey: item.conceptKey, completedAt: item.completedAt })),
      });
    }
    if (crossDomain.length > 0) {
      recordDegradation({
        source: 'ai-teaching/anchor-probe',
        faultCategory: 'SCHEMA_VIOLATION',
        severity: 'P3_NOTICE',
        impactedDimensions: ['anchorProbe.delayed.completedAt'],
        mitigationApplied: 'skip-cross-domain-candidate',
        rootCauseMessage: `delayed anchor candidate timestamp after now (clock-domain mismatch): ${crossDomain
          .map((item) => item.conceptKey)
          .join(',')
          .slice(0, 200)}`,
      });
    }
    if (delayed.plans[0]) return delayed.plans[0];

    // 其次：独立证伪探针（Q13/B4）
    const decision = shouldRunAnchorProbe({
      now: params.now,
      lastProbeAt,
      hasPendingCheckpoint: getPendingCheckpoint(params.teachingState) !== null,
      turnsSinceLastProbe: deriveTurnsSinceLastProbe(
        params.messageCount,
        params.teachingState?.lastCheckpointTurn,
      ),
      probesSinceLastFlag,
    });
    if (!decision.shouldRun) return null;

    const candidates = buildAnchorCandidatesFromLearnerSignals(signalSource);
    const plans = selectAnchorCandidates(candidates, { limit: 1 });
    return plans[0] ?? null;
  } catch (error) {
    // 允许降级，不允许未打标的降级：读取失败 → 本轮不投放，结构化遥测留痕，链路照常。
    logger.warn('[anchor-probe] 目标解析失败（本轮不投放，链路照常）', {
      userId: params.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    recordDegradation({
      source: 'ai-teaching/anchor-probe',
      faultCategory: 'DB_READ_FAILED',
      severity: 'P3_NOTICE',
      impactedDimensions: ['anchorProbeTarget'],
      mitigationApplied: 'return-null-skip-turn',
      rootCauseMessage: degradationCause(error),
    });
    return null;
  }
}

/**
 * 独立锚题结果留痕（`learner_evidence` type=`anchor:result`）。
 *
 * 触发条件（全部满足）：该检查点带 `purpose='anchor'`、由**代码裁决**（`judgedBy='code'`，纪律 1）、
 * 且 `anchorExpectedBelief` 合法。`evaluateAnchorProbeOutcome` 只产出"证伪/一致"标记，
 * **绝不改写** knowledge/mastery/difficulty/BKT（纪律 2）；证伪时打 `warn` 提示人工复核。
 *
 * 幂等：`(eventId, evidenceKey)` 由 checkpointId 派生并命中唯一约束，同一检查点重复提交只保留一行
 * （答错重答时按最新一次结果 upsert），不会重复计数。
 */
export async function recordAnchorProbeResult(
  session: TeachingSessionRecord,
  checkpoint: TeachingCheckpoint,
  passed: boolean,
): Promise<void> {
  const expected = checkpoint.anchorExpectedBelief;
  if (expected !== 'mastered' && expected !== 'struggling') return;
  try {
    const outcome = evaluateAnchorProbeOutcome({ expected, passed });
    const anchorKind = checkpoint.anchorKind ?? 'independent';
    const row = buildAnchorResultEvidence({
      checkpointId: checkpoint.id,
      conceptKey: checkpoint.anchorConceptKey ?? null,
      expected,
      passed,
      signal: outcome.signal,
      falsified: outcome.falsified,
      anchorKind,
      intervalDays: checkpoint.anchorIntervalDays ?? null,
      userId: session.userId,
      pathId: session.learningPathId ?? null,
      taskId: session.taskId ?? null,
      sessionId: session.id,
      occurredAt: simulatedNowOr(),
    });
    const { eventId, evidenceKey } = anchorResultEvidenceKey(checkpoint.id);
    await prisma.learner_evidence.upsert({
      where: { eventId_evidenceKey: { eventId, evidenceKey } },
      create: row,
      update: {
        payload: row.payload,
        confidence: row.confidence,
        occurredAt: row.occurredAt,
      },
    });
    if (outcome.falsified) {
      logger.warn('[anchor-probe] 独立锚题证伪既有信念（仅标记待复核，不改写掌握/难度/BKT）', {
        sessionId: session.id,
        checkpointId: checkpoint.id,
        conceptKey: checkpoint.anchorConceptKey ?? null,
        expected,
        anchorKind,
        intervalDays: checkpoint.anchorIntervalDays ?? null,
        passed,
        signal: outcome.signal,
      });
    } else {
      logger.info('[anchor-probe] 独立锚题结果留痕', {
        sessionId: session.id,
        checkpointId: checkpoint.id,
        conceptKey: checkpoint.anchorConceptKey ?? null,
        expected,
        anchorKind,
        intervalDays: checkpoint.anchorIntervalDays ?? null,
        passed,
        signal: outcome.signal,
      });
    }
  } catch (error) {
    logger.warn('[anchor-probe] 探针结果留痕失败（不影响判定与课堂）', {
      sessionId: session.id,
      checkpointId: checkpoint.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 剥离检查点答案键（客户端投影前调用）：答案键只用于服务端代码裁决，**绝不下发**。
 * 覆盖两处暴露面：`pendingCheckpoint` 本身，以及原样返回的 `teachingState`（其中也存了一份）。
 */
/**
 * 消息响应里下发的 `checkpoint`：**必须先剥离答案键**。
 *
 * 为什么单独抽出来（18 号报告 N1）：`/messages`（含 SSE final）此前直接下发
 * `getPendingCheckpoint(teachingState)`，而 `pendingCheckpoint` 里带着 `correctOptionIds` /
 * `expectedKeywords`——答案键一旦下发，"代码裁决独立传感器"的反作弊前提就失效了。
 * `/detail` 早已剥离，这里补齐唯一遗漏的出口。
 */
export function checkpointForMessageResult(
  teachingState: Record<string, any> | null | undefined
): TeachingCheckpoint | null {
  const stripped = stripCheckpointAnswerKeys({ pendingCheckpoint: getPendingCheckpoint(teachingState) });
  return stripped.pendingCheckpoint ?? null;
}

/**
 * 组装本回合 `teachingState`：**先继承上一回合顶层状态，再覆盖本回合字段**。
 *
 * 为什么必须继承（18 号报告 N2）：本函数此前用 `{ ...currentState(运行时指标), ... }` 重建，
 * 而运行时指标里**没有** `pendingCheckpoint` / `lastCheckpointTurn` / `checkpointHistory`——
 * 它们只存在于上一回合的顶层。于是每次重建都把它们丢掉：
 * 答错后 `getPendingCheckpoint` 返回 null → `submitCheckpoint` 报"理解检查不存在或已处理"，
 * `checkpointHistory` 永远为空（DB 实测 220 会话仅 2 条）。
 */
export function inheritTeachingState<T extends Record<string, any>>(
  previousTeachingState: Record<string, any> | null | undefined,
  turnState: T
): T & Record<string, any> {
  return { ...(previousTeachingState || {}), ...turnState };
}

export function stripCheckpointAnswerKeys<T extends Record<string, any> | null | undefined>(teachingState: T): T {
  if (!teachingState || typeof teachingState !== 'object') return teachingState;
  const clone: Record<string, any> = { ...(teachingState as Record<string, any>) };
  const stripOne = (checkpoint: any) => {
    if (!checkpoint || typeof checkpoint !== 'object') return checkpoint;
    const { correctOptionIds, expectedKeywords, ...rest } = checkpoint;
    void correctOptionIds;
    void expectedKeywords;
    return rest;
  };
  if (clone.pendingCheckpoint) clone.pendingCheckpoint = stripOne(clone.pendingCheckpoint);
  if (clone.sessionArtifacts && typeof clone.sessionArtifacts === 'object' && clone.sessionArtifacts.pendingCheckpoint) {
    clone.sessionArtifacts = { ...clone.sessionArtifacts, pendingCheckpoint: stripOne(clone.sessionArtifacts.pendingCheckpoint) };
  }
  return clone as T;
}
