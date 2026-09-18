/**
 * resolvePathSubject 回归：
 * path-planning 的 analyzeInput 用 input.goal 当 subject，会把几百字目标原文写进
 * learning_paths.subject，进而污染教学 prompt、管理端内容列表与 Dashboard 路径卡副标题。
 * 口径：subject 简洁则沿用，过长/缺失用清洗后的路径名兜底。
 */
import { MAX_PATH_SUBJECT_LENGTH, resolvePathSubject, cleanPathTitle, buildSceneSummaryFromFraming, normalizeSessionDurationMinutes } from '../learning.helpers';

describe('resolvePathSubject（路径 subject 兜底）', () => {
  it('简洁 subject 原样保留', () => {
    expect(resolvePathSubject('TypeScript', 'TypeScript 入门')).toBe('TypeScript');
    expect(resolvePathSubject('  Python  ', 'Python 入门')).toBe('Python');
  });

  it('目标原文（超长）改用清洗后的路径名兜底', () => {
    const rawGoal = '偏离后没有「最小重启标准」，且该标准在崩溃当下无法被主动想起、也无法被外部形式有效承载。'.repeat(5);
    expect(resolvePathSubject(rawGoal, '二战在家备考偏离重启入门')).toBe('二战在家备考偏离重启入门');
  });

  it('缺失/空白/非字符串 subject 用路径名兜底', () => {
    expect(resolvePathSubject(undefined, '兜底名')).toBe('兜底名');
    expect(resolvePathSubject('', '兜底名')).toBe('兜底名');
    expect(resolvePathSubject('   ', '兜底名')).toBe('兜底名');
    expect(resolvePathSubject(123, '兜底名')).toBe('兜底名');
  });

  it('边界：<= 24 字沿用，> 24 字兜底', () => {
    const justFit = '一'.repeat(MAX_PATH_SUBJECT_LENGTH);
    expect(resolvePathSubject(justFit, '兜底名')).toBe(justFit);
    expect(resolvePathSubject('一'.repeat(MAX_PATH_SUBJECT_LENGTH + 1), '兜底名')).toBe('兜底名');
  });
});

describe('cleanPathTitle', () => {
  it('去掉结尾的「学习路径」等后缀', () => {
    expect(cleanPathTitle('Python 自动化 Excel 学习路径')).toBe('Python 自动化 Excel');
    expect(cleanPathTitle('摄影入门学习计划')).toBe('摄影入门');
  });

  it('无后缀时原样返回', () => {
    expect(cleanPathTitle('二战在家备考偏离重启入门')).toBe('二战在家备考偏离重启入门');
  });
});

describe('buildSceneSummaryFromFraming（设计意图卡数据）', () => {
  const realProblem = '偏离后没有「最小重启标准」，且该标准在崩溃当下无法被主动想起。'.repeat(12);
  const framing = {
    normalizedInput: {
      learnerProfile: { surfaceGoal: '二战在家备考不崩' },
      problemSpace: { realProblem },
      confirmedProposal: { firstDeliverable: '一张重启卡', keyStages: ['阶段一：做卡', '阶段二：跑闭环'] },
      successCriteria: { observableResult: '下次偏离当天不崩' },
      resources: { timeBudget: '每天 1 小时', timeHorizon: '3 周' },
    },
  };

  it('标题用短目标 surfaceGoal，问题原文另置 problemBackground', () => {
    const summary = buildSceneSummaryFromFraming(framing as any, 3, 12);
    expect(summary?.title).toBe('二战在家备考不崩');
    expect(summary?.problemBackground).toContain('最小重启标准');
    expect(summary?.title).not.toBe(summary?.problemBackground);
  });

  it('无 surfaceGoal 时标题回落问题原文，problemBackground 仍保留', () => {
    const noGoal = { normalizedInput: { ...framing.normalizedInput, learnerProfile: {} } };
    const summary = buildSceneSummaryFromFraming(noGoal as any, 3, 12);
    expect(summary?.title).toContain('最小重启标准');
    expect(summary?.problemBackground).toContain('最小重启标准');
  });

  it('保留 firstDeliverable / targetState / planningFocus（是否展示由前端决定）', () => {
    const summary = buildSceneSummaryFromFraming(framing as any, 3, 12);
    expect(summary?.firstDeliverable).toBe('一张重启卡');
    expect(summary?.targetState).toBe('下次偏离当天不崩');
    expect(summary?.planningFocus).toEqual(['阶段一：做卡', '阶段二：跑闭环']);
  });
});

describe('normalizeSessionDurationMinutes（会话时长统一口径）', () => {
  it('优先用 duration 列（已扣除暂停/idle）', () => {
    expect(normalizeSessionDurationMinutes({
      duration: 25,
      startTime: new Date('2026-01-01T00:00:00Z'),
      endTime: new Date('2026-01-01T03:00:00Z'),
    })).toBe(25);
  });

  it('duration 写成秒的历史数据按秒兜底', () => {
    expect(normalizeSessionDurationMinutes({ duration: 3600, startTime: null, endTime: null })).toBe(60);
  });

  it('无 duration 时用 endTime−startTime 兜底，封顶 30 分钟', () => {
    expect(normalizeSessionDurationMinutes({
      duration: null,
      startTime: new Date('2026-01-01T00:00:00Z'),
      endTime: new Date('2026-01-01T00:10:00Z'),
    })).toBe(10);
    expect(normalizeSessionDurationMinutes({
      duration: null,
      startTime: new Date('2026-01-01T00:00:00Z'),
      endTime: new Date('2026-01-01T02:00:00Z'),
    })).toBe(30);
  });

  it('既无 duration 也无 endTime 返回 0（无终点信号时不猜）', () => {
    expect(normalizeSessionDurationMinutes({ duration: null, startTime: new Date(), endTime: null })).toBe(0);
  });

  /**
   * 走查 P9：学了一节课后暂停/离开，此前在历史/学习台显示 0 分钟。
   * 未结束会话按「startTime → 最后活动（扣暂停）」估算，并用消息间隔封顶。
   */
  describe('未结束会话（active/paused）的活跃时长估算', () => {
    const startTime = new Date('2026-09-17T16:11:00Z');
    const messages = [
      { role: 'assistant', timestamp: '2026-09-17T16:11:34Z' },
      { role: 'user', timestamp: '2026-09-17T16:12:22Z' },
      { role: 'assistant', timestamp: '2026-09-17T16:13:10Z' },
      { role: 'user', timestamp: '2026-09-17T16:16:00Z' },
      { role: 'assistant', timestamp: '2026-09-17T16:21:00Z' },
    ];

    it('暂停中：按 pausedAt 收束，而不是按「现在」越算越多', () => {
      const minutes = normalizeSessionDurationMinutes({
        duration: null,
        startTime,
        endTime: null,
        status: 'paused',
        messages,
        teachingState: { sessionArtifacts: { pausedAt: '2026-09-17T16:22:00Z' } },
        updatedAt: new Date('2026-09-17T16:22:00Z'),
      });
      // 16:11 → 16:22 = 11 分钟；消息间隔给出的下界（≈10 + 60 收尾窗）不构成上限
      expect(minutes).toBe(11);
    });

    it('累计暂停时长被扣除（暂停过又回来）', () => {
      const minutes = normalizeSessionDurationMinutes({
        duration: null,
        startTime,
        endTime: null,
        status: 'active',
        messages,
        teachingState: { sessionArtifacts: { pausedDurationMs: 30 * 60 * 1000, pausedAt: null } },
        updatedAt: new Date('2026-09-17T16:41:00Z'),
      });
      // 30 分钟墙钟 − 30 分钟暂停 = 0 → 取 1 分钟下限
      expect(minutes).toBe(1);
    });

    it('消息间隔 >30 分钟视为离开，长挂机不会把 idle 算进学习时长', () => {
      const minutes = normalizeSessionDurationMinutes({
        duration: null,
        startTime,
        endTime: null,
        status: 'active',
        messages: [
          { role: 'assistant', timestamp: '2026-09-17T16:11:00Z' },
          { role: 'user', timestamp: '2026-09-17T18:11:00Z' }, // 隔了 2 小时
        ],
        updatedAt: new Date('2026-09-17T18:11:00Z'),
      });
      // 墙钟 120 分钟被消息封顶（间隔按 30 计 + 60 收尾窗 = 90）
      expect(minutes).toBe(90);
    });
  });
});
