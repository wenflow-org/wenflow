/**
 * Admin · Token 成本统计（P1：LLM 用量与成本透视）
 * ============================================================
 * 数据源：agent_call_logs 单表，token 归因如下（2026-08 实测确认）：
 * - 带 token 的行全部由 api-gateway 层写入（executionLayer='api-gateway'），
 *   token 在 tokensUsed/promptTokens/completionTokens 列；
 *   skill 归因在 metadata.skillId（JSON），user 归因在 userId 列，model 归因在 model 列。
 * - skill 层行（agentId='skill:xxx'）不带 token（tokensUsed 恒空），仅贡献调用/失败计数。
 *
 * 因此口径：
 * - token 排行：取 executionLayer='api-gateway' 且 tokensUsed>0 的行，
 *   per-skill 用 metadata.skillId，per-user 用 userId，per-model 用 model；
 *   无 skillId 的（金丝雀探活等）归入「未归因」。
 * - 调用/失败计数：全量行（skill 层 + gateway 层），真实用户/全量双口径。
 *
 * 端点：
 *   GET /api/admin/token-cost/summary?days=7&includeTest=0|1
 *   GET /api/admin/token-cost/by-skill?days=7&includeTest=0|1
 *   GET /api/admin/token-cost/by-user?days=7&includeTest=0|1&limit=20&q=<关键词>
 *   GET /api/admin/token-cost/by-model?days=7&includeTest=0|1
 */

import express, { Request, Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { listAgentManifest } from '../../services/agent-manifest.service';
import {
  accumulateCost,
  createCostBucket,
  describePricingStatus,
  type CostBucket,
  type PricingStatus,
} from '../../services/cost/call-cost-aggregation';
import {
  resolveRealUserIds,
  aggregateWindow,
  aggregateTokenGroups,
  listUsersBasicInfo,
} from '../../services/cost/token-cost.service';
import { logger } from '../../utils/logger';
import { dayKeyOf, addDaysToDayKey, parseDayKeyStart } from '../../services/time/day-boundary';

const router = express.Router();
router.use(authMiddleware);

/** agentId / skillId → 可读名映射（manifest 单点；未收录原样展示） */
function buildAgentNameMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of listAgentManifest()) {
    map[item.id] = item.name;
    for (const alias of item.aliases || []) {
      map[alias] = item.name;
    }
  }
  return map;
}

const agentNameMap = buildAgentNameMap();

export function agentDisplayName(agentId: string): string {
  const known = agentNameMap[agentId];
  if (known) return known;
  if (agentId.startsWith('skill:')) return agentId.slice(6);
  return agentId;
}

/** 解析天数参数：默认 7，限 1-90 */
function parseDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 7;
  return Math.min(Math.floor(n), 90);
}

function parseIncludeTest(raw: unknown): boolean {
  return raw === '1' || raw === 'true';
}

export function parseMetadataSkillId(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    const skillId = parsed?.skillId;
    return typeof skillId === 'string' && skillId ? skillId : null;
  } catch {
    return null;
  }
}

/** 排行条目：沿用既有 token 字段，附加成本字段（usd=null 表示单价未配置，不用 0 冒充） */
interface RankEntry extends CostBucket {
  key: string;
  display: string;
  tokens: number;
  failed: number;
}

/* 计算结果缓存：4 个端点共用的 loadTokenData 是全量聚合（全表扫 agent_call_logs），
   页面并发请求 summary/by-skill/by-user/by-model 会把它重复执行 4 遍（实测 3.7 万行 ×4 ≈ 10s）。
   加 5min TTL 内存缓存（key = days + includeTest）：并发 4 请求只计算 1 次，其余秒回。
   数据的写入路径不在本路由（api-gateway 落库），TTL 内新调用延迟 5min 可见属可接受口径延迟（分析页非操作面）。 */
/* 2026-10-01 性能批次：TTL 30s→5min。全表聚合冷载实测 3.9s（4 万+ 行物化+解析），
   页面 4 端点并发共享本缓存；分析页非操作面，5min 口径延迟可接受（与 spans 300s 同先例），
   换取 5 分钟内重复进入秒回。 */
const TOKEN_CACHE_TTL_MS = 300_000;

interface TokenDataResult {
  totals: CostBucket & { tokens: number; failed: number };
  trend: Array<{ date: string; tokens: number; calls: number; failed: number }>;
  bySkill: RankEntry[];
  byUser: RankEntry[];
  byModel: RankEntry[];
  /** 已出现模型的单价配置状态（运维补价清单） */
  pricingStatus: PricingStatus;
}

const tokenCache = new Map<string, { expires: number; data: TokenDataResult }>();
/** in-flight 去重：并发 4 请求首载时共享同一个计算 Promise,只跑一次全表聚合 */
const tokenInflight = new Map<string, Promise<TokenDataResult>>();

function cacheKey(days: number, includeTest: boolean): string {
  return `${days}:${includeTest ? 1 : 0}`;
}

async function loadTokenDataCached(days: number, includeTest: boolean): Promise<TokenDataResult> {
  const key = cacheKey(days, includeTest);
  const hit = tokenCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;

  // 已有同 key 计算在途 → 复用（首载 4 并发只触发一次全表聚合）
  const inflight = tokenInflight.get(key);
  if (inflight) return inflight;

  const promise = loadTokenData(days, includeTest).then((data) => {
    tokenCache.set(key, { expires: Date.now() + TOKEN_CACHE_TTL_MS, data });
    // 防堆积：仅清理过期项（数量级极小，无需定时器）
    for (const [k, v] of tokenCache) {
      if (v.expires <= Date.now()) tokenCache.delete(k);
    }
    return data;
  });
  tokenInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    tokenInflight.delete(key);
  }
}

/** 测试钩子：清空缓存（jest beforeEach 使用，避免用例间缓存污染） */
export function __clearTokenCacheForTests(): void {
  tokenCache.clear();
  tokenInflight.clear();
}

/**
 * 启动预热（2026-10-04 页面加载性能批）：SQL 聚合改造后冷载仍需读 ~100MB
 * metadata（7 天窗 8.4 万 token 行，json_extract 在 C 层取值）——在启动后台
 * 空转时先算一次默认口径（7d/仅真实），首访成本分析页直接命中 TTL 缓存。
 * 失败静默：用户访问时自然重算（口径/新鲜度约束不变）。
 */
export function warmTokenCostCache(): Promise<TokenDataResult> {
  return loadTokenDataCached(7, false);
}

/**
 * 统一数据加载（2026-10-04 SQL 聚合改造）：
 * 原实现外拉 17.5 万全量行 + 8.4 万 token 行（metadata ~100MB 逐行 JSON.parse）到 JS 聚合，
 * 冷载实测 28.5s。现改由 SQL 端聚合：
 * - aggregateTokenGroups：skillId × userId × model 分组（组基数 ~4k），json_extract 在 C 层取值；
 * - aggregateWindow：总量一次 + 每个本地日一个小窗（calledAt 索引），一次扫出 调用/失败/token；
 * JS 侧只做装配（组级合计经 accumulateCost(rowCount) 累加，语义与逐行一致，见该函数注释）。
 */
async function loadTokenData(days: number, includeTest: boolean) {
  const since = new Date(Date.now() - days * 86400000);
  const realUserIds = includeTest ? null : await resolveRealUserIds();
  const sinceMs = since.getTime();

  // 日标签按**应用时区本地日**（day-boundary），与学习侧日界/前端 localDateKey 同口径；
  // trend 只含最近 days 个整本地日——窗口头部不足一日的行只进总量（与原逐行
  // dayKeyOf + daily.get 命不中即跳过的行为一致）
  const todayKey = dayKeyOf(new Date());
  const dayLabels: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    dayLabels.push(addDaysToDayKey(todayKey, -i));
  }

  const [windowTotals, tokenGroups, ...dayAggregates] = await Promise.all([
    aggregateWindow(sinceMs, null, realUserIds),
    aggregateTokenGroups(sinceMs, realUserIds),
    ...dayLabels.map((label) => {
      const fromMs = parseDayKeyStart(label).getTime();
      const toMs = parseDayKeyStart(addDaysToDayKey(label, 1)).getTime();
      return aggregateWindow(fromMs, toMs, realUserIds);
    }),
  ]);

  // —— token 维度排行（组级装配：每组合计视作一行、行数 = calls）——
  const skillMap = new Map<string, RankEntry>();
  const userMap = new Map<string, RankEntry>();
  const modelMap = new Map<string, RankEntry>();
  let totalTokens = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;
  const costTotals = createCostBucket();

  for (const g of tokenGroups) {
    totalTokens += g.tokens;
    totalPrompt += g.promptTokens;
    totalCompletion += g.completionTokens;

    // 成本输入只有 model/prompt/completion（无缓存明细 → cachedTokens 恒 0，与原实现一致）
    const costRow = { model: g.model ?? '', promptTokens: g.promptTokens, completionTokens: g.completionTokens };
    const triples: Array<[Map<string, RankEntry>, string, string]> = [
      [skillMap, g.skillId || '未归因', agentDisplayName(g.skillId || '未归因')],
      [userMap, g.userId || '未归因', g.userId || '未归因'],
      [modelMap, g.model || '未归因', g.model || '未归因'],
    ];
    for (const [map, key, display] of triples) {
      const e = map.get(key) || { key, display, tokens: 0, failed: 0, ...createCostBucket() };
      e.tokens += g.tokens;
      e.failed += g.failed;
      accumulateCost(e, costRow, undefined, g.calls);
      map.set(key, e);
    }
    accumulateCost(costTotals, costRow, undefined, g.calls);
  }

  // 单价配置状态：已出现模型（组级去重同口径）
  const pricingStatus = describePricingStatus(tokenGroups.map((g) => g.model));

  const sortByTokens = (map: Map<string, RankEntry>) => [...map.values()].sort((a, b) => b.tokens - a.tokens);

  return {
    totals: {
      tokens: totalTokens,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      // 调用/失败：窗口全量行口径（含 skill 层），与改造前 callRows.length 一致
      calls: windowTotals.calls,
      failed: windowTotals.failed,
      // 成本字段（语义不变）：usd=null 表示无已定价调用；pricingKnown 为 false 时金额不完整
      usd: costTotals.usd,
      pricingKnown: costTotals.pricingKnown,
      callsMissingPricing: costTotals.callsMissingPricing,
      pricedCalls: costTotals.pricedCalls,
    },
    trend: dayLabels.map((label, i) => ({
      date: label,
      tokens: dayAggregates[i]?.tokens ?? 0,
      calls: dayAggregates[i]?.calls ?? 0,
      failed: dayAggregates[i]?.failed ?? 0,
    })),
    bySkill: sortByTokens(skillMap),
    byUser: sortByTokens(userMap),
    byModel: sortByTokens(modelMap),
    pricingStatus,
  };
}

/**
 * GET /api/admin/token-cost/summary?days=7&includeTest=0|1
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const days = parseDays(req.query.days);
    const includeTest = parseIncludeTest(req.query.includeTest);
    const data = await loadTokenDataCached(days, includeTest);
    res.json({
      success: true,
      // 响应顶层：运维据此定位待补单价的模型（configuredModels / missingPricingModels）
      pricingStatus: data.pricingStatus,
      data: {
        days,
        includeTest,
        totals: data.totals,
        trend: data.trend,
      },
    });
  } catch (error: any) {
    logger.error('token-cost summary 失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/token-cost/by-skill?days=7&includeTest=0|1
 */
router.get('/by-skill', async (req: Request, res: Response) => {
  try {
    const days = parseDays(req.query.days);
    const includeTest = parseIncludeTest(req.query.includeTest);
    const data = await loadTokenDataCached(days, includeTest);
    res.json({ success: true, pricingStatus: data.pricingStatus, data: { days, includeTest, items: data.bySkill } });
  } catch (error: any) {
    logger.error('token-cost by-skill 失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/token-cost/by-user?days=7&includeTest=0|1&limit=20&q=<关键词>
 * q（D13，2026-10-05）：按 用户ID / 昵称 / 邮箱 过滤（大小写不敏感），先在全量 byUser 上过滤再取 limit；
 * 无 q 时保持原行为（只 enrich Top-limit，避免无谓的全量用户信息查询）。
 */
router.get('/by-user', async (req: Request, res: Response) => {
  try {
    const days = parseDays(req.query.days);
    const includeTest = parseIncludeTest(req.query.includeTest);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const data = await loadTokenDataCached(days, includeTest);

    // D13：搜索需覆盖全量用户（只 enrich Top-N 会让中小用户按昵称/邮箱搜不到）
    const pool = q ? data.byUser : data.byUser.slice(0, limit);
    const ids = pool.map((r) => r.key).filter((k) => k !== '未归因');
    const users = ids.length
      ? await listUsersBasicInfo(ids)
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const enriched = pool.map((r) => {
      const u = userMap.get(r.key);
      return { ...r, name: u?.name || null, email: u?.email || null };
    });
    const matched = q
      ? enriched.filter((r) =>
          r.key.toLowerCase().includes(q)
          || (r.name ? r.name.toLowerCase().includes(q) : false)
          || (r.email ? r.email.toLowerCase().includes(q) : false),
        )
      : enriched;
    const items = matched.slice(0, limit);

    res.json({ success: true, pricingStatus: data.pricingStatus, data: { days, includeTest, items } });
  } catch (error: any) {
    logger.error('token-cost by-user 失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/token-cost/by-model?days=7&includeTest=0|1
 */
router.get('/by-model', async (req: Request, res: Response) => {
  try {
    const days = parseDays(req.query.days);
    const includeTest = parseIncludeTest(req.query.includeTest);
    const data = await loadTokenDataCached(days, includeTest);
    res.json({ success: true, pricingStatus: data.pricingStatus, data: { days, includeTest, items: data.byModel } });
  } catch (error: any) {
    logger.error('token-cost by-model 失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
