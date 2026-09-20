/**
 * 教学会话视图与证据纯函数域（架构审计 §5 行动 #2：AITeachingCoordinator 按领域拆分）
 *
 * 职责：有效时长计算（终态取 duration，活跃按流逝分钟）、开场恢复/确定性兜底、
 * 收尾 wrapup 兜底（buildEndWrapupFallback）、会话负载指标（commitSessionLoadMetric）、
 * 同伴策略选择（pickPeerStrategy）与会话证据汇总（computeSessionEvidence）。
 * 自 AITeachingCoordinator 头部迁出，行为不变；pickPeerStrategy/computeSessionEvidence
 * 自 coordinator re-export 维持既有 import 路径。
 */
import prisma from '../../config/database';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { cloneKnowledgePoints } from './teaching-knowledge-state';
import { parseSessionArtifacts } from './checkpoint-shared';
import type { TeachingOpening } from './AITeachingCoordinator';
import type { TeachingSessionRecord } from './TeachingSessionRepository';
import type { TeachingScenarioContext } from './TeachingContextBuilder';

export function computeEffectiveDurationMinutes(session: TeachingSessionRecord) {
  const sessionArtifacts = parseSessionArtifacts(session.teachingState);
  let pausedDurationMs = Number(sessionArtifacts.pausedDurationMs || 0);
  if (!Number.isFinite(pausedDurationMs) || pausedDurationMs < 0) pausedDurationMs = 0;

  // 暂停中直接收束：当前暂停段（pausedAt → now）一并计入暂停，避免把切走时间算入
  if (session.status === 'paused' && typeof sessionArtifacts.pausedAt === 'string') {
    const pausedAtMs = new Date(sessionArtifacts.pausedAt).getTime();
    if (Number.isFinite(pausedAtMs)) {
      pausedDurationMs += Math.max(0, Date.now() - pausedAtMs);
    }
  }

  const rawDuration = Math.max(1, Math.round((simulatedNowOr().getTime() - session.startTime.getTime() - pausedDurationMs) / 60000));

  // idle 封顶：按消息时间戳间隔估算活跃时长（间隔 > 30 分钟视为暂停，与 timeout-fallback 规则一致），
  // 防止合盖睡眠/进程被杀等无 pagehide 场景把 idle 时间算入学习时长
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const times = messages
    .map((m) => (m.timestamp ? new Date(m.timestamp).getTime() : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length > 0) {
    let activeMinutes = 0;
    for (let i = 1; i < times.length; i++) {
      activeMinutes += Math.min((times[i] - times[i - 1]) / 60000, 30);
    }
    // 首条消息前引导段 + 最后活动后的收尾窗各按最多 30 分钟计
    const capped = Math.round(activeMinutes + 60);
    return Math.max(1, Math.min(rawDuration, capped));
  }

  return rawDuration;
}

export function buildRecoveredOpening(session: TeachingSessionRecord): TeachingOpening {
  return {
    message: `已为你恢复这节关于 **${session.topic}** 的课程进度，我们从你上次离开的地方继续。`,
    question: '准备好了的话，我们继续刚才的内容。',
    quickReplies: [{ text: '继续上次进度' }, { text: '先回顾一下' }, { text: '从当前焦点继续' }],
    mode: 'self-assess',
  };
}

/**
 * 确定性开场兜底：generateOpening（LLM）失败/无有效结构时使用，
 * 保证开课链路在模型不可用时仍可用（此前直接抛错导致开课整体不可用）。
 * 结构对齐 TeachingOpening 契约（message/question/quickReplies/mode）。
 */
export function buildDeterministicOpening(context: TeachingScenarioContext): TeachingOpening {
  return {
    message: `我们先从 **${context.topic || context.taskTitle}** 开始这节课。目标是把关键知识点讲清楚，并在过程中检查你的掌握情况。`,
    question: '准备好了的话，我们直接开始。',
    quickReplies: [{ text: '准备好了，开始' }, { text: '先讲讲目标' }, { text: '换种方式讲解' }],
    mode: 'example-first',
  };
}

/**
 * M1 兜底：正式课后产出（executeSkill）抛错 / 返回 success:false 时构造的
 * summary-only wrapup（不调 LLM），结构对齐 applyTimeoutWrapupFallback，
 * 保证 endSession 收束流程继续，不落入 finalization_failed。
 */
export function buildEndWrapupFallback(session: TeachingSessionRecord, durationMinutes: number): {
  result: any;
  artifact: any;
} {
  const knowledgePoints = cloneKnowledgePoints(session.knowledgeState);
  const mastered = knowledgePoints.filter((p) => p.status === 'mastered').map((p) => p.name);
  const learning = knowledgePoints.filter((p) => p.status === 'learning').map((p) => p.name);
  const summary = {
    topicSummary: '本次学习记录生成遇到问题，为你保留了基础总结。',
    knowledgeSummary: mastered.length > 0 ? `已掌握：${mastered.join('、')}。` : '暂未确认掌握的知识点。',
    practiceAdvice: '重新完成一次完整的学习后，这里会给出完整建议。',
    learningEvaluation: '未生成学习评价。',
    knowledgeItems: knowledgePoints.map((p) => ({
      name: p.name,
      status: p.status,
      progress: p.progress,
      evidence: p.status === 'mastered' ? '会话中确认掌握' : '会话中未完成确认',
    })),
    keyTakeaways: [] as string[],
    actionPlan: [] as string[],
    evaluationHighlights: { strengths: [] as string[], improvements: [] as string[] },
    metricInterpretation: {
      session: '未生成本节课堂表现。',
      longTerm: '未生成长期状态评估。',
    },
    summaryVersion: 'v2',
  };
  const progress = {
    newlyMastered: mastered,
    movedToReview: [] as string[],
    stillLearning: learning,
    unchangedMastered: [] as string[],
  };
  const evidence = {
    turnCount: Array.isArray(session.messages) ? session.messages.length : 0,
    avgUnderstanding: null,
    avgEngagement: null,
    dominantCognitiveLevel: null,
    lastCognitiveLevel: null,
    topConfusionPoints: [] as string[],
    emotionalSignals: { positive: 0, neutral: 0, frustrated: 0, confused: 0 },
    completionCandidateSeen: false,
  };
  return {
    result: {
      summary,
      evaluation: null,
      summarySource: 'fallback' as const,
      evaluationSource: 'failed' as const,
      runtimeEnvelope: null,
    },
    artifact: {
      status: 'summary-only' as const,
      sources: { summary: 'end-fallback' as const, evaluation: 'failed' as const },
      summary,
      evaluation: null,
      progress,
      evidence,
      duration: durationMinutes,
    },
  };
}

/**
 * 开场交互块生成的超时（C7 修复，2026-09-15）。
 * 实测 148 次**成功**调用的时延：p50=3.9s / p90=8.2s / **p95=11.2s / max=14.1s**；
 * 而原 15s 恰好切在 p95~max 之间 → 慢的合法调用被 abort（59 次失败全部停在 **15.0–15.8s**，`CALLER_ABORTED`）。
 * 抬到 30s（>2× 实测 max）并支持 env 覆盖。开场每节课只生成一次，最坏只多等一次；
 * 真失败仍有确定性开场兜底（`buildDeterministicOpening`）。
 */
export const OPENING_GENERATION_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.OPENING_GENERATION_TIMEOUT_MS) || 30_000,
);
/** 收束兜底：回合数达到该值且目标集均分达标、无 pending 时放行，保证课堂不会「永不收敛」 */
export const COMPLETION_TURNS_BACKSTOP = 8;

/**
 * session_load 聚合（loadIndex 聚合消费）：从会话消息的 analysis.loadIndex 聚合
 * 均值/峰值/loadBasis 分布，以 metricType='session_load' 幂等写入 learning_metrics
 * （sourceKey=session-load:{sessionId}）。无 loadIndex 证据时跳过。
 */
export async function commitSessionLoadMetric(session: TeachingSessionRecord): Promise<void> {
  const loadIndexes: number[] = [];
  const basisCounter = new Map<string, number>();
  for (const message of session.messages) {
    const load = Number(message.analysis?.loadIndex);
    if (Number.isFinite(load)) loadIndexes.push(load);
    const basis = message.analysis?.loadBasis;
    if (typeof basis === 'string' && basis) {
      basisCounter.set(basis, (basisCounter.get(basis) || 0) + 1);
    }
  }
  if (loadIndexes.length === 0) return;
  const avg = loadIndexes.reduce((sum, value) => sum + value, 0) / loadIndexes.length;
  const max = Math.max(...loadIndexes);
  const basisDist: Record<string, number> = {};
  for (const [key, count] of basisCounter) basisDist[key] = count;

  await prisma.learning_metrics.upsert({
    where: {
      sourceKey: `session-load:${session.id}`,
    },
    update: {},
    create: {
      id: `sl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      sourceKey: `session-load:${session.id}`,
      userId: session.userId,
      pathId: session.learningPathId || null,
      taskId: session.taskId,
      metricType: 'session_load',
      value: Number(avg.toFixed(3)),
      metadata: JSON.stringify({
        max: Number(max.toFixed(3)),
        basisDist,
        perTurnCount: loadIndexes.length,
        scale: '0-1',
      }),
    },
  });
}

/**
 * 伴学策略（peer-reinforcement 规则的"手法"）由**代码**按认知层级选定。
 *
 * 断链修复（审计 §3.19 P0②）：此前两处调用都硬编码 `strategy: 'feynman'`，
 * 使 skill 规则 38「understand→类比 / apply→反例边界 / analyze+→辩论费曼」永不触发。
 * 分工与全仓一致：代码给档位/枚举，prompt 负责"怎么说"。
 */
export function pickPeerStrategy(
  cognitiveLevel: unknown,
): 'analogy' | 'counterexample' | 'debate' {
  const level = String(cognitiveLevel || '').trim().toLowerCase();
  if (level === 'analyze' || level === 'evaluate' || level === 'create') return 'debate';
  if (level === 'apply') return 'counterexample';
  return 'analogy'; // remember / understand / 未知：先用类比搭桥
}

/** 导出以便回归测试（§3.19 P0③：wrapup 声明了 loadIndex 均值/峰值，必须真的给） */
export function computeSessionEvidence(session: TeachingSessionRecord) {  // 排除检查点合成消息（非真实学生话语），避免污染理解/参与度统计
  const analyzedMessages = session.messages.filter((message) => !!message.analysis && !message.checkpoint);
  const avg = (values: number[]) => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const understandingScores = analyzedMessages
    .map((message) => Number(message.analysis?.understanding))
    .filter((value) => Number.isFinite(value));
  const engagementScores = analyzedMessages
    .map((message) => Number(message.analysis?.engagement))
    .filter((value) => Number.isFinite(value));
  // 认知负荷：session-wrapup 的规则声明了"loadIndex 均值与峰值"，但此前从未提供（审计 §3.19 P0③）
  const loadIndexScores = analyzedMessages
    .map((message) => Number(message.analysis?.loadIndex))
    .filter((value) => Number.isFinite(value));

  const confusionCounter = new Map<string, number>();
  const cognitiveCounter = new Map<string, number>();
  const emotionalSignals = {
    positive: 0,
    neutral: 0,
    frustrated: 0,
    confused: 0,
  };

  for (const message of analyzedMessages) {
    const confusionPoints = Array.isArray(message.analysis?.confusionPoints)
      ? message.analysis?.confusionPoints
      : [];
    for (const point of confusionPoints) {
      if (!point || typeof point !== 'string') continue;
      confusionCounter.set(point, (confusionCounter.get(point) || 0) + 1);
    }

    const level = typeof message.analysis?.cognitiveLevel === 'string'
      ? message.analysis.cognitiveLevel
      : null;
    if (level) {
      cognitiveCounter.set(level, (cognitiveCounter.get(level) || 0) + 1);
    }

    const emotion = typeof message.analysis?.emotionalState === 'string'
      ? message.analysis.emotionalState
      : null;
    if (emotion === 'positive' || emotion === 'neutral' || emotion === 'frustrated' || emotion === 'confused') {
      emotionalSignals[emotion] += 1;
    }
  }

  const dominantCognitiveLevel = Array.from(cognitiveCounter.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const lastCognitiveLevel = [...analyzedMessages].reverse().find((message) => !!message.analysis?.cognitiveLevel)?.analysis?.cognitiveLevel || null;
  const topConfusionPoints = Array.from(confusionCounter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label]) => label);
  const completionCandidateSeen = !!session.messages.find((message) => message.analysis?.completionCandidate === true)
    || !!(session.teachingState as any)?.completionCandidate;

  // 解法尝试台账（2026-09-17 起被消费；此前 teaching-turn 每轮产出 rsmAttempts 却没人读，审计 §5.2 P2 尾巴）。
  // 只取最近 5 条，交给 wrapup 做"方法层面"的整合（哪种方法有效、为什么）。
  const rsmAttempts = analyzedMessages
    .flatMap((message) => Array.isArray(message.analysis?.rsmAttempts) ? message.analysis!.rsmAttempts : [])
    .filter((attempt: any) => attempt && typeof attempt.method === 'string' && attempt.method.trim())
    .slice(-5)
    .map((attempt: any) => ({
      method: String(attempt.method).trim().slice(0, 200),
      outcome: typeof attempt.outcome === 'string' ? attempt.outcome.trim().slice(0, 200) : '',
      evidence: typeof attempt.evidence === 'string' ? attempt.evidence.trim().slice(0, 200) : '',
    }));

  return {
    turnCount: session.messages.filter((message) => message.role === 'user').length,
    avgUnderstanding: avg(understandingScores),
    avgEngagement: avg(engagementScores),
    dominantCognitiveLevel,
    lastCognitiveLevel,
    topConfusionPoints,
    emotionalSignals,
    completionCandidateSeen,
    avgLoadIndex: avg(loadIndexScores) === null ? null : Math.round((avg(loadIndexScores) as number) * 1000) / 1000,
    maxLoadIndex: loadIndexScores.length > 0 ? Math.round(Math.max(...loadIndexScores) * 1000) / 1000 : null,
    ...(rsmAttempts.length > 0 ? { rsmAttempts } : {}),
  };
}

/**
 * 检查点历史摘要（2026-09-17 起**被消费**；此前 `checkpointHistory` 只写不读，审计 §5.2 P2）。
 *
 * 只给模型"最近发生了什么、哪些没通过"，用于**换表征再确认**——不铺原始 20 条（噪声）。
 * 返回 null = 本节课还没有检查点记录（模型据此不改变默认行为）。
 */
