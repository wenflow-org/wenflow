/**
 * 重排规模锚（2026-10-15 双向化）
 *
 * 审计 §七 的结论：重排此前不向 stage-designer 传任务数锚 → designer 掉到「全缺默认 3-6」，
 * 源阶段只有 2 个任务时**只能膨胀**；提示词规则 77 又明令「只能加课数，不能减课缩分钟」。
 * 这两条把重排焊成了单向变长。修法是按「目标阶段学时 × 系数」反推任务数注入
 * `planningHints.targetSubtasksForStage`，系数<1 即压缩。
 */
import {
  REPLAN_ANCHOR_MINUTES_FALLBACK,
  REPLAN_TASK_COUNT_CAP,
  REPLAN_TASK_RATIO,
  buildReplanTaskCount,
  resolveAdvisoryAction,
  resolveReplanTaskRatio,
} from '../path-replan.service';

describe('resolveReplanTaskRatio（两套词汇都要认）', () => {
  it('建议动作（evidence.advisoryAction）优先于 mode', () => {
    // 发送端历史上硬写 mode=overwrite，只有 advisoryAction 携带真实意图
    expect(resolveReplanTaskRatio('overwrite', 'accelerate')).toBe(REPLAN_TASK_RATIO.accelerate);
    expect(resolveReplanTaskRatio('overwrite', 'reinforce')).toBe(REPLAN_TASK_RATIO.reinforce);
  });

  it('accelerate（界面文案=「压缩下一阶段」）与 compress 同系数，且 <1', () => {
    expect(REPLAN_TASK_RATIO.accelerate).toBeLessThan(1);
    expect(REPLAN_TASK_RATIO.accelerate).toBe(REPLAN_TASK_RATIO.compress);
  });

  it('补强/降速方向系数 >1，等量重排 =1', () => {
    expect(REPLAN_TASK_RATIO.reinforce).toBeGreaterThan(1);
    expect(REPLAN_TASK_RATIO.slow_down).toBeGreaterThan(1);
    expect(REPLAN_TASK_RATIO.resequence).toBe(1);
    expect(REPLAN_TASK_RATIO.keep).toBe(1);
  });

  it('认不出/缺省 → 1（等量重排，不误伤）', () => {
    expect(resolveReplanTaskRatio('overwrite', null)).toBe(1);
    expect(resolveReplanTaskRatio(null, '未知动作')).toBe(1);
    expect(resolveReplanTaskRatio(null, null)).toBe(1);
  });
});

describe('resolveAdvisoryAction（老客户端兼容）', () => {
  it('显式 advisoryAction 优先', () => {
    expect(resolveAdvisoryAction({ advisoryAction: 'reinforce', advisory: { recommendation: 'accelerate' } }))
      .toBe('reinforce');
  });

  it('只传 advisory.recommendation 时派生动作（accelerate 不再被当等量重排）', () => {
    expect(resolveAdvisoryAction({ advisory: { recommendation: 'accelerate' } })).toBe('accelerate');
    expect(resolveReplanTaskRatio('overwrite', resolveAdvisoryAction({ advisory: { recommendation: 'accelerate' } })))
      .toBe(REPLAN_TASK_RATIO.accelerate);
  });

  it('两者都缺失 → undefined（等量重排）', () => {
    expect(resolveAdvisoryAction({})).toBeUndefined();
    expect(resolveAdvisoryAction(null)).toBeUndefined();
  });
});

describe('buildReplanTaskCount（学时×系数 → 任务数）', () => {
  const base = { estimatedHours: 6, completedMinutes: 0, ratio: 1, anchorMinutes: 60 };

  it('系数 <1 产出更少任务、>1 更多任务（双向都能表达）', () => {
    const compressed = buildReplanTaskCount({ ...base, ratio: 0.5 });
    const equal = buildReplanTaskCount({ ...base, ratio: 1 });
    const reinforced = buildReplanTaskCount({ ...base, ratio: 1.35 });
    expect(compressed).toBeLessThan(equal);
    expect(equal).toBeLessThan(reinforced);
    expect(compressed).toBe(3);
    expect(equal).toBe(6);
  });

  it('已完成任务不占新任务预算（压缩后可能只剩 1 个）', () => {
    expect(buildReplanTaskCount({ ...base, completedMinutes: 120, ratio: 1 })).toBe(4);
    expect(buildReplanTaskCount({ ...base, completedMinutes: 240, ratio: 0.5 })).toBe(1);
  });

  it('下限 1、上限取 cap，且 cap 优先于默认 8', () => {
    expect(buildReplanTaskCount({ ...base, estimatedHours: 0.1, ratio: 0.5 })).toBe(1);
    expect(buildReplanTaskCount({ ...base, ratio: 5 })).toBe(REPLAN_TASK_COUNT_CAP);
    expect(buildReplanTaskCount({ ...base, ratio: 1, cap: 3 })).toBe(3);
  });

  it('无学时锚 → 返回 0 = 不注入，保持旧行为', () => {
    expect(buildReplanTaskCount({ ...base, estimatedHours: null })).toBe(0);
    expect(buildReplanTaskCount({ ...base, estimatedHours: 0 })).toBe(0);
    expect(buildReplanTaskCount({ ...base, estimatedHours: Number.NaN })).toBe(0);
  });

  it('锚缺失时落到兜底分钟数', () => {
    const count = buildReplanTaskCount({ ...base, anchorMinutes: null });
    expect(count).toBe(Math.round((6 * 60) / REPLAN_ANCHOR_MINUTES_FALLBACK));
  });
});
