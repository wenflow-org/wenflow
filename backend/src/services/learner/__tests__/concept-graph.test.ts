import {
  ConceptGraphService,
  RELATION_PREREQUISITE,
  RELATION_PART_OF,
  type ConceptGraphDeps,
} from '../concept-graph.service';

/**
 * 内存假 deps：模拟 `concept_edges` 的复合唯一键语义（重复 upsert 不新增行），
 * 以及概念注册表的"同名同身份"。测试不打 DB。
 */
function makeDeps() {
  const concepts = new Map<string, { id: string; canonicalLabel: string; level: string }>();
  const aliasToId = new Map<string, string>();
  const edges = new Map<string, { fromConceptId: string; toConceptId: string; relation: string; scope: string; pathId: string | null }>();
  const calls = { resolve: 0, upsert: 0 };
  let seq = 0;

  const deps: ConceptGraphDeps = {
    async resolveConcept(userId, text, options) {
      calls.resolve += 1;
      const label = String(text ?? '').trim();
      if (!label) return null;
      const key = `${userId}\u0000${label}`;
      const hit = aliasToId.get(key);
      if (hit) return { conceptId: hit };
      const id = `cpt_${++seq}`;
      concepts.set(id, { id, canonicalLabel: label, level: options?.level ?? 'kc' });
      aliasToId.set(key, id);
      return { conceptId: id };
    },
    async upsertEdge(data) {
      calls.upsert += 1;
      const key = [data.userId, data.fromConceptId, data.toConceptId, data.relation, data.scope, data.pathId ?? ''].join('\u0000');
      edges.set(key, { fromConceptId: data.fromConceptId, toConceptId: data.toConceptId, relation: data.relation, scope: data.scope, pathId: data.pathId });
    },
    async listEdges(where) {
      return [...edges.values()]
        .filter((e) => where.relations.includes(e.relation))
        .filter((e) => (where.scope ? e.scope === where.scope : true))
        .filter((e) => (where.pathId !== undefined ? e.pathId === where.pathId : true))
        .map((e) => ({ fromConceptId: e.fromConceptId, toConceptId: e.toConceptId, relation: e.relation, pathId: e.pathId }));
    },
    async findConcepts(ids) {
      return ids.map((id) => concepts.get(id)).filter((c): c is { id: string; canonicalLabel: string; level: string } => !!c);
    },
    async listConcepts() {
      return [...concepts.values()].map((c) => ({ id: c.id, canonicalLabel: c.canonicalLabel, level: c.level, taxonomy: null, originPathId: null }));
    },
    async listTraceMastery() { return []; },
    async listPathTitles(pathIds) { return pathIds.map((id) => ({ id, title: `路径 ${id}` })); },
  };
  return { deps, concepts, edges, calls, idOf: (label: string) => aliasToId.get(`u1\u0000${label}`)! };
}

const annotation = {
  kcGraph: {
    nodes: [
      { kcId: 'kc-1a', name: '识别列名差异' },
      { kcId: 'kc-1b', name: '按公共键对齐拼接' },
    ],
    // 实测标定语义：from 是 to 的前置
    edges: [{ from: 'kc-1a', to: 'kc-1b', relation: 'prerequisite' }],
  },
  conceptKcs: [
    { conceptId: 'concept-1', kcs: [{ kcId: 'kc-1a', name: '识别列名差异' }, { kcId: 'kc-1b', name: '按公共键对齐拼接' }] },
  ],
};
const core = { coreConcepts: [{ id: 'concept-1', name: '多源报表对齐' }] };

describe('materializePathGraph（图物化）', () => {
  it('物化 prerequisite 边，方向 = from 是 to 的前置', async () => {
    const { deps, idOf } = makeDeps();
    const svc = new ConceptGraphService(deps);
    const r = await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: annotation, cognitiveCore: core });
    expect(r.prerequisite).toBe(1);
    // 上游查询：以"按公共键对齐拼接"为起点，应取到"识别列名差异"
    const upstream = await svc.upstreamClosure('u1', idOf('按公共键对齐拼接'), { maxDepth: 1, pathId: 'p1' });
    expect(upstream).toEqual([{ conceptId: idOf('识别列名差异'), depth: 1, label: '识别列名差异' }]);
  });

  it('由 conceptKcs 嵌套推导 part_of（KC → coreConcept），不新增 LLM', async () => {
    const { deps, idOf } = makeDeps();
    const svc = new ConceptGraphService(deps);
    const r = await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: annotation, cognitiveCore: core });
    expect(r.partOf).toBe(2);
    const parents = await svc.neighbors('u1', idOf('识别列名差异'), { relations: [RELATION_PART_OF], direction: 'out', pathId: 'p1' });
    expect(parents.map((n) => n.label)).toEqual(['多源报表对齐']);
  });

  it('幂等：重复物化不新增边（复合唯一键去重）', async () => {
    const { deps, edges } = makeDeps();
    const svc = new ConceptGraphService(deps);
    await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: annotation, cognitiveCore: core });
    const sizeAfterFirst = edges.size;
    await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: annotation, cognitiveCore: core });
    expect(edges.size).toBe(sizeAfterFirst);
  });

  it('两端无法解析（节点名缺失）时跳过并计入 skipped，不抛', async () => {
    const { deps } = makeDeps();
    const svc = new ConceptGraphService(deps);
    const r = await svc.materializePathGraph({
      userId: 'u1', pathId: 'p1',
      kcAnnotation: { kcGraph: { nodes: [], edges: [{ from: 'kc-x', to: 'kc-y', relation: 'prerequisite' }] }, conceptKcs: [] },
      cognitiveCore: core,
    });
    expect(r.prerequisite).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it('自环（from === to）被跳过', async () => {
    const { deps } = makeDeps();
    const svc = new ConceptGraphService(deps);
    const r = await svc.materializePathGraph({
      userId: 'u1', pathId: 'p1',
      kcAnnotation: { kcGraph: { nodes: [{ kcId: 'kc-1a', name: '同名' }], edges: [{ from: 'kc-1a', to: 'kc-1a', relation: 'prerequisite' }] }, conceptKcs: [] },
      cognitiveCore: null,
    });
    expect(r.prerequisite).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it('缺 kcAnnotation / pathId 时安全返回零值', async () => {
    const { deps } = makeDeps();
    const svc = new ConceptGraphService(deps);
    expect(await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: null })).toEqual({ prerequisite: 0, partOf: 0, prerequisiteConcept: 0, skipped: 0 });
    expect(await svc.materializePathGraph({ userId: 'u1', pathId: '', kcAnnotation: annotation })).toEqual({ prerequisite: 0, partOf: 0, prerequisiteConcept: 0, skipped: 0 });
  });
});

/**
 * 层级错配修复（2026-09-23 实测发现）：`kcGraph.edges` 两端是 **KC 级**，任务当前概念是 **concept 级**，
 * 于是概念级节点上没有 prerequisite 边、`upstreamClosure` 恒空（真实数据 25/25 任务命中 0）。
 * 修复 = 物化时把 KC 级前置折叠到所属 coreConcept。下面钉死投影规则。
 */
describe('materializePathGraph（概念级前置投影）', () => {
  const crossCore = { coreConcepts: [{ id: 'concept-1', name: '报表阅读' }, { id: 'concept-2', name: '结论表达' }] };
  const crossAnnotation = {
    kcGraph: {
      nodes: [{ kcId: 'kc-a1', name: '读同比' }, { kcId: 'kc-b1', name: '写结论' }],
      edges: [{ from: 'kc-a1', to: 'kc-b1', relation: 'prerequisite' }],
    },
    conceptKcs: [
      { conceptId: 'concept-1', kcs: [{ kcId: 'kc-a1', name: '读同比' }] },
      { conceptId: 'concept-2', kcs: [{ kcId: 'kc-b1', name: '写结论' }] },
    ],
  };

  it('跨 coreConcept 的 KC 前置 → 产出 concept 级前置边，概念级上游闭包可用', async () => {
    const { deps, idOf } = makeDeps();
    const svc = new ConceptGraphService(deps);
    const r = await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: crossAnnotation, cognitiveCore: crossCore });
    expect(r.prerequisite).toBe(1);
    expect(r.prerequisiteConcept).toBe(1);
    // 关键：以**概念级**节点为起点也能取到上游（改造前这里恒为空）
    const upstream = await svc.upstreamClosure('u1', idOf('结论表达'), { maxDepth: 1, pathId: 'p1' });
    expect(upstream).toEqual([{ conceptId: idOf('报表阅读'), depth: 1, label: '报表阅读' }]);
  });

  it('同一 coreConcept 内部的 KC 前置不产生概念级自环', async () => {
    const { deps } = makeDeps();
    const svc = new ConceptGraphService(deps);
    // annotation 里 kc-1a / kc-1b 同属 concept-1
    const r = await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: annotation, cognitiveCore: core });
    expect(r.prerequisite).toBe(1);
    expect(r.prerequisiteConcept).toBe(0);
  });

  it('互为反向的投影对只保留一条（避免概念级两跳环）', async () => {
    const { deps } = makeDeps();
    const svc = new ConceptGraphService(deps);
    const r = await svc.materializePathGraph({
      userId: 'u1', pathId: 'p1', cognitiveCore: crossCore,
      kcAnnotation: {
        ...crossAnnotation,
        kcGraph: {
          nodes: crossAnnotation.kcGraph.nodes,
          edges: [
            { from: 'kc-a1', to: 'kc-b1', relation: 'prerequisite' },
            { from: 'kc-b1', to: 'kc-a1', relation: 'prerequisite' },
          ],
        },
      },
    });
    expect(r.prerequisite).toBe(2);
    expect(r.prerequisiteConcept).toBe(1);
  });

  it('缺 kcId→coreConcept 映射时只写 KC 级边，不凭空造概念级边', async () => {
    const { deps } = makeDeps();
    const svc = new ConceptGraphService(deps);
    const r = await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: crossAnnotation, cognitiveCore: null });
    expect(r.prerequisite).toBe(1);
    expect(r.prerequisiteConcept).toBe(0);
  });
});

describe('neighbors（1-hop 邻域）', () => {
  async function seeded() {
    const ctx = makeDeps();
    const svc = new ConceptGraphService(ctx.deps);
    await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: annotation, cognitiveCore: core });
    return { ...ctx, svc };
  }

  it('direction=in 只给前置；out 只给后继；both 都给', async () => {
    const { svc, idOf } = await seeded();
    const mid = idOf('识别列名差异');
    const incoming = await svc.neighbors('u1', mid, { relations: [RELATION_PREREQUISITE], direction: 'in', pathId: 'p1' });
    const outgoing = await svc.neighbors('u1', mid, { relations: [RELATION_PREREQUISITE], direction: 'out', pathId: 'p1' });
    expect(incoming).toEqual([]);                       // 它是起点，没有前置
    expect(outgoing.map((n) => n.label)).toEqual(['按公共键对齐拼接']);
  });

  it('limit 截断且不返回自身', async () => {
    const { svc, idOf } = await seeded();
    const all = await svc.neighbors('u1', idOf('识别列名差异'), { limit: 1, pathId: 'p1' });
    expect(all.length).toBe(1);
    expect(all.every((n) => n.conceptId !== idOf('识别列名差异'))).toBe(true);
  });

  it('limit 截断时**前置优先**（顺序确定，不受 DB 行序影响）', async () => {
    // 目标概念同时有：① 一条入向 prerequisite（来自跨概念的 KC 级前置投影）② 一条入向 part_of（子 KC）
    // 顺序若不确定，limit=1 会随机返回子 KC —— 改造前真实数据就是这样（返回的全是 part_of）。
    const { deps, idOf } = makeDeps();
    const svc = new ConceptGraphService(deps);
    const ann = {
      kcGraph: {
        nodes: [{ kcId: 'k1', name: '子KC' }, { kcId: 'k2', name: '前置KC' }],
        edges: [{ from: 'k2', to: 'k1', relation: 'prerequisite' }],
      },
      conceptKcs: [
        { conceptId: 'c1', kcs: [{ kcId: 'k1', name: '子KC' }] },
        { conceptId: 'c2', kcs: [{ kcId: 'k2', name: '前置KC' }] },
      ],
    };
    await svc.materializePathGraph({
      userId: 'u1', pathId: 'p1', kcAnnotation: ann,
      cognitiveCore: { coreConcepts: [{ id: 'c1', name: '目标概念' }, { id: 'c2', name: '前置概念' }] },
    });
    const top = await svc.neighbors('u1', idOf('目标概念'), { direction: 'in', limit: 1, pathId: 'p1' });
    expect(top.map((n) => n.label)).toEqual(['前置概念']);
    expect(top[0]!.relation).toBe(RELATION_PREREQUISITE);
  });
});

describe('upstreamClosure（上游闭包）', () => {
  it('多跳按 depth 去重取最小深度，且不因环死循环', async () => {
    const { deps, idOf } = makeDeps();
    const svc = new ConceptGraphService(deps);
    const ann = {
      kcGraph: {
        nodes: [{ kcId: 'a', name: 'A' }, { kcId: 'b', name: 'B' }, { kcId: 'c', name: 'C' }],
        edges: [
          { from: 'a', to: 'b', relation: 'prerequisite' },
          { from: 'b', to: 'c', relation: 'prerequisite' },
          { from: 'c', to: 'a', relation: 'prerequisite' }, // 环
        ],
      },
      conceptKcs: [],
    };
    await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: ann, cognitiveCore: null });
    const closure = await svc.upstreamClosure('u1', idOf('C'), { maxDepth: 3, pathId: 'p1' });
    const byId = Object.fromEntries(closure.map((c) => [c.conceptId, c.depth]));
    expect(byId[idOf('B')]).toBe(1);
    expect(byId[idOf('A')]).toBe(2);
    expect(byId[idOf('C')]).toBeUndefined(); // 起点不返回
  });

  it('maxDepth 生效', async () => {
    const { deps, idOf } = makeDeps();
    const svc = new ConceptGraphService(deps);
    const ann = {
      kcGraph: {
        nodes: [{ kcId: 'a', name: 'A' }, { kcId: 'b', name: 'B' }, { kcId: 'c', name: 'C' }],
        edges: [
          { from: 'a', to: 'b', relation: 'prerequisite' },
          { from: 'b', to: 'c', relation: 'prerequisite' },
        ],
      },
      conceptKcs: [],
    };
    await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: ann, cognitiveCore: null });
    const closure = await svc.upstreamClosure('u1', idOf('C'), { maxDepth: 1, pathId: 'p1' });
    expect(closure).toEqual([{ conceptId: idOf('B'), depth: 1, label: 'B' }]);
  });
});

describe('buildGraphView（图视图 + 路径筛选）', () => {
  const ann = (kcs: Array<[string, string]>, edges: Array<[string, string]>) => ({
    kcGraph: {
      nodes: kcs.map(([kcId, name]) => ({ kcId, name })),
      edges: edges.map(([from, to]) => ({ from, to, relation: 'prerequisite' })),
    },
    conceptKcs: [],
  });

  it('meta.paths 列出涉及到的路径；按 pathId 筛选后**候选仍完整**（下拉不缩水）', async () => {
    const { deps } = makeDeps();
    const svc = new ConceptGraphService(deps);
    await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: ann([['a', 'A'], ['b', 'B']], [['a', 'b']]), cognitiveCore: null });
    await svc.materializePathGraph({ userId: 'u1', pathId: 'p2', kcAnnotation: ann([['c', 'C'], ['d', 'D']], [['c', 'd']]), cognitiveCore: null });

    const all = await svc.buildGraphView('u1', {});
    expect(all.meta.paths.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(all.meta.edgeCount).toBe(2);

    const onlyP1 = await svc.buildGraphView('u1', { pathId: 'p1' });
    expect(onlyP1.meta.edgeCount).toBe(1);
    // 关键：候选来自**全量**边，筛选后仍能看到另一条路径（否则用户切过去就回不来）
    expect(onlyP1.meta.paths.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });
});
