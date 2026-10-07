/**
 * PeerReinforcementSkill - 伴学 Skill
 * 在教学主链判断学生需要强化时，提供同伴式讨论补强能力
 */

import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { PromptCallSpec } from '../../composers/types';
import { logger } from '../../utils/logger';
import { detectAwaitingLearnerWork } from '../../config/pedagogy.config';
import type { AgentDefinition } from '../../agents/protocol';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';
import { buildSkillOutcome, noneTransition, type SkillOutcome } from '../outcome';

type MessageRole = 'user' | 'assistant' | 'system';
interface ChatMessage { role: MessageRole; content: string }

const AGENT_ID = 'skill:peer-reinforcement';

// File-as-Truth：从编译产物加载 systemPrompt，避免代码内嵌第二份 prompt 导致双源漂移
const PEER_REINFORCEMENT_PROMPT = loadPromptFile(AGENT_ID)?.systemPrompt || '';




export const peerAgentDefinition: AgentDefinition = {
  id: AGENT_ID,
  name: '伴学 Skill',
  version: '1.0.0',
  type: 'teaching',
  category: 'standard',
  description: '讨论式伴学能力，通过费曼技巧、辩论、反例等方式强化理解',
  capabilities: [
    'feynman-technique',
    'debate-facilitation',
    'counterexample-challenge',
    'analogy-migration',
    'error-analysis'
  ],
  subscribes: [
    'learning:struggle',
    'learning:confusion',
    'teaching:reinforcement-needed'
  ],
  publishes: [
    'peer:discussion-completed',
    'learning:understanding-improved'
  ],
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: '讨论主题' },
      strategy: { 
        type: 'string', 
        enum: ['feynman', 'debate', 'counterexample', 'analogy', 'error-analysis', 'encourage'],
        description: '伴学策略（encourage=老师本轮在布置独立作业/等作答时的鼓励式降级，不给解题线索）'
      },
      studentMessage: { type: 'string', description: '学生最新消息' },
      tutorLatestReply: { type: 'string', description: '老师最近一条回复原文（可选；用于对齐老师当前教学动作）' },
      tutorContext: {
        type: 'array', 
        items: { 
          type: 'object', 
          properties: { 
            role: { type: 'string' }, 
            content: { type: 'string' } 
          } 
        },
        description: '教学对话上下文'
      },
      cognitiveLevel: { type: 'string', description: '学生认知层级' },
      understanding: { type: 'number', description: '学生理解度 (0-1)' },
      // 规则 41 的"高负荷/受挫 → 先共情 + 小例子"分支需要这两个字段才可达（此前未提供，§3.19 P0②）
      loadIndex: { type: ['number', 'null'], description: '本轮认知负荷 (0-1)，未知为 null' },
      emotionalState: { type: ['string', 'null'], description: '本轮情绪（positive/neutral/frustrated/confused/bored），未知为 null' },
      // 规则 11「连续 3 问无进展即收手」的 3 问预算依赖它（审计 P2-11：引擎主路径此前不转发，
      // 伴学看不到自己说过什么）。聊天路径一直传，引擎路径 2026-10-07 起对齐。
      peerHistory: {
        type: 'array',
        items: {
          type: 'object',
          properties: { role: { type: 'string' }, content: { type: 'string' } }
        },
        description: '此前伴学对话历史（peer 标记消息/本轮之前的伴学插话）'
      }
    },
    required: ['topic', 'strategy', 'tutorContext']
  },
  outputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '伴学消息内容' },
      strategy: { type: 'string', description: '使用的伴学策略' },
      followUpQuestions: { 
        type: 'array', 
        items: { type: 'string' },
        description: '后续问题列表'
      }
    },
    required: ['message', 'strategy']
  },
  endpoint: undefined,
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

export interface PeerDiscussionInput {
  topic: string;
  strategy: 'feynman' | 'debate' | 'counterexample' | 'analogy' | 'error-analysis' | 'encourage';
  studentMessage?: string;
  /**
   * 老师最近一条回复原文（2026-09-25 对齐调整，可选）。
   * 让伴学看见老师刚说了什么：老师刚提问等学生答 → 不代答不提前给提示；老师搁置某话题 → 不再追。
   * 此前只埋在 tutorContext 的 100 字/条窗口里，压不过【学生消息】的锚定（真课实测两轮插话均与老师节奏相抵）。
   */
  tutorLatestReply?: string;
  tutorContext: Array<{ role: string; content: string }>;
  cognitiveLevel?: string;
  understanding?: number;
  /**
   * 本轮认知负荷 (0-1)，未知为 null。
   * 规则「高负荷/受挫 → 不连续追问、先共情」需要它才可达——inputSchema 与两个 caller 都已传，
   * 此前类型与载荷都不转发（审计 P1 §2.4a）。
   */
  loadIndex?: number | null;
  /** 本轮情绪（positive/neutral/frustrated/confused/bored），未知为 null */
  emotionalState?: string | null;
  /** 此前伴学对话历史（peer 标记消息） */
  peerHistory?: Array<{ role: string; content: string }>;
}

export interface PeerModelArtifact {
  message: string;
  followUpQuestions: string[];
}

/** 伴学独立 canonical artifact（无 durable 状态迁移） */
export interface PeerCanonicalArtifact {
  message: string;
  strategy: string;
  followUpQuestions: string[];
}

export interface PeerDiscussionOutput {
  message: string;
  strategy: string;
  followUpQuestions?: string[];
  promptDebug?: any;
  inputEcho?: PeerDiscussionInput;
  runtimeEnvelope?: ReturnType<typeof adaptToRuntimeEnvelope>;
  /** model 主路径（2026-08-11 移除本地 fallback 降级，失败改抛错冒泡） */
  source?: 'model' | 'fallback';
}

export function toPeerCanonicalArtifact(result: PeerDiscussionOutput): PeerCanonicalArtifact {
  return {
    message: result.message,
    strategy: result.strategy,
    followUpQuestions: Array.isArray(result.followUpQuestions) ? result.followUpQuestions : [],
  };
}

/** peer 无 durable transition；公开仍是 { message, strategy, followUpQuestions } */
export function toPeerSkillOutcome(
  result: PeerDiscussionOutput,
  options?: { quality?: 'model' | 'fallback' | 'partial' | 'failed'; reason?: string | null }
): SkillOutcome<PeerCanonicalArtifact> {
  return buildSkillOutcome({
    skillId: AGENT_ID,
    artifact: toPeerCanonicalArtifact(result),
    quality: options?.quality ?? (result.source === 'fallback' ? 'fallback' : 'model'),
    reason: options?.reason ?? null,
    runtimeEnvelope: result.runtimeEnvelope || null,
    transition: noneTransition('discussion-generated'),
  });
}

function getStrategyInstruction(strategy: PeerDiscussionInput['strategy']): string {
  const strategyPrompts: Record<PeerDiscussionInput['strategy'], string> = {
    feynman: '请像同学一样请学生把概念讲给你听，并用一个追问检验他是否真的理解。',
    debate: '请提出一个轻量对立视角，让学生比较哪种说法更合理。',
    counterexample: '请给一个边界情况或反例，促使学生检查结论是否还成立。',
    analogy: '请引导学生联想一个相近概念，帮助他做类比迁移。',
    'error-analysis': '请围绕学生刚才的错误或偏差，温和地引导他分析错因。',
    encourage: '老师本轮在让学生自己作答——只给一句鼓励式同伴回应（如"你先自己写，写完咱俩对一对"），不要给任何线索、类比、反例或解题方向。',
  };

  return strategyPrompts[strategy] || strategyPrompts.feynman;
}

/**
 * 本轮实际生效的伴学策略（P1-14 修复③，2026-10-07）。
 *
 * 老师本轮在布置独立作业/等学生作答时，不论调用方传了什么 strategy，一律降级为 encourage。
 * 单一实现、四处共用（载荷、【策略要求】、返回回显 result.strategy、runtimeEnvelope 与 handler 的
 * internal.ext.peer.strategy），保证**回显/落库/前端标签**与载荷实际下发的手法一致——
 * 聊天路径（teaching-session-ops.ts:647）只传 cognitiveLevel、不传 tutorLatestReply，
 * 若不在此统一，会出现"载荷按鼓励式生成、回显却写着反例挑战"的口径分裂。
 */
export function resolveEffectivePeerStrategy(input: PeerDiscussionInput): PeerDiscussionInput['strategy'] {
  return detectAwaitingLearnerWork(input?.tutorLatestReply).awaiting ? 'encourage' : input.strategy;
}

function buildPeerUserPayload(input: PeerDiscussionInput) {
  const contextSection = input.tutorContext.length > 0
    ? `\n【最近对话】\n${input.tutorContext.slice(-5).map((m) => `${m.role}: ${m.content.substring(0, 100)}`).join('\n')}`
    : '';

  const peerHistorySection = Array.isArray(input.peerHistory) && input.peerHistory.length > 0
    ? `\n【此前伴学对话】\n${input.peerHistory.slice(-6).map((m) => `${m.role === 'user' ? '学生' : '伴学伙伴'}: ${m.content.substring(0, 100)}`).join('\n')}`
    : '';

  const studentMessageSection = input.studentMessage
    ? `\n【学生消息】${input.studentMessage}`
    : '';

  // 对齐老师当前教学动作（2026-09-25）：500 字/条窗口外单独放行，让伴学看见老师刚说了什么
  const tutorReplySection = input.tutorLatestReply
    ? `\n【老师本轮回复】${input.tutorLatestReply.substring(0, 500)}`
    : '';

  const understandingSection = typeof input.understanding === 'number'
    ? `\n【理解度】${input.understanding}`
    : '';

  // 规则「当【理解度】< 0.3 或输入表明学生处于高认知负荷/情绪受挫时：不连续追问、先共情」——
  // 这两个字段此前完全不转发，该分支只能靠【理解度】单腿触发（审计 P1 §2.4a）。
  const loadSection = typeof input.loadIndex === 'number'
    ? `\n【本轮认知负荷】${input.loadIndex}`
    : '';
  const emotionSection = typeof input.emotionalState === 'string' && input.emotionalState
    ? `\n【本轮情绪】${input.emotionalState}`
    : '';

  // 独立作业进行中（P1-14 修复③）：老师本轮在布置独立作业/等学生作答时，
  // 【策略要求】与策略手法一律降级为鼓励式，并在载荷里显式声明"不得给线索"——
  // 提示词规则 7 单独压不过【策略要求】的"必须遵守"（生产实证：apply 层级被派 counterexample，
  // 学生独立证明题上伴学把关键步骤递了出去）。此处代码门与 pickPeerStrategy 同判据、双保险。
  const awaiting = detectAwaitingLearnerWork(input.tutorLatestReply);
  const effectiveStrategy = resolveEffectivePeerStrategy(input);
  const awaitingSection = awaiting.awaiting
    ? `\n【本轮禁令】老师本轮正在等学生自己作答（判据：${awaiting.reason}）——不得给出任何线索、类比、反例、解题方向或答案；只可鼓励一句，把作答权留给学生。此禁令优先于上方【策略要求】。`
    : '';

  return `请生成一段同伴讨论消息：
【主题】${input.topic}
【策略】${effectiveStrategy}
【策略要求】${getStrategyInstruction(effectiveStrategy)}
【学生认知层级】${input.cognitiveLevel || 'understand'}${understandingSection}${loadSection}${emotionSection}${contextSection}${tutorReplySection}${peerHistorySection}${studentMessageSection}${awaitingSection}`;
}

export function validatePeerParsedOutput(parsed: unknown) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false as const, failureReason: 'PEER_OUTPUT_NOT_OBJECT' };
  }

  const artifact = parsed as Record<string, unknown>;
  if (typeof artifact.message !== 'string' || !artifact.message.trim()) {
    return { valid: false as const, failureReason: 'PEER_MESSAGE_MISSING' };
  }

  if (Object.prototype.hasOwnProperty.call(artifact, 'followUpQuestions')) {
    if (!Array.isArray(artifact.followUpQuestions)) {
      return { valid: false as const, failureReason: 'PEER_FOLLOW_UP_QUESTIONS_NOT_ARRAY' };
    }

    if (artifact.followUpQuestions.some(question => typeof question !== 'string' || !question.trim())) {
      return { valid: false as const, failureReason: 'PEER_FOLLOW_UP_QUESTION_INVALID' };
    }
  }

  return { valid: true as const };
}

export function normalizePeerParsedOutput(parsed: unknown): PeerModelArtifact {
  const artifact = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const followUpQuestions = Array.isArray(artifact.followUpQuestions)
    ? artifact.followUpQuestions
      .filter((question): question is string => typeof question === 'string' && !!question.trim())
      .slice(0, 3)
      .map(question => question.trim().slice(0, 100))
    : [];

  return {
    message: typeof artifact.message === 'string' ? artifact.message.trim() : '',
    followUpQuestions,
  };
}

/**
 * 契约校验前的容错归一（审计 P0 §1.5）。
 *
 * core fields 曾把 followUpQuestions 声明为必填（"string[]"），而提示词写的是「可选的后续追问」、
 * handler 也按可选处理 ⇒ 模型省略该字段时整轮 missing-required 失败（peer 无 retryStrategy，
 * maxAttempts=1 不重试），**伴学消息整条丢失**（现网实测 2 次）。
 * 缺失/非数组一律收敛为 []：语义上等价于「本轮不追问」，normalizeOutput 本就按此处理。
 */
export function coercePeerParsedForContract(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.followUpQuestions)) return parsed;
  return { ...record, followUpQuestions: [] };
}

const peerPromptSpec: PromptCallSpec<PeerDiscussionInput, PeerModelArtifact> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: PEER_REINFORCEMENT_PROMPT,
  requireActivePrompt: true,
  caller: {
    agentId: 'teaching-agent',
    skillId: 'peer-reinforcement',
  },
  buildUserPayload: (input) => buildPeerUserPayload(input),
  coerceParsedForContract: (parsed) => coercePeerParsedForContract(parsed),
  validateParsedOutput: (parsed) => validatePeerParsedOutput(parsed),
  normalizeOutput: (parsed) => normalizePeerParsedOutput(parsed),
  // 现网实测：peer 的头号失败源是 `response does not contain valid JSON object`（35 次），
  // 其次才是契约缺字段（2 次）。此前没有 retryStrategy ⇒ maxAttempts=1，一次不合规就整条丢。
  // 给一次纠偏重试（与 stage-designer 同模式），把"偶发输出散文"从失败转成成功。
  retryStrategy: {
    maxAttempts: 2,
    // P1-14 修复③：纠偏语带上「独立作业进行中不得给线索」约束——重试时也不得把解题钥匙递出去。
    onValidationFail: ({ failureReason, input }) =>
      `请只输出一个 JSON 对象（字段：message、strategy、followUpQuestions），不要输出解释文字或 markdown 代码块之外的内容。`
      + (detectAwaitingLearnerWork((input as PeerDiscussionInput | undefined)?.tutorLatestReply).awaiting
        ? '注意：老师本轮正在等学生自己作答，只可鼓励一句，不得给出任何线索、类比、反例或解题方向。'
        : '')
      + `上次失败原因：${failureReason}`,
  },
  mapEnvelope: (output, input, runtimeContract) => adaptToRuntimeEnvelope({
    contract: runtimeContract,
    artifact: {
      message: output.message,
      // P1-14 修复③：与载荷实际下发的手法一致（等待作答 → encourage），避免回显/落库口径分裂。
      strategy: resolveEffectivePeerStrategy(input),
      followUpQuestions: output.followUpQuestions,
    },
    phase: 'discussion-generated',
    status: 'succeeded',
    isTerminal: false,
    nextAction: 'continue-discussion',
    nextState: {
      stage: 'discussion-generated',
      strategy: resolveEffectivePeerStrategy(input),
      topic: input.topic,
    },
  }),
  };

export async function executePeerDiscussion(input: PeerDiscussionInput): Promise<PeerDiscussionOutput> {
  const startTime = Date.now();
  let error: Error | null = null;
  let result: PeerDiscussionOutput | null = null;

  try {
    const promptResult = await callPrompt(peerPromptSpec, input);

    if (!promptResult.success) {
      throw new Error(promptResult.error?.message || 'PEER_PROMPT_FAILED');
    }

    const modelArtifact = promptResult.output;
    const message = modelArtifact?.message || '';

    if (!message.trim()) {
      throw new Error('PEER_RESPONSE_EMPTY');
    }

    const effectiveStrategy = resolveEffectivePeerStrategy(input);
    logger.info(`[PeerReinforcementSkill] 生成讨论消息：strategy=${effectiveStrategy}, topic=${input.topic}`);

    result = {
      message,
      // P1-14 修复③：返回值与 payload / runtimeEnvelope 同一 effective strategy，聊天路径不再回显 counterexample。
      strategy: effectiveStrategy,
      followUpQuestions: modelArtifact.followUpQuestions,
      promptDebug: promptResult.debug || null,
      inputEcho: input,
      runtimeEnvelope: promptResult.runtimeEnvelope,
      source: 'model',
    };
    return result;
  } catch (e: any) {
    error = e instanceof Error ? e : new Error(e.message);
    // 2026-08-11 移除模板话术降级（策略模板在会话中冒充"同伴已回复"）：
    // 失败显式抛错冒泡，由调用方 AITeachingCoordinator.ts:1498-1519 try/catch 容错跳过。
    logger.error(`[PeerReinforcementSkill] 讨论生成失败：${error.message}`);
    throw error;
  } finally {
    const durationMs = Date.now() - startTime;
    logger.debug('[PeerReinforcementSkill] 执行结束', {
      durationMs,
      success: !error,
      error: error?.message || null,
    });
  }
}

export async function peerAgentHandler(input: any, context: any): Promise<any> {
  const startTime = Date.now();
  let success = false;

  try {
    const result = await executePeerDiscussion(input);
    success = true;

    peerAgentDefinition.stats.callCount++;
    peerAgentDefinition.stats.successRate = 
      (peerAgentDefinition.stats.successRate * (peerAgentDefinition.stats.callCount - 1) + 1) 
      / peerAgentDefinition.stats.callCount;

    const skillOutcome = toPeerSkillOutcome(result, {
      quality: result.source === 'fallback' ? 'fallback' : 'model',
      reason: result.runtimeEnvelope?.businessState?.reason || null,
    });

    return {
      success: true,
      userVisible: result.message,
      runtimeEnvelope: result.runtimeEnvelope,
      internal: {
        core: {
          stage: 'discussion-completed',
          confidence: 0.8,
          isCompleted: true,
        },
        ext: {
          peer: {
            message: result.message,
            strategy: result.strategy,
            followUpQuestions: result.followUpQuestions || [],
            promptDebug: result.promptDebug || null,
            input: result.inputEcho || input,
            runtimeEnvelope: result.runtimeEnvelope,
            // 内部协议 sidecar；coordinator 继续读 message 等公开字段
            skillOutcome,
          }
        },
        strategy: result.strategy,
        followUpQuestions: result.followUpQuestions,
        output: result
      },
      renderHints: {
        component: 'peer-message',
        followUpQuestions: result.followUpQuestions || []
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: AGENT_ID,
        agentName: '伴学 Skill',
        agentType: 'teaching',
        confidence: 0.8,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error: any) {
    peerAgentDefinition.stats.callCount++;
    peerAgentDefinition.stats.successRate = 
      (peerAgentDefinition.stats.successRate * (peerAgentDefinition.stats.callCount - 1)) 
      / peerAgentDefinition.stats.callCount;

    return {
      success: false,
      userVisible: '同伴回复生成失败，请稍后重试。',
      error: {
        code: 'PEER_AGENT_FAILED',
        message: error?.message || 'PeerReinforcementSkill execution failed'
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: AGENT_ID,
        agentName: '伴学 Skill',
        agentType: 'teaching',
        confidence: 0,
        generatedAt: new Date().toISOString(),
      }
    };
  } finally {
    const duration = Date.now() - startTime;
    peerAgentDefinition.stats.avgLatency = 
      (peerAgentDefinition.stats.avgLatency * (peerAgentDefinition.stats.callCount - 1) + duration) 
      / peerAgentDefinition.stats.callCount;
  }
}
