/**
 * ConceptGraphService —— 概念图（L2）的物化与查询单一入口
 *
 * 设计：doc/KC_CONCEPT_IDENTITY_AND_GRAPH_DESIGN.md §4
 *
 * 背景（实测 2026-09-22）：`kcGraph.edges` 一直只躺在 `learning_paths.aiPromptTemplate` 的
 * JSON blob 里，**零读侧消费者**；`concept_edges` 表建了但 0 行。本模块把图从 blob 搬进表，
 * 并提供 1-hop 邻域 / 上游闭包查询，供 L3 调控接入（`neighboringConcepts` / `prerequisiteGaps`）消费。
 *
 * **边的方向语义（实测标定，不是猜的）**：`edges[{from, to, relation:'prerequisite'}]` 表示
 * **`from` 是 `to` 的前置**（要先掌握 from 才能学 to）。用 5 条真实路径的 66 条边与
 * `conceptKcs[].kcs[].prerequisiteKCs`（每 KC 显式列出的前置）交叉验证：66 条一致、0 条反向。
 * 故：**上游（前置）查询 = 取 `to = X` 的边的 `from`**。
 *
 * 粒度：`part_of` 边把 KC 挂到 coreConcept 上（由 `conceptKcs` 嵌套结构**代码推导**，不新增 LLM 调用）。
 * 实测 `prerequisite` 边很稀疏（96 条边 / 5 条路径有内容），`part_of` 才是主要结构。
 *
 * 纪律：物化是 best-effort——失败只 warn，不阻断路径生成；幂等靠复合唯一键。
 */
import prisma from '../../config/database';
import { conceptRegistryService } from './concept-registry.service';

export const RELATION_PREREQUISITE = 'prerequisite';
export const RELATION_PART_OF = 'part_of';
export const SCOPE_PATH = 'path';
export const SOURCE_KC_MAPPER = 'kc-mapper';
export const SOURCE_DERIVED = 'path-planning-derived';

export type ConceptLevel = 'concept' | 'kc';
export type EdgeDirection = 'in' | 'out' | 'both';

/** kcAnnotation 的最小视图（容忍 prompt 演进） */
export interface KcGraphLike {
  nodes?: Array<{ kcId?: unknown; name?: unknown; taxonomy?: unknown }>;
  edges?: Array<{ from?: unknown; to?: unknown; relation?: unknown }>;
}
export interface KcAnnotationLike {
  kcGraph?: KcGraphLike | null;
  conceptKcs?: Array<{ conceptId?: unknown; kcs?: Array<{ kcId?: unknown; name?: unknown; taxonomy?: unknown }> }>;
  [key: string]: unknown;
}
export interface CognitiveCoreLike {
  coreConcepts?: Array<{ id?: unknown; name?: unknown }>;
  [key: string]: unknown;
}

export interface EdgeRow {
  fromConceptId: string;
  toConceptId: string;
  relation: string;
}

/** 可注入依赖（测试用；默认实现走 prisma + conceptRegistry） */
export interface ConceptGraphDeps {
  resolveConcept(userId: string, text: unknown, options?: { level?: ConceptLevel; originPathId?: string | null }): Promise<{ conceptId: string } | null>;
  upsertEdge(data: {
    id: string; userId: string; fromConceptId: string; toConceptId: string;
    relation: string; scope: string; pathId: string | null; source: string;
  }): Promise<void>;
  listEdges(where: { userId: string; relations: string[]; scope?: string; pathId?: string | null }): Promise<EdgeRow[]>;
  findConcepts(ids: string[]): Promise<Array<{ id: string; canonicalLabel: string; level: string }>>;
}

const defaultDeps: ConceptGraphDeps = {
  resolveConcept: (userId, text, options) =>
    conceptRegistryService.resolveConcept(userId, text, {
      source: 'write_time',
      level: options?.level ?? 'kc',
      originPathId: options?.originPathId ?? null,
    }),
  upsertEdge: async (data) => {
    await prisma.concept_edges.upsert({
      where: {
        userId_fromConceptId_toConceptId_relation_scope_pathId: {
          userId: data.userId, fromConceptId: data.fromConceptId, toConceptId: data.toConceptId,
          relation: data.relation, scope: data.scope, pathId: data.pathId,
        },
      },
      create: data,
      update: { source: data.source },
    });
  },
  listEdges: async (where) => prisma.concept_edges.findMany({
    where: {
      userId: where.userId,
      relation: { in: where.relations },
      ...(where.scope ? { scope: where.scope } : {}),
      ...(where.pathId !== undefined ? { pathId: where.pathId } : {}),
    },
    select: { fromConceptId: true, toConceptId: true, relation: true },
  }),
  findConcepts: async (ids) => prisma.concepts.findMany({
    where: { id: { in: ids } },
    select: { id: true, canonicalLabel: true, level: true },
  }),
};

const newId = (): string => `ced_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export interface MaterializeResult {
  prerequisite: number;
  partOf: number;
  /** 因两端无法解析出 canonical 身份而跳过的边数 */
  skipped: number;
}

export class ConceptGraphService {
  constructor(private readonly deps: ConceptGraphDeps = defaultDeps) {}

  /**
   * 把一条路径的 `kcAnnotation` 物化进 `concept_edges`（幂等，best-effort）。
   * - `prerequisite`：来自 `kcGraph.edges`，两端经 kcId→name→canonical 解析
   * - `part_of`：来自 `conceptKcs` 嵌套（父 = coreConcept，子 = 各 KC），代码推导
   */
  async materializePathGraph(params: {
    userId: string;
    pathId: string;
    kcAnnotation: KcAnnotationLike | null | undefined;
    cognitiveCore?: CognitiveCoreLike | null;
  }): Promise<MaterializeResult> {
    const { userId, pathId, kcAnnotation, cognitiveCore } = params;
    const result: MaterializeResult = { prerequisite: 0, partOf: 0, skipped: 0 };
    if (!userId || !pathId || !kcAnnotation) return result;

    const nodes = Array.isArray(kcAnnotation.kcGraph?.nodes) ? kcAnnotation.kcGraph!.nodes! : [];
    const nameByKcId = new Map<string, string>();
    for (const node of nodes) {
      const kcId = str(node?.kcId);
      const name = str(node?.name);
      if (kcId && name) nameByKcId.set(kcId, name);
    }
    // 兜底：nodes 缺失时从 conceptKcs 的 KC 明细建同样的映射
    for (const item of Array.isArray(kcAnnotation.conceptKcs) ? kcAnnotation.conceptKcs! : []) {
      for (const kc of Array.isArray(item?.kcs) ? item.kcs! : []) {
        const kcId = str(kc?.kcId);
        const name = str(kc?.name);
        if (kcId && name && !nameByKcId.has(kcId)) nameByKcId.set(kcId, name);
      }
    }

    // ── prerequisite 边（from = 前置，to = 后继）──
    const edges = Array.isArray(kcAnnotation.kcGraph?.edges) ? kcAnnotation.kcGraph!.edges! : [];
    for (const edge of edges) {
      const fromName = nameByKcId.get(str(edge?.from));
      const toName = nameByKcId.get(str(edge?.to));
      if (!fromName || !toName || fromName === toName) { result.skipped += 1; continue; }
      const [from, to] = await Promise.all([
        this.deps.resolveConcept(userId, fromName, { level: 'kc', originPathId: pathId }),
        this.deps.resolveConcept(userId, toName, { level: 'kc', originPathId: pathId }),
      ]);
      if (!from || !to) { result.skipped += 1; continue; }
      await this.deps.upsertEdge({
        id: newId(), userId,
        fromConceptId: from.conceptId, toConceptId: to.conceptId,
        relation: RELATION_PREREQUISITE, scope: SCOPE_PATH, pathId, source: SOURCE_KC_MAPPER,
      });
      result.prerequisite += 1;
    }

    // ── part_of 边（KC → 其所属 coreConcept），由嵌套结构代码推导 ──
    const coreConcepts = Array.isArray(cognitiveCore?.coreConcepts) ? cognitiveCore!.coreConcepts! : [];
    const coreNameById = new Map<string, string>();
    for (const concept of coreConcepts) {
      const id = str(concept?.id);
      const name = str(concept?.name);
      if (id && name) coreNameById.set(id, name);
    }
    for (const item of Array.isArray(kcAnnotation.conceptKcs) ? kcAnnotation.conceptKcs! : []) {
      const parentName = coreNameById.get(str(item?.conceptId));
      if (!parentName) continue;
      const parent = await this.deps.resolveConcept(userId, parentName, { level: 'concept', originPathId: pathId });
      if (!parent) { result.skipped += 1; continue; }
      for (const kc of Array.isArray(item?.kcs) ? item.kcs! : []) {
        const childName = str(kc?.name);
        if (!childName) continue;
        const child = await this.deps.resolveConcept(userId, childName, { level: 'kc', originPathId: pathId });
        if (!child) { result.skipped += 1; continue; }
        await this.deps.upsertEdge({
          id: newId(), userId,
          fromConceptId: child.conceptId, toConceptId: parent.conceptId,
          relation: RELATION_PART_OF, scope: SCOPE_PATH, pathId, source: SOURCE_DERIVED,
        });
        result.partOf += 1;
      }
    }

    return result;
  }

  /**
   * 1-hop 邻域。`direction`：`in` = 前置（取 `to = X` 的边的 `from`）、`out` = 后继、`both`。
   */
  async neighbors(
    userId: string,
    conceptId: string,
    options: { relations?: string[]; direction?: EdgeDirection; limit?: number; pathId?: string | null } = {},
  ): Promise<Array<{ conceptId: string; label: string | null; relation: string; direction: 'in' | 'out' }>> {
    const relations = options.relations ?? [RELATION_PREREQUISITE, RELATION_PART_OF];
    const direction = options.direction ?? 'both';
    const edges = await this.deps.listEdges({ userId, relations, pathId: options.pathId ?? undefined });
    const found: Array<{ conceptId: string; relation: string; direction: 'in' | 'out' }> = [];
    for (const edge of edges) {
      if (direction !== 'out' && edge.toConceptId === conceptId) {
        found.push({ conceptId: edge.fromConceptId, relation: edge.relation, direction: 'in' });
      }
      if (direction !== 'in' && edge.fromConceptId === conceptId) {
        found.push({ conceptId: edge.toConceptId, relation: edge.relation, direction: 'out' });
      }
    }
    const seen = new Set<string>();
    const unique = found.filter((item) => {
      if (item.conceptId === conceptId || seen.has(item.conceptId)) return false;
      seen.add(item.conceptId);
      return true;
    });
    const limited = options.limit && options.limit > 0 ? unique.slice(0, options.limit) : unique;
    const concepts = await this.deps.findConcepts(limited.map((item) => item.conceptId));
    const labelById = new Map(concepts.map((c) => [c.id, c.canonicalLabel]));
    return limited.map((item) => ({ ...item, label: labelById.get(item.conceptId) ?? null }));
  }

  /**
   * 沿 `prerequisite` 向上游闭包（"要学 X，先得掌握什么"）。BFS，按 depth 去重取最小深度。
   */
  async upstreamClosure(
    userId: string,
    conceptId: string,
    options: { maxDepth?: number; pathId?: string | null } = {},
  ): Promise<Array<{ conceptId: string; depth: number }>> {
    const maxDepth = options.maxDepth ?? 2;
    if (maxDepth <= 0) return [];
    const edges = await this.deps.listEdges({
      userId, relations: [RELATION_PREREQUISITE], pathId: options.pathId ?? undefined,
    });
    const incoming = new Map<string, string[]>();
    for (const edge of edges) {
      if (!incoming.has(edge.toConceptId)) incoming.set(edge.toConceptId, []);
      incoming.get(edge.toConceptId)!.push(edge.fromConceptId);
    }
    const depthOf = new Map<string, number>();
    let frontier = [conceptId];
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const parent of incoming.get(node) ?? []) {
          if (parent === conceptId || depthOf.has(parent)) continue;
          depthOf.set(parent, depth);
          next.push(parent);
        }
      }
      frontier = next;
    }
    return [...depthOf.entries()].map(([id, depth]) => ({ conceptId: id, depth }));
  }

  /** 单条路径的边（供只读校验/前端） */
  async listPathEdges(userId: string, pathId: string): Promise<EdgeRow[]> {
    return this.deps.listEdges({ userId, relations: [RELATION_PREREQUISITE, RELATION_PART_OF], pathId });
  }
}

export const conceptGraphService = new ConceptGraphService();
export default conceptGraphService;
