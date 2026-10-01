import { RpmLimiter } from '../rpm-limiter';
import { normalizePlatformReliabilitySettings } from '../../../services/reliability-settings.service';
import { normalizeVirtualLabSettings } from '../../../services/virtual-lab-settings.service';

describe('RpmLimiter 令牌桶', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rpm=0（不限）：立即放行，仅计在途', async () => {
    const limiter = new RpmLimiter('t', 0);
    const release = await limiter.acquire();
    expect(limiter.stats()).toMatchObject({ rpm: 0, inFlight: 1, queued: 0 });
    release();
    expect(limiter.stats().inFlight).toBe(0);
  });

  it('rpm=60（1 req/s）：超预算则等待令牌，不报错', async () => {
    jest.useFakeTimers();
    const limiter = new RpmLimiter('t', 60);
    const release1 = await limiter.acquire(); // 桶容量 1 → 立即
    expect(limiter.stats().available).toBe(0);

    let resolved = false;
    const pending = limiter.acquire().then((r) => { resolved = true; return r; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(limiter.stats().queued).toBe(1);

    await jest.advanceTimersByTimeAsync(1100);
    const release2 = await pending;
    expect(resolved).toBe(true);
    expect(limiter.stats().queued).toBe(0);

    release1();
    release2();
  });

  it('setRpm 可即时放宽并唤醒排队者', async () => {
    jest.useFakeTimers();
    const limiter = new RpmLimiter('t', 60);
    const release1 = await limiter.acquire();
    let resolved = false;
    const pending = limiter.acquire().then((r) => { resolved = true; return r; });
    await Promise.resolve();
    expect(resolved).toBe(false);

    limiter.setRpm(0); // 放宽为不限
    await Promise.resolve();
    const release2 = await pending;
    expect(resolved).toBe(true);
    release1();
    release2();
  });

  it('maxWaitMs：排队超时返回 null（快速失败护栏），且把 waiter 从队列摘除', async () => {
    jest.useFakeTimers();
    const limiter = new RpmLimiter('t', 60);
    const release1 = await limiter.acquire();
    const pending = limiter.acquire({ maxWaitMs: 500 });
    await Promise.resolve();
    expect(limiter.stats().queued).toBe(1);

    await jest.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(result).toBeNull();
    expect(limiter.stats().queued).toBe(0); // 超时者已离队，不占队列

    // 之后令牌恢复仍可正常获取（离队不影响后续排队者）
    await jest.advanceTimersByTimeAsync(1100);
    const release2 = await limiter.acquire();
    expect(release2).not.toBeNull();
    release1();
    release2();
  });

  it('maxWaitMs：令牌先到则正常放行（不等满超时）', async () => {
    jest.useFakeTimers();
    const limiter = new RpmLimiter('t', 60);
    const release1 = await limiter.acquire();
    const pending = limiter.acquire({ maxWaitMs: 5000 });
    await jest.advanceTimersByTimeAsync(1100);
    const release2 = await pending;
    expect(release2).not.toBeNull();
    release1();
    release2();
  });
});

describe('RPM 设置归一化', () => {
  it('平台全局：非法/负数归 0（不限），上限钳制 100000', () => {
    expect(normalizePlatformReliabilitySettings({ platformRpmLimit: -5 }).platformRpmLimit).toBe(0);
    expect(normalizePlatformReliabilitySettings({ platformRpmLimit: 'abc' as unknown as number }).platformRpmLimit).toBe(0);
    expect(normalizePlatformReliabilitySettings({ platformRpmLimit: 999999 }).platformRpmLimit).toBe(100000);
    expect(normalizePlatformReliabilitySettings({ platformRpmLimit: 300 }).platformRpmLimit).toBe(300);
  });

  it('虚拟学习者：非法/负数归 0（不限）', () => {
    expect(normalizeVirtualLabSettings({ virtualLearnerRpmLimit: -1 }).virtualLearnerRpmLimit).toBe(0);
    expect(normalizeVirtualLabSettings({ virtualLearnerRpmLimit: 120 }).virtualLearnerRpmLimit).toBe(120);
    expect(normalizeVirtualLabSettings({}).virtualLearnerRpmLimit).toBe(0);
  });
});
