/**
 * #35 调整建议处置埋点（recordAdvisoryResponse）语义测试：
 * - 保留/稍后/预览 → 合并写入 advisory.learnerResponse{action,at}，原字段一个不丢
 * - 无建议会话（shouldSuggest≠true / advisory 为空）→ no_advisory，不落库
 * - 非本人会话/不存在 → not_found，不落库
 */
const mockPrisma = {
  teaching_sessions: {
    update: jest.fn(),
  },
};

jest.mock('../../../config/database', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../../../config/system-database', () => ({
  __esModule: true,
  default: { $executeRawUnsafe: jest.fn().mockResolvedValue([]), $disconnect: jest.fn() },
}));

import { teachingSessionRepository } from '../TeachingSessionRepository';
import type { TeachingSessionRecord } from '../TeachingSessionRepository';

const baseRecord = {
  id: 'session-1',
  userId: 'user-1',
  advisory: {
    shouldSuggest: true,
    recommendation: 'reinforce',
    priority: 'medium',
    rationale: '连续两次卡在同一考点',
    ui: { title: '调整建议', body: '先巩固再前进', options: [] },
  },
} as unknown as TeachingSessionRecord;

describe('TeachingSessionRepository.recordAdvisoryResponse（#35 轻埋点）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('保留：learnerResponse 合并写入，原 advisory 字段保留', async () => {
    jest.spyOn(teachingSessionRepository, 'getById').mockResolvedValue(baseRecord);
    mockPrisma.teaching_sessions.update.mockResolvedValue({});

    const result = await teachingSessionRepository.recordAdvisoryResponse('session-1', 'user-1', 'keep');

    expect(result.status).toBe('ok');
    expect(result.advisory).toMatchObject({
      shouldSuggest: true,
      recommendation: 'reinforce',
      rationale: '连续两次卡在同一考点',
      learnerResponse: { action: 'keep' },
    });
    expect(typeof result.advisory?.learnerResponse.at).toBe('string');
    expect(mockPrisma.teaching_sessions.update).toHaveBeenCalledTimes(1);
    const updateArg = mockPrisma.teaching_sessions.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'session-1' });
    const persisted = JSON.parse(updateArg.data.advisory);
    expect(persisted.learnerResponse.action).toBe('keep');
    expect(persisted.recommendation).toBe('reinforce');
  });

  it('稍后/预览同样可写入（动作枚举透传）', async () => {
    jest.spyOn(teachingSessionRepository, 'getById').mockResolvedValue(baseRecord);
    mockPrisma.teaching_sessions.update.mockResolvedValue({});

    const later = await teachingSessionRepository.recordAdvisoryResponse('session-1', 'user-1', 'later');
    const preview = await teachingSessionRepository.recordAdvisoryResponse('session-1', 'user-1', 'preview');

    expect(later.advisory?.learnerResponse.action).toBe('later');
    expect(preview.advisory?.learnerResponse.action).toBe('preview');
    expect(mockPrisma.teaching_sessions.update).toHaveBeenCalledTimes(2);
  });

  it('无建议会话（shouldSuggest 非 true）→ no_advisory 且不落库', async () => {
    jest.spyOn(teachingSessionRepository, 'getById').mockResolvedValue({
      ...baseRecord,
      advisory: { shouldSuggest: false, recommendation: 'reinforce' },
    });

    const result = await teachingSessionRepository.recordAdvisoryResponse('session-1', 'user-1', 'keep');

    expect(result.status).toBe('no_advisory');
    expect(mockPrisma.teaching_sessions.update).not.toHaveBeenCalled();
  });

  it('非本人会话 → not_found 且不落库', async () => {
    jest.spyOn(teachingSessionRepository, 'getById').mockResolvedValue(baseRecord);

    const result = await teachingSessionRepository.recordAdvisoryResponse('session-1', 'user-2', 'keep');

    expect(result.status).toBe('not_found');
    expect(mockPrisma.teaching_sessions.update).not.toHaveBeenCalled();
  });

  it('会话不存在 → not_found 且不落库', async () => {
    jest.spyOn(teachingSessionRepository, 'getById').mockResolvedValue(null);

    const result = await teachingSessionRepository.recordAdvisoryResponse('missing', 'user-1', 'keep');

    expect(result.status).toBe('not_found');
    expect(mockPrisma.teaching_sessions.update).not.toHaveBeenCalled();
  });
});
