/**
 * 决策 provider 注册表（顺序即降级链）。
 *
 * DECISION_PROVIDER 未设时默认 `alibaba`：
 *   - 阿里云 MaaS 部署实测最快（90~300ms）且当前可用；
 *   - cloudflare 已实测可用但有额度/可用性问题（2026-10-18 用户反馈停用），需显式启用；
 *   - venice 需余额；opencode 是共享免费额度；custom 用于自建部署（laya 等）。
 */

import type { DecisionProvider, DecisionProviderId } from '../types';
import { readPluginChannelOrder } from '../../plugin-providers.service';
import { AlibabaDecisionProvider } from './alibaba';
import { CloudflareDecisionProvider } from './cloudflare';
import { VeniceDecisionProvider } from './venice';
import { OpencodeDecisionProvider } from './opencode';
import { CustomDecisionProvider } from './custom';

export const IMPLEMENTED_DECISION_PROVIDERS: readonly DecisionProviderId[] = [
  'alibaba',
  'custom',
  'cloudflare',
  'venice',
  'opencode',
];

export const DEFAULT_DECISION_PROVIDER_ORDER: readonly DecisionProviderId[] = ['alibaba'];

export function createDecisionProviders(): Record<DecisionProviderId, DecisionProvider> {
  return {
    alibaba: new AlibabaDecisionProvider(),
    custom: new CustomDecisionProvider(),
    cloudflare: new CloudflareDecisionProvider(),
    venice: new VeniceDecisionProvider(),
    opencode: new OpencodeDecisionProvider(),
  };
}

/** 优先级：平台保存的顺序 → 环境变量 → 默认（与联网两通道同判例） */
export function resolveDecisionProviderOrder(): DecisionProviderId[] {
  const configured = readPluginChannelOrder('decision', 'decision').filter(
    (id): id is DecisionProviderId => IMPLEMENTED_DECISION_PROVIDERS.includes(id as DecisionProviderId)
  );
  if (configured.length) return configured;
  return [...DEFAULT_DECISION_PROVIDER_ORDER];
}
