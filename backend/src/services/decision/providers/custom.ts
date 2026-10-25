/**
 * 自定义 SystemOne 兼容决策端点（不改代码接入自建部署）。
 *
 * 用途：在其它机器上自建的决策模型（laya 等）只要兼容 `{ state, questions } -> { answers }`，
 * 把地址/密钥/模型填进环境变量即可参与对比，不需要新增 provider 文件。
 *
 * 环境变量：
 *   DECISION_CUSTOM_URL        完整端点地址（必填）
 *   DECISION_CUSTOM_MODEL      模型 id（可选；写进 body）
 *   DECISION_CUSTOM_API_KEY    密钥（可选；无鉴权的本地部署可留空）
 *   DECISION_CUSTOM_AUTH_STYLE bearer（默认，`Authorization: Bearer <key>`）
 *                              | raw（`Authorization: <key>`，阿里云那类）
 *                              | header（`X-API-Key: <key>`）
 *
 * 响应形状：`{answers}` 或 `{result:{answers}}` 都能解析（见 providers/shared.ts）。
 */

import { readPluginProviderField, readPluginProviderSecret } from '../../plugin-providers.service';
import type { DecisionCallOptions, DecisionProvider, DecisionProviderResult, DecisionRequest } from '../types';
import { postDecision } from './shared';

export interface CustomDecisionConfig {
  url: string;
  model: string;
  apiKey: string;
  authStyle: 'bearer' | 'raw' | 'header';
}

export function readCustomDecisionConfig(): CustomDecisionConfig {
  const authStyleRaw = (readPluginProviderField('decision', 'custom', 'authStyle') || 'bearer').trim().toLowerCase();
  return {
    url: readPluginProviderField('decision', 'custom', 'url'),
    model: readPluginProviderField('decision', 'custom', 'model'),
    apiKey: readPluginProviderSecret('decision', 'custom'),
    authStyle: authStyleRaw === 'raw' || authStyleRaw === 'header' ? authStyleRaw : 'bearer',
  };
}

export class CustomDecisionProvider implements DecisionProvider {
  readonly id = 'custom' as const;
  private readonly config: CustomDecisionConfig;

  constructor(config: CustomDecisionConfig = readCustomDecisionConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.url);
  }

  async decide(request: DecisionRequest, options: DecisionCallOptions = {}): Promise<DecisionProviderResult> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      if (this.config.authStyle === 'header') headers['X-API-Key'] = this.config.apiKey;
      else if (this.config.authStyle === 'raw') headers.Authorization = this.config.apiKey;
      else headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return postDecision(
      {
        url: this.config.url,
        headers,
        model: request.model || this.config.model || undefined,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      },
      request
    );
  }
}
