/**
 * 插件 provider 连通性探测（2026-11-07 用户「每个 provider 给一个测试」）。
 *
 * 背景：配置弹窗里改了端点 / 密钥后，运营只能靠「保存 → 等主流程报错 → 查日志」确认是否可用。
 * 这里提供一个只探测**单个** provider 的入口：不进降级链、失败不降级，直接把上游的真实
 * 响应（条数 / 延迟 / 错误原文）回给弹窗。
 *
 * 边界：
 * - 只探测链上/目录里存在的 provider，未知 id 直接 400（由路由层校验）。
 * - 联网的搜索/抓取各用一次最小请求（搜索 1 条、抓取 example.com 一页）；
 *   决策用一个必然可判的 noul 问题。
 * - 生图**不真的生成**：单张约 10s 且按张计费，测试按钮不该产生费用。
 *   它的探测只校验「地址 + 密钥」是否就位，detail 里写明这一点，不谎称已验证链路。
 */

import { getPluginConfigDef, type PluginConfigId } from '../config/plugin-providers';
import { logger } from '../utils/logger';
import { createDecisionProviders } from './decision/providers';
import type { DecisionProvider } from './decision/types';
import { createFetchProviders } from './fetch/providers';
import type { FetchProvider } from './fetch/types';
import { createImageProviders } from './image/providers';
import type { ImageProvider } from './image/types';
import { createSearchProviders } from './search/providers';
import type { SearchProvider } from './search/types';

/* 各 provider 注册表的键是联合字面量，而这里是「目录里声明的任意 id」——
   先按宽表取实例再判空：目录与注册表不同步（某构建没实现某家）时要报错，不能静默通过。 */
const asTable = <T>(table: object): Record<string, T | undefined> => table as Record<string, T | undefined>;

export interface PluginProbeResult {
  ok: boolean;
  /** 探测到的客观读数（成功时是人类可读的条数/延迟提示；失败时是上游原文） */
  detail: string;
  latencyMs: number;
}

const PROBE_TIMEOUT_MS = 15_000;

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function probeSearch(providerId: string): Promise<string> {
  const provider = asTable<SearchProvider>(createSearchProviders())[providerId];
  if (!provider) throw new Error(`该构建没有实现 ${providerId}`);
  const res = await provider.search(
    { query: 'wenflow connectivity probe', maxResults: 1 },
    { timeoutMs: PROBE_TIMEOUT_MS },
  );
  return `搜索可达，返回 ${res.results.length} 条`;
}

async function probeFetch(providerId: string): Promise<string> {
  const provider = asTable<FetchProvider>(createFetchProviders())[providerId];
  if (!provider) throw new Error(`该构建没有实现 ${providerId}`);
  const res = await provider.fetch({ urls: ['https://example.com'] }, { timeoutMs: PROBE_TIMEOUT_MS });
  const got = res.results.length;
  if (got === 0) {
    throw new Error(res.errors[0]?.message || '抓取未返回内容');
  }
  return `抓取可达，返回 ${got} 页`;
}

async function probeDecision(providerId: string): Promise<string> {
  const provider = asTable<DecisionProvider>(createDecisionProviders())[providerId];
  if (!provider) throw new Error(`该构建没有实现 ${providerId}`);
  const res = await provider.decide(
    {
      state: '这段话是中文。',
      questions: { probe: { type: 'noul', instructions: '这段文字是否为中文？' } },
    },
    { timeoutMs: PROBE_TIMEOUT_MS },
  );
  const answer = res.answers?.probe;
  return `判定可达，模型 ${res.model}${answer?.noul !== undefined ? `，概率 ${answer.noul}` : ''}`;
}

function probeImage(providerId: string): string {
  const provider = asTable<ImageProvider>(createImageProviders())[providerId];
  if (!provider) throw new Error(`该构建没有实现 ${providerId}`);
  // 不发起真实生成（按张计费，单张约 10s），只确认调用条件齐备
  if (!provider.isConfigured()) throw new Error('地址或密钥未配置');
  return '地址与密钥已就位（未实际生成，避免计费）';
}

/**
 * 探测一个 provider。失败时 ok=false 且 detail 带上游原文——调用方直接展示，
 * 不再二次包装（网关 / 额度 / 鉴权三类错误长得很不一样，包装只会把线索抹掉）。
 */
export async function probePluginProvider(
  pluginId: PluginConfigId,
  providerId: string,
): Promise<PluginProbeResult> {
  const def = getPluginConfigDef(pluginId);
  if (!def.providers.some((p) => p.id === providerId)) {
    throw new Error(`未知 provider：${pluginId}/${providerId}`);
  }
  const startedAt = Date.now();
  try {
    let detail: string;
    if (pluginId === 'web') {
      // 联网的 provider 同时服务搜索与抓取两条链：地址分开配，两条都探一次才说明得了「能用」
      detail = await probeSearch(providerId);
      detail += `；${await probeFetch(providerId)}`;
    } else if (pluginId === 'decision') {
      detail = await probeDecision(providerId);
    } else {
      detail = probeImage(providerId);
    }
    return { ok: true, detail, latencyMs: Date.now() - startedAt };
  } catch (error) {
    logger.warn('[plugin-probe] provider 探测失败', {
      pluginId,
      providerId,
      error: errorText(error),
    });
    return { ok: false, detail: errorText(error), latencyMs: Date.now() - startedAt };
  }
}