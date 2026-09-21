/**
 * virtual-session-log-store（virtual_session_logs 子表）单元测试
 *
 * 锁定大 JSON 增量化的核心语义：
 * - 双读：侧表有行即权威；旧会话（侧表空）回退解析 logs 列
 * - 惰性播种：首写把列内容搬进侧表并把列置 null（原地回收）；二写不再播种
 * - 字节预算：超出裁最旧行，始终保留最新一条
 */
jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: {
    virtual_sessions: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    virtual_session_logs: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn()
    }
  }
}))

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}))

import prisma from '../../../config/database';
import {
  appendSessionLogs,
  loadSessionLogs,
  trimSessionLogRows
} from '../virtual-session-log-store';

const mockSessionFindUnique = prisma.virtual_sessions.findUnique as jest.Mock;
const mockSessionUpdate = prisma.virtual_sessions.update as jest.Mock;
const mockLogFindMany = prisma.virtual_session_logs.findMany as jest.Mock;
const mockLogCreateMany = prisma.virtual_session_logs.createMany as jest.Mock;
const mockLogDeleteMany = prisma.virtual_session_logs.deleteMany as jest.Mock;

function entry(phase: 'error' | 'teaching-response', sizeChars = 10) {
  return { timestamp: 't', phase, details: { output: { pad: 'x'.repeat(sizeChars) } } };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loadSessionLogs（双读）', () => {
  it('侧表有行 → 解析 payload 为权威内容，不回退列', async () => {
    mockLogFindMany.mockResolvedValueOnce([
      { id: 1, payload: JSON.stringify(entry('error')) },
      { id: 2, payload: JSON.stringify(entry('teaching-response')) }
    ]);

    const logs = await loadSessionLogs('s-1');

    expect(logs.map((item) => item.phase)).toEqual(['error', 'teaching-response']);
    expect(mockSessionFindUnique).not.toHaveBeenCalled();
  });

  it('侧表无行（旧会话）→ 回退解析 logs 列', async () => {
    mockLogFindMany.mockResolvedValueOnce([]);
    mockSessionFindUnique.mockResolvedValueOnce({ logs: JSON.stringify([entry('teaching-response')]) });

    const logs = await loadSessionLogs('s-legacy');

    expect(logs).toHaveLength(1);
    expect(logs[0].phase).toBe('teaching-response');
  });
});

describe('appendSessionLogs（惰性播种 + 预算裁剪）', () => {
  it('首写：播种列内容进侧表、列置 null，再追加新条目', async () => {
    mockLogFindMany
      .mockResolvedValueOnce([]) // 播种检查：侧表空
      .mockResolvedValueOnce([]); // 裁剪扫描：空
    mockSessionFindUnique.mockResolvedValueOnce({ logs: JSON.stringify([entry('teaching-response', 5)]) });

    await appendSessionLogs('s-1', [entry('error')]);

    expect(mockLogCreateMany).toHaveBeenCalledTimes(2);
    // 第一批 = 播种的旧行
    expect(mockLogCreateMany.mock.calls[0][0].data[0].sessionId).toBe('s-1');
    expect(JSON.parse(mockLogCreateMany.mock.calls[0][0].data[0].payload).phase).toBe('teaching-response');
    // 第二批 = 新条目
    expect(JSON.parse(mockLogCreateMany.mock.calls[1][0].data[0].payload).phase).toBe('error');
    // 列置 null（原地回收）
    expect(mockSessionUpdate).toHaveBeenCalledWith({ where: { id: 's-1' }, data: { logs: null } });
  });

  it('侧表已有行：不再播种、不再触碰列', async () => {
    mockLogFindMany
      .mockResolvedValueOnce([{ id: 7 }]) // 播种检查：侧表已有行
      .mockResolvedValueOnce([]); // 裁剪扫描：空

    await appendSessionLogs('s-1', [entry('error')]);

    expect(mockLogCreateMany).toHaveBeenCalledTimes(1);
    expect(mockSessionFindUnique).not.toHaveBeenCalled();
    expect(mockSessionUpdate).not.toHaveBeenCalled();
  });

  it('超出字节预算时裁最旧行，保留最新一条', async () => {
    mockLogFindMany
      .mockResolvedValueOnce([{ id: 7 }]) // 播种检查：侧表已有行
      .mockResolvedValueOnce([ // 裁剪扫描：3 行，总计超预算
        { id: 1, bytes: 900 },
        { id: 2, bytes: 900 },
        { id: 3, bytes: 500 }
      ]);
    mockLogDeleteMany.mockResolvedValueOnce({ count: 2 });

    await appendSessionLogs('s-1', [entry('error')], { budgetBytes: 1000 });

    // 从最新往前累计：500（id3）保留，+900（id2）=1400 超预算 → 保留 id3，删 id 1/2
    expect(mockLogDeleteMany).toHaveBeenCalledWith({ where: { id: { in: [1, 2] } } });
  });
});

describe('trimSessionLogRows', () => {
  it('预算内不动；至少保留最新一条', async () => {
    mockLogFindMany.mockResolvedValueOnce([{ id: 1, bytes: 100 }]);
    expect(await trimSessionLogRows('s-1', 1000)).toBe(0);
    expect(mockLogDeleteMany).not.toHaveBeenCalled();

    // 最新一条自身超预算 → 仍保留，不删
    mockLogFindMany.mockResolvedValueOnce([{ id: 1, bytes: 5000 }]);
    expect(await trimSessionLogRows('s-1', 1000)).toBe(0);
    expect(mockLogDeleteMany).not.toHaveBeenCalled();
  });
});
