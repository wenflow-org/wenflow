import { inferMaxWeeksFromTimeHorizon, derivePlanningHints, derivePlannedOutline, buildFramedNormalizedInput } from '../path-planning-hints';
import { paceSignalRangeConfig } from '../../../config/pedagogy.config';

/**
 * 走查 P7：预览承诺的阶段数必须与真实生成一致（两边都走 derivePlanningHints，同源）。
 * 体量口径（A′，2026-09-20）：scope_size 只作**下界参考**，计数以 key_stages 为准；
 * 上界取 scope 与 pace 中较松者再压硬上限 8 —— 保留防膨胀，同时不让"~95% small"的退化信号压小。
 */
describe('derivePlannedOutline（预览口径与生成同源）', () => {
  it('4 段大纲 + scope_size=small → 生成口径 4 段（不再被 scopeCap=3 砍掉）', () => {
    const result = derivePlannedOutline({
      key_stages: ['环境搭建与基础认知', 'Python 操作 Excel 核心技能', '周报自动化脚本开发与调试', '流程优化与异常处理'],
      scope_size: 'small',
    });
    expect(result.plannedMilestones).toBe(4);
    expect(result.stages).toHaveLength(4); // 清洗只剔操作性阶段
  });

  it('scope 与大纲自洽时不缩水（medium + 4 段 → 4）', () => {
    const result = derivePlannedOutline({
      key_stages: ['一', '二', '三', '四'],
      scope_size: 'medium',
    });
    expect(result.plannedMilestones).toBe(4);
  });

  it('缺 scope_size 时按段数归一（下限 2）', () => {
    expect(derivePlannedOutline({ key_stages: ['一'] }).plannedMilestones).toBe(2);
    expect(derivePlannedOutline({ key_stages: [] }).plannedMilestones).toBeNull();
  });

  it('不再正则剔除「操作性阶段」：原样保留（方案乙——交给 LLM 判断）', () => {
    const result = derivePlannedOutline({
      key_stages: ['环境搭建', '4. 梳理本周任务清单', '脚本开发'],
      scope_size: 'medium',
    });
    // 旧行为按动词前缀黑名单删掉"梳理…"，还会误删"学习/设计/分析…"开头的真阶段（实测删过"设计…固定动作"）
    expect(result.stages).toEqual(['环境搭建', '4. 梳理本周任务清单', '脚本开发']);
    expect(result.plannedMilestones).toBe(3); // 建议值
    expect(result.milestoneRange).toEqual([3, 5]); // 权威区间
  });

  it('兼容 camelCase 键（handoff 形态）', () => {
    expect(derivePlannedOutline({ keyStages: ['一', '二', '三'], scopeSize: 'small' }).plannedMilestones).toBe(3);
  });

  it('非对象输入安全返回', () => {
    expect(derivePlannedOutline(null)).toEqual({ plannedMilestones: null, milestoneRange: null, stages: [] });
  });
});

describe('体量与节奏分轴（A′）：scope 降为下界、计数以 keyStages 为准', () => {
  it('small + 5 段（pace=standard 上界 5）→ 5', () => {
    expect(derivePlannedOutline({ key_stages: ['一', '二', '三', '四', '五'], scope_size: 'small' }).plannedMilestones).toBe(5);
  });

  it('紧节奏（compact）仍保留防膨胀：small + 4 段 → 3', () => {
    const hints = derivePlanningHints('1天', null, null, null, ['一', '二', '三', '四'], null, 'small');
    expect(hints.paceSignal).toBe('compact');
    expect(hints.targetMilestones).toBe(3); // cap = min(8, max(scope 3, pace 3)) = 3
  });

  it('宽松节奏（extended）允许铺开：small + 6 段 → 6', () => {
    const hints = derivePlanningHints('三个月', null, null, null, ['一', '二', '三', '四', '五', '六'], null, 'small');
    expect(hints.paceSignal).toBe('extended');
    expect(hints.targetMilestones).toBe(6); // cap = min(8, max(scope 3, pace 8)) = 8
  });

  it('micro：floor 来自 scope（1），不会被无条件抬到 2', () => {
    expect(derivePlanningHints(null, null, null, null, ['一'], null, 'micro').targetMilestones).toBe(1);
  });

  it('无 scope 时行为不变', () => {
    expect(derivePlanningHints(null, null, null, null, ['一', '二', '三'], null, null).targetMilestones).toBe(3);
    expect(derivePlanningHints(null, null, null, null, [], null, null).targetMilestones).toBeNull();
  });
});

describe('inferMaxWeeksFromTimeHorizon（自由文本周数兜底）', () => {
  const cases: Array<{ input: string | null; expected: number | null; label: string }> = [
    { input: null, expected: null, label: 'null' },
    { input: '   ', expected: null, label: '空白' },
    { input: 'null', expected: null, label: '字面null字符串→null' },
    { input: 'undefined', expected: null, label: '字面undefined字符串→null' },
    { input: '三个月', expected: 12.9, label: '三个月→12.9周' },
    { input: '半年', expected: 26, label: '半年→26周' },
    { input: '一年', expected: 52, label: '一年→52周' },
    { input: '3个月', expected: 12.9, label: '3个月→12.9周' },
    { input: '两周', expected: 2, label: '两周→2周' },
    { input: '三个星期', expected: 3, label: '三个星期→3周' },
    { input: '四天', expected: 4 / 7, label: '四天→0.57周' },
    { input: '两三天', expected: 3 / 7, label: '两三天→0.43周（按3天）' },
    { input: '下周复诊前，剩四天', expected: 4 / 7, label: '下周复诊剩四天→0.57周' },
    { input: '明天早上就要交', expected: 1, label: '明天早上就要交→1周' },
    { input: '下周五上午', expected: 1, label: '下周五上午→1周（截止信号）' },
    { input: '周五见', expected: null, label: '周五是weekday不是5周→null' },
    { input: '上半年（1月到6月）', expected: 4.3, label: '上半年1到6月→4.3周（按1月）' },
    { input: '有空就剪，灵感来了能到半夜', expected: null, label: '无时间信号→null' },
    { input: '周末', expected: 1, label: '仅"周末"→1周（短周期信号）' },
  ];

  it.each(cases)('$label', ({ input, expected }) => {
    const actual = inferMaxWeeksFromTimeHorizon(input);
    if (expected === null) {
      expect(actual).toBeNull();
    } else {
      expect(actual).not.toBeNull();
      expect(actual).toBeCloseTo(expected, 1);
    }
  });
});

describe('derivePlanningHints maxWeeks 兜底链路', () => {
  it('timeDimensions 缺失时用自由文本钳制紧迫场景', () => {
    const hints = derivePlanningHints('下周复诊前，剩四天', '晚上量一次', '每晚10分钟', 'per_day', []);
    // 0.57 周 × 1.2 → ceil = 1，不再回退 extended 的 24
    expect(hints.maxWeeks).toBe(1);
  });

  it('自由文本无时间信号时兜底 standard（不再默认 extended）', () => {
    const hints = derivePlanningHints('有空就剪，灵感来了能到半夜', null, null, null, []);
    expect(hints.maxWeeks).toBe(8);
  });

  it('timeDimensions.totalWeeks 优先于自由文本', () => {
    const hints = derivePlanningHints(
      '三个月', '每周两次', '每周两次', 'per_week',
      [],
      { totalWeeks: 12, estimatedHours: null, sessionsPerWeek: null, sessionsLengthMin: null }
    );
    expect(hints.maxWeeks).toBe(Math.min(52, Math.max(1, Math.ceil(12 * 1.2)))); // 15
  });
});

describe('inferPaceSignal（节奏档兜底：未命中映射表时按周数分档，不再一律 extended）', () => {
  it('两周 / 一个月 → standard（不再 extended）', () => {
    expect(derivePlanningHints('两周', null, null, null, []).paceSignal).toBe('standard');
    expect(derivePlanningHints('一个月', null, null, null, []).paceSignal).toBe('standard');
  });
  it('三个月 / 半年 → extended', () => {
    expect(derivePlanningHints('三个月', null, null, null, []).paceSignal).toBe('extended');
    expect(derivePlanningHints('半年', null, null, null, []).paceSignal).toBe('extended');
  });
  it('null / 未明确 → standard（不再 extended）', () => {
    expect(derivePlanningHints(null, null, null, null, []).paceSignal).toBe('standard');
    expect(derivePlanningHints('未明确', null, null, null, []).paceSignal).toBe('standard');
  });
  it('半天 / 1天 → compact（映射表优先，不变）', () => {
    expect(derivePlanningHints('半天', null, null, null, []).paceSignal).toBe('compact');
    expect(derivePlanningHints('1天', null, null, null, []).paceSignal).toBe('compact');
  });
  it('下周复诊前，剩四天 → compact（短周期）', () => {
    expect(derivePlanningHints('下周复诊前，剩四天', null, null, null, []).paceSignal).toBe('compact');
  });
});

describe('scope_size（问题规模钳制里程碑数）', () => {
  it('micro 是定义类（1-2 段）：建议值夹到 2，区间 [1,2]', () => {
    const hints = derivePlanningHints('三个月', null, null, null, ['S1', 'S2', 'S3', 'S4', 'S5'], null, 'micro');
    expect(hints.targetMilestones).toBe(2);
    expect(hints.milestoneRange).toEqual([1, 2]);
    expect(hints.scopeSize).toBe('micro');
  });
  it('small 允许被 pace 放宽（extended）：keyStages 5 → 5（不再被 scopeCap=3 砍到 3）', () => {
    const hints = derivePlanningHints('三个月', null, null, null, ['S1', 'S2', 'S3', 'S4', 'S5'], null, 'small');
    expect(hints.targetMilestones).toBe(5); // cap = min(8, max(scope 3, pace extended 8)) = 8
  });
  it('medium 允许到 5：keyStages 给 5 个保留 5', () => {
    const hints = derivePlanningHints('三个月', null, null, null, ['S1', 'S2', 'S3', 'S4', 'S5'], null, 'medium');
    expect(hints.targetMilestones).toBe(5);
  });
  it('large 允许到 8：keyStages 给 8 个保留 8', () => {
    const hints = derivePlanningHints('三个月', null, null, null, Array.from({ length: 8 }, (_, i) => `S${i}`), null, 'large');
    expect(hints.targetMilestones).toBe(8);
  });
  it('无 scope_size 时回退旧行为（keyStages 直接 clamp 2-8）', () => {
    const hints = derivePlanningHints('三个月', null, null, null, ['S1', 'S2', 'S3', 'S4', 'S5'], null, null);
    expect(hints.targetMilestones).toBe(5);
    expect(hints.scopeSize).toBeNull();
  });
  it('scope_size 改变 subtasksPerStageRange：micro 兜底不再落到 1', () => {
    const hints = derivePlanningHints('三个月', null, null, null, ['S1', 'S2'], null, 'micro');
    expect(hints.targetSubtasksPerStage).toBe(2);
    expect(hints.subtasksPerStageRange).toEqual([2, 3]);
  });
});

describe('targetMilestones 降级为建议值 + milestoneRange 为权威区间（方案乙）', () => {
  it('keyStages 数作为建议值；区间给边界', () => {
    const hints = derivePlanningHints('三个月', null, null, null, ['S1', 'S2', 'S3']);
    expect(hints.targetMilestones).toBe(3);
    expect(hints.milestoneRange).toEqual([2, 8]); // 无 scope：下界 2、上界硬上限 8
  });

  it('keyStages 缺失时建议值为 null，区间仍给边界（不再沿用 pace 区间）', () => {
    const hints = derivePlanningHints('三个月', null, null, null, [], null);
    expect(hints.targetMilestones).toBeNull();
    expect(hints.milestoneRange).toEqual([2, 8]);
  });

  it('方案丙：无 scope 时上界由节奏给（standard→5、extended→8），下界仍 2', () => {
    const low = derivePlanningHints(null, null, null, null, ['S1']);
    expect(low.targetMilestones).toBe(2);
    // 无时间信号 → pace=standard → cap = min(8, 5) = 5
    const mid = derivePlanningHints(null, null, null, null, Array.from({ length: 12 }, (_, i) => `S${i}`));
    expect(mid.targetMilestones).toBe(5);
    // 长周期 → pace=extended → cap = min(8, 8) = 8
    const wide = derivePlanningHints('三个月', null, null, null, Array.from({ length: 12 }, (_, i) => `S${i}`));
    expect(wide.targetMilestones).toBe(8);
  });
});

describe('targetSubtasksPerStage（每阶段任务数，总学时/里程碑数推导 + 兜底）', () => {
  it('有 estimatedHours 与 keyStages 时推导每阶段任务数，range 同步精确化', () => {
    // 12h 总学时 / 3 里程碑 / 每任务 1h → 4 个/阶段
    const hints = derivePlanningHints(
      '三个月', null, null, null, ['S1', 'S2', 'S3'],
      { totalWeeks: 12, estimatedHours: 12, sessionsPerWeek: null, sessionsLengthMin: null }
    );
    expect(hints.targetSubtasksPerStage).toBe(4);
    expect(hints.subtasksPerStageRange).toEqual([4, 4]);
  });

  it('estimatedHours 缺失但频率信息完整时由 totalWeeks×sessionsPerWeek×分钟/60 推算总学时', () => {
    // 4周 × 2次/周 × 60分钟 = 8h 总学时 / 4里程碑 = 2 个/阶段
    const hints = derivePlanningHints(
      null, null, null, null, ['S1', 'S2', 'S3', 'S4'],
      { totalWeeks: 4, estimatedHours: null, sessionsPerWeek: 2, sessionsLengthMin: 60 }
    );
    expect(hints.targetSubtasksPerStage).toBe(2);
    expect(hints.subtasksPerStageRange).toEqual([2, 2]);
  });

  it('estimatedHours 与频率都缺失时用 pace 档位下限兜底（不再 null）', () => {
    const hints = derivePlanningHints('三个月', null, null, null, ['S1', 'S2', 'S3'], null);
    // extended subtasksPerStageRange=[4,6]，兜底目标取下限 4；区间保留 [4,6] 不再塌成单点
    expect(hints.targetSubtasksPerStage).toBe(4);
    expect(hints.subtasksPerStageRange).toEqual([4, 6]);
  });

  it('每阶段任务数超出范围时按 pace 区间上限夹取（无 scope 时 standard 上限 5）', () => {
    // 30h / 3 里程碑 / 1h → 10，null 时间 → standard subtasksPerStageRange=[3,5]，夹取到 5
    const high = derivePlanningHints(
      null, null, null, null, ['S1', 'S2', 'S3'],
      { totalWeeks: null, estimatedHours: 30, sessionsPerWeek: null, sessionsLengthMin: null }
    );
    expect(high.targetSubtasksPerStage).toBe(5);
    // 1.4h / 4 里程碑 → ~0.35，下限硬编码 2
    const low = derivePlanningHints(
      null, null, null, null, ['S1', 'S2', 'S3', 'S4'],
      { totalWeeks: null, estimatedHours: 1.4, sessionsPerWeek: null, sessionsLengthMin: null }
    );
    expect(low.targetSubtasksPerStage).toBe(2);
  });

  it('perStageFromHours 上界被 pace 夹住（small + extended）：16h/3≈5 → 5', () => {
    const hints = derivePlanningHints(
      '三个月', null, null, null, ['S1', 'S2', 'S3'],
      { totalWeeks: 2, estimatedHours: 16, sessionsPerWeek: 6, sessionsLengthMin: 60 },
      'small'
    );
    // A″：上界取 max(scope small 3, pace extended 6) = 6，故 16h/3≈5 不再被 scope 的 3 砍到 3；仍受 6 夹住
    expect(hints.targetSubtasksPerStage).toBe(5);
    expect(hints.subtasksPerStageRange).toEqual([5, 5]);
  });

  it('keyStages 缺失时 targetSubtasksPerStage 为 null，沿用 pace 区间', () => {
    const hints = derivePlanningHints('三个月', null, null, null, [], null);
    expect(hints.targetSubtasksPerStage).toBeNull();
    expect(hints.subtasksPerStageRange).toEqual(paceSignalRangeConfig.extended.subtasksPerStageRange);
  });
});

describe('缺陷修复：学时未知时每阶段任务数不再落到 1', () => {
  it('scope=micro 且 estimatedHours 缺失 → targetSubtasksPerStage >= 2 且落在返回区间内', () => {
    const micro = derivePlanningHints('三个月', null, null, null, ['S1', 'S2'], null, 'micro');
    expect(micro.targetSubtasksPerStage).toBeGreaterThanOrEqual(2);
    expect(micro.subtasksPerStageRange[0]).toBeLessThanOrEqual(micro.targetSubtasksPerStage as number);
    expect(micro.subtasksPerStageRange[1]).toBeGreaterThanOrEqual(micro.targetSubtasksPerStage as number);
    expect(micro.subtasksPerStageRange).toEqual([2, 3]);
  });

  it('无 scope 且学时/频率都缺失 → 目标仍 >= 2 且不塌成单点区间', () => {
    const hints = derivePlanningHints(null, null, null, null, ['S1', 'S2', 'S3'], null);
    expect(hints.targetSubtasksPerStage).toBeGreaterThanOrEqual(2);
    expect(hints.subtasksPerStageRange[0]).toBeLessThanOrEqual(hints.targetSubtasksPerStage as number);
    expect(hints.subtasksPerStageRange[1]).toBeGreaterThanOrEqual(hints.targetSubtasksPerStage as number);
    // 旧行为会把区间精确化成 [target,target]，现在兜底保留 [≥2, cap]
    expect(hints.subtasksPerStageRange).toEqual([3, 5]);
  });

  it('estimatedHours 存在时每阶段任务数仍精确化；里程碑区间按方案乙给边界', () => {
    const hints = derivePlanningHints(
      '三个月', null, null, null, ['S1', 'S2', 'S3'],
      { totalWeeks: 12, estimatedHours: 12, sessionsPerWeek: null, sessionsLengthMin: null }
    );
    expect(hints.targetSubtasksPerStage).toBe(4);
    expect(hints.subtasksPerStageRange).toEqual([4, 4]);
    expect(hints.milestoneRange).toEqual([2, 8]);
    expect(hints.maxWeeks).toBe(15);
  });
});

describe('可选负荷画像 learnerLoadProfile（加性参数，不传零差异）', () => {
  it('紧预算 + 极低耐受 → 收紧里程碑数 / 单任务分钟 / 周期 / 每阶段任务数', () => {
    const tightened = derivePlanningHints(
      '三个月', null, null, null, ['S1', 'S2', 'S3'], null, 'medium',
      { availableTime: 'minimal', loadTolerance: '信息一多就容易乱，三步以上就放弃' }
    );
    expect(tightened.targetMilestones).toBe(2);
    expect(tightened.milestoneRange).toEqual([2, 2]);
    expect(tightened.subtaskMinutesRange).toEqual([30, 45]);
    expect(tightened.maxWeeks).toBe(2);
    // medium 下界本就是 3；低耐受把上界从 5 收到 3
    expect(tightened.subtasksPerStageRange).toEqual([3, 3]);
    expect(tightened.targetSubtasksPerStage).toBe(3);
  });

  it('碎片化节奏（per_day）在传入负荷画像时也触发收紧', () => {
    const withoutCadence = derivePlanningHints(
      '三个月', null, null, null, ['S1', 'S2', 'S3'], null, 'medium',
      { availableTime: 'moderate' }
    );
    const withCadence = derivePlanningHints(
      '三个月', null, null, 'per_day', ['S1', 'S2', 'S3'], null, 'medium',
      { availableTime: 'moderate' }
    );
    expect(withoutCadence.maxWeeks).toBe(16); // moderate + 无 cadence：仅按三个月推断（12.9×1.2→16），不收紧
    expect(withCadence.maxWeeks).toBe(2);     // per_day + 负荷画像：触发收紧
    expect(withCadence.subtaskMinutesRange[1]).toBeLessThanOrEqual(45);
  });

  it('不传 learnerLoadProfile 与传入非紧画像逐字段一致（加性参数零差异）', () => {
    const without = derivePlanningHints('三个月', null, null, null, ['S1', 'S2', 'S3'], null, 'medium');
    const nonTight = derivePlanningHints(
      '三个月', null, null, null, ['S1', 'S2', 'S3'], null, 'medium',
      { availableTime: 'abundant', loadTolerance: '较高，能长时间专注' }
    );
    expect(nonTight).toEqual(without);
    // 非紧画像也不改变 defect-1 修复后的兜底结果
    expect(without.targetSubtasksPerStage).toBe(3);
    expect(without.subtasksPerStageRange).toEqual([3, 6]); // A″：上界取 max(scope medium 5, pace extended 6)
  });
});

describe('buildFramedNormalizedInput：currentBaseline.level 归一为契约枚举（修 2）', () => {
  const levelOf = (input: Parameters<typeof buildFramedNormalizedInput>[0]) =>
    buildFramedNormalizedInput(input).learnerProfile.currentBaseline.level;

  it('明确水平词 → 对应枚举', () => {
    expect(levelOf({ learnerProfile: { currentBaseline: { level: '零基础' } } })).toBe('beginner');
    expect(levelOf({ learnerProfile: { currentBaseline: { level: '新手' } } })).toBe('beginner');
    expect(levelOf({ learnerProfile: { currentBaseline: { level: '中级' } } })).toBe('intermediate');
    expect(levelOf({ learnerProfile: { currentBaseline: { level: '熟练' } } })).toBe('advanced');
    expect(levelOf({ learnerProfile: { currentBaseline: { level: 'BEGINNER' } } })).toBe('beginner');
  });

  it('缺失 / 长句自述 → unknown（不再把「缺失」等同 beginner）', () => {
    expect(levelOf({ learnerProfile: {} })).toBe('unknown');
    expect(levelOf({ learnerProfile: { currentBaseline: {} } })).toBe('unknown');
    expect(
      levelOf({
        learnerProfile: {
          currentBaseline: { level: '非零基础：护理本科、ICU 临床十几年，具备医药卫生专业背景' },
        },
      })
    ).toBe('unknown');
  });
});

describe('derivePlanningHints：紧预算同时收紧建议值与区间上界（修 3 + 方案乙）', () => {
  it('medium + 紧预算（per_day 20 分钟）→ 上界被收紧', () => {
    const tight = derivePlanningHints(null, null, '每天20分钟', 'per_day', ['一', '二', '三', '四', '五'], null, 'medium');
    expect(tight.targetMilestones).toBe(4);
    expect(tight.milestoneRange).toEqual([2, 4]);
  });

  it('非紧预算不受影响（medium 5 段 → 5）', () => {
    const normal = derivePlanningHints(null, null, '每天60分钟', 'per_day', ['一', '二', '三', '四', '五'], null, 'medium');
    expect(normal.targetMilestones).toBe(5);
    expect(normal.milestoneRange).toEqual([3, 5]);
  });
});
