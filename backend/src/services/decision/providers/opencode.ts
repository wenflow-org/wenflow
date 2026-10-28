/**
 * OpenCode Zen 的 SystemOne provider（jev-1.13-free）。
 *
 * 端点：POST https://opencode.ai/zen/v1/systemone
 * 鉴权：Authorization: Bearer public（匿名共享额度）
 * 模型：body（默认 jev-1.13-free）
 *
 * 免费但无文档、共享额度、延迟 0.38~1.24s，且只支持 choice/noul 两种问法（score 未实测）。
 * 缺省不放进 provider 顺序，作为零成本兜底显式启用。
 */

import { readPluginProviderField, readPluginProviderSecret } from '../../plugin-providers.service';
import type { DecisionCallOptions, DecisionProvider, DecisionProviderResult, DecisionRequest } from '../types';
import { postDecision } from './shared';

const DEFAULT_URL = 'https://opencode.ai/zen/v1/systemone';
const DEFAULT_MODEL = 'jev-1.13-free';

export interface OpencodeDecisionConfig {
  url: string;
  apiKey: string;
  model: string;
}

export function readOpencodeDecisionConfig(): OpencodeDecisionConfig {
  return {
    url: readPluginProviderField('decision', 'opencode', 'url') || DEFAULT_URL,
    apiKey: readPluginProviderSecret('decision', 'opencode'),
    model: readPluginProviderField('decision', 'opencode', 'model') || DEFAULT_MODEL,
  };
}

export class OpencodeDecisionProvider implements DecisionProvider {
  readonly id = 'opencode' as const;
  private readonly config: OpencodeDecisionConfig;

  constructor(config: OpencodeDecisionConfig = readOpencodeDecisionConfig()) {
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
