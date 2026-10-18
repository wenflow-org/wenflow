/**
 * 阿里云 MaaS 部署的决策模型 provider（SystemOne 槽位协议）。
 *
 * 端点：POST <DASHSCOPE_DECISION_URL>（默认 = 私有部署域名的 /compatible-mode/v1/systemone）
 * 鉴权：Authorization: <key>（**不带 Bearer**，实测如此）
 * 模型：写在 body（默认 decision-model-preview）。
 *
 * 特点：目前实测最快的路径（服务端自报 42~49ms、端到端 90~300ms）。
 * 已知短板：对同义改写不敏感，一条「您只需负责操作系统」问 IaaS 的材料被判 0.21。
 * 因此默认顺序把 cloudflare 放在前面，它是质量更稳的一档。
 */

import type { DecisionCallOptions, DecisionProvider, DecisionProviderResult, DecisionRequest } from '../types';
import { postDecision } from './shared';

const DEFAULT_URL = 'https://ws-j2djr3yj51rhlwmw.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone';
const DEFAULT_MODEL = 'decision-model-preview';

export interface AlibabaDecisionConfig {
  url: string;
  apiKey: string;
  model: string;
}

export function readAlibabaDecisionConfig(): AlibabaDecisionConfig {
  return {
    url: (process.env.DASHSCOPE_DECISION_URL || DEFAULT_URL).trim(),
    apiKey: (process.env.DASHSCOPE_API_KEY || '').trim(),
    model: (process.env.DASHSCOPE_DECISION_MODEL || DEFAULT_MODEL).trim(),
  };
}

export class AlibabaDecisionProvider implements DecisionProvider {
  readonly id = 'alibaba' as const;
  private readonly config: AlibabaDecisionConfig;

  constructor(config: AlibabaDecisionConfig = readAlibabaDecisionConfig()) {
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.url) && Boolean(this.config.apiKey);
  }

  async decide(request: DecisionRequest, options: DecisionCallOptions = {}): Promise<DecisionProviderResult> {
    return postDecision(
      {
        url: this.config.url,
        headers: { Authorization: this.config.apiKey },
        model: request.model || this.config.model,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      },
      request
    );
  }
}
