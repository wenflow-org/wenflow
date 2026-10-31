/**
 * P0.1 绝对日期采集（TIME-TRUST-SCHEME-20261001）。
 *
 * 契约：goal 对话模型从对话中解析外部截止的**绝对日期**（understanding.deadline_date，YYYY-MM-DD，
 * 可空），经 visibleSummary.resources.deadlineDate 透传到 path.coordinator；
 * path.coordinator 侧模型日期优先（L1 硬锚），既有正则启发式（相对表述推算）保留为
 * 「无模型日期时的兜底」。
 *
 * 配置口径（2026-10-08 核对）：现网 agent_lab_configs 为空，getPathAgentInputConfig 恒返回
 * DEFAULT_PATH_AGENT_INPUT_CONFIG，且其 deadlineTextSources 路径与 buildNormalizedGoalInput
 * 内部 source 形状一致（`visibleSummary.resources.deadlineText` / `visibleSummary.resources.timeHorizon`
 * / `understanding.available_resources.time_horizon` / `understanding.deadline_text`）。
 * 所以这里 mock 也直接用 requireActual 真默认配置——路径一旦被改坏（如旧的
 * `goalFinalPayload.xxx` 文案），本套用例会立刻红。
 */
import { buildGoalPathVisibleSummary, normalizeDeadlineDate } from '../goal-path-visible-summary';

jest.mock('../../agentConfig.service', () => {
  const actual = jest.requireActual('../../agentConfig.service');
  return {
    DEFAULT_PATH_AGENT_INPUT_CONFIG: actual.DEFAULT_PATH_AGENT_INPUT_CONFIG,
    getPathAgentInputConfig: jest.fn(async () => actual.DEFAULT_PATH_AGENT_INPUT_CONFIG),
  };
});

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import pathOrchestrator from '../../../coordinators/path.coordinator';

describe('normalizeDeadlineDate（绝对日期归一化）', () => {
  it('YYYY-MM-DD 合法日期原样返回', () => {
    expect(normalizeDeadlineDate('2027-01-05')).toBe('2027-01-05');
  });

  it('带时间部分的 ISO 串取日期部分', () => {
    expect(normalizeDeadlineDate('2027-01-05T09:30:00Z')).toBe('2027-01-05');
    expect(normalizeDeadlineDate('2027-01-05 09:30')).toBe('2027-01-05');
  });

  it('Date 实例转 YYYY-MM-DD', () => {
    expect(normalizeDeadlineDate(new Date('2027-01-05T00:00:00Z'))).toBe('2027-01-05');
  });

  it('非法日历日（2026-02-30）返回 null——宁缺勿错', () => {
    expect(normalizeDeadlineDate('2026-02-30')).toBeNull();
    expect(normalizeDeadlineDate('2026-13-01')).toBeNull();
  });

  it('相对表述（"三个月后"）不是绝对日期 → null（正则启发式兜底负责）', () => {
    expect(normalizeDeadlineDate('三个月后')).toBeNull();
    expect(normalizeDeadlineDate('下周汇报前')).toBeNull();
  });

  it('缺失/空串/非字符串 → null', () => {
    expect(normalizeDeadlineDate(null)).toBeNull();
    expect(normalizeDeadlineDate(undefined)).toBeNull();
    expect(normalizeDeadlineDate('')).toBeNull();
    expect(normalizeDeadlineDate('   ')).toBeNull();
    expect(normalizeDeadlineDate(42)).toBeNull();
  });

  it('非法 Date 实例 → null', () => {
    expect(normalizeDeadlineDate(new Date('not-a-date'))).toBeNull();
  });
});

describe('buildGoalPathVisibleSummary · deadline_date 透传（P0.1）', () => {
  it('understanding.deadline_date 进入 resources.deadlineDate', () => {
    const visible = buildGoalPathVisibleSummary({
      understanding: { deadline_date: '2027-01-05', deadline_text: '2027年1月5日考试' },
      confirmedProposal: null,
      collected: {},
    });
    expect(visible.resources?.deadlineDate).toBe('2027-01-05');
    expect(visible.resources?.deadlineText).toBe('2027年1月5日考试');
  });

  it('相对表述的 deadline_date 不透传（null），deadlineText 照旧', () => {
    const visible = buildGoalPathVisibleSummary({
      understanding: { deadline_date: '三个月后', deadline_text: '三个月后' },
      confirmedProposal: null,
      collected: {},
    });
    expect(visible.resources?.deadlineDate).toBeNull();
    expect(visible.resources?.deadlineText).toBe('三个月后');
  });

  it('只有绝对日期、无其它资源时 resources 仍然产出', () => {
    const visible = buildGoalPathVisibleSummary({
      understanding: { deadline_date: '2027-01-05' },
      confirmedProposal: null,
      collected: {},
    });
    expect(visible.resources).not.toBeNull();
    expect(visible.resources?.deadlineDate).toBe('2027-01-05');
  });
});

describe('path.coordinator · 模型绝对日期优先，正则启发式兜底（P0.1）', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 探针/测试：visibleSummary 形状内在动态（对齐 path.coordinator.material.test 先例）
  const baseVisible = (over: Record<string, unknown>): any => ({
    surfaceGoal: '三个月后考试',
    realProblem: '备考时间不够',
    resources: {
      timeBudget: '每天1小时',
      timeBudgetCadence: 'per_day',
      timePerWeek: '每天1小时',
      timePerSession: null,
      timeHorizon: '三个月',
      deadlineText: '三个月',
      deadlineDate: null,
      ...over,
    },
    successCriteria: null,
    confirmedProposal: null,
  });

  it('有模型日期：deadline 精确落模型日期，不再按「三个月」相对推算', async () => {
    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u-deadline-1',
      rawGoal: '三个月后考试',
      visibleSummary: baseVisible({ deadlineText: '三个月', deadlineDate: '2027-01-05' }),
    });
    expect(result.deadline).toBeTruthy();
    expect((result.deadline as Date).getTime()).toBe(new Date('2027-01-05T00:00:00').getTime());
    // 自由文本照旧保留，供展示
    expect(result.deadlineText).toBe('三个月');
  });

  it('无模型日期：「3 个月」走正则启发式推算（兜底行为与原先一致）', async () => {
    const before = Date.now();
    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u-deadline-2',
      rawGoal: '三个月后考试',
      visibleSummary: baseVisible({ deadlineText: '3 个月', deadlineDate: null }),
    });
    expect(result.deadline).toBeTruthy();
    const deadlineMs = (result.deadline as Date).getTime();
    // 兜底 = now + 3 个月（正则推算）；宽松夹在 +89 天 ~ +95 天之间即视为同口径
    expect(deadlineMs).toBeGreaterThanOrEqual(before + 89 * 86_400_000);
    expect(deadlineMs).toBeLessThanOrEqual(before + 95 * 86_400_000);
  });

  it('无模型日期且无 deadlineText：timeHorizon「2 周」作为默认配置第 2 顺位源兜底', async () => {
    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u-deadline-2b',
      rawGoal: '两周后汇报',
      visibleSummary: baseVisible({ deadlineText: null, timeHorizon: '2 周', deadlineDate: null }),
    });
    expect(result.deadline).toBeTruthy();
    const days = ((result.deadline as Date).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(12);
    expect(days).toBeLessThan(16);
    expect(result.deadlineText).toBe('2 周');
  });

  it('模型日期非法（相对表述）→ 不阻断，正则兜底仍生效', async () => {
    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u-deadline-3',
      rawGoal: '三个月后考试',
      visibleSummary: baseVisible({ deadlineText: '2 周', deadlineDate: '尽快' }),
    });
    expect(result.deadline).toBeTruthy();
    const days = ((result.deadline as Date).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(10);
    expect(days).toBeLessThan(18);
  });

  it('完全无截止信号（deadlineText/timeHorizon/模型日期皆空）→ deadline 与 deadlineText 均缺失', async () => {
    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u-deadline-4',
      rawGoal: '随便学学',
      visibleSummary: baseVisible({ deadlineText: null, timeHorizon: null, deadlineDate: null }),
    });
    expect(result.deadline).toBeUndefined();
    expect(result.deadlineText).toBeUndefined();
  });
});

/**
 * R8（2026-10-27）：deadlineDate 的镜像源 time_dimensions.deadlineDate。
 * 模型可能只填 time_dimensions.deadlineDate（与 understanding.deadline_date 同值），
 * 归一化/透传层必须能识别，否则「有期限/无期限」在 visibleSummary 与 coordinator 两处漂移。
 */
describe('R8 · time_dimensions.deadlineDate 镜像源', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 探针/测试：visibleSummary 形状内在动态
  const visibleWith = (over: Record<string, unknown>): any => ({
    surfaceGoal: '随便学学',
    realProblem: null,
    resources: {
      timeBudget: null,
      timeBudgetCadence: null,
      timePerWeek: null,
      timePerSession: null,
      timeHorizon: null,
      deadlineText: null,
      deadlineDate: null,
      ...over,
    },
    successCriteria: null,
    confirmedProposal: null,
  });
  it('visibleSummary：只有 time_dimensions.deadlineDate 也进 resources.deadlineDate 与 timeDimensions', () => {
    const visible = buildGoalPathVisibleSummary({
      understanding: {
        time_dimensions: { timeModelVersion: 2, objectiveScopeHours: 18, deadlineDate: '2027-01-05' },
      },
      confirmedProposal: null,
      collected: {},
    });
    expect(visible.resources?.deadlineDate).toBe('2027-01-05');
    expect(visible.timeDimensions?.deadlineDate).toBe('2027-01-05');
    expect(visible.timeDimensions?.objectiveScopeHours).toBe(18);
    expect(visible.timeDimensions?.timeModelVersion).toBe(2);
  });

  it('visibleSummary：无期限时两处都为 null，resources 不因 deadline 产生', () => {
    const visible = buildGoalPathVisibleSummary({
      understanding: {
        time_dimensions: { timeModelVersion: 2, objectiveScopeHours: 20, deadlineDate: null },
      },
      confirmedProposal: null,
      collected: {},
    });
    expect(visible.resources).toBeNull();
    expect(visible.timeDimensions?.deadlineDate).toBeNull();
  });

  it('coordinator：handoff 的 understanding.time_dimensions 能进 normalizedInput（visibleSummary 为空）', async () => {
    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u-r8-1',
      rawGoal: '学会 SQL 调优',
      visibleSummary: visibleWith({}),
      goalHandoffFields: {
        'understanding.time_dimensions': {
          timeModelVersion: 2,
          sessionsLengthMin: 60,
          objectiveScopeHours: 18,
          deadlineDate: '2027-01-05',
        },
      },
    } as Parameters<typeof pathOrchestrator.previewNormalizedGoalInput>[0]);
    const normalized = result.userProfile?.normalizedInput;
    expect(normalized?.timeDimensions?.objectiveScopeHours).toBe(18);
    expect(normalized?.timeDimensions?.deadlineDate).toBe('2027-01-05');
    expect(normalized?.timeDimensions?.timeModelVersion).toBe(2);
    // deadline 也应从 timeDimensions 镜像落到硬锚（handoff 无 understanding.deadline_date）
    expect(result.deadline).toBeTruthy();
    expect((result.deadline as Date).getTime()).toBe(new Date('2027-01-05T00:00:00').getTime());
  });

  it('coordinator：无期限（deadlineDate=null）不产生硬截止', async () => {
    const result = await pathOrchestrator.previewNormalizedGoalInput({
      userId: 'u-r8-2',
      rawGoal: '随便学学',
      visibleSummary: visibleWith({}),
      goalHandoffFields: {
        'understanding.time_dimensions': {
          timeModelVersion: 2,
          objectiveScopeHours: 20,
          deadlineDate: null,
        },
      },
    } as Parameters<typeof pathOrchestrator.previewNormalizedGoalInput>[0]);
    const normalized = result.userProfile?.normalizedInput;
    expect(normalized?.timeDimensions?.objectiveScopeHours).toBe(20);
    expect(normalized?.timeDimensions?.deadlineDate).toBeNull();
    expect(result.deadline).toBeUndefined();
  });
});
