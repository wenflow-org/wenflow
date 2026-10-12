/**
 * 降级 wrapup 重生成（2026-10-11 补轮，用户令「补一轮」）
 *
 * 背景：fast 链并发 8-12 时上游池对 wrapup 调用打 429/500，94 节完课的 wrapup 退化为
 * summary-only（evidence 占位、掌握度缺失）。已完成会话再调 endSession 只会返回缓存，
 * 本模块提供「只重跑 wrapup 产物」的重生成路径：
 *   - 输入装配与 endSession 同源（同一批 helper，不复制逻辑）；
 *   - 只写 teaching_sessions.wrapup 列 + learning_metrics（原退化会话 scoreInput=null 从未写入）；
 *   - 不碰 advisory/归因/快照/insight（接受旧 advisory 停留在阈值版——它们本就与 wrapup 弱耦合）。
 * 守卫：仅 status='completed' 且现有 wrapup 为降级态（summary-only/fallback）的会话可重生成。
 *
 * 两个入口共用同一组同步守卫（resolveRegenTarget）：
 *   - regenerateWrapup：管理端同步等待（POST /api/admin/virtual-learners/sessions/:id/regenerate-wrapup）
 *   - startWrapupRegeneration：学习者侧（2026-10-12，总结页「重新生成总结」）——重生成首试 480s
 *     + 重试 240s 的硬帽决定它不能挂在一个 HTTP 请求上：守卫立即应答，重活 void 后台跑，
 *     前端轮询 detail 观察 sources 升级 / regeneratedAt 变化。
 */
import prisma from '../../config/database';
import { executeSkill, sessionWrapupAgentDefinition } from '../../skills';
import { logger } from '../../utils/logger';
import { teachingSessionRepository, type TeachingSessionRecord } from './TeachingSessionRepository';
import { buildTeachingScenarioContext } from './TeachingContextBuilder';
import { parseSessionArtifacts } from './checkpoint-shared';
import { deriveTeachingRuntimeSignals } from './teaching-classroom-flow';
import { computeKnowledgeDelta } from './teaching-knowledge-state';
import { computeEffectiveDurationMinutes, computeSessionEvidence } from './teaching-session-views';
import { aggregateSessionEvaluationFromMessages, buildSessionEvaluationShadow } from '../learning/session-evaluation-aggregate';
import { hasReliableSessionEvaluation } from './SessionFinalizationPolicy';
import { learningStateService, type LearningStateMetrics } from '../learning/learning-state.service';
import { loadRetrievabilityHints } from './teaching-session-lifecycle';

const inFlight = new Set<string>();

/** 重生成冷却：一轮（含两次 LLM 尝试）落库后至少隔这么久才允许再触发，防连点烧 LLM 预算 */
const REGEN_COOLDOWN_MS = 120_000;

export type WrapupRegenOperator = { adminId?: string | null; adminName?: string | null };

function isDegradedWrapup(wrapup: unknown): boolean {
  const w = wrapup as Record<string, any> | null;
  if (!w) return false;
  if (w.status === 'summary-only') return true;
  const sources = w.sources as Record<string, string> | undefined;
  return String(sources?.summary || '').includes('fallback') || sources?.evaluation === 'unavailable';
}

type RegenTarget =
  | { session: TeachingSessionRecord; existing: Record<string, any> | null }
  | { error: string }
  | { skipped: string };

/** 守卫与执行分离：学习者侧端点必须先拿守卫结果立即应答，重活丢后台 */
async function resolveRegenTarget(sessionId: string): Promise<RegenTarget> {
  if (inFlight.has(sessionId)) return { skipped: 'already-in-flight' };
  const session = await teachingSessionRepository.getById(sessionId);
  if (!session) return { error: '会话不存在' };
  if (session.status !== 'completed') return { error: `仅完结会话可重生成（当前 ${session.status}）` };
  // repository 的 mapRecord 已把 wrapup 解析成对象（历史行也可能是字符串，双形态兼容）
  const existing = (typeof session.wrapup === 'string'
    ? (() => { try { return JSON.parse(session.wrapup as string); } catch { return null; } })()
    : session.wrapup) as Record<string, any> | null;
  if (!isDegradedWrapup(existing)) return { skipped: 'wrapup 未退化，无需重生成' };
  const lastRegenAt = Date.parse(String(existing?.regeneratedAt || ''));
  if (Number.isFinite(lastRegenAt) && Date.now() - lastRegenAt < REGEN_COOLDOWN_MS) {
    return { skipped: '刚刚重试过，请稍候再试' };
  }
  return { session, existing };
}

async function runWrapupRegeneration(
  sessionId: string,
  session: TeachingSessionRecord,
  existing: Record<string, any> | null,
  operator: WrapupRegenOperator
): Promise<{ regenerated: boolean; skipped?: string; error?: string }> {
  inFlight.add(sessionId);
  try {
    const sessionArtifacts = { ...parseSessionArtifacts(session.teachingState), endReason: parseSessionArtifacts(session.teachingState).endReason || 'task-completed' };
    const classroomEventHistory = Array.isArray(session.teachingState?.classroomEventHistory) ? session.teachingState?.classroomEventHistory : [];
    const finalClassroomContext = session.teachingState?.classroomContext || null;
    const stageHistory = Array.isArray(session.teachingState?.stageHistory) ? session.teachingState?.stageHistory : [];
    const initialKnowledgeState = Array.isArray(sessionArtifacts.initialKnowledgeState) ? sessionArtifacts.initialKnowledgeState : [];
    const knowledgeDelta = computeKnowledgeDelta(initialKnowledgeState, session.knowledgeState);
    const sessionEvidence = computeSessionEvidence(session);
    const context = await buildTeachingScenarioContext(session.userId, session.taskId, session);
    const reviewHints = await loadRetrievabilityHints(session.userId);
    const durationMinutes = computeEffectiveDurationMinutes(session);

    // 与 endSession 同形的技能调用（首试 480s + 重试 240s）
    const runAttempt = (timeoutMs: number) => Promise.race([
      executeSkill(sessionWrapupAgentDefinition, {
        input: {
          messages: session.messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: new Date(m.timestamp),
            analysis: m.analysis,
          })),
          knowledgePoints: session.knowledgeState,
          sessionInfo: {
            subject: session.subject,
            topic: session.topic,
            durationMinutes,
            userMessageCount: session.messages.filter((m) => m.role === 'user').length,
            assistantMessageCount: session.messages.filter((m) => m.role === 'assistant').length,
            taskType: session.taskType,
            taskTitle: context.taskTitle,
            taskDescription: context.taskDescription,
            pathTitle: context.pathContext.pathTitle || null,
            pathSummary: context.pathContext.pathSummary || null,
          },
          learningState: context.learningState ? { ...context.learningState, ...deriveTeachingRuntimeSignals(context) } : undefined,
          knowledgeContext: { initialPoints: initialKnowledgeState, delta: knowledgeDelta, reviewHints },
          sessionEvidence,
          sessionStructure: {
            pathBackground: sessionArtifacts.pathBackgroundContext || null,
            finalClassroomContext,
            classroomEventHistory,
            stageHistory,
            endReason: sessionArtifacts.endReason || 'task-completed',
          },
        },
        context: { userId: session.userId, sessionId },
      }, {
        contextEnvelope: {
          schemaVersion: 'context-envelope/v1',
          principal: { userId: session.userId },
          session: { sessionId: session.id, conversationId: session.id, taskId: session.taskId },
        },
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error(`WRAPUP_REGEN_TIMEOUT_${Math.round(timeoutMs / 1000)}S`)), timeoutMs);
        if (timer && typeof timer === 'object' && 'unref' in timer) timer.unref();
      }),
    ]);

    let output: any = null;
    try {
      output = await runAttempt(480_000);
    } catch (firstError) {
      logger.warn('[wrapup-regen] 首试失败，重试一次', { sessionId, firstAttemptError: firstError instanceof Error ? firstError.message : String(firstError) });
      output = await runAttempt(240_000);
    }
    const ext = output?.internal?.ext?.sessionWrapup;
    const result = ext?.result;
    const artifact = ext?.artifact;
    if (!result || !artifact) return { regenerated: false, error: 'wrapup 技能未产出结果（ext 缺失）' };

    // 指标补写：原退化会话 scoreInput=null 从未写 learning_metrics；评估可靠时补一次
    // （与 completeWithEvent 的 metric 块同语义：revision 守卫 + sourceKey deleteMany/create）
    let finalState: LearningStateMetrics | null = null;
    const evaluation = hasReliableSessionEvaluation(result.evaluation, result.evaluationSource) ? result.evaluation : null;
    if (evaluation) {
      try {
        const commit = await learningStateService.prepareSessionScoreCommit(session.userId, {
          sessionLss: evaluation.sessionLss,
          sessionKtl: evaluation.sessionKtl,
          sessionLf: evaluation.sessionLf,
          durationMinutes,
          confidence: evaluation.confidence,
          pathId: session.learningPathId || null,
          taskId: session.taskId,
          sessionId,
        });
        await prisma.$transaction(async (tx) => {
          const claimed = await tx.users.updateMany({
            where: { id: commit.userId, learningStateRevision: commit.expectedRevision },
            data: { learningStateRevision: { increment: 1 } },
          });
          if (claimed.count !== 1) throw new Error('TEACHING_LEARNING_STATE_STALE');
          await tx.learning_metrics.deleteMany({ where: { sourceKey: commit.sourceKey } });
          await tx.learning_metrics.create({ data: commit.data as any });
        });
        finalState = commit.metrics;
      } catch (metricError) {
        // 指标竞争/失败不阻塞 wrapup 重生成（状态口径保持旧值）
        logger.warn('[wrapup-regen] 指标补写失败（不阻塞）', { sessionId, error: metricError instanceof Error ? metricError.message : String(metricError) });
      }
    }

    const deterministicEvaluation = aggregateSessionEvaluationFromMessages(session.messages);
    const shadowDeterministic = buildSessionEvaluationShadow({
      llm: evaluation ?? null,
      deterministic: deterministicEvaluation,
      recordedAt: new Date().toISOString(),
    });
    const persistedWrapup = {
      ...artifact,
      duration: durationMinutes,
      stateUpdate: finalState ?? (existing as any)?.stateUpdate ?? null,
      summarySource: result.summarySource,
      evaluationSource: result.evaluationSource,
      runtimeEnvelope: output?.runtimeEnvelope || result?.runtimeEnvelope || null,
      shadowDeterministic,
      // 重生成留痕：区分首写与补轮（审计读得到，学习者侧轮询也靠它判定"一轮已落库"）
      regeneratedAt: new Date().toISOString(),
      regeneratedBy: operator.adminId ?? operator.adminName ?? 'system-catchup',
    };
    const updated = await prisma.teaching_sessions.updateMany({
      where: { id: sessionId, status: 'completed' },
      data: { wrapup: JSON.stringify(persistedWrapup), updatedAt: new Date() },
    });
    if (updated.count !== 1) return { regenerated: false, error: '会话状态已变化，放弃写入' };

    await prisma.admin_audit_logs.create({
      data: {
        adminId: operator.adminId ?? null,
        adminName: operator.adminName ?? null,
        action: 'teaching-wrapup-regenerate',
        targetType: 'teaching_session',
        targetId: sessionId,
        before: { status: existing?.status, summarySource: existing?.summarySource, evaluationSource: existing?.evaluationSource },
        after: { status: persistedWrapup.status, summarySource: persistedWrapup.summarySource, evaluationSource: persistedWrapup.evaluationSource },
      } as any,
    }).catch(() => []);

    logger.info('[wrapup-regen] 重生成完成', { sessionId, summarySource: persistedWrapup.summarySource, evaluationSource: persistedWrapup.evaluationSource, metricsBackfilled: !!finalState });
    return { regenerated: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[wrapup-regen] 重生成失败', { sessionId, error: message });
    return { regenerated: false, error: message };
  } finally {
    inFlight.delete(sessionId);
  }
}

/** 管理端入口：同步等待整轮重生成（最长 ~12 分钟，管理端调用方是后台脚本/运维动作） */
export async function regenerateWrapup(
  sessionId: string,
  operator: WrapupRegenOperator = {}
): Promise<{ regenerated: boolean; skipped?: string; error?: string }> {
  const target = await resolveRegenTarget(sessionId);
  if ('error' in target) return { regenerated: false, error: target.error };
  if ('skipped' in target) return { regenerated: false, skipped: target.skipped };
  return runWrapupRegeneration(sessionId, target.session, target.existing, operator);
}

/**
 * 学习者侧入口（总结页「重新生成总结」）：守卫同步判定立即应答，重活后台执行。
 * 返回 started=true 后由前端轮询 detail 收结果；守卫拒绝/冷却中返回原因供前端展示。
 */
export async function startWrapupRegeneration(
  sessionId: string,
  operator: WrapupRegenOperator = {}
): Promise<{ started: boolean; skipped?: string; error?: string }> {
  const target = await resolveRegenTarget(sessionId);
  if ('error' in target) return { started: false, error: target.error };
  if ('skipped' in target) return { started: false, skipped: target.skipped };
  void runWrapupRegeneration(sessionId, target.session, target.existing, operator)
    .then((result) => {
      if (!result.regenerated) {
        logger.warn('[wrapup-regen] 后台重生成未完成', { sessionId, error: result.error || result.skipped || 'unknown' });
      }
    })
    .catch((error) => {
      logger.warn('[wrapup-regen] 后台重生成失败', { sessionId, error: error instanceof Error ? error.message : String(error) });
    });
  return { started: true };
}
