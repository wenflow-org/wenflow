/**
 * 回归：task-completion 写入的学习状态指标必须是 **0-10 量纲**
 *
 * 历史缺陷（2026-09-16 修复）：`LearningMetricService.updateLearningMetrics` 在派生 LSS 时
 * 多除了一个 10（0-100 私有公式时代的遗留），而 `calculateLSS` 已 clamp 到 0-10 →
 * 线上出现 lss=0.4 / ktl≈1 / lf≈1 / lsb≈0 的"看起来毫无压力"的状态，
 * 而消费者阈值按 0-10 写（lf≥6 判疲劳、ktl≥6 判可加速），导致 20 人中 17 人的
 * 难度/节奏自适应分支静默失效（见 src/scripts/audit-learning-metrics-scale.ts）。
 */
import { learningStateService } from '../../learning/learning-state.service';
import { updateLearningMetrics } from '../LearningMetricService';

describe('toInternalTenScale（量纲归一的唯一口径）', () => {
  it('0-10 原样保留；0-100 除以 10；越界 clamp', () => {
    expect(learningStateService.toInternalTenScale(4)).toBe(4);
    expect(learningStateService.toInternalTenScale(0.4)).toBe(0.4);
    expect(learningStateService.toInternalTenScale(40)).toBe(4);
    expect(learningStateService.toInternalTenScale(120)).toBe(10);
    expect(learningStateService.toInternalTenScale(-3)).toBe(0);
    expect(learningStateService.toInternalTenScale(Number.NaN)).toBe(0);
  });
});

describe('updateLearningMetrics：LSS 不再被多除一个 10', () => {
  /** 捕获派生回调，直接用给定 previous 调用它（不落库） */
  async function captureDerive() {
    let captured: ((previous: any) => any) | null = null;
    jest.spyOn(learningStateService, 'commitDerivedDisplayMetrics').mockImplementation((async (
      _userId: string,
      derive: (previous: any) => any,
    ) => {
      captured = derive;
      return { lss: 1, ktl: 1, lf: 1, lsb: 0, timestamp: new Date() } as any;
    }) as any);
    await updateLearningMetrics({
      userId: 'u1',
      taskId: 't1',
      durationMinutes: 25,
      completed: true,
      subjectiveDifficulty: 6,
      lssScore: 4,
    });
    return captured!;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('0-10 的 lssScore(4) → display 刻度 40（落库再 /10 = 内部 4，不再被压成 0.4）', async () => {
    const derive = await captureDerive();
    const result = await derive(null);
    // 回调输出契约 = display(0-100)：commitDisplayMetrics 会 displayTenScaleToInternal 除 10
    expect(result.lss).toBe(40);
    expect(result.ktl).toBeCloseTo(20, 5);         // 无前值：lssDisplay * 0.5
    expect(result.lf).toBeCloseTo(12, 5);          // 无前值：lssDisplay * 0.3
    expect(result.lsb).toBeCloseTo(8, 5);
    expect(result.source).toBe('task-completion');
    // 回归护栏：绝不能再出现 0-1 量纲的 lss（历史缺陷特征）
    expect(result.lss).toBeGreaterThan(1);
  });

  it('0-100 的口径也能被正确收敛（不再依赖调用方统一）', async () => {
    let captured: ((previous: any) => any) | null = null;
    jest.spyOn(learningStateService, 'commitDerivedDisplayMetrics').mockImplementation((async (
      _userId: string,
      derive: (previous: any) => any,
    ) => {
      captured = derive;
      return { lss: 1, ktl: 1, lf: 1, lsb: 0, timestamp: new Date() } as any;
    }) as any);
    await updateLearningMetrics({
      userId: 'u1', taskId: 't2', durationMinutes: 25, completed: true, lssScore: 40,
    });
    expect((await captured!(null)).lss).toBe(40);
  });

  it('有前值时 EWMA 全程在同一刻度（前值 0-10 → display 50，与新值 40 收敛）', async () => {
    const derive = await captureDerive();
    const result = await derive({ lss: 5, ktl: 5, lf: 5, lsb: 0, timestamp: new Date() });
    expect(result.ktl).toBeCloseTo(50 * 0.95 + 40 * 0.05, 5);
    expect(result.lf).toBeCloseTo(50 * 0.7 + 40 * 0.15, 5);
  });
});
