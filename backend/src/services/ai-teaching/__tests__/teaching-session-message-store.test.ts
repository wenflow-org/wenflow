/**
 * teaching-session-message-store（teaching_session_messages 子表）单元测试
 *
 * 锁定大 JSON 增量化 #2 的核心语义：
 * - 双读：侧表有行即权威；侧表无行返回 null（调用方回退列）
 * - 惰性播种：首写把列内容搬进侧表并把列置 null；侧表已有行不再播种
 * - 基线校验：侧表行数 ≠ baseCount → TeachingMessageBaseStaleError；一致则仅 INSERT 增量
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    teaching_sessions: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    teaching_session_messages: {
      findMany: jest.fn(),
      count: jest.fn(),
      createMany: jest.fn()
    }
  }
}))

import prisma from '../../../config/database';
import {
  appendTeachingMessages,
  commitTeachingMessages,
  hydrateTeachingSessionMessages,
  loadTeachingMessages,
  TeachingMessageBaseStaleError
} from '../teaching-session-message-store';

const mockSessionFindUnique = prisma.teaching_sessions.findUnique as jest.Mock;
const mockSessionUpdate = prisma.teaching_sessions.update as jest.Mock;
const mockRowsFindMany = prisma.teaching_session_messages.findMany as jest.Mock;
const mockRowCount = prisma.teaching_session_messages.count as jest.Mock;
const mockCreateMany = prisma.teaching_session_messages.createMany as jest.Mock;

function message(content: string) {
  return { role: 'user' as const, content, timestamp: 't' };
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('loadTeachingMessages / hydrate（双读）', () => {
  it('侧表有行 → 返回权威内容；侧表无行 → 返回 null（回退列）', async () => {
    mockRowsFindMany.mockResolvedValueOnce([
      { id: 1, payload: JSON.stringify(message('hello')) }
    ]);
    expect(await loadTeachingMessages('s-1')).toHaveLength(1);
    expect(mockSessionFindUnique).not.toHaveBeenCalled();

    mockRowsFindMany.mockResolvedValueOnce([]);
    expect(await loadTeachingMessages('s-legacy')).toBeNull();
  });

  it('hydrate：侧表有行覆写 record.messages；无行不动', async () => {
    mockRowsFindMany.mockResolvedValueOnce([
      { id: 1, payload: JSON.stringify(message('from-store')) }
    ]);
    const record = { id: 's-1', messages: [message('from-column')] };
    await hydrateTeachingSessionMessages(record);
    expect(record.messages[0].content).toBe('from-store');

    mockRowsFindMany.mockResolvedValueOnce([]);
    const untouched = { id: 's-2', messages: [message('kept')] };
    await hydrateTeachingSessionMessages(untouched);
    expect(untouched.messages[0].content).toBe('kept');
  });
});

describe('commitTeachingMessages（播种 + 基线校验 + 增量）', () => {
  it('首写：播种列内容、列置 null，基线一致只落增量', async () => {
    mockRowsFindMany
      .mockResolvedValueOnce([])   // 播种检查：侧表空
      .mockResolvedValueOnce([]);  // 未使用（count 走 count）
    mockSessionFindUnique.mockResolvedValueOnce({
      messages: JSON.stringify([message('opening')])
    });
    mockRowCount.mockResolvedValueOnce(1); // 播种后基线 = 1

    const added = await commitTeachingMessages('s-1', 1, [message('opening'), message('user turn')]);

    expect(added).toBe(1);
    expect(mockSessionUpdate).toHaveBeenCalledWith({ where: { id: 's-1' }, data: { messages: null } });
    // 两次 createMany：第一次播种旧行，第二次落增量
    expect(mockCreateMany).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockCreateMany.mock.calls[0][0].data[0].payload).content).toBe('opening');
    const additions = mockCreateMany.mock.calls[1][0].data;
    expect(additions).toHaveLength(1);
    expect(JSON.parse(additions[0].payload).content).toBe('user turn');
  });

  it('基线漂移（侧表行数 ≠ baseCount）→ TeachingMessageBaseStaleError，不落库', async () => {
    mockRowsFindMany.mockResolvedValueOnce([{ id: 7 }]); // 侧表已有行
    mockRowCount.mockResolvedValueOnce(5);

    await expect(commitTeachingMessages('s-1', 4, [message('a'), message('b'), message('c'), message('d')]))
      .rejects.toBeInstanceOf(TeachingMessageBaseStaleError);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it('fullMessages 短于基线 → 拒绝', async () => {
    mockRowsFindMany.mockResolvedValueOnce([{ id: 7 }]);
    mockRowCount.mockResolvedValueOnce(3);

    await expect(commitTeachingMessages('s-1', 3, [message('only')]))
      .rejects.toBeInstanceOf(TeachingMessageBaseStaleError);
  });
});

describe('appendTeachingMessages（伴学路径）', () => {
  it('播种后直接 INSERT 给定消息，不做基线对账', async () => {
    mockRowsFindMany.mockResolvedValueOnce([]); // 播种检查：侧表空
    mockSessionFindUnique.mockResolvedValueOnce({ messages: '[]' }); // 空列无需播种

    await appendTeachingMessages('s-1', [message('peer hi')]);

    expect(mockSessionUpdate).not.toHaveBeenCalled();
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockCreateMany.mock.calls[0][0].data[0].payload).content).toBe('peer hi');
  });
});
