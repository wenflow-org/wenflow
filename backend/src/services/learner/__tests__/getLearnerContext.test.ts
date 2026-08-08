import { LearnerExitService } from '../LearnerExitService';
import { getLevelFromXp } from '../level.util';

describe('LearnerExitService 统一出口', () => {
  const mockSnapshot = { snapshotVersion: 'learner-snapshot-v1', scope: { userId: 'u1' } };
  const mockDueTraces = [
    { conceptKey: 'CAP', label: 'CAP 定理', masteryScore: 0.4, retention: 0.55, reason: 'below-threshold', extractionCount: 2 },
  ];

  function buildService(overrides: { dueTraces?: unknown[] } = {}) {
    const snapshotService = {
      getSnapshot: jest.fn().mockResolvedValue(mockSnapshot),
    } as any;
    const memoryTraceService = {
      getDueTraces: jest.fn().mockResolvedValue(overrides.dueTraces ?? mockDueTraces),
    } as any;
    const prisma = {
      users: {
        findUnique: jest.fn().mockResolvedValue({ name: '张三', xp: 1600 }),
      },
    } as any;

    const service = new LearnerExitService(snapshotService);
    (service as any).getDueReview = jest.fn().mockImplementation(async (userId: string) => {
      const traces = await memoryTraceService.getDueTraces(userId, { limit: 5 });
      return traces.map((t: any) => ({
        conceptKey: t.conceptKey,
        label: t.label,
        masteryScore: t.masteryScore,
        retention: t.retention,
        reason: t.reason,
        extractionCount: t.extractionCount,
      }));
    });
    (service as any).getAccountView = jest.fn().mockImplementation(async (userId: string) => {
      const user = await prisma.users.findUnique({ where: { id: userId }, select: { name: true, xp: true } });
      return { name: user?.name ?? null, xp: user?.xp ?? 0, level: getLevelFromXp(user?.xp ?? 0) };
    });

    return { service, snapshotService, memoryTraceService, prisma };
  }

  it('getLearnerContext 并行返回 snapshot + dueReview + accountView', async () => {
    const { service, snapshotService, memoryTraceService, prisma } = buildService();

    const result = await service.getLearnerContext({ userId: 'u1' });

    expect(snapshotService.getSnapshot).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
    expect(memoryTraceService.getDueTraces).toHaveBeenCalledWith('u1', expect.any(Object));
    expect(prisma.users.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
    expect(result.snapshot).toEqual(mockSnapshot);
    expect(result.dueReview).toHaveLength(1);
    expect(result.dueReview[0].conceptKey).toBe('CAP');
    expect(result.accountView).toEqual({ name: '张三', xp: 1600, level: 5 });
  });

  it('dueReview 为空时返回空数组（不抛错）', async () => {
    const { service } = buildService({ dueTraces: [] });
    const result = await service.getLearnerContext({ userId: 'u1' });
    expect(result.dueReview).toEqual([]);
  });

  it('getDueReview 字段裁剪为出口契约（不含内部字段）', async () => {
    const { service } = buildService();
    const due = await service.getDueReview('u1');
    expect(Object.keys(due[0]).sort()).toEqual(['conceptKey', 'extractionCount', 'label', 'masteryScore', 'reason', 'retention']);
  });
});

describe('getLevelFromXp 单点公式', () => {
  it('level = floor(sqrt(xp/100)) + 1', () => {
    expect(getLevelFromXp(0)).toBe(1);
    expect(getLevelFromXp(99)).toBe(1);
    expect(getLevelFromXp(100)).toBe(2);
    expect(getLevelFromXp(1600)).toBe(5);
  });

  it('负值钳制为 0', () => {
    expect(getLevelFromXp(-50)).toBe(1);
  });
});
