/**
 * 决策模型编排服务（外挂能力 decision-gate 的运行时入口）。
 *
 * 职责：校验入参 → 按 DECISION_PROVIDER 顺序逐个 provider 尝试 → 失败自动降级 →
 * 返回统一结构（含实际命中的 provider、尝试链与耗时）。
 *
 * 与 services/embedding 的分工：embedding 出向量（算相似度），decision 出**判定**（带类型的问题）。
 * 两者都不含存储，落盘/入库由消费方决定。
 *
 * 开关：DECISION_DISABLED=1 全局停用（调用方应 fail-open，不要阻塞主链路）。
 */

import { logger } from '../../utils/logger';
import {
  DecisionError,
  type DecisionCallOptions,
  type DecisionProviderId,
  type DecisionRequest,
  type DecisionResponse,
} from './types';
import { createDecisionProviders, resolveDecisionProviderOrder } from './providers';

const DEFAULT_TIMEOUT_MS = 8_000;

export function isDecisionEnabled(): boolean {
  return process.env.DECISION_DISABLED !== '1';
}

/** 至少有一个 provider 具备凭证；调用方可用它做「没配就跳过」的短路判断。 */
export function isDecisionConfigured(options: Pick<DecisionCallOptions, 'providerOrder'> = {}): boolean {
  const providers = createDecisionProviders();
  const order = options.providerOrder ?? resolveDecisionProviderOrder();
  return order.some((id) => providers[id]?.isConfigured());
}

function normalizeRequest(request: DecisionRequest): DecisionRequest {
  const state = request?.state;
  if (state === undefined || state === null || (typeof state === 'string' && !state.trim())) {
    throw new DecisionError('DECISION_REQUEST_INVALID', '决策请求缺少 state');
  }
  const questions = request?.questions;
  if (!questions || typeof questions !== 'object' || Object.keys(questions).length === 0) {
    throw new DecisionError('DECISION_REQUEST_INVALID', '决策请求缺少 questions');
  }
  return { ...request, state, questions };
}

export async function decide(
  request: DecisionRequest,
  options: DecisionCallOptions = {}
): Promise<DecisionResponse> {
  if (!isDecisionEnabled()) {
    throw new DecisionError('DECISION_DISABLED', '决策能力已停用（DECISION_DISABLED=1）');
  }
  const normalized = normalizeRequest(request);
  const providers = createDecisionProviders();
  const order = options.providerOrder ?? resolveDecisionProviderOrder();
  const timeoutMs = options.timeoutMs ?? Number(process.env.DECISION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  const attempts: DecisionProviderId[] = [];
  let lastError: unknown;

  for (const id of order) {
    const provider = providers[id];
    if (!provider || !provider.isConfigured()) continue;
    attempts.push(id);
    try {
      const result = await provider.decide(normalized, { ...options, timeoutMs });
      return {
        model: result.model,
        answers: result.answers,
        provider: id,
        attempts,
        latencyMs: Date.now() - startedAt,
        usage: result.usage,
      };
    } catch (error) {
      lastError = error;
      logger.warn('[decision] provider 调用失败，尝试降级', {
        provider: id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (attempts.length === 0) {
    throw new DecisionError(
      'DECISION_PROVIDER_NOT_CONFIGURED',
      '没有可用的决策 provider（请配置 DASHSCOPE_API_KEY；或 CF_ACCOUNT_ID/CF_TOKEN、DECISION_CUSTOM_URL）'
    );
  }

  throw new DecisionError(
    'DECISION_ALL_PROVIDERS_FAILED',
    `所有决策 provider 均调用失败（尝试：${attempts.join(' → ')}）`,
    lastError
  );
}
