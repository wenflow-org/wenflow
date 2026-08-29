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
 *   GET /api/admin/token-cost/by-user?days=7&includeTest=0|1&limit=20
 *   GET /api/admin/token-cost/by-model?days=7&includeTest=0|1
 */

import express, { Request, Response } from 'express';
import prisma from '../../config/database';
import { authMiddleware } from '../../middleware/auth.middleware';
import { REAL_USER_WHERE as REAL_USER_WHERE_UTILS } from '../../utils/test-account';
import { listAgentManifest } from '../../services/agent-manifest.service';
import { logger } from '../../utils/logger';

const router = express.Router();
router.use(authMiddleware);

/** 真实用户过滤：虚拟/测试账号排除 + 软删排除（与 platform.ts 同口径） */
const REAL_USER_WHERE = {
  ...REAL_USER_WHERE_UTILS,
  deletedAt: null,
};

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

async function resolveRealUserIds(): Promise<string[]> {
  const ids = (await prisma.users.findMany({ where: REAL_USER_WHERE, select: { id: true } })).map((u) => u.id);
  return ids;
}

interface RankEntry {
  key: string;
  display: string;
  tokens: number;
  calls: number;
  failed: number;
}

/**
 * 统一数据加载：
 * - tokenRows：带 token 的 gateway 行（含 metadata.skillId 解析）
 * - callRows：全量行（调用/失败计数）
 * 返回按维度聚合好的排行 + 总量 + 按天趋势。
 */
async function loadTokenData(days: number, includeTest: boolean) {
  const since = new Date(Date.now() - days * 86400000);
  const realUserIds = includeTest ? null : await resolveRealUserIds();
  // userId 过滤：真实用户口径时排除虚拟/测试（userId 不在真实集合 → 剔除；null/孤儿同样剔除）
  const userScope = realUserIds ? { userId: { in: realUserIds } } : {};

  const [tokenRows, callRows] = await Promise.all([
    prisma.agent_call_logs.findMany({
      where: { executionLayer: 'api-gateway', tokensUsed: { gt: 0 }, calledAt: { gte: since }, ...userScope },
      select: { metadata: true, userId: true, model: true, tokensUsed: true, promptTokens: true, completionTokens: true, success: true, calledAt: true },
    }),
    prisma.agent_call_logs.findMany({
      where: { calledAt: { gte: since }, ...userScope },
      select: { agentId: true, success: true, calledAt: true },
    }),
  ]);

  // —— token 维度排行 ——
  const skillMap = new Map<string, RankEntry>();
  const userMap = new Map<string, RankEntry>();
  const modelMap = new Map<string, RankEntry>();
  let totalTokens = 0;
  let totalPrompt = 0;
  let totalCompletion = 0;

  for (const r of tokenRows) {
    const t = r.tokensUsed || 0;
    const skillId = parseMetadataSkillId(r.metadata) || '未归因';
    const userKey = r.userId || '未归因';
    const modelKey = r.model || '未归因';

    totalTokens += t;
    totalPrompt += r.promptTokens || 0;
    totalCompletion += r.completionTokens || 0;

    // —— 三个维度统一累加 ——
    const entries: Array<[string, string]> = [
      [skillId, agentDisplayName(skillId)],
      [userKey, userKey],
      [modelKey, modelKey],
    ];
    const maps: Array<{ get: (k: string) => RankEntry | undefined; set: (k: string, v: RankEntry) => void }> = [skillMap, userMap, modelMap];
    for (let i = 0; i < maps.length; i += 1) {
      const key = entries[i][0];
      const display = entries[i][1];
      const e = maps[i].get(key) || { key, display, tokens: 0, calls: 0, failed: 0 };
      e.tokens += t;
      e.calls += 1;
      if (r.success === false) e.failed += 1;
      maps[i].set(key, e);
    }
  }

  // —— 调用/失败计数补全（全量行，含 skill 层）——
  const callCount = callRows.length;
  let callFailed = 0;
  const daily = new Map<string, { date: string; tokens: number; calls: number; failed: number }>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    daily.set(label, { date: label, tokens: 0, calls: 0, failed: 0 });
  }
  for (const r of callRows) {
    if (r.success === false) callFailed += 1;
    const d = new Date(r.calledAt);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const b = daily.get(label);
    if (b) {
      b.calls += 1;
      if (r.success === false) b.failed += 1;
    }
  }
  // token 按天叠加
  for (const r of tokenRows) {
    const d = new Date(r.calledAt);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const b = daily.get(label);
    if (b) {
      b.tokens += r.tokensUsed || 0;
    }
  }

  const sortByTokens = (map: Map<string, RankEntry>) => [...map.values()].sort((a, b) => b.tokens - a.tokens);

  return {
    totals: {
      tokens: totalTokens,
      promptTokens: totalPrompt,
      completionTokens: totalCompletion,
      calls: callCount,
      failed: callFailed,
    },
    trend: [...daily.values()],
    bySkill: sortByTokens(skillMap),
    byUser: sortByTokens(userMap),
    byModel: sortByTokens(modelMap),
  };
}

/**
 * GET /api/admin/token-cost/summary?days=7&includeTest=0|1
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const days = parseDays(req.query.days);
    const includeTest = parseIncludeTest(req.query.includeTest);
    const data = await loadTokenData(days, includeTest);
    res.json({
      success: true,
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
    const data = await loadTokenData(days, includeTest);
    res.json({ success: true, data: { days, includeTest, items: data.bySkill } });
  } catch (error: any) {
    logger.error('token-cost by-skill 失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/token-cost/by-user?days=7&includeTest=0|1&limit=20
 */
router.get('/by-user', async (req: Request, res: Response) => {
  try {
    const days = parseDays(req.query.days);
    const includeTest = parseIncludeTest(req.query.includeTest);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const data = await loadTokenData(days, includeTest);

    const top = data.byUser.slice(0, limit);
    const ids = top.map((r) => r.key).filter((k) => k !== '未归因');
    const users = ids.length
      ? await prisma.users.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const items = top.map((r) => {
      const u = userMap.get(r.key);
      return { ...r, name: u?.name || null, email: u?.email || null };
    });

    res.json({ success: true, data: { days, includeTest, items } });
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
    const data = await loadTokenData(days, includeTest);
    res.json({ success: true, data: { days, includeTest, items: data.byModel } });
  } catch (error: any) {
    logger.error('token-cost by-model 失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
