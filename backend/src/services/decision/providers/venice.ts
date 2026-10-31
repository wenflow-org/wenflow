/**
 * Venice 的决策模型 provider（jev-latest）。
 *
 * 端点：POST https://api.venice.ai/api/v1/decisions
 * 鉴权：Authorization: Bearer <VENICE_INFERENCE_KEY_...>
 * 模型：body（默认 jev-latest；Venice 不存在 jev-preview，传错会 404 并提示 did you mean）。
 *
 * 注意：该端点按量计费，余额为零时返回 **HTTP 402**（不是 401/400），
 * 说明密钥与请求体都合法。缺省不放进 provider 顺序，需要显式启用。
 */

import { readPluginProviderField, readPluginProviderSecret } from '../../plugin-providers.service';
import type { DecisionCallOptions, DecisionProvider, DecisionProviderResult, DecisionRequest } from '../types';
import { postDecision } from './shared';

const DEFAULT_URL = 'https://api.venice.ai/api/v1/decisions';
const DEFAULT_MODEL = 'jev-latest';

export interface VeniceDecisionConfig {
  url: string;
  apiKey: string;
  model: string;
}

export function readVeniceDecisionConfig(): VeniceDecisionConfig {
  return {
    url: readPluginProviderField('decision', 'venice', 'url') || DEFAULT_URL,
    apiKey: readPluginProviderSecret('decision', 'venice'),
    model: readPluginProviderField('decision', 'venice', 'model') || DEFAULT_MODEL,
  };
}

export class VeniceDecisionProvider implements DecisionProvider {
  readonly id = 'venice' as const;
  private readonly config: VeniceDecisionConfig;

  constructor(config: VeniceDecisionConfig = readVeniceDecisionConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.url) && Boolean(this.config.apiKey);
  }

  async decide(request: DecisionRequest, options: DecisionCallOptions = {}): Promise<DecisionProviderResult> {
    return postDecision(
      {
        url: this.config.url,
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        model: request.model || this.config.model,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      },
      request
    );
  }
}
