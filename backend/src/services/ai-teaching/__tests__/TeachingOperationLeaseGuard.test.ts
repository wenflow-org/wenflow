const mockRenew = jest.fn();

jest.mock('../TeachingSessionRepository', () => ({
  TEACHING_OPERATION_RENEW_MS: 30_000,
  teachingSessionRepository: { renewOperationLease: mockRenew }
}));

jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
}));

import { TeachingOperationLeaseGuard } from '../TeachingOperationLeaseGuard';

describe('TeachingOperationLeaseGuard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRenew.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('每 30s 续租一次，stop 后不再续租', async () => {
    mockRenew.mockResolvedValue(true);
    const guard = new TeachingOperationLeaseGuard('s1', 'op1');
    guard.start();
    await jest.advanceTimersByTimeAsync(90_000);
    expect(mockRenew).toHaveBeenCalledTimes(3);
    expect(mockRenew).toHaveBeenCalledWith('s1', 'op1');
    guard.stop();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(mockRenew).toHaveBeenCalledTimes(3);
  });

  it('租约已被接管（renew 返回 false）时立即停止续租', async () => {
    mockRenew.mockResolvedValueOnce(false).mockResolvedValue(true);
    const guard = new TeachingOperationLeaseGuard('s1', 'op1');
    guard.start();
    await jest.advanceTimersByTimeAsync(90_000);
    expect(mockRenew).toHaveBeenCalledTimes(1);
    guard.stop();
  });

  it('单次续租异常只告警、不中断后续续租', async () => {
    mockRenew.mockRejectedValueOnce(new Error('db down')).mockResolvedValue(true);
    const guard = new TeachingOperationLeaseGuard('s1', 'op1');
    guard.start();
    await jest.advanceTimersByTimeAsync(90_000);
    expect(mockRenew).toHaveBeenCalledTimes(3);
    guard.stop();
  });
});
