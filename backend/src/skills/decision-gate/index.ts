/**
 * 决策闸门 Skill（外挂能力，handler-only / 无 LLM prompt）。
 *
 * 定位：把 services/decision 的 provider 抽象（Cloudflare Clef / 阿里云 MaaS / Venice / OpenCode Zen
 * + 降级链）暴露为统一 Skill 入口，供 Capability Runtime、管理端测试台与资料链路调用。
 *
 * 与 web-search 的形态完全对齐：无 prompt、无 DB 直读、配置全部走环境变量：
 *   DECISION_PROVIDER         provider 顺序（默认 cloudflare,alibaba）
 *   DECISION_DISABLED=1       全局停用
 *   CF_ACCOUNT_ID / CF_TOKEN  Cloudflare Workers AI
 *   DASHSCOPE_API_KEY         阿里云 MaaS
 *   VENICE_API_KEY            Venice（需余额）
 *   SYSTEMONE_API_KEY         OpenCode Zen（默认 public）
 *
 * 能做什么 / 不能做什么：
 *   能 —— choice（多选一带概率）、noul（0~1）、score（有序分级）；适合可用性、可答性、覆盖度、分级。
 *   不能 —— 生成文本，因此不能做资料抽取（tldr / sections / keyPoints）。
 */

import {
  decide,
  isDecisionConfigured,
  isDecisionEnabled,
  type DecisionAnswer,
  type DecisionRequest,
} from '../../services/decision';
import type { SkillDefinition, SkillExecutionResult } from '../protocol';

export interface DecisionGateInput {
  /** 待判定材料：字符串或结构化对象 */
  state: string | Record<string, unknown>;
  /** 带类型的问题；id 不会下发模型，语义请写进 question/instructions */
  questions: DecisionRequest['questions'];
  /** 覆盖默认模型（一般不传） */
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DecisionGateOutput {
  model: string;
  answers: Record<string, DecisionAnswer>;
  provider: string;
  attempts: string[];
  latencyMs: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export const decisionGateDefinition: SkillDefinition = {
  name: 'decision-gate',
  displayName: '决策闸门 Skill',
  version: '1.0.0',
  category: 'analysis',
  description: '调用外部决策模型（Clef / jev 系），把一段材料与一组带类型的问题转成概率化判定（choice/noul/score）',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', description: '待判定材料（字符串或对象：材料正文、目标主题、标题、URL）', required: true },
      questions: { type: 'object', description: '问题表：{ id: { type: choice|noul|score, question?, instructions?, criteria? } }', required: true },
      model: { type: 'string', description: '覆盖 provider 默认模型（一般不传）' },
      timeoutMs: { type: 'number', description: '单次调用超时（默认 8000ms）' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      model: { type: 'string' },
      answers: { type: 'object', description: '问题 id → { type, choice?, noul?, score?, confidence?, probabilities? }' },
      provider: { type: 'string' },
      attempts: { type: 'array' },
      latencyMs: { type: 'number' },
      usage: { type: 'object' },
    },
  },
  capabilities: ['typed-decision', 'probability', 'provider-fallback', 'material-quality'],
  stats: { callCount: 0, successRate: 1, avgLatency: 0 },
};

const DECISION_GATE_ERROR_MESSAGES: Record<string, string> = {
  DECISION_DISABLED: '决策能力已停用（DECISION_DISABLED=1）',
  DECISION_REQUEST_INVALID: '决策请求无效（state 与 questions 均为必填）',
  DECISION_PROVIDER_NOT_CONFIGURED: '决策 provider 未配置（请配置 CF_ACCOUNT_ID/CF_TOKEN 或 DASHSCOPE_API_KEY）',
  DECISION_ALL_PROVIDERS_FAILED: '所有决策 provider 均调用失败',
};

export async function executeDecisionGate(
  input: DecisionGateInput
): Promise<SkillExecutionResult<DecisionGateOutput>> {
  const startedAt = Date.now();

  if (!isDecisionEnabled()) {
    return {
      success: false,
      error: { code: 'DECISION_DISABLED', message: DECISION_GATE_ERROR_MESSAGES.DECISION_DISABLED },
      duration: Date.now() - startedAt,
    };
  }
  if (!isDecisionConfigured()) {
    return {
      success: false,
      error: {
        code: 'DECISION_PROVIDER_NOT_CONFIGURED',
        message: DECISION_GATE_ERROR_MESSAGES.DECISION_PROVIDER_NOT_CONFIGURED,
      },
      duration: Date.now() - startedAt,
    };
  }

  try {
    const response = await decide(
      { state: input?.state, questions: input?.questions, model: input?.model },
      { timeoutMs: input?.timeoutMs, signal: input?.signal }
    );
    return {
      success: true,
      output: {
        model: response.model,
        answers: response.answers,
        provider: response.provider,
        attempts: response.attempts,
        latencyMs: response.latencyMs,
        usage: response.usage,
      },
      duration: Date.now() - startedAt,
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'DECISION_ALL_PROVIDERS_FAILED';
    return {
      success: false,
      error: {
        code,
        message:
          DECISION_GATE_ERROR_MESSAGES[code]
          || (error instanceof Error ? error.message : DECISION_GATE_ERROR_MESSAGES.DECISION_ALL_PROVIDERS_FAILED),
      },
      duration: Date.now() - startedAt,
    };
  }
}
