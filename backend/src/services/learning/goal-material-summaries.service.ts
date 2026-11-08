/**
 * goal 阶段的「已上传资料清单」投影（元信息 + 理解摘要）。
 *
 * 从 goal-conversation.service 抽出：该 service 已超文件行数棘轮上限，而这段逻辑
 * 与对话状态机无关，只是“按当前目标选资料 → 等 brief → 映射 payload”。
 *
 * brief 惰性生成一次、持久化复用；受总等待预算约束——到点未就绪的降级为 headings
 * 元信息（生成在后台继续落盘，下次对话拾取）。纯本地读盘 + fail-open：任何异常
 * 返回空清单，绝不阻塞对话。
 *
 * 排序结果会话级缓存（#176-4，A+C 方案）：修复前每轮都拿「含本轮 userInput 的 query」
 * 走 selectMaterialsRanked —— ≥2 份资料时逐条调决策模型（最多 12 次 + 20s brief 等待），
 * 同一会话相邻两轮的资料集合与目标通常没变，这些调用全是重复劳动。
 * 现在按 `(userId, conversationId, surface_goal)` 缓存**排序结果**，用资料集合指纹
 * （上传资料 id 集合）判定是否仍然有效：集合与目标未变 → 直接复用排序，不调决策模型；
 * 变化 → 重排并回写缓存。
 *
 * 边界（有意为之）：
 * - 只缓存「排序」，不缓存 brief：brief 每轮仍按现有链路收集（缺失的会继续生成并落盘），
 *   所以**模型可见上下文与修复前完全一致**（brief 刚就绪的那一轮立刻带上摘要），
 *   只是不再重复调决策模型。
 * - 缓存有 TTL（默认 30 分钟）、条目上限（LRU 淘汰），并在会话收尾/删除时按会话清空，
 *   避免无界增长（进程内 Map，不持久化：多实例下各自缓存，语义仍是「可能重复排一次」）。
 */
import { createHash } from 'crypto';
import { logger } from '../../utils/logger';
import type { GoalUploadedMaterialSummary } from '../../skills/goal-conversation';
import { collectBriefsWithDeadline } from '../materials/material-brief.service';
import { listMaterials, type MaterialRecord } from '../materials/material-store';
import { selectMaterialsRanked, type MaterialSelection } from '../materials/material-selection.service';

export const GOAL_MATERIAL_SUMMARY_LIMIT = 5;
/** path 实际只打包 3 份；goal 清单里同步标出哪 3 份是本次路径主线。 */
export const GOAL_PATH_MATERIAL_LIMIT = 3;

/**
 * goal 回合等待资料 brief 就绪的总预算（毫秒）。
 * 到点未就绪的资料降级为 headings 元信息；brief 生成在后台继续落盘，下次对话拾取。
 */
export const GOAL_BRIEF_DEADLINE_MS = 20_000;

/** 排序结果缓存 TTL（毫秒）：同一会话长时间停滞后重新进入，允许重排一次。 */
export const GOAL_MATERIAL_RANK_CACHE_TTL_MS = 30 * 60 * 1000;
/** 缓存条目上限：超出按最久未使用淘汰（TTL 之外的第二道界，防长进程无界增长）。 */
const RANK_CACHE_MAX_ENTRIES = 200;

/** collectGoalUploadedMaterialSummaries 的会话维度入参（缺省=不进缓存）。 */
export interface GoalMaterialSummaryOptions {
  /** 会话 id：缓存键的一部分，也是会话收尾时按会话清空的依据。 */
  conversationId?: string;
  /** 当前目标（understanding.surface_goal）：缓存键的一部分，目标变了就重排。 */
  surfaceGoal?: string;
}

interface GoalMaterialRankCacheEntry {
  /** 资料集合指纹：上传资料 id 集合（排序后哈希）。 */
  fingerprint: string;
  selectedIds: string[];
  omittedIds: string[];
  total: number;
  strategy: MaterialSelection['strategy'];
  hasPhraseHit: boolean;
  expiresAt: number;
  lastUsedAt: number;
}

const rankCache = new Map<string, GoalMaterialRankCacheEntry>();

function rankCacheTtlMs(): number {
  const raw = Number(process.env.GOAL_MATERIAL_RANK_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : GOAL_MATERIAL_RANK_CACHE_TTL_MS;
}

/**
 * 清空排序缓存。传 conversationId 只清该会话（会话收尾/删除时调用），不传清全部（测试/运维）。
 */
export function clearGoalMaterialRankCache(conversationId?: string): void {
  if (conversationId === undefined) {
    rankCache.clear();
    return;
  }
  const suffix = `::${conversationId}::`;
  for (const key of [...rankCache.keys()]) {
    if (key.includes(suffix)) rankCache.delete(key);
  }
}

/** 缓存键：userId + conversationId + surface_goal（资料集合指纹在条目内单独比对）。 */
function buildRankCacheKey(
  userId: string,
  conversationId: string,
  surfaceGoal: string
): string {
  const goalHash = createHash('sha1').update(surfaceGoal.trim()).digest('hex').slice(0, 16);
  return `goal-material-rank::${userId}::${conversationId}::${goalHash}`;
}

/** 资料集合指纹：只认「集合身份」（上传资料 id），不认内容——brief 落盘不算集合变化。 */
function materialPoolFingerprint(pool: MaterialRecord[]): string {
  const ids = pool.map((record) => String(record.id)).sort();
  return createHash('sha1').update(ids.join('|')).digest('hex');
}

function pruneRankCache(now: number): void {
  for (const [key, entry] of rankCache) {
    if (entry.expiresAt <= now) rankCache.delete(key);
  }
  if (rankCache.size <= RANK_CACHE_MAX_ENTRIES) return;
  const byAge = [...rankCache.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
  for (const [key] of byAge.slice(0, rankCache.size - RANK_CACHE_MAX_ENTRIES)) {
    rankCache.delete(key);
  }
}

function readRankCache(
  key: string,
  fingerprint: string
): GoalMaterialRankCacheEntry | null {
  const entry = rankCache.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (entry.expiresAt <= now) {
    rankCache.delete(key);
    return null;
  }
  if (entry.fingerprint !== fingerprint) {
    // 资料集合变了：旧排序作废（下一次写入会覆盖同一条目）。
    rankCache.delete(key);
    return null;
  }
  entry.lastUsedAt = now;
  return entry;
}

function writeRankCache(
  key: string,
  fingerprint: string,
  selection: MaterialSelection
): void {
  const now = Date.now();
  pruneRankCache(now);
  rankCache.set(key, {
    fingerprint,
    selectedIds: selection.selected.map((record) => record.id),
    omittedIds: selection.omitted.map((record) => record.id),
    total: selection.total,
    strategy: selection.strategy,
    hasPhraseHit: selection.hasPhraseHit,
    expiresAt: now + rankCacheTtlMs(),
    lastUsedAt: now,
  });
}

/** 按缓存的 id 顺序还原选择结果；任一 id 已不在池里则视为失效（返回 null 走重排）。 */
function selectionFromCache(
  entry: GoalMaterialRankCacheEntry,
  pool: MaterialRecord[],
  limit: number
): MaterialSelection | null {
  const byId = new Map(pool.map((record) => [record.id, record]));
  const pick = (ids: string[]): MaterialRecord[] | null => {
    const out: MaterialRecord[] = [];
    for (const id of ids) {
      const record = byId.get(id);
      if (!record) return null;
      out.push(record);
    }
    return out;
  };
  const selected = pick(entry.selectedIds);
  const omitted = pick(entry.omittedIds);
  if (!selected || !omitted) return null;
  return {
    selected: selected.slice(0, limit),
    omitted,
    total: entry.total,
    strategy: entry.strategy,
    hasPhraseHit: entry.hasPhraseHit,
  };
}

export async function collectGoalUploadedMaterialSummaries(
  userId?: string,
  query?: string,
  options?: GoalMaterialSummaryOptions
): Promise<GoalUploadedMaterialSummary[]> {
  const id = typeof userId === 'string' ? userId.trim() : '';
  if (!id) return [];
  try {
    // 上传池（origin !== 'web'）先读一次：既用于资料集合指纹，也作为 selectMaterialsRanked 的
    // records 入参，避免它内部再读一遍盘。
    const records = listMaterials(id);
    const pool = records.filter((record) => record.origin !== 'web');
    if (pool.length === 0) return [];

    const conversationId = typeof options?.conversationId === 'string' ? options.conversationId.trim() : '';
    const surfaceGoal = typeof options?.surfaceGoal === 'string' ? options.surfaceGoal.trim() : '';
    const fingerprint = materialPoolFingerprint(pool);
    const cacheKey = conversationId ? buildRankCacheKey(id, conversationId, surfaceGoal) : '';
    const cachedEntry = cacheKey ? readRankCache(cacheKey, fingerprint) : null;
    const cachedSelection = cachedEntry
      ? selectionFromCache(cachedEntry, pool, GOAL_MATERIAL_SUMMARY_LIMIT)
      : null;

    const selection = cachedSelection || await selectMaterialsRanked({
      userId: id,
      query,
      limit: GOAL_MATERIAL_SUMMARY_LIMIT,
      includeWeb: false,
      records,
    });
    if (!cachedSelection && cacheKey) {
      writeRankCache(cacheKey, fingerprint, selection);
    }

    const selectedRecords = selection.selected;
    if (selectedRecords.length === 0) return [];
    const omittedCount = Math.max(0, selection.total - selectedRecords.length);
    const briefs = await collectBriefsWithDeadline(selectedRecords, GOAL_BRIEF_DEADLINE_MS);
    logger.info('[goal-conversation] 资料库选择', {
      total: selection.total,
      selected: selectedRecords.map((record) => record.name),
      omitted: selection.omitted.map((record) => record.name),
      strategy: selection.strategy,
      // 缓存命中 = 本轮资料集合与目标未变，复用上一轮排序（不调决策模型）
      rankCache: cachedSelection ? 'hit' : (cacheKey ? 'miss' : 'disabled'),
      conversationId: conversationId || undefined,
    });
    return selectedRecords.map((record, index) => {
      const brief = briefs[index];
      return {
        name: record.name,
        ext: record.ext,
        format: record.format,
        charCount: record.charCount,
        headingCount: record.structure?.headingCount ?? 0,
        headings: (record.anchors || [])
          .map((anchor) => String(anchor?.heading || '').trim())
          .filter((heading) => heading && heading !== '（无标题）')
          .slice(0, 6),
        selectedForPath: index < GOAL_PATH_MATERIAL_LIMIT,
        libraryTotal: selection.total,
        libraryOmitted: omittedCount,
        brief: brief
          ? {
              docType: brief.docType,
              subject: brief.subject,
              audience: brief.audience,
              overview: brief.overview,
              naturalDivisions: brief.naturalDivisions,
              toc: brief.toc,
            }
          : null,
      };
    });
  } catch (error) {
    logger.warn('[goal-conversation] 读取上传资料清单失败，已跳过（fail-open）', {
      userId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
