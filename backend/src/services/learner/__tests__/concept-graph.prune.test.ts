/**
 * #173-2：概念图重建的「幽灵边」回归。
 *
 * 现象：`materializePathGraph` 只 upsert、不清旧边。replace-path / 重跑 kc-mapper 时，
 * 旧 KC 解析出的边按同一 `pathId` 残留在 `concept_edges`，读侧（上游闭包 / 邻域 / 图视图）
 * 把已经不在路径图里的概念当成前置/后继，条数也恒大于当前图。
 *
 * 本测试**走生产依赖**（`new ConceptGraphService()` 的 defaultDeps + 假 prisma 表），
 * 而不是注入 fake deps，故能抓住「defaultDeps 没接清边」这种接线漏配：
 * 假表实现 concept_edges 的复合唯一键（userId,from,to,relation,scope,pathId），
 * 与真实 schema.prisma 的 @@unique 同口径。
 */
jest.mock('../../../config/database', () => {
  type Row = {
    id: string;
    userId: string;
    fromConceptId: string;
    toConceptId: string;
    relation: string;
    scope: string;
    pathId: string | null;
    source: string;
  };
  const rows: Row[] = [];
  const keyOf = (row: Row) =>
    [row.userId, row.fromConceptId, row.toConceptId, row.relation, row.scope, row.pathId ?? ''].join('|');

  const conceptEdges = {
    __rows: rows,
    deleteMany: jest.fn(async ({ where }: { where: { userId?: string; pathId?: string | null; scope?: string } }) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i]!;
        if (where.userId !== undefined && row.userId !== where.userId) continue;
        if (where.pathId !== undefined && row.pathId !== where.pathId) continue;
        if (where.scope !== undefined && row.scope !== where.scope) continue;
        rows.splice(i, 1);
        count += 1;
      }
      return { count };
    }),
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((row) =>
        row.userId === where.userId
        && row.fromConceptId === where.fromConceptId
        && row.toConceptId === where.toConceptId
        && row.relation === where.relation
        && row.scope === where.scope
        && row.pathId === ((where.pathId ?? null) as string | null)
      ) ?? null),
    upsert: jest.fn(async ({ create }: { create: Row }) => {
      const key = keyOf(create);
      if (!rows.some((row) => keyOf(row) === key)) rows.push({ ...create });
      return create;
    }),
    create: jest.fn(async ({ data }: { data: Row }) => {
      rows.push({ ...data });
      return data;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const hit = rows.find((row) => row.id === where.id);
      if (hit) Object.assign(hit, data);
      return hit ?? { id: where.id, ...data };
    }),
  };

  return { __esModule: true, default: { concept_edges: conceptEdges } };
});

jest.mock('../concept-registry.service', () => ({
  __esModule: true,
  conceptRegistryService: {
    // 同名同 level 恒得同一 id：与真实注册表的「同名同身份」语义一致
    resolveConcept: jest.fn(async (_userId: string, text: unknown, options?: { level?: string }) =>
      String(text ?? '').trim() ? { conceptId: `cpt:${options?.level ?? 'kc'}:${String(text).trim()}` } : null),
    registerAlias: jest.fn(async () => ({ registered: true })),
  },
}));

import prisma from '../../../config/database';
import { ConceptGraphService, SCOPE_PATH, SCOPE_USER } from '../concept-graph.service';

type EdgeRow = {
  userId: string;
  fromConceptId: string;
  toConceptId: string;
  relation: string;
  scope: string;
  pathId: string | null;
};
const mockTable = (prisma as unknown as { concept_edges: { __rows: EdgeRow[]; deleteMany: jest.Mock } }).concept_edges;
const mockRows = mockTable.__rows;

const roundOne = {
  kcGraph: {
    nodes: [{ kcId: 'kc-1a', name: '旧KC-前置' }, { kcId: 'kc-1b', name: '旧KC-后继' }],
    edges: [{ from: 'kc-1a', to: 'kc-1b', relation: 'prerequisite' }],
  },
  conceptKcs: [
    { conceptId: 'concept-1', kcs: [{ kcId: 'kc-1a', name: '旧KC-前置' }, { kcId: 'kc-1b', name: '旧KC-后继' }] },
  ],
};
const roundOneCore = { coreConcepts: [{ id: 'concept-1', name: '旧核心概念' }] };

/** 重建后的新图：KC 全换（replace-path 后模型重新命名的常见形态） */
const roundTwo = {
  kcGraph: {
    nodes: [{ kcId: 'kc-2a', name: '新KC-前置' }, { kcId: 'kc-2b', name: '新KC-后继' }],
    edges: [{ from: 'kc-2a', to: 'kc-2b', relation: 'prerequisite' }],
  },
  conceptKcs: [
    { conceptId: 'concept-2', kcs: [{ kcId: 'kc-2a', name: '新KC-前置' }, { kcId: 'kc-2b', name: '新KC-后继' }] },
  ],
};
const roundTwoCore = { coreConcepts: [{ id: 'concept-2', name: '新核心概念' }] };

const pathRows = (userId: string, pathId: string) =>
  mockRows.filter((row) => row.userId === userId && row.pathId === pathId && row.scope === SCOPE_PATH);
const userRows = (userId: string) => mockRows.filter((row) => row.userId === userId && row.scope === SCOPE_USER);

describe('#173-2 概念图重建清旧边（幽灵边回归）', () => {
  beforeEach(() => {
    mockRows.length = 0;
    jest.clearAllMocks();
  });

  it('重建路径后：边数等于新图边数，旧 KC 的边不再存在', async () => {
    const svc = new ConceptGraphService();
    const first = await svc.materializePathGraph({
      userId: 'u1', pathId: 'p1', kcAnnotation: roundOne, cognitiveCore: roundOneCore,
    });
    // 首轮：1 条 KC 级前置（path）+ 2 条 part_of（path）+ 1 条用户级投影（user，pathId=null）
    expect(pathRows('u1', 'p1')).toHaveLength(3);
    expect(first.prerequisite).toBe(1);
    expect(first.partOf).toBe(2);
    expect(pathRows('u1', 'p1').some((row) => row.fromConceptId.includes('旧KC'))).toBe(true);

    const second = await svc.materializePathGraph({
      userId: 'u1', pathId: 'p1', kcAnnotation: roundTwo, cognitiveCore: roundTwoCore,
    });

    // 核心断言：表里 path 级边 = 新图的边（而不是新旧叠加的 6 条）
    const rowsAfter = pathRows('u1', 'p1');
    expect(rowsAfter).toHaveLength(3);
    expect(rowsAfter).toHaveLength(second.prerequisite + second.partOf + second.prerequisiteConcept);
    // 旧边不再存在
    expect(rowsAfter.filter((row) => row.fromConceptId.includes('旧KC') || row.toConceptId.includes('旧KC'))).toEqual([]);
    expect(rowsAfter.filter((row) => row.fromConceptId.includes('旧核心概念') || row.toConceptId.includes('旧核心概念'))).toEqual([]);
    // 新边在
    expect(rowsAfter.some((row) => row.toConceptId === 'cpt:kc:新KC-后继')).toBe(true);

    // 清边口径：(userId, pathId) + scope='path'
    expect(mockTable.deleteMany).toHaveBeenLastCalledWith({
      where: { userId: 'u1', pathId: 'p1', scope: SCOPE_PATH },
    });
  });

  it('清边只清本路径 path 级行：user 级跨路径聚合边不动，其他路径不受影响', async () => {
    const svc = new ConceptGraphService();
    await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: roundOne, cognitiveCore: roundOneCore });
    await svc.materializePathGraph({ userId: 'u1', pathId: 'p2', kcAnnotation: roundTwo, cognitiveCore: roundTwoCore });
    const userBefore = userRows('u1').length;
    expect(userBefore).toBeGreaterThan(0);

    await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: roundTwo, cognitiveCore: roundTwoCore });

    expect(userRows('u1')).toHaveLength(userBefore);
    expect(pathRows('u1', 'p2')).toHaveLength(3);
    expect(pathRows('u1', 'p2').some((row) => row.toConceptId === 'cpt:kc:新KC-后继')).toBe(true);
  });

  it('缺 userId/pathId/kcAnnotation 时不清边（早退于清边之前）', async () => {
    const svc = new ConceptGraphService();
    await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: roundOne, cognitiveCore: roundOneCore });
    expect(pathRows('u1', 'p1')).toHaveLength(3);

    await svc.materializePathGraph({ userId: 'u1', pathId: 'p1', kcAnnotation: null });
    await svc.materializePathGraph({ userId: '', pathId: 'p1', kcAnnotation: roundOne });

    expect(pathRows('u1', 'p1')).toHaveLength(3);
    expect(mockTable.deleteMany).toHaveBeenCalledTimes(1);
  });
});
