const mockAggregate = jest.fn();
const mockFindMany = jest.fn();

// 拦掉真实 PrismaClient（import 时会实例化并跑 PRAGMA），缓存行为只看这两个查询桩
jest.mock('../../../config/database', () => ({
  __esModule: true,
  prisma: {
    learning_paths: {
      aggregate: (...args: unknown[]) => mockAggregate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

import {
  __clearMaterialUsageCacheForTests,
  extractMaterialUsageFromTemplate,
  getMaterialUsageMap,
  summarizeMaterialUsage,
} from '../material-usage.service';

describe('extractMaterialUsageFromTemplate', () => {
  it('资料包多处副本只算一次采用；materialRefs 按条目去重计数', () => {
    const template = {
      normalizedInput: {
        resources: {
          materials: [
            {
              status: 'ok',
              pack: {
                materialId: 'm1',
                title: '公司合规手册',
                sections: [{ id: 's1', title: '总则', summary: '' }],
                keyPoints: [{ text: '要点', cite: '原文一', sourceUrl: 'attachment://a' }],
              },
            },
          ],
        },
      },
      // 同一份资料包在快照/阶段载荷里重复出现，不应重复计数
      pathAgentInput: {
        metadata: {
          normalizedInput: {
            resources: {
              materials: [{ pack: { materialId: 'm1', sections: [{ id: 's1', title: '总则', summary: '' }] } }],
            },
          },
        },
      },
      stageDesigns: {
        'stage-1': {
          inputPayload: { materials: [{ pack: { materialId: 'm1', sections: [] } }] },
        },
      },
      milestones: [
        {
          materialRefs: [{ materialId: 'm1', sectionId: 's1', quote: '原文一' }],
          subtasks: [
            {
              materialRefs: [
                { materialId: 'm1', sectionId: 's1', quote: '原文一' },
                { materialId: 'm1', sectionId: 's2', quote: '原文二' },
                { materialId: 'm2', sectionId: 's9', quote: '另一份资料' },
              ],
            },
          ],
        },
      ],
    };

    const result = extractMaterialUsageFromTemplate(template);
    expect([...result.adoptedIds]).toEqual(['m1']);
    expect(result.refCounts.get('m1')).toBe(2);
    expect(result.refCounts.get('m2')).toBe(1);
  });

  it('没有引用/资料包的模板返回空', () => {
    const result = extractMaterialUsageFromTemplate({ milestones: [{ title: '阶段' }] });
    expect(result.adoptedIds.size).toBe(0);
    expect(result.refCounts.size).toBe(0);
  });
});

describe('summarizeMaterialUsage', () => {
  it('按路径汇总采用与引用，并跳过损坏模板', () => {
    const packOf = (id: string) => ({
      normalizedInput: { resources: { materials: [{ pack: { materialId: id, sections: [{ id: `${id}-s1` }] } }] } },
    });
    const rows = [
      {
        id: 'p-old',
        title: '旧路径',
        updatedAt: '2026-10-01T00:00:00.000Z',
        aiPromptTemplate: JSON.stringify({
          ...packOf('m1'),
          milestones: [{ materialRefs: [{ materialId: 'm1', sectionId: 'm1-s1', quote: '引文' }] }],
        }),
      },
      {
        id: 'p-new',
        name: '新路径',
        updatedAt: '2026-10-20T00:00:00.000Z',
        aiPromptTemplate: JSON.stringify({
          milestones: [{ materialRefs: [{ materialId: 'm1', sectionId: 's2', quote: '只有引用' }] }],
        }),
      },
      {
        id: 'p-broken',
        title: '坏模板',
        aiPromptTemplate: '{not json',
      },
      {
        id: 'p-empty',
        title: '无资料',
        aiPromptTemplate: JSON.stringify({ milestones: [{ title: '阶段' }] }),
      },
    ];

    const usage = summarizeMaterialUsage(rows as unknown as Parameters<typeof summarizeMaterialUsage>[0]);
    const m1 = usage.get('m1');
    expect(m1).toBeDefined();
    expect(m1!.pathCount).toBe(2);
    expect(m1!.adoptedPathCount).toBe(1);
    expect(m1!.refCount).toBe(2);
    // 最近更新的路径排前面
    expect(m1!.paths.map((path) => path.pathId)).toEqual(['p-new', 'p-old']);
    expect(m1!.paths[1]).toEqual({
      pathId: 'p-old',
      pathTitle: '旧路径',
      adopted: true,
      refCount: 1,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
  });
});

describe('getMaterialUsageMap 缓存', () => {
  const packRow = (materialId: string, pathId: string, title: string, updatedAt: string) => ({
    id: pathId,
    title,
    aiPromptTemplate: JSON.stringify({
      normalizedInput: {
        resources: { materials: [{ pack: { materialId, sections: [{ id: 's1' }] } }] },
      },
    }),
    updatedAt: new Date(updatedAt),
  });

  beforeEach(() => {
    __clearMaterialUsageCacheForTests();
    mockAggregate.mockReset();
    mockFindMany.mockReset();
    delete process.env.MATERIAL_USAGE_CACHE_TTL_MS;
  });

  afterEach(() => {
    delete process.env.MATERIAL_USAGE_CACHE_TTL_MS;
  });

  it('同 signature 二次调用命中缓存：不重查模板，仅做轻量 signature 比对', async () => {
    mockAggregate.mockResolvedValue({
      _max: { updatedAt: new Date('2026-10-01T00:00:00.000Z') },
      _count: { _all: 1 },
    });
    mockFindMany.mockResolvedValue([packRow('m1', 'p1', '路径一', '2026-10-01T00:00:00.000Z')]);

    const first = await getMaterialUsageMap('u1');
    const second = await getMaterialUsageMap('u1');

    expect(first.get('m1')).toBeDefined();
    expect(second).toBe(first); // 同一 Map 实例，未重算
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockAggregate).toHaveBeenCalledTimes(2); // 每次命中缓存都查一次签名
    expect(mockAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } })
    );
  });

  it('signature 变化（新路径生成）→ 不等 TTL 立即重算', async () => {
    mockAggregate.mockResolvedValue({
      _max: { updatedAt: new Date('2026-10-01T00:00:00.000Z') },
      _count: { _all: 1 },
    });
    mockFindMany.mockResolvedValue([packRow('m1', 'p1', '路径一', '2026-10-01T00:00:00.000Z')]);
    await getMaterialUsageMap('u1');

    mockAggregate.mockResolvedValue({
      _max: { updatedAt: new Date('2026-10-02T00:00:00.000Z') },
      _count: { _all: 2 },
    });
    mockFindMany.mockResolvedValue([packRow('m2', 'p2', '新路径', '2026-10-02T00:00:00.000Z')]);

    const usage = await getMaterialUsageMap('u1');

    expect(mockFindMany).toHaveBeenCalledTimes(2); // 立即重算，不受 60s TTL 影响
    expect(usage.get('m2')).toBeDefined();
  });

  it('TTL=0 时禁用缓存：每次调用都全量重查，不查 signature', async () => {
    process.env.MATERIAL_USAGE_CACHE_TTL_MS = '0';
    mockFindMany.mockResolvedValue([packRow('m1', 'p1', '路径一', '2026-10-01T00:00:00.000Z')]);

    const first = await getMaterialUsageMap('u1');
    const second = await getMaterialUsageMap('u1');

    expect(mockFindMany).toHaveBeenCalledTimes(2);
    expect(mockAggregate).not.toHaveBeenCalled();
    expect(second.get('m1')).toBeDefined();
    expect(second).not.toBe(first); // 无缓存，各自独立结果
  });
});
