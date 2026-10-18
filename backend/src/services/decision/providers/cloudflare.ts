/**
 * Cloudflare Workers AI 的 Clef 决策模型 provider。
 *
 * 端点：POST https://api.cloudflare.com/client/v4/accounts/<account>/ai/run/<model>
 * 鉴权：Authorization: Bearer <cf token>
 * 模型：写在**路径**里，body 不带 model。
 *
 * 三档（2026-10-18 目录价，均按输入 token 计）：
 *   @cf/cloudflare/clef-flash  9B  24,576 ctx  $0.038/M
 *   @cf/cloudflare/clef-omni   30B MoE(3B active) 65,536 ctx  $0.15/M
 *   @cf/cloudflare/clef        27B 65,536 ctx  $0.24/M
 * 默认 clef-omni：同批可答性样本上准确率接近 27B 且延迟最低（0.28~0.31s）。
 */

import type { DecisionCallOptions, DecisionProvider, DecisionProviderResult, DecisionRequest } from '../types';
import { postDecision } from './shared';

const DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';
const DEFAULT_MODEL = '@cf/cloudflare/clef-omni';

export interface CloudflareDecisionConfig {
  accountId: string;
  token: string;
  baseUrl: string;
  model: string;
}

export function readCloudflareDecisionConfig(): CloudflareDecisionConfig {
  return {
    accountId: (process.env.CF_ACCOUNT_ID || process.env.CF_ACCT || '').trim(),
    token: (process.env.CF_TOKEN || '').trim(),
    baseUrl: (process.env.CF_AI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    model: (process.env.CF_DECISION_MODEL || DEFAULT_MODEL).trim(),
  };
}

export class CloudflareDecisionProvider implements DecisionProvider {
  readonly id = 'cloudflare' as const;
  private readonly config: CloudflareDecisionConfig;

  constructor(config: CloudflareDecisionConfig = readCloudflareDecisionConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.accountId) && Boolean(this.config.token);
  }

  async decide(request: DecisionRequest, options: DecisionCallOptions = {}): Promise<DecisionProviderResult> {
    const model = request.model || this.config.model;
    return postDecision(
      {
        url: `${this.config.baseUrl}/accounts/${this.config.accountId}/ai/run/${model}`,
        headers: { Authorization: `Bearer ${this.config.token}` },
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      },
      request
    );
  }
}
