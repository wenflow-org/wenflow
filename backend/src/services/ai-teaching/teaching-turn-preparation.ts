/* eslint-disable @typescript-eslint/no-explicit-any -- 边界解析 LLM/JSON 动态载荷，形状由上游契约与运行时校验兜底 */
/**
 * 教学回合的独立准备/收尾助手（2026-11-19 从 teaching-turn-engine 拆出，压到分层硬顶以内）。
 * 只放不依赖回合内可变状态的纯函数与小助手；processStudentMessage 主回路仍留在引擎。
 */
import { logger } from '../../utils/logger';
import { executeSkill, executeSkillWithResult, auxSkillDefinitionMap } from '../../skills';
import { normalizeForKeywordMatch } from './checkpoint-shared';
import { deriveTeachingRuntimeSignals, withTimeoutSignal } from './teaching-classroom-flow';
import { buildDeterministicOpening, ensureOpeningActionLine, ensureOpeningMaterialGrounding, ensureOpeningSampleHonesty, OPENING_GENERATION_TIMEOUT_MS } from './teaching-session-views';
import { figureKindCap } from './teaching-visual.service';
import { teachingSessionRepository } from './TeachingSessionRepository';
import { AI_TEACHING_AGENT_ID, appendTimestamp } from './teaching-turn-shared';
import { recordDegradation } from '../../skills/degradation-telemetry';
import type { TeachingScenarioContext } from './TeachingContextBuilder';
import type { TeachingOpening, ProcessStudentMessageOptions } from './AITeachingCoordinator';
import type { TeachingSessionMessage } from './TeachingSessionRepository';
import type { LessonReport } from './lesson-contract';
import { parseExitTicketSubmission, type ExitTicket, type LessonContract, type LessonEvidence } from './lesson-contract';
import { judgeCheckpointAnswer } from './teaching-checkpoint';

/**
 * 检查点题面只存在 pendingCheckpoint 里，教师回复正文不打印题面时，学员可见历史会出现
 * "回答了一道从未出现过的题"。把题面补进本轮可见回复（已包含则原样返回）。
 */
export function ensureCheckpointQuestionVisible(reply: string, question: string): string {
  const trimmedQuestion = String(question || '').trim();
  if (!trimmedQuestion) return reply;
  const normalizedReply = normalizeForKeywordMatch(reply);
  const normalizedQuestion = normalizeForKeywordMatch(trimmedQuestion);
  if (normalizedQuestion && normalizedReply.includes(normalizedQuestion)) return reply;
  // 老师已经用自己的措辞问过同一道题时不要再贴一遍——实测会出现
  // "…该到哪儿？\n\n…应该是哪一段？" 这种同题复读。用字二元组近似判重。
  if (isNearDuplicateQuestion(reply, trimmedQuestion)) return reply;
  const trimmedReply = String(reply || '').trim();
  return trimmedReply ? `${trimmedReply}\n\n${trimmedQuestion}` : trimmedQuestion;
}

function charBigrams(text: string): Set<string> {
  const normalized = String(text || '').replace(/\s+/g, '');
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i += 1) grams.add(normalized.slice(i, i + 2));
  return grams;
}

function isNearDuplicateQuestion(reply: string, question: string): boolean {
  const tail = String(reply || '').slice(-200);
  if (!/[？?]/.test(tail)) return false;
  const replyGrams = charBigrams(tail);
  const questionGrams = charBigrams(question);
  if (replyGrams.size === 0 || questionGrams.size === 0) return false;
  let intersection = 0;
  for (const gram of questionGrams) if (replyGrams.has(gram)) intersection += 1;
  const union = replyGrams.size + questionGrams.size - intersection;
  return union > 0 && intersection / union >= 0.32;
}

/**
 * 软收口知识地板（2026-09-25 训练局 P1）：老师语义明确收课且无 pending 点时，
 * 平均目标进度达到此值即允许完成。低于硬门禁（80）但高于"刚起步"（30 上下）——
 * 轻量任务（单知识点）常停在 70，硬门禁永远够不着，课就永远收不了。
 */
export const SOFT_COMPLETION_PROGRESS_FLOOR = 60;
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
export const ARITHMETIC_REPAIR_BUDGET_MS = 150_000;
export const ARITHMETIC_REPAIR_TIMEOUT_MS = 90_000;

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
export const CLOSING_REPLY_PATTERNS: RegExp[] = [
  /今天(就)?(到这儿|到这里|收到这儿|就到这)/,
  /这节课?(就)?(到这儿|到这里|结束了)/,
  /这一?节(就)?齐了/,
  /(我们)?(先|就)(到这|到这里)/,
];

/**
 * 开场「上一课经历」接地守卫（修复批 8，OPENING_ASSUME_EXPERIENCE 课堂聚类 4/5；批 12 扩
 * 反向断言，批 L 聚类 5/5 触发 §18.3-3 tripwire）：开场文本断言存在上一课/上次经历（病历单
 * 形态：「上一课你把…五处逐条判完了」「上一阶段那三把尺子已经走稳了」「你说过要的是……」），
 * 或**反向断言**学习者的过往（批 L 实证：「你之前没细看过这类合同，下周一又要签」——断言
 * 学习者没做过某事同样是编造经历，无据）。lastLessonRecap 缺席 = 本课没有任何可核验的上一课
 * 记录（recap 只在真实完成课存在时由 recap 链装配）——此时任何此类断言都不可核验。
 * 条件式豁免：「如果你之前没接触过…」是批 8 钉住的合法衔接形态——命中反向断言的**句子**带
 * 条件/疑问标记（如果/假如/要是/是否…）时不判违例。
 */
const OPENING_PRIOR_HISTORY_PATTERN
  = /(上一[节节课次阶段环节]|上次[的课学习]?|你说过|你之前[提讲]过)/;
const OPENING_PRIOR_NEGATIVE_PATTERN
  = /(?:你|您)(?:之前|以前|先前|过去)?[^。！？?！]{0,8}(?:没|从没|从未|不太)(?:细看|看过|接触|学过|遇过|见过|碰过|做过|试过|听过)/;
/** 学员短确认连续计数（修复批 13-②，repetitive_closure_loop 取证定性）：最近连续的
 * 学员回合全是 ≤6 字非问句短确认（「马上去」「好」「收到」「明白了」）时返回该计数——
 * 配合教师 reply 低增量重复，即为「作业指令重发循环」的收口条件（u01 六轮、u04 十轮实证：
 * 任务已宣布结束仍反复重发同一指令，学员只会短确认）。任一较长/含问句的学员回合打断计数。 */
export function computeLearnerShortAckStreak(messages: Array<{ role?: unknown; content?: unknown }>): number {
  let streak = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== 'user') continue;
    const text = String(message.content ?? '').trim();
    if (!text) continue;
    if (/[?？]/.test(text)) break;
    const normalized = text.replace(/[^\p{L}\p{N}]/gu, '');
    if (normalized.length === 0 || normalized.length > 6) break;
    streak += 1;
    if (streak >= 5) break;
  }
  return streak;
}

const OPENING_CONDITIONAL_MARKERS = /(?:如果|假如|要是|若|是否|要不要|有没有|或许|可能|大概)/;

export function hasUnverifiablePriorClaim(opening: { message?: unknown; question?: unknown }): boolean {
  const text = `${String(opening?.message ?? '')}\n${String(opening?.question ?? '')}`;
  if (OPENING_PRIOR_HISTORY_PATTERN.test(text)) return true;
  if (!OPENING_PRIOR_NEGATIVE_PATTERN.test(text)) return false;
  const sentences = text.split(/[。！？?！]/);
  return sentences.some((sentence) =>
    OPENING_PRIOR_NEGATIVE_PATTERN.test(sentence) && !OPENING_CONDITIONAL_MARKERS.test(sentence));
}

const OPENING_PRIOR_CLAIM_CONSTRAINT = '本课没有任何可核验的上一课记录。不得断言上一课/上次/上一阶段的经历或成果'
  + '（如「你上一课判完了…」「上一阶段已经走稳」「你说过要的是…」），也**不得反向假定**学习者'
  + '的过往（「你之前没细看过这类合同」「你肯定没接触过」——断言学习者没做过某事同样是编造'
  + '经历）；如需衔接，改用条件式表述（「如果你之前接触过/没接触过…」），或直接锚定本课材料开场。';

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
  const openingInput = {
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
        // 画像/学情锚/任务目标（2026-10-14）：开场此前只看到课程文本+三个运行信号，
        // 两个不同人设的首课载荷逐字节相同。缺省字段不进载荷（与 recap 同一口径）。
        ...(context.learnerPersona ? { learnerPersona: context.learnerPersona } : {}),
        ...(context.schoolAnchor.background || context.schoolAnchor.baselineEvidence
          ? { schoolAnchor: context.schoolAnchor }
          : {}),
        ...(context.taskProfile.learningObjectives.length || context.taskProfile.coreConcept
          ? {
            taskProfile: {
              learningObjectives: context.taskProfile.learningObjectives,
              coreConcept: context.taskProfile.coreConcept,
            },
          }
          : {}),
        // #181：开场生成器此前不在输入白名单里带预测 ⇒ 预测对「学生第一印象/首轮节奏」
        // 零作用（1–2 回合的短课几乎等于没有回喂）。缺省不进载荷（与 recap 同一口径）。
        ...(context.learnerPrediction ? { learnerPrediction: context.learnerPrediction } : {}),
        __prompt: {
          userId: context.userId,
          taskId: context.taskId,
          requestPath: '/services/ai-teaching/generate-opening',
          callerAgentId: AI_TEACHING_AGENT_ID,
        },
    };
    let parsed: any = null;
    try {
      const result = await withTimeoutSignal(
        (signal) => executeSkillWithResult(auxSkillDefinitionMap['teaching-opening'], openingInput, { abortSignal: signal }),
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
    return ensureOpeningSampleHonesty(ensureOpeningMaterialGrounding(buildDeterministicOpening(context), context), context);
  }

  if (parsed) {
    // 「一条行动线」契约的确定性兜底（2026-11-02 用户反馈「开场很不舒服」）：
    // 模型可省略 quickReplies，实测 39.5% 的开场落库为空数组 → 第一屏没有任何可点的东西；
    // question 里还会写"也可以直接往下走"这种没有控件的动作承诺。这里统一收口。
    // 材料落地护栏（2026-11-12）：模型说「这段对话」却不摆本体时整块补挂（见 ensureOpeningMaterialGrounding）。
    // 示例口径护栏（2026-11-12）：描述标「示例」而开场说成「你大概见过」时改回示例口径。
    let opening = ensureOpeningSampleHonesty(
      ensureOpeningMaterialGrounding(
        ensureOpeningActionLine(parsed as Partial<TeachingOpening>, context),
        context,
      ),
      context,
    );
    // 开场「上一课经历」接地守卫（修复批 8，OPENING_ASSUME_EXPERIENCE 聚类 4/5）：
    // lastLessonRecap 缺席 = 无可核验的上一课记录，开场文本却断言上一课经历
    // → 按接地约束重生成一次（条件式表述或锚定本课材料）；重生成结果始终采用（带指令的
    // 即便仍违例也优于原版），并打遥测。fail-open：重生成失败保留原开场，绝不阻塞开课。
    if (!context.lastLessonRecap && hasUnverifiablePriorClaim(opening)) {
      try {
        const retry = await withTimeoutSignal(
          (signal) => executeSkillWithResult(auxSkillDefinitionMap['teaching-opening'], {
            ...openingInput,
            priorClaimConstraint: OPENING_PRIOR_CLAIM_CONSTRAINT,
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
        const reparsed = retry.success && retry.output ? retry.output : null;
        if (reparsed) {
          opening = ensureOpeningSampleHonesty(
            ensureOpeningMaterialGrounding(
              ensureOpeningActionLine(reparsed as Partial<TeachingOpening>, context),
              context,
            ),
            context,
          );
          logger.warn('[AITeaching] 开场断言了不可核验的上一课经历，已按接地约束重生成', {
            userId: context.userId,
            taskId: context.taskId,
            stillViolating: hasUnverifiablePriorClaim(opening),
          });
          recordDegradation({
            source: 'ai-teaching/generate-opening',
            faultCategory: 'SCHEMA_VIOLATION',
            severity: 'P2_DEGRADED',
            impactedDimensions: ['opening.message'],
            mitigationApplied: 'regenerate-opening-prior-claim-grounded',
            rootCauseMessage: 'opening asserted prior-lesson experience without verifiable recap; regenerated with grounding constraint',
          });
        }
      } catch (retryError) {
        logger.warn('[AITeaching] 开场接地重生成失败，保留原开场（fail-open）', {
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });
      }
    }
    return opening;
  }

  logger.warn('[AITeaching] 开场交互块缺少有效结构，降级为确定性开场', {
    userId: context.userId,
    taskId: context.taskId,
    topic: context.topic,
  });
  return ensureOpeningSampleHonesty(ensureOpeningMaterialGrounding(buildDeterministicOpening(context), context), context);
}

/**
 * 出图闸门的库侧快照：会话总数、该图型数、已落库的图。
 * 判据必须取自库（侧表），不用回合内存快照——2026-10-22 复核 744 张图，
 * 会话上限 4 与同骨架去重两道闸门在真课里一次都没触发（单课最多 12 张）。
 */
export async function figureGateSnapshot(sessionId: string, kind: unknown) {
  const key = String(kind || 'position-line');
  // 共享白板是任务级持久板书，不是「一次性配图」：不计入会话图配额，也不参与同骨架去重。
  const figures = (await teachingSessionRepository.listFigures(sessionId))
    .filter((figure) => (figure as { board?: boolean }).board !== true);
  const kindCount = figures.reduce(
    (n, figure) => n + (String((figure as { kind?: string })?.kind || 'position-line') === key ? 1 : 0),
    0,
  );
  return { figures, total: figures.length, kindCount, kindCap: figureKindCap(key) };
}

/**
 * 课末终检题生成（2026-11-19）：独立 aux skill，只负责出题 + 答案键；判分由引擎确定性完成。
 * 失败 fail-open（返回 null，不阻断收束）——没有终检题时契约门仍按既有证据判定。
 */
export async function generateExitTicketForLesson(input: {
  subject: string;
  topic: string;
  taskTitle: string;
  contract: LessonContract;
  evidence: LessonEvidence[];
  messages: Array<{ role: string; content?: unknown }>;
  attempts: number;
}): Promise<ExitTicket | null> {
  const definition = auxSkillDefinitionMap['teaching-exit-ticket'];
  if (!definition) return null;
  const independentNames = new Set(
    input.evidence
      .filter((item) => item.independent && item.correct)
      .map((item) => item.kcName.trim()),
  );
  const coreKcs = input.contract.coreKcs.map((kc) => ({
    name: kc.name,
    hasIndependentEvidence: independentNames.has(kc.name.trim()),
  }));
  try {
    const result: any = await executeSkill(definition, {
      subject: input.subject,
      topic: input.topic,
      taskTitle: input.taskTitle,
      coreKcs,
      recentDialogue: input.messages.slice(-8).map((item) => ({
        role: item.role,
        content: String(item.content ?? '').slice(0, 400),
      })),
    } as any);
    if (result?.success === false) {
      throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'EXIT_TICKET_FAILED');
    }
    const out: any = result?.output ?? result;
    const question = typeof out?.question === 'string' ? out.question.trim() : '';
    const conceptName = typeof out?.conceptName === 'string' ? out.conceptName.trim() : '';
    if (!question || !conceptName) return null;
    const type = out.type === 'single_choice' || out.type === 'multi_choice' || out.type === 'short_answer'
      ? out.type
      : 'short_answer';
    const options = Array.isArray(out.options)
      ? out.options
          .filter((option: any) => option && typeof option.id === 'string' && typeof option.text === 'string')
          .slice(0, 4)
          .map((option: any) => ({ id: option.id.trim(), text: option.text.trim() }))
      : [];
    const optionIds = new Set(options.map((option: { id: string }) => option.id));
    const correctOptionIds: string[] = type !== 'short_answer' && Array.isArray(out.correctOptionIds)
      ? Array.from(new Set(out.correctOptionIds
          .filter((id: any) => typeof id === 'string' && optionIds.has(id.trim()))
          .map((id: string) => id.trim())))
      : [];
    const expectedKeywords = type === 'short_answer' && Array.isArray(out.expectedKeywords)
      ? out.expectedKeywords
          .filter((keyword: any) => typeof keyword === 'string' && keyword.trim())
          .map((keyword: string) => keyword.trim().slice(0, 40))
          .slice(0, 3)
      : [];
    // 无答案键的题不落库：终检必须能确定性判分，否则会变成「模型说了算」。
    if (type !== 'short_answer' && (options.length < 2 || correctOptionIds.length === 0)) return null;
    if (type === 'short_answer' && expectedKeywords.length === 0) return null;
    return {
      id: `et_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question,
      type,
      conceptName,
      ...(type !== 'short_answer' ? { options, correctOptionIds } : {}),
      ...(type === 'short_answer' ? { expectedKeywords } : {}),
      askedAt: new Date().toISOString(),
      status: 'pending',
      attempts: Math.max(1, input.attempts + 1),
    };
  } catch (error) {
    logger.warn('[AITeaching] 课末终检题生成失败（fail-open，不阻断收束）', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 去掉回复末尾仍在追问的段落（终检轮只保留一个待答问题）。 */
export function stripTrailingQuestionParagraph(reply: string): string {
  const paragraphs = String(reply || '').split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  if (paragraphs.length > 0) {
    const last = paragraphs[paragraphs.length - 1];
    if (/[?？]/.test(last.split('\n').slice(-2).join('\n'))) paragraphs.pop();
  }
  return paragraphs.join('\n\n');
}

/** 把终检题追加到本轮教师回复（学生必须能在对话里看到题面与选项）。 */
export function appendExitTicketToReply(
  teachingOutput: { reply?: string },
  ticket: ExitTicket,
): void {
  const current = String(teachingOutput.reply || '');
  const optionsBlock = (Array.isArray(ticket.options) ? ticket.options : [])
    .filter((option) => option && typeof option.id === 'string' && typeof option.text === 'string')
    .map((option) => `${option.id}. ${option.text}`)
    .join('\n');
  const choiceHint = ticket.type === 'short_answer' ? '' : '\n\n（回复选项字母即可）';
  // 题面已由模型带出时只补选项：只问字母却不列选项，学生只能猜（2026-11-20 真课实证：
  // 学员把正确选项写成完整句子，解析不到字母，两次都被记成「作答 空」）。
  if (current.includes(ticket.question)) {
    if (optionsBlock && !current.includes(optionsBlock)) {
      teachingOutput.reply = `${current}\n\n${optionsBlock}${choiceHint}`;
    }
    return;
  }
  // 终检轮只留一个待答问题：模型回复末尾若还有自己的追问，整段撤掉——
  // 两个问题同屏时学生会答前一个（2026-11-19 真课实证：两次终检都被当成「没作答」）。
  const lead = stripTrailingQuestionParagraph(current);
  const optionsText = optionsBlock ? `\n${optionsBlock}` : '';
  teachingOutput.reply = `${lead}${lead ? '\n\n' : ''}最后一道题（独立作答，不限时）：${ticket.question}${optionsText}${choiceHint}`;
}



/** 受理入口护栏（issue #210）：返回 hasLearnerImages；非法输入直接抛错，不进入回合主回路。 */
export function assertLearnerTurnInput(options: ProcessStudentMessageOptions, message: string): boolean {
  const hasLearnerImages = Array.isArray(options.images) && options.images.length > 0;
  if (options.kind !== 'resume-continue' && !hasLearnerImages
    && (typeof message !== 'string' || message.trim().length === 0)) {
    throw new Error('缺少消息内容');
  }
  return hasLearnerImages;
}

/** 组装本轮可见消息（resume-continue 不落伪 user 消息；普通回合保留学生原文与交互元数据）。 */
export function buildUpdatedMessages(
  sessionMessages: TeachingSessionMessage[],
  message: string,
  options: ProcessStudentMessageOptions,
  hasLearnerImages: boolean,
): TeachingSessionMessage[] {
  if (options.kind === 'resume-continue') return appendTimestamp([...sessionMessages]);
  return appendTimestamp([
    ...sessionMessages,
    {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      ...(hasLearnerImages ? { images: options.images } : {}),
      ...(options.checkpointId ? { checkpoint: true } : {}),
      ...(options.interactionMeta && Object.keys(options.interactionMeta).length > 0
        ? { meta: options.interactionMeta as Record<string, number> }
        : {}),
    } as unknown as TeachingSessionMessage,
  ]);
}

/** 选择题终检未识别出任何选项（多为学生用整句作答、没带字母）：算格式未识别，不算答错。 */
export function isExitTicketFormatMiss(ticket: ExitTicket | null | undefined): boolean {
  if (!ticket || ticket.status !== 'failed') return false;
  if (ticket.type === 'short_answer') return false;
  return /作答\s*空/.test(String(ticket.detail || ''));
}

/** 课末终检的确定性判分（发题后学生作答 → 更新状态/历史/裁决；含历史回填）。 */
export function gradePendingExitTicket(input: {
  exitTicketState: ExitTicket | null;
  exitTicketHistory: unknown;
  kind?: string;
  message: string;
}): {
  state: ExitTicket | null;
  history: ExitTicket[];
  attempts: number;
  verdict: { passed: boolean; detail: string | null } | null;
  graded: boolean;
  /** 选择题没解析出选项：保持 pending，下一轮重新贴题面与选项，不消耗作答次数 */
  formatMiss: boolean;
} {
  let state = input.exitTicketState;
  const history: ExitTicket[] = Array.isArray(input.exitTicketHistory)
    ? (input.exitTicketHistory as ExitTicket[]).filter((item) => !!item && typeof item === 'object')
    : [];
  // 历史里的「格式未识别」不计入失败次数；否则学生两次整句作答就把终检额度耗尽，
  // 契约永久 met=false，结算门再也过不去（2026-11-20 真课实测死局）。
  const countAttempts = () => history.filter((item) => !isExitTicketFormatMiss(item)).length;
  const attempts = countAttempts();
  let verdict: { passed: boolean; detail: string | null } | null = null;
  let graded = false;
  let formatMiss = false;
  if (state?.status === 'pending' && input.kind !== 'resume-continue' && String(input.message || '').trim()) {
    const submission = parseExitTicketSubmission(state, String(input.message));
    const selected = Array.isArray(submission.selectedOptionIds) ? submission.selectedOptionIds : [];
    const hasOptions = Array.isArray(state.options) && state.options.some((option) => !!option?.id);
    if (state.type !== 'short_answer' && hasOptions && selected.length === 0) {
      return { state, history, attempts, verdict, graded, formatMiss: true };
    }
    const judgement = judgeCheckpointAnswer(state, submission);
    const passed = judgement?.passed === true;
    state = {
      ...state,
      status: passed ? 'passed' : 'failed',
      attempts: Math.max(1, Number(state.attempts) || 1),
      judgedBy: judgement?.judgedBy ?? 'model-reference',
      passed,
      answeredAt: new Date().toISOString(),
      answerExcerpt: String(input.message).slice(0, 200),
      detail: judgement?.detail ?? '无可用答案键，按未通过处理',
    };
    const historyIndex = history.findIndex((item) => item.id === state!.id);
    if (historyIndex >= 0) history[historyIndex] = state;
    else history.push(state);
    verdict = { passed, detail: judgement?.detail ?? null };
    graded = true;
  }
  return { state, history, attempts: countAttempts(), verdict, graded, formatMiss };
}

/** 契约缺口指令：独立证据不足时点名到 coreKc，避免模型挑契约外点出题。 */
export function buildContractGapDirective(
  previousLessonReport: LessonReport | undefined,
  lessonContract: LessonContract,
): { directive: string | null; independentGapKcs: string[] } {
  const previousIndependentNames = new Set(
    (Array.isArray(previousLessonReport?.evidence) ? previousLessonReport.evidence : [])
      .filter((item) => item?.independent === true && typeof item.kcName === 'string')
      .map((item) => item.kcName.trim()),
  );
  const independentGapKcs = lessonContract.coreKcs
    .filter((kc) => !previousIndependentNames.has(kc.name.trim()))
    .map((kc) => kc.name);
  const directive = previousLessonReport && previousLessonReport.met === false
    ? [
        Array.isArray(previousLessonReport.missingKcs) && previousLessonReport.missingKcs.length > 0
          ? `本课契约还缺证据的 KC：${previousLessonReport.missingKcs.join('、')}。本轮必须回到这些 KC，先给认知积木，再通过 control.checkpoint 出一次独立检查点；`
          : '',
        independentGapKcs.length > 0
          ? `独立证据不足（${previousLessonReport.independentCount}/${previousLessonReport.requiredIndependent}）：本轮必须通过 control.checkpoint 出一次独立检查点（只口头追问不算证据），题目落在以下尚无独立证据的核心 KC 之一——「${independentGapKcs.join('」「')}」，无提示、首答计分；`
          : '',
        '不要继续收尾。',
      ].filter(Boolean).join('')
    : null;
  return { directive, independentGapKcs };
}
