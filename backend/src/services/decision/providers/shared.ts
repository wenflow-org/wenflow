/**
 * 决策 provider 共用逻辑：一次 POST + 答案归一化 + 错误收敛。
 *
 * 上游都遵循 SystemOne 槽位协议，差异只在「端点 / 鉴权 / 模型放哪（路径 or body） / 响应外包一层」。
 */

import { safeHttpRequest } from '../../../utils/safe-http';
import {
  DecisionError,
  type DecisionProviderResult,
  type DecisionRequest,
} from '../types';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface PostOptions {
  url: string;
  headers: Record<string, string>;
  /** 放进 body 的模型 id（Cloudflare 走路径，不需要） */
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** 把 question 转成上游要求的形状：id 不下发，语义写进 question/instructions。 */
export function buildQuestions(request: DecisionRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(request.questions ?? {})) {
    out[id] = {
      type: question.type,
      ...(question.question ? { question: question.question } : {}),
      ...(question.instructions ? { instructions: question.instructions } : {}),
      ...(question.criteria ? { criteria: question.criteria } : {}),
    };
  }
  return out;
}

/** 上游把答案放在根上或 result 下面，统一剥一层。 */
export function normalizeAnswers(raw: unknown): DecisionProviderResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const container = (obj.result && typeof obj.result === 'object' ? obj.result : obj) as Record<string, unknown>;
  const answers = container.answers;
  if (!answers || typeof answers !== 'object') {
    throw new DecisionError('DECISION_ALL_PROVIDERS_FAILED', '上游未返回 answers');
  }
  const usage = container.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  return {
    model: typeof container.model === 'string' ? container.model : '',
    answers: answers as DecisionProviderResult['answers'],
    ...(usage ? { usage } : {}),
  };
}

export async function postDecision(
  options: PostOptions,
  request: DecisionRequest
): Promise<DecisionProviderResult> {
  let response;
  try {
    response = await safeHttpRequest<unknown>(options.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: {
        ...(options.model ? { model: options.model } : {}),
        state: request.state,
        questions: buildQuestions(request),
      },
      timeoutMs: options.timeoutMs,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      privateNetworkPolicy: 'public-only',
      signal: options.signal,
    });
  } catch (error) {
    throw new DecisionError(
      'DECISION_ALL_PROVIDERS_FAILED',
      `决策上游请求失败：${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }

  if (response.status < 200 || response.status >= 300) {
    const detail =
      typeof response.data === 'object' && response.data
        ? JSON.stringify(response.data).slice(0, 200)
        : String(response.data ?? '').slice(0, 200);
    throw new DecisionError(
      'DECISION_ALL_PROVIDERS_FAILED',
      `决策上游返回 HTTP ${response.status}：${detail}`
    );
  }

  return normalizeAnswers(response.data);
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
