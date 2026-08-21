/**
 * PeerReinforcementSkill - 伴学 Skill
 * 在教学主链判断学生需要强化时，提供同伴式讨论补强能力
 */

import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { PromptCallSpec } from '../../composers/types';
import { logger } from '../../utils/logger';
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
        enum: ['feynman', 'debate', 'counterexample', 'analogy', 'error-analysis'],
        description: '伴学策略'
      },
      studentMessage: { type: 'string', description: '学生最新消息' },
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
      understanding: { type: 'number', description: '学生理解度 (0-1)' }
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
  strategy: 'feynman' | 'debate' | 'counterexample' | 'analogy' | 'error-analysis';
  studentMessage?: string;
  tutorContext: Array<{ role: string; content: string }>;
  cognitiveLevel?: string;
  understanding?: number;
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
  };

  return strategyPrompts[strategy] || strategyPrompts.feynman;
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

  const understandingSection = typeof input.understanding === 'number'
    ? `\n【理解度】${input.understanding}`
    : '';

  return `请生成一段同伴讨论消息：
【主题】${input.topic}
【策略】${input.strategy}
【策略要求】${getStrategyInstruction(input.strategy)}
【学生认知层级】${input.cognitiveLevel || 'understand'}${understandingSection}${contextSection}${peerHistorySection}${studentMessageSection}`;
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

const peerPromptSpec: PromptCallSpec<PeerDiscussionInput, PeerModelArtifact> = {
  agentId: AGENT_ID,
  defaultSystemPrompt: PEER_REINFORCEMENT_PROMPT,
  requireActivePrompt: true,
  caller: {
    agentId: 'teaching-agent',
    skillId: 'peer-reinforcement',
  },
  buildUserPayload: (input) => buildPeerUserPayload(input),
  validateParsedOutput: (parsed) => validatePeerParsedOutput(parsed),
  normalizeOutput: (parsed) => normalizePeerParsedOutput(parsed),
  mapEnvelope: (output, input, runtimeContract) => adaptToRuntimeEnvelope({
    contract: runtimeContract,
    artifact: {
      message: output.message,
      strategy: input.strategy,
      followUpQuestions: output.followUpQuestions,
    },
    phase: 'discussion-generated',
    status: 'succeeded',
    isTerminal: false,
    nextAction: 'continue-discussion',
    nextState: {
      stage: 'discussion-generated',
      strategy: input.strategy,
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

    logger.info(`[PeerReinforcementSkill] 生成讨论消息：strategy=${input.strategy}, topic=${input.topic}`);

    result = {
      message,
      strategy: input.strategy,
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
