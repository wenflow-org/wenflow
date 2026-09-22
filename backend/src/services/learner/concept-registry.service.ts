/**
 * ConceptRegistryService —— 概念身份解析（KC 概念身份与图关系改造 · L1）
 *
 * 设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §3
 *
 * 解决的问题（实测 2026-09-22）：系统里概念有**三套互不相通的身份**——
 * `memory_traces`/`misconception_ledger` 用自由文本概念名做键（848 行/843 键，一行为一键，
 * 键交集仅 28%）；`subtasks`/`milestones` 用 path 内局部序号 `concept-N`（同键不同义）；
 * `kcGraph.nodes.kcId` 又是另一套。三者无共同主键，跨表 join 静默错。
 *
 * 本服务提供**唯一**的身份解析入口：`resolveConcept(userId, rawText) → conceptId`。
 * 机制极简——`normalizeConceptKey`（与 memory_traces 同口径）+ `concept_aliases` 的
 * `@@unique([userId, aliasNorm])` 索引一次命中；未命中且允许创建时登记新概念。
 *
 * 纪律（沿用本仓既有分工）：
 * - **关键路径零 LLM**：解析纯代码，绝不 inline await 模型（同 TaskDifficultyAdjustmentService）。
 * - **语义近义不在这里做**：机械归一化只吃标点/引号/冒号从句；语义近义（"回来后第一眼交给书"
 *   vs "回来后第一眼第一手交给已翻开的书"）留给 `ConceptConsolidatorService` 的 LLM 建议，
 *   异步、可证伪、经闸门后由代码登记为 alias（`registerAlias`）。
 * - **身份是用户级**的：同一名字对新手是技能簇、对熟手只是一个词（复用 concept-load 判读），
 *   且遗忘不分路径 → 不做 path 隔离。
 * - **非破坏性**：登记 alias 不改任何业务表行；回滚 = 删 alias 行。
 */
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { normalizeConceptKey } from '../memory/concept-key';

export type ConceptLevel = 'concept' | 'kc';
export type AliasSource = 'write_time' | 'consolidator' | 'human' | 'backfill';

export interface ResolveOptions {
  /** 未命中时是否创建新概念（默认 true）。回填/只读校验可传 false。 */
  createIfMissing?: boolean;
  /** 别名来源标记（审计用） */
  source?: AliasSource;
  /** 概念层级（仅在**创建**新概念时生效；已有概念不改层级） */
  level?: ConceptLevel;
  /** 首次出现路径（仅创建时写入，用于溯源；不做隔离键） */
  originPathId?: string | null;
  /** 分类/粒度（仅创建时写入；缺省留空，由 concept-load 判定后回填） */
  taxonomy?: string | null;
  granularity?: string | null;
}

export interface ResolvedConcept {
  conceptId: string;
  /** 本次调用是否新建了概念（false = 命中既有身份） */
  created: boolean;
}

/** 可注入依赖（测试用；默认实现走 prisma） */
export interface ConceptRegistryDeps {
  findAlias(userId: string, aliasNorm: string): Promise<{ conceptId: string } | null>;
  findConcept(userId: string, canonicalLabel: string): Promise<{ id: string } | null>;
  createConcept(data: {
    id: string; userId: string; canonicalLabel: string; level: ConceptLevel;
    taxonomy: string | null; granularity: string | null; originPathId: string | null;
  }): Promise<{ id: string }>;
  createAlias(data: {
    id: string; conceptId: string; userId: string; aliasNorm: string; aliasRaw: string;
    source: AliasSource; confidence: number;
  }): Promise<{ id: string }>;
}

const defaultDeps: ConceptRegistryDeps = {
  findAlias: (userId, aliasNorm) =>
    prisma.concept_aliases.findUnique({ where: { userId_aliasNorm: { userId, aliasNorm } }, select: { conceptId: true } }),
  findConcept: (userId, canonicalLabel) =>
    prisma.concepts.findUnique({ where: { userId_canonicalLabel: { userId, canonicalLabel } }, select: { id: true } }),
  createConcept: (data) => prisma.concepts.create({ data, select: { id: true } }),
  createAlias: (data) => prisma.concept_aliases.create({ data, select: { id: true } }),
};

/** 简单 LRU（解析是高频热点：每写一条痕迹/误解都要 resolve）。 */
class LruCache {
  private readonly map = new Map<string, string>();
  constructor(private readonly max = 5000) {}
  get(key: string): string | undefined {
    const hit = this.map.get(key);
    if (hit === undefined) return undefined;
    // 触碰即刷新（LRU 语义）
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }
  set(key: string, value: string): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
  delete(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}

const newId = (prefix: string): string => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export class ConceptRegistryService {
  private readonly cache = new LruCache();
  constructor(private readonly deps: ConceptRegistryDeps = defaultDeps) {}

  /** 仅供测试：清空进程内解析缓存 */
  clearCache(): void { this.cache.clear(); }

  /**
   * 解析概念身份（幂等）。返回 null 的两种情形：入参归一化后为空；未命中且 createIfMissing=false。
   */
  async resolveConcept(userId: string, rawText: unknown, options: ResolveOptions = {}): Promise<ResolvedConcept | null> {
    const aliasNorm = normalizeConceptKey(rawText);
    if (!userId || !aliasNorm) return null;

    const cacheKey = `${userId}\u0000${aliasNorm}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return { conceptId: cached, created: false };

    const existing = await this.deps.findAlias(userId, aliasNorm);
    if (existing) {
      this.cache.set(cacheKey, existing.conceptId);
      return { conceptId: existing.conceptId, created: false };
    }

    if (options.createIfMissing === false) return null;

    const canonicalLabel = String(rawText ?? '').trim() || aliasNorm;
    const conceptId = await this.ensureConcept(userId, canonicalLabel, options);
    await this.ensureAlias({
      conceptId, userId, aliasNorm, aliasRaw: canonicalLabel,
      source: options.source ?? 'write_time', confidence: 1,
    });
    this.cache.set(cacheKey, conceptId);
    return { conceptId, created: true };
  }

  /**
   * 批量解析（顺序去重后逐个 resolve）。返回 `aliasNorm → conceptId` 映射，便于调用方回填。
   * 空/无效项不进结果。
   */
  async resolveMany(userId: string, rawTexts: readonly unknown[], options: ResolveOptions = {}): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const seen = new Set<string>();
    for (const raw of rawTexts) {
      const norm = normalizeConceptKey(raw);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      const resolved = await this.resolveConcept(userId, raw, options);
      if (resolved) out.set(norm, resolved.conceptId);
    }
    return out;
  }

  /**
   * 登记一条别名（归并升格入口）：把 free-text 别名挂到既有 canonical 概念上。
   * 非破坏性——不动任何业务表行；已存在同别名（同用户）时原样返回其概念，不抛错。
   */
  async registerAlias(params: {
    userId: string; conceptId: string; aliasRaw: string;
    source?: AliasSource; confidence?: number;
  }): Promise<{ conceptId: string; registered: boolean }> {
    const aliasNorm = normalizeConceptKey(params.aliasRaw);
    if (!params.userId || !params.conceptId || !aliasNorm) {
      return { conceptId: params.conceptId, registered: false };
    }
    const existing = await this.deps.findAlias(params.userId, aliasNorm);
    if (existing) {
      this.cache.set(`${params.userId}\u0000${aliasNorm}`, existing.conceptId);
      return { conceptId: existing.conceptId, registered: false };
    }
    try {
      await this.ensureAlias({
        conceptId: params.conceptId, userId: params.userId, aliasNorm,
        aliasRaw: String(params.aliasRaw).trim() || aliasNorm,
        source: params.source ?? 'consolidator', confidence: params.confidence ?? 1,
      });
      this.cache.set(`${params.userId}\u0000${aliasNorm}`, params.conceptId);
      return { conceptId: params.conceptId, registered: true };
    } catch (error) {
      // 并发下可能被别处抢先登记（unique 冲突）→ 重读，不抛
      const again = await this.deps.findAlias(params.userId, aliasNorm);
      if (again) return { conceptId: again.conceptId, registered: false };
      throw error;
    }
  }

  /** 取 canonical 概念（含别名），供读侧展示与审计。 */
  async getConcept(conceptId: string) {
    return prisma.concepts.findUnique({
      where: { id: conceptId },
      include: { aliases: { select: { aliasNorm: true, aliasRaw: true, source: true } } },
    });
  }

  /**
   * 撤销若干别名（归并回滚用）：删 alias 行并清缓存。
   * 只删别名，**不动任何业务表行**——调用方负责把被改指的 conceptId 还原。
   * 概念行本身保留（可能仍有其它别名指向它）。
   */
  async removeAliases(userId: string, aliasRaws: readonly string[]): Promise<{ removed: number }> {
    const norms = aliasRaws.map((raw) => normalizeConceptKey(raw)).filter(Boolean);
    if (!userId || norms.length === 0) return { removed: 0 };
    const result = await prisma.concept_aliases.deleteMany({ where: { userId, aliasNorm: { in: norms } } });
    for (const norm of norms) this.cache.delete(`${userId}\u0000${norm}`);
    return { removed: result.count };
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  /** 取或建 canonical 概念（`@@unique([userId, canonicalLabel])` 冲突时重读，保证并发安全） */
  private async ensureConcept(userId: string, canonicalLabel: string, options: ResolveOptions): Promise<string> {
    const found = await this.deps.findConcept(userId, canonicalLabel);
    if (found) return found.id;
    try {
      const created = await this.deps.createConcept({
        id: newId('cpt'),
        userId,
        canonicalLabel,
        level: options.level ?? 'kc',
        taxonomy: options.taxonomy ?? null,
        granularity: options.granularity ?? null,
        originPathId: options.originPathId ?? null,
      });
      return created.id;
    } catch (error) {
      const again = await this.deps.findConcept(userId, canonicalLabel);
      if (again) return again.id;
      logger.warn('[concept-registry] 创建概念失败', {
        userId, canonicalLabel: canonicalLabel.slice(0, 40),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** 插 alias；unique 冲突由调用方重读处理 */
  private async ensureAlias(data: {
    conceptId: string; userId: string; aliasNorm: string; aliasRaw: string;
    source: AliasSource; confidence: number;
  }): Promise<void> {
    await this.deps.createAlias({ id: newId('cal'), ...data });
  }
}

export const conceptRegistryService = new ConceptRegistryService();
export default conceptRegistryService;
