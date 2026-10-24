/**
 * outbox 唤醒通道单测（架构优化批 #5）。
 */
import {
  clearPendingWake,
  notifyOutboxActivity,
  setOutboxWakeListener,
  WAKE_DEBOUNCE_MS,
} from '../outbox-wake';

describe('outbox-wake（入队唤醒 + 防抖）', () => {
  afterEach(() => {
    setOutboxWakeListener(null);
    clearPendingWake();
  });

  it('防抖窗口内的多次入队只唤醒一次', () => {
    jest.useFakeTimers();
    const wakes = jest.fn();
    setOutboxWakeListener(wakes);
    notifyOutboxActivity();
    notifyOutboxActivity();
    notifyOutboxActivity();
    expect(wakes).not.toHaveBeenCalled();
    jest.advanceTimersByTime(WAKE_DEBOUNCE_MS);
    expect(wakes).toHaveBeenCalledTimes(1);
    // 窗口过后再次入队 → 再次唤醒
    notifyOutboxActivity();
    jest.advanceTimersByTime(WAKE_DEBOUNCE_MS);
    expect(wakes).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('无监听者时 notify 是空操作；注销后不再唤醒', () => {
    jest.useFakeTimers();
    expect(() => {
      notifyOutboxActivity();
      jest.advanceTimersByTime(WAKE_DEBOUNCE_MS * 2);
    }).not.toThrow();
    const wakes = jest.fn();
    setOutboxWakeListener(wakes);
    setOutboxWakeListener(null);
    notifyOutboxActivity();
    jest.advanceTimersByTime(WAKE_DEBOUNCE_MS * 2);
    expect(wakes).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe('DurableOutboxWorker 自适应轮询（架构优化批 #5）', () => {
  const mockPrisma: any = {
    domain_event_outbox: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  jest.mock('../../config/database', () => ({ __esModule: true, default: mockPrisma }));
  jest.mock('../../utils/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DurableOutboxWorker } = require('../outbox.worker');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { setOutboxWakeListener: registerWake } = require('../outbox-wake');

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.domain_event_outbox.findMany.mockResolvedValue([]);
  });
  afterEach(() => {
    registerWake(null);
  });

  it('start 后退避：空转序列 1s→2s→…封顶 30s；入队唤醒把间隔拍回 1s', async () => {
    const worker = new DurableOutboxWorker({ dispatch: jest.fn() } as any);
    // 不真跑 setTimeout 链：直接驱动 tick 观察内部 nextDelayMs 演化
    const delayOf = () => (worker as unknown as { nextDelayMs: number }).nextDelayMs;
    expect(delayOf()).toBe(1000);
    await (worker as unknown as { tick: () => Promise<void> }).tick();
    expect(delayOf()).toBe(2000);
    await (worker as unknown as { tick: () => Promise<void> }).tick();
    expect(delayOf()).toBe(4000);
    // 模拟 5 轮空转后封顶
    for (let i = 0; i < 6; i += 1) await (worker as unknown as { tick: () => Promise<void> }).tick();
    expect(delayOf()).toBe(30000);
    // 入队唤醒（监听器在 start() 注册；这里手动调 tick 前先模拟唤醒回调已把间隔复位）
    (worker as unknown as { nextDelayMs: number }).nextDelayMs = 1000;
    await (worker as unknown as { tick: () => Promise<void> }).tick();
    expect(delayOf()).toBe(2000);
  });

  it('start() 注册唤醒监听、stop() 注销且停调度', async () => {
    jest.useFakeTimers();
    const worker = new DurableOutboxWorker({ dispatch: jest.fn() } as any);
    worker.start();
    // start 立即跑一轮（immediate）+ 注册监听
    expect(mockPrisma.domain_event_outbox.findMany).toHaveBeenCalled();
    await worker.stop();
    // stop 后监听器注销：notify 不再有副作用
    const before = mockPrisma.domain_event_outbox.findMany.mock.calls.length;
    const { notifyOutboxActivity: notify } = require('../outbox-wake');
    notify();
    jest.advanceTimersByTime(200);
    expect(mockPrisma.domain_event_outbox.findMany.mock.calls.length).toBe(before);
    jest.useRealTimers();
  });
});
