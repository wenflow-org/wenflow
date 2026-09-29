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
  $queryRaw: jest.fn(),
};

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../teaching-session-progress.service', () => ({
  deriveTeachingSessionProgress: jest.fn(async () => new Map()),
}));

import { listTeachingSessionsDebug } from '../platform-teaching-sessions.service';

/** 服务返回 unknown（见其签名）：测试只关心这两个计数 */
type ListResult = { items: Array<{ messageCount: number; knowledgePointCount: number }> };

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

  it('knowledgePointCount 仍按 knowledgeState 长度给出', async () => {
    const result = (await call()) as unknown as ListResult;
    expect(result.items[0].knowledgePointCount).toBe(2);
  });
});
