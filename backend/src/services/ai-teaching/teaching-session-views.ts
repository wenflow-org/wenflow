/**
 * 回合分析投影（路由出参用）。软/硬困惑口径分开给（2026-11-01）：
 * `confusionPoints` 是全量软通道（遥测/复盘用）；`confusionEvidenced` 是有原话证据的硬口径，
 * 学生可见的「发现卡点」chip 只认后者。放这里而不是留在路由里，是因为 ai-teaching 路由已超过
 * 分层棘轮的行数上限（只许缩短）。
 */
export function buildTurnAnalysisView(analysis: Record<string, any>) {
  return {
    cognitiveLevel: analysis.cognitiveLevel ?? null,
    levelScore: analysis.levelScore ?? null,
    understanding: analysis.understanding ?? null,
    confusionPoints: analysis.confusionPoints ?? [],
    confusionEvidenced: countEvidencedConfusions(analysis) > 0,
    engagement: analysis.engagement ?? null,
    emotionalState: analysis.emotionalState ?? null,
  };
}

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
import { detectAwaitingLearnerWork } from '../../config/pedagogy.config';
import { countEvidencedConfusions, resolveUnderstandingReading } from './checkpoint-shared';
import { simulatedNowOr } from '../virtual-lab/simulation-clock-context';
import { cloneKnowledgePoints } from './teaching-knowledge-state';
import { parseSessionArtifacts } from './checkpoint-shared';
import type { TeachingOpening } from './AITeachingCoordinator';
import type { TeachingSessionRecord } from './TeachingSessionRepository';
import type { TeachingScenarioContext } from './TeachingContextBuilder';

/**
 * 未结算暂停段的时长（pausedAt → 暂停段实际结束的时刻）。
 *
 * 判暂停只认 artifacts.pausedAt：pausedAt 非空 = 有一段暂停还没结算
 * （resumeSession / 复用开课 resume 结算时把它清零，并把时长并进 pausedDurationMs），
 * **与 session.status 无关**。原因见 computeEffectiveDurationMinutes 内 #172-4 注释。
 *
 * 终点（取「不超过当前时刻」的最早信号，全部是 artifacts，不碰 status）：
 *  1. endTime 已落库（会话闭合） → 收束时刻。收束受理时 endTime 仍为 null，此刻「当前」即收束时刻。
 *  2. pausedAt 之后还有消息 → 暂停早已结束而账没结（典型：paused 超 24h 被 timeoutIfPaused 降级，
 *     之后由教学回合直接恢复——只把 status 改回 active，不清 pausedAt）。这种悬挂段若按 now 扣，
 *     会随时钟越扣越多、把真实会话压成 1 分钟，故其结束点取首条「暂停后消息」时间戳。
 *  3. 以上都不存在 → 当前时刻（收束路径上即收束时刻）。
 * 都不存在且 endTime 也在未来等异常情形：Math.max(0, …) 兜底为 0。
 */
function resolveOpenPauseDurationMs(
  session: TeachingSessionRecord,
  sessionArtifacts: Record<string, any>,
): number {
  if (typeof sessionArtifacts.pausedAt !== 'string') return 0;
  const pausedAtMs = new Date(sessionArtifacts.pausedAt).getTime();
  if (!Number.isFinite(pausedAtMs)) return 0;

  const messages = Array.isArray(session.messages) ? session.messages : [];
  const resumedAfterPauseMs = messages
    .map((m) => (m?.timestamp ? new Date(m.timestamp).getTime() : NaN))
    .filter((t) => Number.isFinite(t) && t > pausedAtMs)
    .sort((a, b) => a - b)[0];
  const endedAtMs = session.endTime instanceof Date ? session.endTime.getTime() : NaN;

  const endMs = Number.isFinite(resumedAfterPauseMs)
    ? (Number.isFinite(endedAtMs) ? Math.min(resumedAfterPauseMs, endedAtMs) : resumedAfterPauseMs)
    : (Number.isFinite(endedAtMs) ? endedAtMs : simulatedNowOr().getTime());

  return Math.max(0, endMs - pausedAtMs);
}

export function computeEffectiveDurationMinutes(session: TeachingSessionRecord) {
  const sessionArtifacts = parseSessionArtifacts(session.teachingState);
  let pausedDurationMs = Number(sessionArtifacts.pausedDurationMs || 0);
  if (!Number.isFinite(pausedDurationMs) || pausedDurationMs < 0) pausedDurationMs = 0;

  // 暂停中直接收束：当前暂停段（pausedAt → 暂停实际结束的时刻）一并计入暂停。
  // #172-4：判暂停只认 artifacts.pausedAt，不再依赖 session.status——收束受理（claimFinalization）
  // 在受理时就把状态置 finalizing，原 `status === 'paused'` 分支在收束路径恒不成立，导致
  // pausedAt → 收束这段时间整段没被扣，最多污染约 60 分钟（wrapup.duration / durationMinutes）。
  pausedDurationMs += resolveOpenPauseDurationMs(session, sessionArtifacts);
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
  const core = clipOpeningName(session.topic);
  return {
    message: `已为你恢复这节关于 **${session.topic}** 的课程进度，我们从你上次离开的地方继续。`,
    question: '准备好了的话，我们继续刚才的内容。',
    quickReplies: [
      { text: `回顾上次的「${core}」` },
      { text: `继续「${core}」的进度` },
      { text: '从上次的地方接着走' },
    ],
    mode: 'self-assess',
  };
}

/** 开场 chip 里引用的内容名：截短，保证整条 chip 不超 14 字 */
function clipOpeningName(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '本课内容';
  return text.length > 6 ? `${text.slice(0, 6)}…` : text;
}

/**
 * 开场动作选项（确定性）：本课核心概念名 + 与 mode 匹配的动词。
 *
 * 为什么要有它：LLM 开场允许省略 quickReplies，实测 39.5% 的开场落库为空数组
 * （2026-11-02 用户反馈「开场很不舒服」实锤）——学生看到一句话、页面上没有任何可点的东西。
 * 兜底 chip 必须**承载本课内容**（"拿「退款口径」看个例子"），不能用"开始吧/继续往下讲"
 * 这类放到任何一节课都成立的万能词（用户同批反馈「快选没什么意义」）。
 */
export function buildOpeningActionChips(
  context: TeachingScenarioContext,
  mode: TeachingOpening['mode'] = 'example-first',
): Array<{ text: string }> {
  const core = clipOpeningName(context.taskProfile?.coreConcept || context.topic || context.taskTitle);
  if (mode === 'predict') {
    return [{ text: `让我先判断「${core}」` }, { text: '给点提示再判断' }, { text: '我先猜一个，你验证' }];
  }
  if (mode === 'self-assess') {
    return [{ text: `先讲「${core}」` }, { text: `拿「${core}」试一小步` }, { text: '跳过自评，直接练' }];
  }
  return [{ text: `拿「${core}」看个例子` }, { text: '我先试一小步' }, { text: '先讲要点，再拿例子练' }];
}

/**
 * question 里的动作指向词：question 不配控件，写出动作就是许一个点不动的承诺
 * （2026-11-02 用户反馈实锤：开场写着"也可以直接往下走"，页面上没有任何可点控件）。
 * 命中即确定性丢弃整句——不做片段手术，避免留下半个残句。
 */
const OPENING_QUESTION_ACTION_TELL =
  /(直接(动手|往下|开始|来|试|做)|先(动手|写|做|试|看一遍|练一遍)|现在(就)?(开始|动手)|马上(开始|动手))/;

/**
 * 开场 question 的第二类「答不了」形态：**判答式提问**。
 *
 * 2026-11-02 实测：开场白写着「这节课拿六个考试句子，把时间标志词和动作性质变成你排除选项的依据」，
 * 下一行却问「「since 2019」和「last Friday」在你眼里是同一类信号吗？」，而页面上只有三个动作
 * chip（先讲「时间标志词」/拿第1句试标信号/跳过自评，直接练六句）——学生既答不了这句、也看不出
 * 这两个表达式从哪来（它们在本屏从未出现，是任务里第 3、5 句的片段）。
 *
 * 开场 question 没有作答控件（想答只能自己打字），它的定位是「你可以想想」的一行引导；
 * 写成需要判定/选择的题，就等于把一道没有答题卡的题摆在动作选项上方。
 */
const OPENING_QUESTION_QUIZ_TELL =
  /(是不是|是否是|同一类|同一个|一样吗|一样不|对吗|对不对|算不算|属于哪|哪一(?:个|种|类)|哪个更)/;

/** question 里带引号的片段：只有含 ASCII 字母/数字才算「引了材料」（「退款口径」这类中文概念名不算） */
const QUOTED_SPAN_RE = /[「『“"]([^」』”"]{2,60})[」』”"]/g;
const MATERIAL_LIKE_RE = /[A-Za-z0-9]/;

/**
 * 开场 question 是否该丢（确定性）：
 * ① 判答式提问；② 引了本屏还没出现过的材料（带引号的拉丁/数字片段）。
 * 宁可不出题，也不留一道学生答不了、又和开场白对不上的问题。
 */
export function isUnanswerableOpeningQuestion(question: string, message: string): boolean {
  const q = String(question || '').trim();
  if (!q) return false;
  if (OPENING_QUESTION_QUIZ_TELL.test(q)) return true;
  const seen = String(message || '');
  for (const match of q.matchAll(QUOTED_SPAN_RE)) {
    const quoted = match[1];
    if (!MATERIAL_LIKE_RE.test(quoted)) continue;
    if (!seen.includes(quoted)) return true;
  }
  return false;
}

/**
 * question 被丢掉后，「自评」这个词就失去了指代对象（「跳过自评，直接练六句」里的自评从没出现过）。
 * 只在没有 question 时剥掉这半句，chip 其余内容（本课内容 + 动作）保留。
 */
function stripDanglingSelfAssess(text: string): string {
  const next = String(text || '')
    .replace(/^(?:跳过|略过|先不|不做)自评[，,、]?\s*/, '')
    .replace(/(?:跳过|略过)自评[，,、]?\s*/g, '')
    .trim();
  return next.length >= 2 ? next : text;
}


/**
 * 开场「一条行动线」契约的确定性兜底（2026-11-02 用户反馈「开场很不舒服」）：
 * - quickReplies 至少 1 个：模型没给就按本课内容补（buildOpeningActionChips）；
 * - question 里不得出现动作指向词，命中即丢；
 * - mode 非法时回落到 example-first。
 * 放在 generateOpening 出参口，保证任何调用方拿到的开场第一屏都有可点动作。
 */
export function ensureOpeningActionLine(
  opening: Partial<TeachingOpening> | null | undefined,
  context: TeachingScenarioContext,
): TeachingOpening {
  const message = typeof opening?.message === 'string' ? opening.message.trim() : '';
  const rawQuestion = typeof opening?.question === 'string' ? opening.question.trim() : '';
  const mode: TeachingOpening['mode'] =
    opening?.mode === 'predict' || opening?.mode === 'self-assess' || opening?.mode === 'example-first'
      ? opening.mode
      : 'example-first';
  const provided = (Array.isArray(opening?.quickReplies) ? opening!.quickReplies : [])
    .map((item) => (typeof item === 'string' ? item : item?.text))
    .map((text) => String(text ?? '').trim())
    .filter((text) => text.length > 0)
    .slice(0, 3)
    .map((text) => ({ text }));
  // question 的可用性：动作指向词（自己许愿点不动的动作）+ 判答式/引未展示材料的提问，都丢。
  const keepQuestion = !!rawQuestion
    && !OPENING_QUESTION_ACTION_TELL.test(rawQuestion)
    && !isUnanswerableOpeningQuestion(rawQuestion, message);
  /* message 缺失时用 question 顶替，并把 question 位清空（2026-11-02 走查）：
     message 与 question 是同一屏上的两句话，任一侧为空时另一侧就是唯一的那句；
     让两者同时承载同一句，会让它在「气泡 + 面板」各出现一次——正是用户看到的「两个问题」。 */
  const messageText = message || (keepQuestion ? rawQuestion : '');
  const replies = (provided.length > 0 ? provided : buildOpeningActionChips(context, mode))
    // 没有 question 时，「自评」无从指代（学生没被问到任何东西）→ 剥掉那半句
    .map((item) => ({ text: keepQuestion ? item.text : stripDanglingSelfAssess(item.text) }));
  return {
    message: messageText,
    question: message && keepQuestion ? rawQuestion : '',
    quickReplies: replies,
    mode,
  };
}

/**
 * 开场正文拼装：`question` 是可选字段（与 quickReplies 互斥，见 TeachingOpening 契约；
 * 确定性兜底 `buildDeterministicOpening` 就只给 quickReplies），裸 `${message}\n\n${question}`
 * 会把字面量 "undefined" 写进落库消息 —— 那是学习者直接看到的第一句话
 * （2026-10-11 走查：全库 108/827 会话命中）。只拼有值的部分。
 */
export function composeWelcome(opening: TeachingOpening): string {
  return [opening.message, opening.question]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n\n');
}

/**
 * 确定性开场兜底：generateOpening（LLM）失败/无有效结构时使用，
 * 保证开课链路在模型不可用时仍可用（此前直接抛错导致开课整体不可用）。
 * 结构对齐 TeachingOpening 契约（message/question/quickReplies/mode）。
 */
export function buildDeterministicOpening(context: TeachingScenarioContext): TeachingOpening {
  // 2026-11-08 p-π案例外评：任务标题（最长 29 字）嵌在句子正中读起来不像人话
  // （「我们先从 绘出含p-π与π-π判断节点的共轭类型一分钟判别流程图初稿 开始这节课…」）。
  // 标题独立成行放在目标位，正文用自然的课堂开场话术；节奏承诺（先讲要点再练）与
  // 快选项动作对齐——学生点「先讲要点」时教师必须兑现（见 teaching-turn 节奏请求规则）。
  const goalLine = context.topic || context.taskTitle || '把本节的关键点讲清楚';
  return {
    message: `开始这节课。目标只有一句话：\n**${goalLine}**\n我先讲要点，再拿例子练；卡住随时打断我。`,
    // 动作选项必须带本课内容（2026-11-02 用户反馈「快选没什么意义」）：此前写死的
    // "准备好了，开始 / 先讲讲目标 / 换种方式讲解" 放哪节课都成立，学生看不出点下去会得到什么。
    quickReplies: buildOpeningActionChips(context, 'example-first'),
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
 * 伴学策略枚举（P1-14 修复③新增 'encourage'：老师本轮在等学生作答时的鼓励式降级，不给解题线索）。
 */
export type PeerStrategy = 'analogy' | 'counterexample' | 'debate' | 'encourage';

/**
 * 伴学历史收集（P2-11 修复，2026-10-07，纯函数供单测）。
 *
 * 审计实证：引擎主路径 peerInput 无 peerHistory —— 4879 条伴学调用中 userPayload 含
 * 【此前伴学对话】0 条，规则 11「连续 3 问无进展即收手」的 3 问预算在主路径永不可达。
 * 取法对齐聊天路径（teaching-session-ops 的 processPeerMessage 从 peer 标记消息恢复 peerHistory），
 * 并补上引擎专有形态：
 * 引擎触发的伴学插话内嵌在老师消息的 peerMessage 旁挂字段里（见 engine 的 assistantMessage 构造）——
 * 按"伴学伙伴"单边恢复（老师原文不进伴学历史，否则会被当成伴学说过的话）。
 */
export function collectPeerHistory(
  messages: Array<{ role?: unknown; content?: unknown; peer?: unknown; peerMessage?: unknown }>
): Array<{ role: string; content: string }> {
  const history: Array<{ role: string; content: string }> = [];
  for (const item of messages || []) {
    if (!item) continue;
    if (item.peer === true) {
      history.push({ role: String(item.role), content: String(item.content || '') });
      continue;
    }
    if (item.role === 'assistant' && typeof item.peerMessage === 'string' && item.peerMessage.trim()) {
      history.push({ role: 'assistant', content: item.peerMessage });
    }
  }
  return history;
}

/**
 * 伴学策略（peer-reinforcement 规则的"手法"）由**代码**按认知层级选定。
 *
 * 断链修复（审计 §3.19 P0②）：此前两处调用都硬编码 `strategy: 'feynman'`，
 * 使 skill 规则 38「understand→类比 / apply→反例边界 / analyze+→辩论费曼」永不触发。
 * 分工与全仓一致：代码给档位/枚举，prompt 负责"怎么说"。
 *
 * P1-14 修复③（2026-10-07）：加「独立作业进行中不得给解题钥匙」代码门——
 * 老师本轮在布置独立作业/等学生作答时（判据见 config/pedagogy.config.ts
 * detectAwaitingLearnerWork），策略一律降级为 'encourage'（纯鼓励式），
 * 不再按 cognitiveLevel 派 counterexample/debate（那正是生产实证里被递出去的解题钥匙：
 * 学生独立证明题上伴学输出「AD⊥BC→直角→与全等判定的关系」+去条件追问）。
 */
export function pickPeerStrategy(
  cognitiveLevel: unknown,
  options?: { tutorLatestReply?: string | null },
): PeerStrategy {
  // 独立作业进行中：不给解题钥匙——类比是"搭桥"、反例是"边界提示"、辩论是"高阶追问"，
  // 三者都在替学生思考；只有鼓励式不触碰解法。
  if (detectAwaitingLearnerWork(options?.tutorLatestReply).awaiting) return 'encourage';
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
    .map((message) => resolveUnderstandingReading(message.analysis?.understanding))
    .filter((value): value is number => value !== null);
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
