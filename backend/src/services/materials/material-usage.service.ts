/**
 * 资料使用关系（只读投影）：某份上传资料被哪些学习路径采用 / 引用。
 *
 * 两种口径分开记，不混成一个“用过”：
 *   - adopted：路径生成时资料包被注入 `normalizedInput.resources.materials`
 *     （含阶段载荷/快照里的副本；同一路径去重）；
 *   - refCount：里程碑/任务 `materialRefs` 指向该资料的条目数（逐字核对后才会有）。
 *
 * 为什么按需算：`aiPromptTemplate` 单条数百 KB，列表每次都解析代价高；
 * 只有资料库页需要使用关系，接口用 `?usage=1` 显式开启。
 *
 * fail-open：模板损坏/DB 读取失败 → 该路径跳过，不影响资料列表。
 */
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

export interface MaterialUsagePath {
  pathId: string;
  pathTitle: string;
  adopted: boolean;
  refCount: number;
  updatedAt: string | null;
}

export interface MaterialUsage {
  /** 采用或引用过这份资料的路径数（按路径去重） */
  pathCount: number;
  /** 仅“资料包进入路径”的路径数（通常等于 pathCount） */
  adoptedPathCount: number;
  /** 课程条目级引用总数（materialRefs 条数） */
  refCount: number;
  paths: MaterialUsagePath[];
}

export interface MaterialUsageTemplateRow {
  id: string;
  title?: string | null;
  name?: string | null;
  aiPromptTemplate?: string | null;
  updatedAt?: Date | string | number | null;
}

interface TemplateUsage {
  adoptedIds: Set<string>;
  refCounts: Map<string, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 从一个路径模板里抽取资料使用关系（纯函数，便于测试）。
 *
 * 判定：
 *   - 带 `sections` / `keyPoints` 数组 + `materialId` = 资料包 → adopted；
 *   - 带非空 `quote` + `materialId` = materialRefs 条目 → refCount（按
 *     materialId|sectionId|quote 去重，防止模板多处副本重复计数）。
 */
export function extractMaterialUsageFromTemplate(template: unknown): TemplateUsage {
  const adoptedIds = new Set<string>();
  const refCounts = new Map<string, number>();
  const seenRefs = new Set<string>();
  const seenNodes = new WeakSet<object>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (seenNodes.has(node as object)) return;
    seenNodes.add(node as object);

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;

    const materialId = typeof node.materialId === 'string' ? node.materialId.trim() : '';
    if (materialId) {
      const isPack = Array.isArray(node.sections) || Array.isArray(node.keyPoints);
      if (isPack) adoptedIds.add(materialId);
      const quote = typeof node.quote === 'string' ? node.quote.trim() : '';
      if (quote) {
        const key = `${materialId}|${String(node.sectionId || '')}|${quote}`;
        if (!seenRefs.has(key)) {
          seenRefs.add(key);
          refCounts.set(materialId, (refCounts.get(materialId) || 0) + 1);
        }
      }
    }

    for (const value of Object.values(node)) visit(value);
  };

  visit(template);
  return { adoptedIds, refCounts };
}

function pathTitleOf(row: MaterialUsageTemplateRow): string {
  return String(row.title || row.name || '未命名路径');
}

function updatedAtOf(row: MaterialUsageTemplateRow): string | null {
  if (!row.updatedAt) return null;
  const date = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 汇总多份路径模板 → materialId → 使用关系。 */
export function summarizeMaterialUsage(rows: MaterialUsageTemplateRow[]): Map<string, MaterialUsage> {
  const usage = new Map<string, MaterialUsage>();
  for (const row of rows) {
    const raw = row.aiPromptTemplate;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let template: unknown;
    try {
      template = JSON.parse(raw);
    } catch {
      continue;
    }
    const { adoptedIds, refCounts } = extractMaterialUsageFromTemplate(template);
    const ids = new Set<string>([...adoptedIds, ...refCounts.keys()]);
    for (const materialId of ids) {
      const adopted = adoptedIds.has(materialId);
      const refCount = refCounts.get(materialId) || 0;
      if (!adopted && refCount === 0) continue;
      let entry = usage.get(materialId);
      if (!entry) {
        entry = { pathCount: 0, adoptedPathCount: 0, refCount: 0, paths: [] };
        usage.set(materialId, entry);
      }
      entry.pathCount += 1;
      if (adopted) entry.adoptedPathCount += 1;
      entry.refCount += refCount;
      entry.paths.push({
        pathId: row.id,
        pathTitle: pathTitleOf(row),
        adopted,
        refCount,
        updatedAt: updatedAtOf(row),
      });
    }
  }
  for (const entry of usage.values()) {
    entry.paths.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }
  return usage;
}

// 进程内缓存：资料库页每次打开都会调 getMaterialUsageMap，全量解析几百 KB 模板代价高。
// TTL 只兜底；是否重算由轻量 signature 决定——该用户 learning_paths 的
// max(updatedAt) + 条数（一次 aggregate，不碰模板列），新路径生成/旧路径更新时
// signature 立即变化 → 立刻重算，不会看到 TTL 窗口内的旧数据。
const DEFAULT_MATERIAL_USAGE_CACHE_TTL_MS = 60_000;

interface MaterialUsageCacheEntry {
  usageMap: Map<string, MaterialUsage>;
  /** 该用户 learning_paths 的 max(updatedAt) + 条数，变化即失效 */
  signature: string;
  expiresAt: number;
}

const materialUsageCache = new Map<string, MaterialUsageCacheEntry>();

/** TTL 默认 60s；MATERIAL_USAGE_CACHE_TTL_MS 覆盖，0=禁用缓存。每次调用现读，测试可动态切换。 */
function resolveMaterialUsageCacheTtlMs(): number {
  const raw = process.env.MATERIAL_USAGE_CACHE_TTL_MS;
  if (!raw || !raw.trim()) return DEFAULT_MATERIAL_USAGE_CACHE_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MATERIAL_USAGE_CACHE_TTL_MS;
  return parsed;
}

/** 轻量签名：一次 aggregate 取 max(updatedAt) + 条数，不解析模板。 */
async function readMaterialUsageSignature(userId: string): Promise<string> {
  const agg = await prisma.learning_paths.aggregate({
    where: { userId },
    _max: { updatedAt: true },
    _count: { _all: true },
  });
  const maxUpdatedAt = agg._max?.updatedAt;
  const stamp = maxUpdatedAt ? new Date(maxUpdatedAt).toISOString() : '';
  return `${stamp}#${agg._count?._all ?? 0}`;
}

/** 全量重算：findMany 粗筛 + 逐条解析模板。 */
async function computeMaterialUsageMap(
  userId: string,
  options: { maxPaths?: number }
): Promise<Map<string, MaterialUsage>> {
  const rows = await prisma.learning_paths.findMany({
    where: {
      userId,
      aiPromptTemplate: { contains: 'materialId' },
    },
    select: {
      id: true,
      title: true,
      name: true,
      aiPromptTemplate: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: Math.max(1, options.maxPaths ?? 100),
  });
  return summarizeMaterialUsage(rows);
}

/**
 * 读取某用户的资料使用关系（带进程内缓存）。
 * SQL 先用 `aiPromptTemplate contains 'materialId'` 粗筛——没带过资料的路径不解析；
 * 缓存命中时每次只跑一条轻量 aggregate 比对 signature，变了立即重算。
 */
export async function getMaterialUsageMap(
  userId: string,
  options: { maxPaths?: number } = {}
): Promise<Map<string, MaterialUsage>> {
  const id = typeof userId === 'string' ? userId.trim() : '';
  if (!id) return new Map();
  const ttlMs = resolveMaterialUsageCacheTtlMs();
  const cached = ttlMs > 0 ? materialUsageCache.get(id) : undefined;

  if (cached && cached.expiresAt > Date.now()) {
    try {
      const signature = await readMaterialUsageSignature(id);
      if (signature === cached.signature) return cached.usageMap;
      // signature 变了（新路径生成/旧路径更新）→ 不等 TTL，立即重算并续期
      const usageMap = await computeMaterialUsageMap(id, options);
      materialUsageCache.set(id, { usageMap, signature, expiresAt: Date.now() + ttlMs });
      return usageMap;
    } catch (error) {
      // 轻查询/重算失败 → 沿用上次算好的结果（fail-open，好过退回空列表）
      logger.warn('[material-usage] 资料使用关系缓存刷新失败，沿用上次结果', {
        userId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return cached.usageMap;
    }
  }

  try {
    const [signature, usageMap] = await Promise.all([
      ttlMs > 0 ? readMaterialUsageSignature(id) : Promise.resolve(''),
      computeMaterialUsageMap(id, options),
    ]);
    if (ttlMs > 0) {
      materialUsageCache.set(id, { usageMap, signature, expiresAt: Date.now() + ttlMs });
    }
    return usageMap;
  } catch (error) {
    logger.warn('[material-usage] 读取资料使用关系失败，已跳过', {
      userId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

/** 测试专用：清空进程内缓存。 */
export function __clearMaterialUsageCacheForTests(): void {
  materialUsageCache.clear();
}
