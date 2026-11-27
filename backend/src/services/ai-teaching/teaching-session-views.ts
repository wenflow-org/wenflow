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
import { extractTaskMaterialExcerpt, looksLikeNumericTaskMaterial } from './teaching-material-shape';
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
  // 收束终点：已落 endTime 的会话按 endTime 计，未收束的才按「现在」计。
  // 这样同一个纯函数既能算收束当刻的有效时长，也能在课后概要重生成 / 结算台账补算时
  // 重算出同一个值（旧实现恒用 now，已完结会话越晚读越虚高）。
  const endedAtMs = session.endTime instanceof Date ? session.endTime.getTime() : NaN;
  const clockMs = Number.isFinite(endedAtMs) ? endedAtMs : simulatedNowOr().getTime();
  const rawDuration = Math.max(1, Math.round((clockMs - session.startTime.getTime() - pausedDurationMs) / 60000));

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
    quickReplies: [
      { text: '回顾上次的内容' },
      { text: '继续上次的进度' },
      { text: '从上次的地方接着走' },
    ],
    mode: 'self-assess',
  };
}

/**
 * 开场 chip 里引用的内容名：只在**完整名字足够短**时使用，绝不截断。
 *
 * 2026-11-25 实机事故：`同一问题下两套回答的分歧根源` 被切成「同一问题下两…」，
 * 学生点「先讲「同一问题下两…」」后，这句带省略号的残词被当成用户消息发进课堂，
 * 而屏幕上从来没有出现过这个名字。省略号不是展示小事——它一旦进了发送内容就是串台。
 * 因此：≤6 字才带名字；更长就用「这一回合」这类指向当前开场的中性动作。
 */
function shortGroundedName(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  return text && text.length <= 6 ? text : null;
}

/**
 * 开场动作选项（确定性）：本课核心概念名 + 与 mode 匹配的动词。
 *
 * 为什么要有它：LLM 开场允许省略 quickReplies，实测 39.5% 的开场落库为空数组
 * （2026-11-02 用户反馈「开场很不舒服」实锤）——学生看到一句话、页面上没有任何可点的东西。
 * 兜底 chip 必须**承载本课内容**（"拿「退款口径」看个例子"），不能用"开始吧/继续往下讲"
 * 这类放到任何一节课都成立的万能词（用户同批反馈「快选没什么意义」）。
 * 名字过长时不硬塞：改用「这一回合」指代开场里已经出现的那场对话，避免引用屏幕外的概念。
 */
export function buildOpeningActionChips(
  context: TeachingScenarioContext,
  mode: TeachingOpening['mode'] = 'example-first',
): Array<{ text: string }> {
  const core = shortGroundedName(context.taskKcs?.[0]?.name)
    ?? shortGroundedName(context.taskProfile?.coreConcept)
    ?? shortGroundedName(context.taskTitle)
    ?? shortGroundedName(context.topic);
  if (!core) {
    // predict 的立场选项必须来自这一屏的具体候选，不能凭空造「我先判断一下」这类流程词——
    // 没有候选时宁可不出选项，让 question 单独成一条行动线。
    if (mode === 'predict') return [];
    if (mode === 'self-assess') {
      return [{ text: '先讲这一回合' }, { text: '拿这一回合试一小步' }, { text: '跳过自评，直接练' }];
    }
    return [{ text: '先看这一回合' }, { text: '我先试一小步' }, { text: '先讲要点，再拿例子练' }];
  }
  if (mode === 'predict') {
    // 同上：这里没有 question/材料可抽，硬造只会得到空转项。
    return [];
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
  // 「先做/先看」要区分祈使与提问：2026-11-27 真课「第一步先做的是哪件事？」
  // 被误判成动作指令，question 与 3 个立场选项一起被丢掉，开场只剩一段独白。
  /(直接(动手|往下|开始|来|试|做)|先(动手|写|做(?!的)|试|看一遍|练一遍)|现在(就)?(开始|动手)|马上(开始|动手))/;

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
 * 开场选项的流程词/空转项（2026-11-26）：点了不会产生可判内容，只会让老师再回一句
 * 「那你猜吧」——实测 flash 会把提示词里的示例原句直接抄成选项，必须确定性拦掉。
 */
const OPENING_META_CHIP_RE =
  /^(让我?先判断|我先判断一下|我先猜一个|我先想想|我准备好了|开始吧|给个?提示再判断|给点?线索再判断)/;
/** 降阶项：允许存在，但至多一个且排在最后（它不是立场，不能和候选混排）。 */
const OPENING_HINT_CHIP_RE = /(拿不准|不确定|不会|给点?(?:提示|线索)|给个?(?:提示|线索))/;

export function isMetaOpeningChip(text: string): boolean {
  return OPENING_META_CHIP_RE.test(String(text || '').trim());
}

export function isOpeningHintChip(text: string): boolean {
  const t = String(text || '').trim();
  return OPENING_HINT_CHIP_RE.test(t) && !isMetaOpeningChip(t);
}

/**
 * 从开场文本里抽「可以直接点的候选」：引号里的本课句子/术语 + ①②③④ 编号项。
 * 只用于 predict 兜底——模型没给或给的是流程词时，用这一屏真实出现过的候选补位。
 */
export function extractOpeningCandidates(text: string): string[] {
  const raw = String(text || '');
  const found: string[] = [];
  for (const match of raw.matchAll(/[「『“"]([^」』”"]{2,30})[」』”"]/g)) found.push(match[1].trim());
  for (const match of raw.matchAll(/[①②③④⑤]\s*([\p{L}\p{N}·]{2,20})/gu)) found.push(match[1].trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of found) {
    const value = item.replace(/[。；;，,]$/, '').trim();
    if (value.length < 2 || value.length > 24 || seen.has(value)) continue;
    // 候选必须是「这一屏里真实出现的具体内容」，不要抽到流程词。
    if (isMetaOpeningChip(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= 4) break;
  }
  return out;
}

function predictStanceChips(text: string): Array<{ text: string }> {
  return extractOpeningCandidates(text).map((candidate) => ({ text: `我猜是「${candidate}」` }));
}

/**
 * 开场按钮单行纪律（2026-11-27 真课：4 个长句 + 线索被挤到第二行，视觉重心散架）。
 * 单条优先在自然停顿处收短（不截半句、不留省略号），仍过长才硬截；总数由调用方压到 3。
 */
function compactOpeningChip(text: string, max = 18): string {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  const clause = value.split(/[，,：:；;]/)[0].trim();
  if (clause.length >= 5 && clause.length <= max) return clause;
  return value.slice(0, max);
}


/**
 * 开场「一条行动线」契约的确定性兜底（2026-11-02 用户反馈「开场很不舒服」）：
 * - predict：选项必须是本题的具体立场/候选；流程词一律丢弃，抽不到候选就让 question 单独成线；
 * - 其它模式：至少 1 个可执行动作（模型没给就按本课内容补 buildOpeningActionChips）；
 * - question 里不得出现动作指向词/答不了的判定式提问，命中即丢；
 * - mode 非法时回落到 example-first。
 * 放在 generateOpening 出参口，保证开场第一屏只有一条能推进的行动线。
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
    .filter((text) => !isMetaOpeningChip(text))
    .slice(0, mode === 'predict' ? 5 : 3)
    .map((text) => ({ text }));
  // question 的可用性：动作指向词（自己许愿点不动的动作）+ 判答式/引未展示材料的提问，都丢。
  const keepQuestion = !!rawQuestion
    && !OPENING_QUESTION_ACTION_TELL.test(rawQuestion)
    && !isUnanswerableOpeningQuestion(rawQuestion, message);
  /* message 缺失时用 question 顶替，并把 question 位清空（2026-11-02 走查）：
     message 与 question 是同一屏上的两句话，任一侧为空时另一侧就是唯一的那句；
     让两者同时承载同一句，会让它在「气泡 + 面板」各出现一次——正是用户看到的「两个问题」。 */
  const messageText = message || (keepQuestion ? rawQuestion : '');
  // 2026-11-25 实机事故：模型/兜底都可能把长概念截成「同一问题下两…」；带省略号的
  // 动作一旦被点，就会作为用户消息原样发进课堂。这里整组丢弃，改用不带名字的兜底动作。
  const hasTruncatedChip = provided.some((item) => /…|\.{3}/.test(item.text));
  let replies: Array<{ text: string }>;
  if (mode === 'predict') {
    // 预测题：选项必须是**本题的立场/候选**；流程词已在上方滤掉。
    // 模型没给候选时，从这一屏文本里抽真实出现过的句子/编号项补位；
    // 连候选都抽不到 → 不出选项，让 question 单独成一条行动线（绝不硬造「我先判断一下」）。
    if (keepQuestion) {
      const stances = provided
        .filter((item) => !isOpeningHintChip(item.text))
        .map((item) => ({ text: compactOpeningChip(item.text) }));
      const hint = provided.find((item) => isOpeningHintChip(item.text));
      replies = stances.length
        ? stances
        : predictStanceChips(`${messageText}\n${rawQuestion}`).map((item) => ({ text: compactOpeningChip(item.text) }));
      // 去重 + 总数硬限 3（含「拿不准」线索）：3 个立场就不要再挂第 4 个孤儿按钮。
      const seen = new Set<string>();
      replies = replies.filter((item) => {
        const key = item.text.replace(/\s+/g, '');
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 3);
      if (replies.length && replies.length < 3) {
        replies.push({ text: compactOpeningChip((hint ?? { text: '拿不准，给点线索' }).text) });
      } else if (!replies.length && hint) {
        // 连候选都没有时不硬造立场；模型自己给了降阶入口才保留。
        replies = [{ text: compactOpeningChip(hint.text) }];
      }
    } else {
      // question 被丢弃时，立场选项失去指代（学生没被问到任何东西）→ 不出选项。
      replies = [];
    }
  } else {
    const actions = provided.length > 0 && !hasTruncatedChip ? provided : buildOpeningActionChips(context, mode);
    replies = actions
      // 没有 question 时，「自评」无从指代（学生没被问到任何东西）→ 剥掉那半句
      .map((item) => ({ text: keepQuestion ? item.text : stripDanglingSelfAssess(item.text) }));
    if (!replies.length) {
      replies = buildOpeningActionChips(context, mode)
        .map((item) => ({ text: keepQuestion ? item.text : stripDanglingSelfAssess(item.text) }));
    }
  }
  // 非 predict 模式：有动作选项时 question 让位（两处入口会让学生无从选择）；
  // predict 模式反过来——question 与立场选项是同一条行动线，允许并存。
  const questionOut = message && keepQuestion && (mode === 'predict' || replies.length === 0)
    ? rawQuestion
    : '';
  const finalReplies = (questionOut ? replies : replies.map((item) => ({ text: stripDanglingSelfAssess(item.text) })))
    .filter((item) => !isMetaOpeningChip(item.text));
  // 动作模式被流程词清空后仍有兜底：按本课内容补动作；predict 不补（选项必须来自本屏候选）。
  const safeReplies = finalReplies.length || mode === 'predict'
    ? finalReplies
    : buildOpeningActionChips(context, mode)
      .map((item) => ({ text: questionOut ? item.text : stripDanglingSelfAssess(item.text) }))
      .filter((item) => !isMetaOpeningChip(item.text));
  return {
    message: messageText,
    question: questionOut,
    quickReplies: safeReplies,
    mode,
  };
}

/**
 * 开场材料落地护栏（2026-11-12 实测「开场问题非常严重」）：提示词已明文
 * 「给定清单必须露出来——屏幕上没有的东西不许假装学生已经看到」，模型仍会把
 * taskDescription 里的对话/清单说成「这段/上面给的」而不摆本体——学生第一屏
 * 看不到任何材料，课从第一句就悬空（跑步咨询重学课：开场说「这段对话里…」，
 * 对话本体不在屏幕上）。确定性兜底：description 命中材料线索词且含 ≥2 条
 * 编号材料行（「轮N…」「1. …」）而开场 message 未含大半时，整块补挂到 message。
 */
const OPENING_MATERIAL_CUE_RE = /(下面这段|下面这\s*\d|给出以下|给出的?\s*\d+\s*(条|个|句|段|组)|完整给出|逐轮对照)/;
const OPENING_MATERIAL_LINE_RE = /^(轮\s*\d+|\d{1,2}\s*[.、）)])/;

export function extractOpeningMaterialLines(description: string): string[] {
  return String(description || '')
    .split(/(?<=[。；;？！!?])/)
    .map((line) => line.trim())
    .filter((line) => OPENING_MATERIAL_LINE_RE.test(line) && line.length >= 6);
}

export function ensureOpeningMaterialGrounding(
  opening: TeachingOpening,
  context: TeachingScenarioContext,
): TeachingOpening {
  const description = context.taskDescription || '';
  if (!OPENING_MATERIAL_CUE_RE.test(description)) return opening;
  const lines = extractOpeningMaterialLines(description);
  if (lines.length < 2) return opening;
  const message = String(opening.message || '');
  const anchorOf = (line: string) => line.slice(0, Math.min(12, line.length));
  const present = lines.filter((line) => message.includes(anchorOf(line))).length;
  if (present >= Math.ceil(lines.length * 0.6)) return opening;
  return {
    ...opening,
    message: `${message}\n\n本课材料先摆出来（后面都围绕它）：\n${lines.join('')}`,
  };
}

/**
 * 开场材料本体护栏（2026-11-24「空气读数课」）：
 * taskDescription 只是 1-2 句简介，真正的表/数据行/原文在 taskMaterialPayload。
 * 开场若只说「看材料/按示例/在片段里读数」而不摆本体，学生屏幕上没有任何可读的数，
 * 第二句就会质问「我这边还没看到具体的数」。
 *
 * 与 ensureOpeningMaterialGrounding 的分工：后者从 description 抽「轮N/1.」编号材料；
 * 本护栏从 taskMaterialPayload 抽 Markdown 表格 / 数据行 / 前 1600 字原文，二者可叠加。
 * 只在开场确实在指代材料、或材料本身就是数值表时补挂；不把长手册整本灌进开场。
 *
 * 形状判定与抽段逻辑在 teaching-material-shape（出图链也复用，避免循环 import）；
 * 这里 re-export 保持既有 import 路径。
 */
export { extractTaskMaterialExcerpt, looksLikeNumericTaskMaterial } from './teaching-material-shape';

/** 材料里的组标题行（A 组 / 第一段 / （B）…）：分段落卡与锚点判定都要跳过它。 */
function isMaterialGroupHeader(line: string): boolean {
  return /^[（(]?\s*(?:(?:第\s*[一二三四五六七八九十0-9]+)\s*[段组]|(?:[A-ZＡ-Ｚ]|[一二三四五六七八九十])\s*[)）组段])/.test(line);
}

/** 开场/贴材料时判断「这段材料是不是已经在正文里」：按内容行（跳过说明括号与组标题）取锚。 */
function materialExcerptPresent(text: string, excerpt: string): boolean {
  const compact = String(text || '').replace(/\s+/g, '');
  if (!compact) return false;
  const lines = String(excerpt || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const contentLines = lines.filter((line) =>
    !line.startsWith('（')
    && !line.startsWith('…')
    && !isMaterialGroupHeader(line));
  const anchors = (contentLines.length ? contentLines : lines)
    .map((line) => line.replace(/\s+/g, '').slice(0, 16))
    .filter((anchor) => anchor.length >= 8);
  return anchors.some((anchor) => compact.includes(anchor));
}

/**
 * 开场正文对材料的指代。2026-11-27 补「转述/小段/两段/句子/对话/语录」：
 * 真实课（苏格拉底论证课）开场写「用的是两小段…的示意转述」，一个字都没命中旧词表，
 * 护栏直接放行——学生第一屏只看到「这段材料」却看不到材料。指代形态本来就多：
 * 原文课说「原文/选段」，语文课说「这段话/例句」，逻辑课说「转述/小段」。
 */
const OPENING_TASK_MATERIAL_REF_RE = /(材料|表格|表里|(?:这|那)张表|对比表|读数|数据|样本|曲线|片段|原文|选段|清单|示例|转述|小段|两段|三段|这段|那段|段话|例句|语录|对话|台词)/;

export function ensureOpeningTaskMaterial(
  opening: TeachingOpening,
  context: TeachingScenarioContext,
  options: { deferToBoard?: boolean } = {},
): TeachingOpening {
  const material = String(context.taskMaterialPayload || '').trim();
  if (!material) return opening;
  const message = String(opening.message || '');
  const tableLike = looksLikeNumericTaskMaterial(material);
  if (!tableLike && !OPENING_TASK_MATERIAL_REF_RE.test(message)) return opening;
  const excerpt = extractTaskMaterialExcerpt(material);
  if (!excerpt) return opening;
  // 已摆出材料（取内容行前 16 字做锚）→ 不重复补挂。
  if (materialExcerptPresent(message, excerpt)) return opening;
  // 阶段协议下材料由整课板书逐段展开（2026-11-26）：开场只给表头 + 第一行做定位，
  // 不把整张表复制进第一条气泡——否则同一份材料在开场与板上各出现一次，
  // 且整表一次曝光违反分段（segmenting）。板书失败时后续回合仍可用纯文本自足兜底。
  const shown = options.deferToBoard
    ? deferMaterialForBoard(excerpt, { firstOnly: opening.mode === 'predict' && !tableLike })
    : excerpt;
  if (!shown) return opening;
  // 2026-11-27：材料不再硬拼进老师 message，改为独立引用卡（前端渲染）。
  // 硬拼会变成「老师说一段人话 + 系统贴一段文档」两张皮，且容易和正文里的
  // 「课上摆到板上」打架。卡只放材料本体，免责/来源括注压成卡片标题。
  const noteMatch = /^（([^）]{4,80})）\s*\n?/.exec(shown);
  const note = noteMatch
    ? noteMatch[1].trim()
    : (/^（([^）]{4,80})）\s*\n?/.exec(excerpt)?.[1].trim() ?? '');
  const body = (noteMatch ? shown.slice(noteMatch[0].length) : shown).trim();
  if (!body) return opening;
  return {
    ...opening,
    material: {
      title: /(示意|转述)/.test(note) ? '本课材料 · 示意转述' : '本课材料',
      text: body,
    },
  };
}

/** 取 Markdown 表头 + 第一行数据（或前 6 行原文 / 第一组），用于「材料由板书承载」时的开场定位。 */
function deferMaterialForBoard(excerpt: string, opts: { firstOnly?: boolean } = {}): string {
  const lines = excerpt.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 2) return excerpt;
  const tableLines = lines.filter((line) => /^\s*\|/.test(line));
  if (tableLines.length >= 3) {
    // 表头 + 分隔行 + 第一条数据行
    return [...tableLines.slice(0, 3), '| … | | | |（其余行课上继续展开） |'].join('\n');
  }
  // 预测题开场只摆「题面」：给出组标题 + 第一条材料（通常就是被指控/待判断的那句），
  // 不把结论句先贴出来再让学生猜（2026-11-27 真课：材料②直接印着「苏格拉底并不研究…」，
  // 下面还让他猜第一步做什么）。非预测开场仍给整组。
  if (opts.firstOnly) {
    const headerIndex = lines.findIndex((line) => isMaterialGroupHeader(line));
    const start = headerIndex >= 0 ? headerIndex : 0;
    const picked = [lines[start], lines[start + 1]].filter((line): line is string => !!line);
    if (!picked.length) return excerpt.slice(0, 400);
    const truncated = start + 2 < lines.length;
    return [...picked, truncated ? '…（其余内容课上继续展开）' : ''].filter(Boolean).join('\n');
  }
  // 文本材料（原文/示意转述/对话/清单）：只给第一组，且要给出**能读的整段**。
  // 2026-11-27 真课：旧实现固定取前 2 行，命中的是「（说明）+ A 组（带连接词）：」
  // 两行标题，一句材料都没上屏——学生被要求凭直觉判断，屏幕上却没有可判断的句子。
  const picked: string[] = [];
  let chars = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i > 1 && isMaterialGroupHeader(line)) break;
    if (picked.length >= 6 || (picked.length > 1 && chars + line.length > 400)) break;
    picked.push(line);
    chars += line.length;
  }
  if (picked.length === 0) return excerpt.slice(0, 400);
  const truncated = picked.length < lines.length;
  return [...picked, truncated ? '…（其余内容课上继续展开）' : ''].filter(Boolean).join('\n');
}

/**
 * 学生对着材料发懵时的确定性兜底（2026-11-27 苏格拉底论证课）：
 * 开场只写「用的是两小段…的示意转述」、学生回「我都不知道是什么事情啊」，
 * 老师接着给背景却仍在问抽象问题。材料其实一直在上下文里（`taskMaterialPayload`），
 * 只是模型没摆出来。这里在**最后一个问句之前**插入第一组材料的可读文本——
 * 先有可判断的句子，再有判断问题；材料已在正文里（24 字锚）则不重复插。
 */
export function ensureConfusionMaterialOnScreen(
  reply: string,
  material: string | null | undefined,
): string {
  const text = String(reply || '');
  const materialText = String(material || '').trim();
  if (!text.trim() || !materialText) return reply;
  const excerpt = deferMaterialForBoard(extractTaskMaterialExcerpt(materialText, 1200));
  if (!excerpt) return reply;
  if (materialExcerptPresent(text, excerpt)) return reply;
  const block = `先把材料摆出来（本课要拆的就是这一小段）：\n${excerpt}`;
  // 插在最后一个问句之前：材料先行，问题在后。
  const questionAt = Math.max(text.lastIndexOf('？'), text.lastIndexOf('?'));
  if (questionAt < 0) return `${text}\n\n${block}`;
  let start = questionAt;
  while (start > 0 && !/[。！？!?\n]/.test(text[start - 1])) start -= 1;
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(start).trimStart();
  return `${before}${before ? '\n\n' : ''}${block}\n\n${after}`;
}

/**
 * 开场示例口径护栏（2026-11-12 实证 st_1794451502004：任务描述明确写「豆包收到…后的一段
 * **示例**回复」，开场却改写成「这段豆包回复**你大概见过**」——把合成示例升格成学习者
 * 见过的真实经历。来源诚实的开场层漏洞：材料落地了，但定性被改了）。
 * 确定性兜底：description 带「示例/仿真/示意/仿写」标记时，开场里「你大概见过/你肯定
 * 遇到过」类假定共享经验的**陈述**（疑问句「你见过…吗」不算）改写为「（示例）」。
 */
const OPENING_SAMPLE_MARK_RE = /(示例|仿真|示意|仿写|虚构)/;
const OPENING_SHARED_EXP_RE = /你(大概|也许|多半|可能|肯定|八成)(曾经)?(见过|遇到过|碰到过)/g;

export function ensureOpeningSampleHonesty(
  opening: TeachingOpening,
  context: TeachingScenarioContext,
): TeachingOpening {
  const description = context.taskDescription || '';
  if (!OPENING_SAMPLE_MARK_RE.test(description)) return opening;
  const message = String(opening.message || '');
  if (!OPENING_SHARED_EXP_RE.test(message)) return opening;
  OPENING_SHARED_EXP_RE.lastIndex = 0;
  const rewritten = message.replace(OPENING_SHARED_EXP_RE, (claim, _adv, _ever, _verb, offset: number) => {
    // 疑问形态（「你见过…吗？」「你遇到过…没？」）是向学习者提问，不是经验断言——不动
    const window = message.slice(offset + claim.length, offset + claim.length + 12);
    if (/[吗呢没？?]/.test(window)) return claim;
    return '（示例）';
  });
  if (rewritten === message) return opening;
  return { ...opening, message: rewritten };
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
  const bandCounter = new Map<string, number>();
  for (const message of session.messages) {
    const load = Number(message.analysis?.loadIndex);
    if (Number.isFinite(load)) loadIndexes.push(load);
    const basis = message.analysis?.loadBasis;
    if (typeof basis === 'string' && basis) {
      basisCounter.set(basis, (basisCounter.get(basis) || 0) + 1);
    }
    const band = message.analysis?.loadBand;
    if (typeof band === 'string' && band) {
      bandCounter.set(band, (bandCounter.get(band) || 0) + 1);
    }
  }
  if (loadIndexes.length === 0) return;
  const avg = loadIndexes.reduce((sum, value) => sum + value, 0) / loadIndexes.length;
  const max = Math.max(...loadIndexes);
  const basisDist: Record<string, number> = {};
  for (const [key, count] of basisCounter) basisDist[key] = count;
  const bandDist: Record<string, number> = {};
  for (const [key, count] of bandCounter) bandDist[key] = count;

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
        ...(Object.keys(bandDist).length > 0 ? { bandDist } : {}),
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
 * 伴学策略（teaching-peer-reinforcement 规则的"手法"）由**代码**按认知层级选定。
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
  // 认知负荷：teaching-wrapup 的规则声明了"loadIndex 均值与峰值"，同时补齐离散负荷档位分布（peakLoadBand / loadBandDistribution）
  const loadIndexScores = analyzedMessages
    .map((message) => Number(message.analysis?.loadIndex))
    .filter((value) => Number.isFinite(value));
  const loadBandCounts = { under: 0, flow: 0, hint: 0, overload: 0, unknown: 0 };
  let loadBandTotal = 0;
  for (const message of analyzedMessages) {
    const band = message.analysis?.loadBand;
    if (band === 'under' || band === 'flow' || band === 'hint' || band === 'overload' || band === 'unknown') {
      loadBandCounts[band] += 1;
      loadBandTotal += 1;
    }
  }
  const peakLoadBand: 'overload' | 'hint' | 'flow' | 'under' | 'unknown' | null = loadBandCounts.overload > 0
    ? 'overload'
    : loadBandCounts.hint > 0
      ? 'hint'
      : loadBandCounts.flow > 0
        ? 'flow'
        : loadBandCounts.under > 0
          ? 'under'
          : loadBandCounts.unknown > 0
            ? 'unknown'
            : null;

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
    ...(loadBandTotal > 0 ? { peakLoadBand, loadBandDistribution: loadBandCounts } : {}),
    ...(rsmAttempts.length > 0 ? { rsmAttempts } : {}),
  };
}

/**
 * 检查点历史摘要（2026-09-17 起**被消费**；此前 `checkpointHistory` 只写不读，审计 §5.2 P2）。
 *
 * 只给模型"最近发生了什么、哪些没通过"，用于**换表征再确认**——不铺原始 20 条（噪声）。
 * 返回 null = 本节课还没有检查点记录（模型据此不改变默认行为）。
 */

/**
 * 学生侧 wrapup 投影（2026-11-24 脱敏复核）。
 *
 * 背景：`teaching_sessions.wrapup` 现在同时承载运营观测字段（影子双写、收束控制态、
 * 收束审计、运行时信封）。这些是**内部排障数据**，不应随学生端 `/sessions/:id/detail`
 * 与 `/tasks/:taskId/evaluation/latest` 一起下发；学生页面实际只消费 summary / evaluation
 * 的分数 / stateUpdate / progress。
 *
 * 保留：summary、progress、evidence、stateUpdate（完课卡长期指标）、duration、
 *       sources、evaluation 中的 sessionLss/sessionKtl/sessionLf/duration/messageCount。
 * 移除：shadowDeterministic（影子公式对比）、controlStateSnapshot（控制面）、
 *       runtimeEnvelope / finalizationAction / closureAudit（内部审计）、learner（内部节奏建议）、
 *       evaluation.metricTiers / metricEvidence / metricMetadata / reasoning / confidence（判定依据）。
 */
const STUDENT_WRAPUP_INTERNAL_KEYS = [
  'shadowDeterministic',
  'controlStateSnapshot',
  'runtimeEnvelope',
  'finalizationAction',
  'closureAudit',
  'learner',
] as const;

const STUDENT_EVALUATION_INTERNAL_KEYS = [
  'metricTiers',
  'metricEvidence',
  'metricMetadata',
  'reasoning',
  'confidence',
] as const;

export function projectWrapupForStudent(wrapup: any): any {
  if (!wrapup || typeof wrapup !== 'object' || Array.isArray(wrapup)) return wrapup;
  const projected: Record<string, any> = { ...wrapup };
  for (const key of STUDENT_WRAPUP_INTERNAL_KEYS) delete projected[key];
  if (projected.evaluation && typeof projected.evaluation === 'object' && !Array.isArray(projected.evaluation)) {
    const evaluation = { ...projected.evaluation };
    for (const key of STUDENT_EVALUATION_INTERNAL_KEYS) delete evaluation[key];
    projected.evaluation = evaluation;
  }
  return projected;
}
