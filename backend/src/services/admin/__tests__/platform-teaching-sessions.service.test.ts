/**
 * 教学会话列表性能护栏（2026-09-29）
 *
 * 病根：这一页只为「消息数」一列就把 teaching_sessions.messages 整列 JSON 读进 Node 再
 * JSON.parse 过滤——该列实测合计 197.7MB、单行最大 3.3MB，而列表页请求的是 limit=1000
 * （真实用户 215 行 / 含测试 472 行），实测 2.4s / 4.4s；加上控制台启动扇出，首行要到 ~5s。
 * 现在计数在库内聚合（侧表优先，无侧表行回退 json_each），messages 不再出现在 select 里。
 *
 * 本护栏锁两点，任一点回退都会让这一页重新变慢：
 *  1. 列表查询不得再 select messages（teachingState 同为无人读取的大 JSON 列，一并锁）；
 *  2. messageCount 由库内聚合给出，且口径仍是「用户消息数」（与改造前逐字一致）。
 */
const mockPrisma = {
  teaching_sessions: { count: jest.fn(), findMany: jest.fn() },
  // #105 读侧接入：行级收束观测按 taskId 批量查 learner_evidence（task:completed 投影行）
  learner_evidence: { findMany: jest.fn() },
  $queryRaw: jest.fn(),
};

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../teaching-session-progress.service', () => ({
  deriveTeachingSessionProgress: jest.fn(async () => new Map()),
}));

import { listTeachingSessionsDebug } from '../platform-teaching-sessions.service';

/** 服务返回 unknown（见其签名）：测试只关心这两个计数 */
type ListResult = { items: Array<{ messageCount: number; knowledgePointCount: number; endReason: string | null }> };

const baseSession = {
  id: 's1',
  userId: 'u1',
  taskId: 't1',
  learningPathId: 'p1',
  milestoneId: 'm1',
  subject: '数学',
  topic: '追及问题',
  taskType: 'practice',
  status: 'completed',
  startTime: new Date('2026-09-29T00:00:00Z'),
  endTime: null,
  duration: 600,
  knowledgeState: JSON.stringify([{ kcId: 'k1' }, { kcId: 'k2' }]),
  wrapup: null,
  advisory: null,
  users: { id: 'u1', name: '张三', email: 'z@example.com', isVirtualLearner: false },
};

const call = () =>
  listTeachingSessionsDebug({
    page: 1,
    limit: 1000,
    onlyWithAdvisory: false,
    onlyMissingWrapup: false,
    includeTest: true,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.teaching_sessions.count.mockResolvedValue(1);
  mockPrisma.teaching_sessions.findMany.mockResolvedValue([baseSession]);
  mockPrisma.learner_evidence.findMany.mockResolvedValue([]);
  mockPrisma.$queryRaw.mockResolvedValue([{ id: 's1', userCount: 3n }]);
});

describe('教学会话列表：大 JSON 列不得进查询', () => {
  it('select 里没有 messages / teachingState（knowledgeState 仍需要，用于知识点数）', async () => {
    await call();
    const select = mockPrisma.teaching_sessions.findMany.mock.calls[0][0].select;
    expect(select).toBeTruthy();
    expect(Object.keys(select)).not.toContain('messages');
    expect(Object.keys(select)).not.toContain('teachingState');
    expect(select.knowledgeState).toBe(true);
    expect(mockPrisma.teaching_sessions.findMany.mock.calls[0][0].include).toBeUndefined();
  });

  it('messageCount 来自库内聚合（BigInt 转数），且口径是用户消息', async () => {
    const result = (await call()) as unknown as ListResult;
    expect(result.items[0].messageCount).toBe(3);

    const sql = mockPrisma.$queryRaw.mock.calls[0][0].join('|');
    expect(sql).toContain('teaching_session_messages'); // 侧表优先
    expect(sql).toContain("json_extract(m.payload, '$.role') = 'user'");
    expect(sql).toContain('json_each(s.messages)'); // 无侧表行的历史会话回退
    expect(sql).toContain('json_type(s.messages)');
  });

  it('聚合缺行时回落 0，不抛错也不留 undefined', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const result = (await call()) as unknown as ListResult;
    expect(result.items[0].messageCount).toBe(0);
  });

  it('endReason 由库里 json_extract 取标量，teachingState 仍不进 Prisma select', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 's1', userCount: 3n, endReason: 'manual-end' }]);
    const result = (await call()) as unknown as ListResult;
    expect(result.items[0].endReason).toBe('manual-end');
    const sql = mockPrisma.$queryRaw.mock.calls[0][0].join('|');
    expect(sql).toContain("json_extract(s.teachingState, '$.sessionArtifacts.endReason')");
    const select = mockPrisma.teaching_sessions.findMany.mock.calls[0][0].select;
    expect(Object.keys(select)).not.toContain('teachingState');
  });

  it('endReason 缺失（老会话）回落 null，不编造', async () => {
    const result = (await call()) as unknown as ListResult;
    expect(result.items[0].endReason).toBeNull();
  });

  it('knowledgePointCount 仍按 knowledgeState 长度给出', async () => {
    const result = (await call()) as unknown as ListResult;
    expect(result.items[0].knowledgePointCount).toBe(2);
  });
});

/**
 * 路径收窄（2026-10-14，学习者详情页的页级「路径视角」开关）。
 * teaching_sessions.learningPathId 实测 248/248 非空（单列直连，无需 join）；
 * 不传即跨全部路径 = 本改动前的行为。
 */
describe('教学会话列表：按路径收窄', () => {
  const callWithPath = (pathId?: string) =>
    listTeachingSessionsDebug({
      page: 1,
      limit: 20,
      userId: 'u1',
      pathId,
      onlyWithAdvisory: false,
      onlyMissingWrapup: false,
      includeTest: true,
    });

  it('pathId 落 where.learningPathId（单列，不 join subtasks/milestones）', async () => {
    await callWithPath('p9');
    const where = mockPrisma.teaching_sessions.findMany.mock.calls[0][0].where;
    expect(where.learningPathId).toBe('p9');
    expect(where.userId).toBe('u1');
  });

  it('不传 pathId 时不加 learningPathId 条件（跨全部路径 = 原行为）', async () => {
    await callWithPath(undefined);
    const where = mockPrisma.teaching_sessions.findMany.mock.calls[0][0].where;
    expect(where.learningPathId).toBeUndefined();
  });

  it('列表行回带 learningPathId（前端据此校对作用域是否真的生效）', async () => {
    const result = (await callWithPath('p1')) as unknown as { items: Array<{ learningPathId: string | null }> };
    expect(result.items[0].learningPathId).toBe('p1');
  });
});

/**
 * #105 读侧接入：行级收束观测（轨道/通道）。
 * 数据 = learner_evidence 的 task:completed 投影行（payload 带 track/completionSource/
 * sessionId）。口径单点在 closure-observability.ts：
 * - 有 track 的行如实透传；
 * - 2026-10-18 前无 track 的历史行标 legacy —— 不用 users.isVirtualLearner 回填、不猜；
 * - 查无收束记录 → null（前端按中性「—」呈现）。
 */
describe('教学会话列表：行级收束观测（#105 轨道/通道）', () => {
  type ClosureResult = {
    items: Array<{ closure: { track: string; completionSource: string } | null }>;
  };

  it('批量按 taskId 查 task:completed 行，命中行透传 track/completionSource', async () => {
    mockPrisma.learner_evidence.findMany.mockResolvedValue([
      {
        taskId: 't1',
        payload: JSON.stringify({ taskId: 't1', track: 'virtual-learner', completionSource: 'vl-blackbox' }),
      },
    ]);
    const result = (await call()) as unknown as ClosureResult;

    expect(result.items[0].closure).toEqual({ track: 'virtual-learner', completionSource: 'vl-blackbox' });
    const query = mockPrisma.learner_evidence.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ evidenceType: 'task:completed', taskId: { in: ['t1'] } });
    expect(query.select).toEqual({ taskId: true, payload: true });
  });

  it('无 track 的历史行如实标 legacy（不回填、不混入新口径）', async () => {
    mockPrisma.learner_evidence.findMany.mockResolvedValue([
      { taskId: 't1', payload: JSON.stringify({ taskId: 't1', actualMinutes: 30 }) },
    ]);
    const result = (await call()) as unknown as ClosureResult;

    expect(result.items[0].closure).toEqual({ track: 'legacy', completionSource: 'unknown' });
  });

  it('同一任务多行（重完成）取最新一条', async () => {
    mockPrisma.learner_evidence.findMany.mockResolvedValue([
      { taskId: 't1', payload: JSON.stringify({ taskId: 't1', track: 'human', completionSource: 'teaching-finalize' }) },
      { taskId: 't1', payload: JSON.stringify({ taskId: 't1', track: 'virtual-learner', completionSource: 'vl-assisted' }) },
    ]);
    const result = (await call()) as unknown as ClosureResult;

    expect(result.items[0].closure).toEqual({ track: 'human', completionSource: 'teaching-finalize' });
    expect(mockPrisma.learner_evidence.findMany.mock.calls[0][0].orderBy).toEqual({ occurredAt: 'desc' });
  });

  it('查无收束记录 → null（未完成或事件未投影，不用身份回填）', async () => {
    mockPrisma.learner_evidence.findMany.mockResolvedValue([]);
    const result = (await call()) as unknown as ClosureResult;

    expect(result.items[0].closure).toBeNull();
  });
});
