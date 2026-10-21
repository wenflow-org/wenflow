/**
 * 图型计数（2026-10-21 真课回归）：同一节课 10 张位置线，而会话上限 4、同图型上限 3
 * 两道闸门一次都没触发——因为判据读的是回合内存里的消息快照。
 * 引擎改为按库里的侧表计数，这里锁定「按图型数得对、旧消息按位置线兜底」。
 */
const mockPrisma = {
  teaching_session_messages: { findMany: jest.fn() },
};

jest.mock('../../../config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { teachingSessionRepository } from '../TeachingSessionRepository';

describe('TeachingSessionRepository.countFiguresByKind', () => {
  beforeEach(() => mockPrisma.teaching_session_messages.findMany.mockReset());

  it('按图型统计侧表里已落库的图', async () => {
    mockPrisma.teaching_session_messages.findMany.mockResolvedValue([
      { payload: JSON.stringify({ role: 'assistant', figures: [{ kind: 'position-line' }, { kind: 'position-line' }] }) },
      { payload: JSON.stringify({ role: 'assistant', figures: [{ kind: 'compare' }] }) },
      { payload: JSON.stringify({ role: 'user', content: '没有图' }) },
      { payload: '不是 JSON' },
    ]);

    await expect(teachingSessionRepository.countFiguresByKind('s-1')).resolves.toEqual({
      'position-line': 2,
      compare: 1,
    });
  });

  it('旧消息没写 kind → 按位置线计（向后兼容）', async () => {
    mockPrisma.teaching_session_messages.findMany.mockResolvedValue([
      { payload: JSON.stringify({ role: 'assistant', figures: [{ marks: [] }] }) },
    ]);

    await expect(teachingSessionRepository.countFiguresByKind('s-2')).resolves.toEqual({ 'position-line': 1 });
  });
});
